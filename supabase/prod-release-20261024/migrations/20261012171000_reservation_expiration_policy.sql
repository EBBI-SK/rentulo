-- RENTULO V1 / PROD RELEASE CANDIDATE bd1b8d1 / 2026-10-24.
-- Apply only to a verified PROD database after backup and approval.
-- This SQL is staged separately: never copy over TEST migrations.
-- Cron activation is deferred; no automatic deployment is authorized.

-- BOD 12: 24 hours for owner approval, then 24 hours for renter payment.
-- No existing pending/approved PROD reservations are backfilled or expired.
-- Financial safety: never release an open/unknown Stripe checkout session.
begin;


DO $rentulo_prod_release_guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets AS s
    WHERE s.name = 'rentulo_prod_release_target'
      AND s.decrypted_secret = 'tfvgxrdjrpicgtvovehl'
  ) THEN
    RAISE EXCEPTION 'Rentulo PROD release guard missing: check target project and approval';
  END IF;
  IF EXISTS (
    SELECT 1 FROM vault.decrypted_secrets AS s
    WHERE s.name = 'rentulo_project_url'
      AND btrim(s.decrypted_secret, '/') NOT IN
        ('UNCONFIGURED', 'https://tfvgxrdjrpicgtvovehl.supabase.co')
  ) THEN
    RAISE EXCEPTION 'Unexpected runtime project URL; release aborted';
  END IF;
END;
$rentulo_prod_release_guard$;


alter table public.reservations
  add column if not exists expires_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists expired_at timestamptz,
  add column if not exists expiry_reason text;

alter table public.reservations
  drop constraint if exists reservations_expiry_reason_check;
alter table public.reservations
  add constraint reservations_expiry_reason_check
    check (expiry_reason is null or expiry_reason in ('owner_no_response', 'payment_timeout'));

alter table public.payments
  add column if not exists checkout_attempt_started_at timestamptz,
  add column if not exists checkout_inflight_started_at timestamptz;

create index if not exists reservations_active_expiry_idx
  on public.reservations (expires_at, id)
  where status in ('pending', 'approved') and expires_at is not null;

-- Fail-closed incidents are visible for manual follow-up; only the server can read/write.
create table if not exists public.reservation_expiration_issues (
  reservation_id uuid primary key references public.reservations(id) on delete cascade,
  reason text not null,
  last_checked_at timestamptz not null default now(),
  attempt_count integer not null default 1 check (attempt_count > 0)
);
alter table public.reservation_expiration_issues enable row level security;
revoke all on public.reservation_expiration_issues from public, anon, authenticated;
grant all on public.reservation_expiration_issues to service_role;

-- Runs AFTER prepare_reservation_before_insert (and the reservation number trigger).
-- Overrides client-supplied deadline fields and disallows changing them manually.
create or replace function public.set_and_protect_reservation_expiration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pickup_at timestamptz;
begin
  if tg_op = 'INSERT' then
    if new.pickup_time is null then
      raise exception 'Pickup time is required';
    end if;
    v_pickup_at := (new.start_date + new.pickup_time) at time zone 'Europe/Prague';
    if v_pickup_at <= now() then
      raise exception using errcode = 'P0001', message = 'PICKUP_TIME_PASSED';
    end if;
    new.expires_at := least(now() + interval '24 hours', v_pickup_at);
    new.approved_at := null;
    new.expired_at := null;
    new.expiry_reason := null;
    return new;
  end if;

  if old.status = 'pending' and new.status = 'approved' then
    if old.expires_at is not null and old.expires_at <= now() then
      raise exception using errcode = 'P0001', message = 'RESERVATION_APPROVAL_EXPIRED';
    end if;
    v_pickup_at := (old.start_date + old.pickup_time) at time zone 'Europe/Prague';
    new.approved_at := now();
    new.expires_at := least(now() + interval '24 hours', v_pickup_at);
    new.expired_at := old.expired_at;
    new.expiry_reason := old.expiry_reason;
  elsif new.status = 'expired' and old.status in ('pending', 'approved') then
    new.expires_at := old.expires_at;
    new.approved_at := old.approved_at;
    new.expired_at := now();
    new.expiry_reason := case when old.status = 'pending'
      then 'owner_no_response' else 'payment_timeout' end;
  elsif new.expires_at is distinct from old.expires_at
     or new.approved_at is distinct from old.approved_at
     or new.expired_at is distinct from old.expired_at
     or new.expiry_reason is distinct from old.expiry_reason
  then
    raise exception 'Reservation expiration fields cannot be changed';
  end if;
  return new;
