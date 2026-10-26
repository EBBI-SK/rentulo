begin;

-- BOD 13: one transactional outbox for reservation email and optional SMS.
-- The table is server-only. No notification delivery is performed by triggers.
-- SMS is opt-in and cannot be sent until a separately configured worker runs.
alter table public.profiles
  add column if not exists sms_notifications boolean not null default false;

create table if not exists public.reservation_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in (
    'new_request', 'approved', 'rejected', 'cancelled',
    'paid', 'picked_up', 'returned', 'paid_cancelled'
  )),
  channel text not null check (channel in ('email', 'sms')),
  status text not null default 'queued' check (status in (
    'queued', 'sending', 'retry', 'sent', 'simulated', 'skipped', 'dead'
  )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  claim_token uuid,
  lease_until timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (reservation_id, event_type, recipient_id, channel)
);

alter table public.reservation_notification_deliveries enable row level security;
revoke all on public.reservation_notification_deliveries from public, anon, authenticated;
grant all on public.reservation_notification_deliveries to service_role;

create index if not exists reservation_notification_deliveries_due_idx
  on public.reservation_notification_deliveries (next_attempt_at, created_at)
  where status in ('queued', 'retry', 'sending');

-- Only verified reservation transitions enqueue work. This function is not
-- callable by normal API clients and cannot be used to send arbitrary messages.
create or replace function public.queue_reservation_notification(
  p_reservation_id uuid,
  p_event_type text,
  p_recipient_id uuid,
  p_offer_sms boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_recipient_id is null then
    return;
  end if;

  insert into public.reservation_notification_deliveries (
    reservation_id, event_type, recipient_id, channel
  ) values (p_reservation_id, p_event_type, p_recipient_id, 'email')
  on conflict (reservation_id, event_type, recipient_id, channel) do nothing;

  if p_offer_sms and exists (
    select 1 from public.profiles p
    where p.id = p_recipient_id and p.sms_notifications is true
  ) then
    insert into public.reservation_notification_deliveries (
      reservation_id, event_type, recipient_id, channel
    ) values (p_reservation_id, p_event_type, p_recipient_id, 'sms')
    on conflict (reservation_id, event_type, recipient_id, channel) do nothing;
  end if;
end;
$function$;
revoke all on function public.queue_reservation_notification(uuid, text, uuid, boolean)
  from public, anon, authenticated;

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
    if new.status <> 'pending' then
      return new;
    end if;
    v_event := 'new_request';
    v_recipient := new.owner_id;
  else
    if old.status is not distinct from new.status then
      return new;
    end if;
    v_event := case new.status
      when 'approved' then 'approved'
      when 'rejected' then 'rejected'
      when 'paid' then 'paid'
      when 'picked_up' then 'picked_up'
      when 'returned' then 'returned'
      when 'cancelled' then 'cancelled'
      else null
    end;

    if v_event is null then
      return new;
    end if;

    if new.status = 'cancelled' then
      -- Paid cancellation is NOT an ordinary cancellation: queue it only after
      -- final refund success and financial finalization (see triggers below).
      if exists (
        select 1 from public.reservation_cancellations c
        where c.reservation_id = new.id and c.cancellation_kind = 'paid_refund'
      ) then
        return new;
      end if;

      v_actor := auth.uid();
      v_recipient := case
        when v_actor = new.owner_id then new.renter_id
        when v_actor = new.renter_id then new.owner_id
        else null
      end;
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

drop trigger if exists trg_queue_reservation_notification_on_insert on public.reservations;
create trigger trg_queue_reservation_notification_on_insert
  after insert on public.reservations
  for each row execute function public.queue_reservation_transition_notifications();

drop trigger if exists trg_queue_reservation_notification_on_status on public.reservations;
create trigger trg_queue_reservation_notification_on_status
  after update of status on public.reservations
  for each row execute function public.queue_reservation_transition_notifications();

-- A paid cancellation must never claim to be refunded until Stripe has
-- succeeded AND the required owner debt/refund accounting is finalized.
-- Both triggers are needed because success can arrive in either order.
create or replace function public.queue_finalized_paid_cancellation_notifications(
  p_reservation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_reservation public.reservations%rowtype;
  v_cancellation public.reservation_cancellations%rowtype;
begin
  select r.* into v_reservation
  from public.reservations r
  where r.id = p_reservation_id and r.status = 'cancelled';
  if not found then return; end if;

  select c.* into v_cancellation
  from public.reservation_cancellations c
  join public.payments p on p.id = c.payment_id
  where c.reservation_id = v_reservation.id
    and c.cancellation_kind = 'paid_refund'
    and c.financials_finalized_at is not null
    and p.refund_status = 'succeeded'
    and p.stripe_refund_amount_minor = c.refund_amount_minor
    and c.refund_amount_minor > 0
  limit 1;
  if not found then return; end if;

  -- Both parties receive the existing financial email. Only the party who
  -- did NOT cancel is eligible for the optional short SMS.
  perform public.queue_reservation_notification(
    v_reservation.id, 'paid_cancelled', v_reservation.owner_id,
    v_cancellation.cancelled_by_role = 'renter'
  );
  perform public.queue_reservation_notification(
    v_reservation.id, 'paid_cancelled', v_reservation.renter_id,
    v_cancellation.cancelled_by_role = 'owner'
  );
end;
$function$;
revoke all on function public.queue_finalized_paid_cancellation_notifications(uuid)
  from public, anon, authenticated;

create or replace function public.queue_paid_cancellation_after_payment_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.refund_status = 'succeeded'
    and old.refund_status is distinct from new.refund_status
  then
    perform public.queue_finalized_paid_cancellation_notifications(new.reservation_id);
  end if;
  return new;
end;
$function$;
revoke all on function public.queue_paid_cancellation_after_payment_update()
  from public, anon, authenticated;

drop trigger if exists trg_queue_paid_cancellation_after_payment_update on public.payments;
create trigger trg_queue_paid_cancellation_after_payment_update
  after update of refund_status on public.payments
  for each row execute function public.queue_paid_cancellation_after_payment_update();

create or replace function public.queue_paid_cancellation_after_financials_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.financials_finalized_at is not null
    and old.financials_finalized_at is null
  then
    perform public.queue_finalized_paid_cancellation_notifications(new.reservation_id);
  end if;
  return new;
end;
$function$;
revoke all on function public.queue_paid_cancellation_after_financials_update()
  from public, anon, authenticated;

drop trigger if exists trg_queue_paid_cancellation_after_financials_update on public.reservation_cancellations;
create trigger trg_queue_paid_cancellation_after_financials_update
  after update of financials_finalized_at on public.reservation_cancellations
  for each row execute function public.queue_paid_cancellation_after_financials_update();

-- Atomic lease/claim API. Only the server-side service_role may claim or ack.
create or replace function public.claim_reservation_notification_deliveries(
  p_limit integer default 15
)
returns table (
  delivery_id uuid,
  claim_token uuid,
  reservation_id uuid,
  event_type text,
  recipient_id uuid,
  channel text
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;

  return query
    with eligible as (
      select d.id
      from public.reservation_notification_deliveries d
      where (
        (d.status in ('queued', 'retry') and d.next_attempt_at <= now())
        or (d.status = 'sending' and d.lease_until < now())
      )
      and d.attempt_count < 5
      order by d.created_at, d.id
      for update skip locked
      limit least(greatest(coalesce(p_limit, 15), 1), 25)
    ), claimed as (
      update public.reservation_notification_deliveries d
      set status = 'sending',
          attempt_count = d.attempt_count + 1,
          claim_token = gen_random_uuid(),
          lease_until = now() + interval '3 minutes',
          updated_at = now()
      from eligible e
      where d.id = e.id
      returning d.id, d.claim_token, d.reservation_id, d.event_type,
                d.recipient_id, d.channel
    )
    select c.id, c.claim_token, c.reservation_id, c.event_type,
           c.recipient_id, c.channel
    from claimed c;
end;
$function$;
revoke all on function public.claim_reservation_notification_deliveries(integer)
  from public, anon, authenticated;
grant execute on function public.claim_reservation_notification_deliveries(integer)
  to service_role;

create or replace function public.finish_reservation_notification_delivery(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_provider_message_id text default null,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_updated integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;
  if p_outcome not in ('sent', 'retry', 'simulated', 'skipped', 'dead') then
    raise exception 'Invalid delivery outcome';
  end if;

  update public.reservation_notification_deliveries d
  set status = case
        when p_outcome = 'retry' and d.attempt_count >= 5 then 'dead'
        else p_outcome end,
      provider_message_id = case when p_outcome = 'sent' then left(p_provider_message_id, 200) else null end,
      last_error = left(p_error, 400),
      claim_token = null,
      lease_until = null,
      next_attempt_at = case
        when p_outcome = 'retry' then now() +
          make_interval(secs => least(3600, 60 * power(2, least(d.attempt_count - 1, 6))::integer))
        else d.next_attempt_at end,
      sent_at = case when p_outcome = 'sent' then now() else null end,
      updated_at = now()
  where d.id = p_delivery_id
    and d.claim_token = p_claim_token
    and d.status = 'sending';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$function$;
revoke all on function public.finish_reservation_notification_delivery(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.finish_reservation_notification_delivery(uuid, uuid, text, text, text)
  to service_role;

commit;