end;
$function$;
revoke all on function public.set_and_protect_reservation_expiration()
  from public, anon, authenticated;

drop trigger if exists zzzz_set_reservation_expiration on public.reservations;
create trigger zzzz_set_reservation_expiration
  before insert or update on public.reservations
  for each row execute function public.set_and_protect_reservation_expiration();

-- Retain all existing trusted Stripe, PIN and cancellation rules.
create or replace function public.protect_reservation_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.status = old.status then
    return new;
  end if;

  -- Guard the 24-hour owner response deadline even before Cron processes it.
  if old.status = 'pending' and new.status = 'approved'
     and old.expires_at is not null and old.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'RESERVATION_APPROVAL_EXPIRED';
  end if;

  -- Only the trusted, Stripe-safe expiration RPC can unlock overdue dates.
  if auth.role() = 'service_role'
     and current_setting('app.reservation_expiration_authorized', true) = 'on'
     and old.status in ('pending', 'approved')
     and new.status = 'expired'
     and old.expires_at is not null and old.expires_at <= now() then
    return new;
  end if;

  -- Trusted Stripe webhook completion: approved -> paid.
  if
    auth.role() = 'service_role'
    and current_setting('app.stripe_payment_authorized', true) = 'on'
    and old.status = 'approved'
    and new.status = 'paid'
  then
    return new;
  end if;

  -- Trusted pickup PIN confirmation: paid -> picked_up.
  if
    auth.role() = 'service_role'
    and current_setting('app.pickup_pin_authorized', true) = 'on'
    and old.status = 'paid'
    and new.status = 'picked_up'
  then
    -- PIN handover is permitted for the entire pickup calendar day in Prague.
    -- This atomic database guard also blocks a direct RPC call and owner payout
    -- before the pickup date or after the date has passed (including midnight).
    -- pickup_time remains informational for handover; cancellation is unchanged.
    if old.start_date is distinct from (now() at time zone 'Europe/Prague')::date then
      raise exception using
        errcode = 'P0001',
        message = 'PICKUP_WRONG_DAY';
    end if;

    return new;
  end if;

  -- Trusted paid cancellation. The browser cannot enable this setting and the
  -- RPC that enables it is service-role only.
  if
    auth.role() = 'service_role'
    and current_setting('app.paid_cancellation_authorized', true) = 'on'
    and old.status = 'paid'
    and new.status = 'cancelled'
  then
    return new;
  end if;

  -- Existing ordinary cancellation remains unchanged.
  if
    new.status = 'cancelled'
    and (
      (
        auth.uid() = old.owner_id
        and old.status = 'approved'
      )
      or (
        auth.uid() = old.renter_id
        and old.status in ('pending', 'approved')
      )
    )
  then
    if
      old.pickup_time is not null
      and now() >= (
        ((old.start_date + old.pickup_time) at time zone 'Europe/Prague')
        - interval '6 hours'
      )
    then
      raise exception
        'Reservation can no longer be cancelled within 6 hours of pickup';
    end if;

    return new;
  end if;

  if auth.uid() = old.owner_id then
    if
      old.status = 'pending'
      and new.status = 'approved'
      and exists (
        select 1
        from public.owner_cancellation_debts d
        where d.owner_id = auth.uid()
          and d.status = 'open'
          and d.due_at <= now()
      )
    then
      raise exception using
        errcode = 'P0001',
        message = 'OWNER_OVERDUE_CANCELLATION_DEBT';
    end if;

    if
      (old.status = 'pending' and new.status in ('approved', 'rejected'))
      or (old.status = 'picked_up' and new.status = 'returned')
    then
      return new;
    end if;

    raise exception
      'Owner is not allowed to change reservation status from % to %',
      old.status,
      new.status;
  end if;

  if auth.uid() = old.renter_id then
    raise exception
      'Renter is not allowed to change reservation status from % to %',
      old.status,
      new.status;
  end if;

  raise exception 'User is not related to this reservation';
end;
$function$;

revoke all on function public.protect_reservation_status_transition()
  from public, anon, authenticated;

-- Checkout claim is a durable marker BEFORE the external Stripe call. The
-- Stripe webhook locks payment before reservation: use the same lock order.
create or replace function public.mark_reservation_checkout_started(
  p_payment_id uuid, p_renter_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_payment public.payments%rowtype;
  v_reservation public.reservations%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;
  select * into v_payment from public.payments
  where id = p_payment_id for update;
  if not found or v_payment.payer_id <> p_renter_id
     or v_payment.status <> 'pending' then
    return false;
  end if;
  select * into v_reservation from public.reservations
  where id = v_payment.reservation_id for update;
  if not found or v_reservation.renter_id <> p_renter_id
     or v_reservation.status <> 'approved'
     or (v_reservation.expires_at is not null and v_reservation.expires_at <= now())
     or v_reservation.pickup_time is null
     or now() >= ((v_reservation.start_date + v_reservation.pickup_time)
       at time zone 'Europe/Prague')
  then
    return false;
  end if;
  if v_payment.checkout_inflight_started_at is not null then
    -- Do not start a second Stripe call while a previous call is in flight
    -- or while its outcome is ambiguous.
    return false;
  end if;
  update public.payments
  set checkout_attempt_started_at = coalesce(checkout_attempt_started_at, now()),
      checkout_inflight_started_at = now()
  where id = p_payment_id;
  return true;
end;
$function$;
revoke all on function public.mark_reservation_checkout_started(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.mark_reservation_checkout_started(uuid, uuid)
  to service_role;

-- Clear the attempt only after a known stored Checkout session is consistent.
-- Never clear an ambiguous POST before its outcome has been reconciled.
create or replace function public.finish_reservation_checkout_attempt(
  p_payment_id uuid, p_renter_id uuid, p_session_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;
  update public.payments p
  set checkout_inflight_started_at = null
  where p.id = p_payment_id
    and p.payer_id = p_renter_id
    and p.provider = 'stripe'
    and p.provider_payment_id = p_session_id
    and p.checkout_inflight_started_at is not null;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$function$;
revoke all on function public.finish_reservation_checkout_attempt(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.finish_reservation_checkout_attempt(uuid, uuid, text)
  to service_role;

-- Final release is one guarded database transition. An existing payment can
-- only be released if Stripe explicitly confirmed THIS Checkout session expired.
-- Unknown checkout creation outcomes keep the date blocked for manual review.
create or replace function public.expire_unpaid_reservation(
  p_reservation_id uuid,
  p_verified_expired_session_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;
  perform set_config('app.reservation_expiration_authorized', 'on', true);
  update public.reservations r
  set status = 'expired', updated_at = now()
  where r.id = p_reservation_id
    and r.status in ('pending', 'approved')
    and r.expires_at is not null and r.expires_at <= now()
    and not exists (
      select 1 from public.payments p
      where p.reservation_id = r.id
        and (
          p.status <> 'pending'
          or p.checkout_inflight_started_at is not null
          or (p.checkout_attempt_started_at is not null
              and nullif(p.provider_payment_id, '') is null)
          or nullif(p.provider_payment_id, '')
             is distinct from p_verified_expired_session_id
        )
    );
  get diagnostics v_count = row_count;
  perform set_config('app.reservation_expiration_authorized', 'off', true);
  return v_count = 1;
end;
$function$;
revoke all on function public.expire_unpaid_reservation(uuid, text)
  from public, anon, authenticated;
grant execute on function public.expire_unpaid_reservation(uuid, text)
  to service_role;

-- One reminder per recipient and reservation; existing notification worker
-- delivers the email. No new SMS category is enabled.
alter table public.reservation_notification_deliveries
  drop constraint if exists reservation_notification_deliveries_event_type_check;
alter table public.reservation_notification_deliveries
  add constraint reservation_notification_deliveries_event_type_check
  check (event_type in (
    'new_request', 'approved', 'rejected', 'cancelled',
    'paid', 'picked_up', 'returned', 'paid_cancelled',
    'expiry_reminder_pending', 'expiry_reminder_approved',
    'expired_pending', 'expired_approved'
  ));

alter table public.reservation_email_deliveries
  drop constraint if exists reservation_email_deliveries_event_type_check;
alter table public.reservation_email_deliveries
  add constraint reservation_email_deliveries_event_type_check
  check (event_type in (
    'new_request', 'approved', 'rejected', 'cancelled',
    'paid', 'picked_up', 'returned', 'paid_cancelled',
    'expiry_reminder_pending', 'expiry_reminder_approved',
    'expired_pending', 'expired_approved'
  ));

create or replace function public.queue_expiry_reminders(p_limit integer default 40)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row record;
  v_count integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;
  for v_row in
    select r.id, r.status, r.owner_id, r.renter_id
    from public.reservations r
    where r.status in ('pending', 'approved')
      and r.expires_at is not null
      and r.expires_at > now()
      and r.expires_at <= now() + interval '4 hours'
      and not exists (
        select 1 from public.reservation_notification_deliveries d
        where d.reservation_id = r.id
          and d.channel = 'email'
          and d.event_type = case when r.status = 'pending'
            then 'expiry_reminder_pending' else 'expiry_reminder_approved' end
      )
    order by r.expires_at, r.id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 40), 1), 100)
  loop
    perform public.queue_reservation_notification(
      v_row.id,
      case when v_row.status = 'pending'
        then 'expiry_reminder_pending' else 'expiry_reminder_approved' end,
      case when v_row.status = 'pending' then v_row.owner_id else v_row.renter_id end,
      false
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;
revoke all on function public.queue_expiry_reminders(integer)
  from public, anon, authenticated;
grant execute on function public.queue_expiry_reminders(integer)
  to service_role;

-- Limit re-check churn on Stripe failures but never lose a blocked expiration.
create or replace function public.list_due_reservation_expirations(p_limit integer default 6)
returns table (reservation_id uuid, reservation_status public.reservation_status)
language sql
stable
security definer
set search_path = ''
as $function$
  select r.id, r.status
  from public.reservations r
  left join public.reservation_expiration_issues i on i.reservation_id = r.id
  where auth.role() = 'service_role'
    and r.status in ('pending', 'approved')
    and r.expires_at is not null
    and r.expires_at <= now()
    and (i.last_checked_at is null or i.last_checked_at <= now() - interval '15 minutes')
  order by r.expires_at, r.id
  limit least(greatest(coalesce(p_limit, 6), 1), 12);
$function$;
revoke all on function public.list_due_reservation_expirations(integer)
  from public, anon, authenticated;
grant execute on function public.list_due_reservation_expirations(integer)
  to service_role;

create or replace function public.note_reservation_expiration_issue(
  p_reservation_id uuid, p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;
  insert into public.reservation_expiration_issues (reservation_id, reason)
  values (p_reservation_id, left(p_reason, 180))
  on conflict (reservation_id) do update
  set reason = excluded.reason,
      last_checked_at = now(),
      attempt_count = public.reservation_expiration_issues.attempt_count + 1;
end;
$function$;
revoke all on function public.note_reservation_expiration_issue(uuid, text)
  from public, anon, authenticated;
grant execute on function public.note_reservation_expiration_issue(uuid, text)
  to service_role;

-- Existing notification outbox trigger keeps its old actions; expiry goes
-- to BOTH participants with the appropriate unambiguous reason.
create or replace function public.queue_reservation_transition_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_event text;
  v_recipient uuid;
  v_actor uuid;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then return new; end if;
    v_event := 'new_request';
    v_recipient := new.owner_id;
  else
    if old.status is not distinct from new.status then return new; end if;
    if new.status = 'expired' then
      v_event := case when old.status = 'pending'
        then 'expired_pending' else 'expired_approved' end;
      perform public.queue_reservation_notification(new.id, v_event, new.owner_id, false);
      perform public.queue_reservation_notification(new.id, v_event, new.renter_id, false);
      return new;
    end if;
    v_event := case new.status
      when 'approved' then 'approved'
      when 'rejected' then 'rejected'
      when 'paid' then 'paid'
      when 'picked_up' then 'picked_up'
      when 'returned' then 'returned'
      when 'cancelled' then 'cancelled'
      else null end;
    if v_event is null then return new; end if;
    if new.status = 'cancelled' then
      if exists (
        select 1 from public.reservation_cancellations c
        where c.reservation_id = new.id and c.cancellation_kind = 'paid_refund'
      ) then return new; end if;
      v_actor := auth.uid();
      v_recipient := case when v_actor = new.owner_id then new.renter_id
        when v_actor = new.renter_id then new.owner_id else null end;
    elsif new.status = 'paid' then
      v_recipient := new.owner_id;
    else
      v_recipient := new.renter_id;
    end if;
  end if;
  perform public.queue_reservation_notification(
    new.id, v_event, v_recipient,
    v_event in ('new_request', 'approved', 'paid', 'cancelled')
  );
  return new;
end;
$function$;
revoke all on function public.queue_reservation_transition_notifications()
  from public, anon, authenticated;

-- Re-create the trusted reservation reader and APPEND deadline columns only.
-- Existing contact privacy and all earlier output columns stay unchanged.
drop function public.get_my_reservations();
create function public.get_my_reservations()
returns table(
  id uuid,
  offer_id uuid,
  owner_id uuid,
  renter_id uuid,
  start_date date,
  end_date date,
  pickup_time time without time zone,
  cancellation_cutoff_at timestamp with time zone,
  days integer,
  price_per_day integer,
  total_price integer,
  platform_fee_percent integer,
  platform_fee_amount integer,
  owner_payout integer,
  status reservation_status,
  contact_visible boolean,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  offer_name text,
  category text,
  city text,
  total_days integer,
  renter_name text,
  renter_email text,
  renter_phone text,
  owner_name text,
  contact_visible_after_payment boolean,
  date_from date,
  date_to date,
  paid_at timestamp with time zone,
  payment_provider_status text,
  owner_phone text,
  pickup_phone text,
  pickup_street text,
  pickup_city text,
  pickup_postal_code text,
  pickup_full_address text,
  pickup_note text,
  pickup_latitude double precision,
  pickup_longitude double precision,
  photo_url text,
  reservation_number text,
  offer_number text,
  expires_at timestamptz,
  approved_at timestamptz,
  expired_at timestamptz,
  expiry_reason text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
select
  r.id,
  r.offer_id,
  r.owner_id,
  r.renter_id,
  r.start_date,
  r.end_date,
  r.pickup_time,
  ((r.start_date + r.pickup_time) at time zone 'Europe/Prague')
    - interval '6 hours' as cancellation_cutoff_at,
  r.days,
  r.price_per_day,
  r.total_price,
  r.platform_fee_percent,
  r.platform_fee_amount,
  r.owner_payout,
  r.status,

  r.status in ('paid', 'picked_up', 'returned')
    as contact_visible,

  r.created_at,
  r.updated_at,
  r.offer_name,
  r.category,
  r.city,
  r.total_days,

  case
    when r.renter_id = auth.uid()
      or r.status in ('paid', 'picked_up', 'returned')
      then r.renter_name
    else null
  end as renter_name,

  case
    when r.status in ('paid', 'picked_up', 'returned')
      then r.renter_email
    else null
  end as renter_email,

  case
    when r.status in ('paid', 'picked_up', 'returned')
      then r.renter_phone
    else null
  end as renter_phone,

  case
    when r.owner_id = auth.uid()
      or r.status in ('paid', 'picked_up', 'returned')
      then r.owner_name
    else null
  end as owner_name,

  r.status in ('paid', 'picked_up', 'returned')
    as contact_visible_after_payment,

  r.date_from,
  r.date_to,
  r.paid_at,
  r.payment_provider_status,

  case
    when r.status in ('paid', 'picked_up', 'returned')
      then r.owner_phone
    else null
  end as owner_phone,

  case
    when r.status in ('paid', 'picked_up', 'returned')
      then r.pickup_phone
    else null
  end as pickup_phone,

  case
    when r.status in ('paid', 'picked_up', 'returned')
      then r.pickup_street
    else null
  end as pickup_street,

  r.pickup_city,

  case
    when r.status in ('paid', 'picked_up', 'returned')
      then r.pickup_postal_code
    else null
  end as pickup_postal_code,

  case
    when r.status in ('paid', 'picked_up', 'returned')
      then r.pickup_full_address
    else null
  end as pickup_full_address,

  case
    when r.status in ('paid', 'picked_up', 'returned')
      then r.pickup_note
    else null
  end as pickup_note,

  case
    when r.status in ('paid', 'picked_up', 'returned')
      then r.pickup_latitude
    else null
  end as pickup_latitude,

  case
    when r.status in ('paid', 'picked_up', 'returned')
      then r.pickup_longitude
    else null
  end as pickup_longitude,

  coalesce(o.photo_url, '') as photo_url,
  r.reservation_number,
  o.offer_number,
  r.expires_at,
  r.approved_at,
  r.expired_at,
  r.expiry_reason

from public.reservations r
left join public.offers o
  on o.id = r.offer_id
where auth.uid() is not null
  and (
    r.owner_id = auth.uid()
    or r.renter_id = auth.uid()
  )
order by r.created_at desc;
$function$;

revoke all on function public.get_my_reservations()
  from public, anon, authenticated;
grant execute on function public.get_my_reservations()
  to authenticated, service_role, postgres;
notify pgrst, 'reload schema';

commit;
