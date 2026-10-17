-- RENTULO / BOD 01 / ETAPA 1B / TEST ONLY
-- 24-hour ordinary cancellation cutoff for NEW reservations only.
-- Legacy reservations preserve the 6-hour rule agreed at their creation.
-- An owner who cannot provide the item may exceptionally cancel a paid booking
-- after the cutoff, before the agreed return deadline, with a FULL renter refund.
-- Owners remain liable for evidenced non-refundable Stripe fees (existing 7-day debt).
-- Payment/refund idempotency, payout guards and no-show remain unchanged.
-- Apply ONLY to Supabase TEST after GitHub PR merge and TEST deployment.

begin;

-- Backfill without changing policy for ANY existing booking (including R-000036).
-- Then default to 24 hours for NEW bookings, not retroactively.
alter table public.reservations
  add column if not exists cancellation_cutoff_hours integer not null default 6;
alter table public.reservations
  alter column cancellation_cutoff_hours set default 24;
alter table public.reservations
  add constraint cancellation_cutoff_hours_allowed
    check (cancellation_cutoff_hours in (6, 24));

-- Even an authenticated client specifying a value at INSERT cannot select
-- a favorable policy; users cannot change a booking's stored policy later.
create or replace function public.protect_reservation_cancellation_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    new.cancellation_cutoff_hours := 24;
  elsif new.cancellation_cutoff_hours is distinct from old.cancellation_cutoff_hours then
    raise exception using errcode = 'P0001',
      message = 'CANCELLATION_POLICY_IMMUTABLE';
  end if;
  return new;
end;
$function$;
revoke all on function public.protect_reservation_cancellation_policy()
  from public, anon, authenticated;
drop trigger if exists zzzzz_protect_reservation_cancellation_policy on public.reservations;
create trigger zzzzz_protect_reservation_cancellation_policy
  before insert or update on public.reservations
  for each row execute function public.protect_reservation_cancellation_policy();

-- Only trusted RPCs may write paid-cancellation incident classification.
alter table public.reservation_cancellations
  add column if not exists exceptional_reason text;
alter table public.reservation_cancellations
  add constraint reservation_cancellations_exceptional_reason_check
    check (exceptional_reason is null or (
      exceptional_reason = 'owner_unavailable'
      and cancellation_kind = 'paid_refund'
      and cancelled_by_role = 'owner'
    ));

-- Latest transition guard, preserving every protected state transition.
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
    -- Return is due at end_date + pickup_time, in Prague local time.
    -- PIN handover is allowed only inside [start, return); at the exact return
    -- instant the PIN is expired and cannot initiate an owner transfer.
    -- Use clock_timestamp(), not transaction-start now(): a confirmation that
    -- waits on a row lock must never succeed after the actual deadline.
    if old.pickup_time is null
       or clock_timestamp() >= ((old.end_date + old.pickup_time) at time zone 'Europe/Prague') then
      raise exception using errcode = 'P0001', message = 'PICKUP_WRONG_DAY';
    end if;
    if clock_timestamp() < ((old.start_date + old.pickup_time) at time zone 'Europe/Prague') then
      raise exception using errcode = 'P0001', message = 'PICKUP_NOT_STARTED';
    end if;

    return new;
  end if;

  -- KROK 79: trusted postgres Cron may settle paid bookings only at/after
  -- the exact agreed Prague-local return instant; not at midnight.
  if session_user = 'postgres'
     and current_setting('app.no_show_authorized', true) = 'on'
     and old.status = 'paid'
     and new.status = 'no_show'
     and old.pickup_time is not null
     and clock_timestamp() >= ((old.end_date + old.pickup_time) at time zone 'Europe/Prague') then
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

  -- Trusted owner-attested exception for approved UNPAID reservations.
  -- The companion RPC checks both identity and the Stripe checkout state.
  if auth.uid() = old.owner_id
     and current_setting('app.owner_unavailable_approved_authorized', true) = 'on'
     and old.status = 'approved' and new.status = 'cancelled' then
    return new;
  end if;

  -- Ordinary cancellation remains subject to each booking's stored cutoff.
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
    -- Fail closed: a pending Stripe Checkout/PaymentIntent cannot be abandoned
    -- by an ordinary client update. Otherwise a renter could still pay a
    -- hosted Checkout page after the reservation had been cancelled.
    if old.status = 'approved' and exists (
      select 1 from public.payments p
      where p.reservation_id = old.id
        and (
          p.status <> 'pending'
          or p.checkout_attempt_started_at is not null
          or p.checkout_inflight_started_at is not null
          or nullif(p.provider_payment_id, '') is not null
        )
    ) then
      raise exception using errcode = 'P0001',
        message = 'RESERVATION_ACTIVE_CHECKOUT';
    end if;
    if
      old.pickup_time is not null
      and clock_timestamp() >= (
        ((old.start_date + old.pickup_time) at time zone 'Europe/Prague')
        - make_interval(hours => old.cancellation_cutoff_hours)
      )
    then
      raise exception
        'Reservation ordinary cancellation deadline has passed';
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
revoke all on function public.protect_reservation_status_transition() from public, anon, authenticated;

-- The existing reader contract and contact-privacy masking are unchanged.
create or replace function public.get_my_reservations()
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
    - make_interval(hours => r.cancellation_cutoff_hours) as cancellation_cutoff_at,
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
revoke all on function public.get_my_reservations() from public, anon, authenticated;
grant execute on function public.get_my_reservations() to authenticated, service_role, postgres;
notify pgrst, 'reload schema';

-- Quote/context is service-role only; retains all refund and transfer checks.
create or replace function public.get_paid_reservation_cancellation_context(
  p_reservation_id uuid,
  p_actor_user_id uuid
)
returns table(
  reservation_id uuid,
  payment_id uuid,
  actor_role text,
  payment_amount_minor integer,
  currency text,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  refund_status text,
  stripe_refund_id text,
  stripe_refund_amount_minor integer,
  transfer_status text,
  stripe_transfer_id text,
  cancellation_id uuid,
  refund_policy text,
  cancellation_refund_amount_minor integer,
  cancellation_external_cost_amount_minor integer,
  cancellation_financials_finalized_at timestamptz,
  cancelled_at timestamptz,
  cancellation_cutoff_at timestamptz,
  owner_debt_id uuid,
  owner_debt_due_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_reservation public.reservations%rowtype;
  v_payment public.payments%rowtype;
  v_cancellation public.reservation_cancellations%rowtype;
  v_owner_debt public.owner_cancellation_debts%rowtype;
  v_actor_role text;
  v_cutoff timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;

  if p_actor_user_id is null then
    raise exception 'Paid cancellation actor is required';
  end if;

  select r.*
  into v_reservation
  from public.reservations r
  where r.id = p_reservation_id;

  if not found then
    raise exception 'Reservation was not found';
  end if;

  v_actor_role := case
    when p_actor_user_id = v_reservation.renter_id then 'renter'
    when p_actor_user_id = v_reservation.owner_id then 'owner'
    else null
  end;

  if v_actor_role is null then
    raise exception 'Paid cancellation actor does not match reservation';
  end if;

  select p.*
  into v_payment
  from public.payments p
  where p.reservation_id = p_reservation_id
    and p.provider = 'stripe'
    and p.status = 'paid'
  order by p.paid_at desc nulls last, p.created_at desc
  limit 1;

  if not found then
    raise exception 'Paid Stripe payment was not found for reservation';
  end if;

  if
    v_payment.payer_id <> v_reservation.renter_id
    or v_payment.owner_id <> v_reservation.owner_id
    or v_payment.currency <> 'czk'
    or v_payment.stripe_payment_intent_status <> 'succeeded'
    or v_payment.stripe_payment_intent_id is null
    or btrim(v_payment.stripe_payment_intent_id) = ''
    or v_payment.stripe_charge_id is null
    or btrim(v_payment.stripe_charge_id) = ''
    or v_payment.stripe_amount_total_minor is null
    or v_payment.stripe_amount_total_minor <> v_payment.amount_total * 100
    or v_payment.amount_total <> v_reservation.total_price
    or v_payment.platform_fee_amount <> v_reservation.platform_fee_amount
    or v_payment.owner_payout <> v_reservation.owner_payout
    or v_payment.platform_fee_amount + v_payment.owner_payout <> v_payment.amount_total
  then
    raise exception 'Paid Stripe payment snapshot does not match reservation';
  end if;

  if
    v_payment.transfer_status <> 'not_created'
    or v_payment.stripe_transfer_id is not null
  then
    raise exception 'Owner transfer state blocks paid cancellation';
  end if;

  select c.*
  into v_cancellation
  from public.reservation_cancellations c
  where c.reservation_id = p_reservation_id;

  if found then
    if
      v_cancellation.cancellation_kind <> 'paid_refund'
      or v_cancellation.payment_id <> v_payment.id
      or v_cancellation.cancelled_by_user_id <> p_actor_user_id
      or v_cancellation.cancelled_by_role <> v_actor_role
      or v_reservation.status <> 'cancelled'
      or v_payment.refund_status not in (
        'pending', 'requires_action', 'succeeded', 'failed', 'canceled'
      )
    then
      raise exception 'Reservation already has a different cancellation state';
    end if;
  else
    if v_reservation.status <> 'paid' then
      raise exception 'Only a paid reservation can enter the paid cancellation flow';
    end if;

    if
      v_payment.refund_status <> 'not_requested'
      or v_payment.stripe_refund_amount_minor <> 0
      or v_payment.stripe_refund_id is not null
    then
      raise exception 'Payment already has refund state';
    end if;

    if v_reservation.pickup_time is null then
      raise exception 'Pickup time is required for paid cancellation';
    end if;

    v_cutoff :=
      ((v_reservation.start_date + v_reservation.pickup_time) at time zone 'Europe/Prague')
      - make_interval(hours => v_reservation.cancellation_cutoff_hours);

    -- A renter may not make an ordinary cancellation after the cutoff.
    -- An owner may attest nonavailability and give the renter a full refund.
    if clock_timestamp() >= v_cutoff and v_actor_role <> 'owner' then
      raise exception 'Reservation ordinary cancellation deadline has passed';
    end if;
    if clock_timestamp() >= v_cutoff and v_actor_role = 'owner'
       and clock_timestamp() >=
           ((v_reservation.end_date + v_reservation.pickup_time) at time zone 'Europe/Prague') then
      raise exception 'Exceptional cancellation after scheduled return is unavailable';
    end if;
  end if;

  if v_reservation.pickup_time is not null then
    v_cutoff :=
      ((v_reservation.start_date + v_reservation.pickup_time) at time zone 'Europe/Prague')
      - make_interval(hours => v_reservation.cancellation_cutoff_hours);
  end if;

  if v_cancellation.id is not null then
    select d.*
    into v_owner_debt
    from public.owner_cancellation_debts d
    where d.cancellation_id = v_cancellation.id;
  end if;

  return query
  select
    v_reservation.id,
    v_payment.id,
    v_actor_role,
    v_payment.stripe_amount_total_minor,
    v_payment.currency,
    v_payment.stripe_payment_intent_id,
    v_payment.stripe_charge_id,
    v_payment.refund_status,
    v_payment.stripe_refund_id,
    v_payment.stripe_refund_amount_minor,
    v_payment.transfer_status,
    v_payment.stripe_transfer_id,
    case when v_cancellation.id is null then null else v_cancellation.id end,
    case when v_cancellation.id is null then null else v_cancellation.refund_policy end,
    case when v_cancellation.id is null then null else v_cancellation.refund_amount_minor end,
    case when v_cancellation.id is null then null else v_cancellation.external_cost_amount_minor end,
    case when v_cancellation.id is null then null else v_cancellation.financials_finalized_at end,
    case when v_cancellation.id is null then null else v_cancellation.cancelled_at end,
    v_cutoff,
    case when v_owner_debt.id is null then null else v_owner_debt.id end,
    case when v_owner_debt.id is null then null else v_owner_debt.due_at end;
end;
$function$;
revoke all on function public.get_paid_reservation_cancellation_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_paid_reservation_cancellation_context(uuid,uuid) to service_role;

-- Existing idempotent paid-cancel RPC; records the owner exception atomically.
create or replace function public.begin_paid_reservation_cancellation(
  p_reservation_id uuid,
  p_cancelled_by_role text,
  p_cancelled_by_user_id uuid
)
returns table(
  cancellation_id uuid,
  reservation_id uuid,
  payment_id uuid,
  cancelled_by_role text,
  refund_policy text,
  payment_amount_minor integer,
  currency text,
  refund_status text,
  cancelled_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_reservation public.reservations%rowtype;
  v_payment public.payments%rowtype;
  v_existing public.reservation_cancellations%rowtype;
  v_cancellation public.reservation_cancellations%rowtype;
  v_refund_policy text;
  v_now timestamptz := now();
  v_cutoff timestamptz;
  v_updated_rows integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;

  if p_cancelled_by_role not in ('renter', 'owner') then
    raise exception 'Paid cancellation actor role is invalid';
  end if;

  if p_cancelled_by_user_id is null then
    raise exception 'Paid cancellation actor is required';
  end if;

  select r.*
  into v_reservation
  from public.reservations r
  where r.id = p_reservation_id
  for update;

  if not found then
    raise exception 'Reservation was not found';
  end if;

  select p.*
  into v_payment
  from public.payments p
  where p.reservation_id = p_reservation_id
    and p.provider = 'stripe'
    and p.status = 'paid'
  order by p.paid_at desc nulls last, p.created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'Paid Stripe payment was not found for reservation';
  end if;

  select c.*
  into v_existing
  from public.reservation_cancellations c
  where c.reservation_id = p_reservation_id;

  -- Safe retry after the first database step: return the same cancellation
  -- instead of creating another record or changing the actor/policy.
  if found then
    if
      v_existing.cancellation_kind = 'paid_refund'
      and v_existing.payment_id = v_payment.id
      and v_existing.cancelled_by_role = p_cancelled_by_role
      and v_existing.cancelled_by_user_id = p_cancelled_by_user_id
      and v_reservation.status = 'cancelled'
      and v_payment.refund_status in ('pending', 'requires_action', 'succeeded', 'failed')
    then
      return query
      select
        v_existing.id,
        v_existing.reservation_id,
        v_existing.payment_id,
        v_existing.cancelled_by_role,
        v_existing.refund_policy,
        v_existing.payment_amount_minor,
        v_existing.currency,
        v_payment.refund_status,
        v_existing.cancelled_at;
      return;
    end if;

    raise exception 'Reservation already has a different cancellation record';
  end if;

  if v_reservation.status <> 'paid' then
    raise exception 'Only a paid reservation can enter the paid cancellation flow';
  end if;

  if
    (p_cancelled_by_role = 'renter' and p_cancelled_by_user_id <> v_reservation.renter_id)
    or (p_cancelled_by_role = 'owner' and p_cancelled_by_user_id <> v_reservation.owner_id)
  then
    raise exception 'Paid cancellation actor does not match reservation';
  end if;

  if v_reservation.pickup_time is null then
    raise exception 'Pickup time is required for paid cancellation';
  end if;

  v_now := clock_timestamp();

  v_cutoff :=
    ((v_reservation.start_date + v_reservation.pickup_time) at time zone 'Europe/Prague')
    - make_interval(hours => v_reservation.cancellation_cutoff_hours);

  if v_now >= v_cutoff and p_cancelled_by_role <> 'owner' then
    raise exception 'Reservation ordinary cancellation deadline has passed';
  end if;
  if v_now >= v_cutoff and p_cancelled_by_role = 'owner'
     and clock_timestamp() >=
         ((v_reservation.end_date + v_reservation.pickup_time) at time zone 'Europe/Prague') then
    raise exception 'Exceptional cancellation after scheduled return is unavailable';
  end if;

  if
    v_payment.payer_id <> v_reservation.renter_id
    or v_payment.owner_id <> v_reservation.owner_id
    or v_payment.currency <> 'czk'
    or v_payment.stripe_payment_intent_status <> 'succeeded'
    or v_payment.stripe_payment_intent_id is null
    or btrim(v_payment.stripe_payment_intent_id) = ''
    or v_payment.stripe_charge_id is null
    or btrim(v_payment.stripe_charge_id) = ''
  then
    raise exception 'Paid Stripe payment identifiers do not match reservation';
  end if;

  if
    v_payment.amount_total <> v_reservation.total_price
    or v_payment.platform_fee_amount <> v_reservation.platform_fee_amount
    or v_payment.owner_payout <> v_reservation.owner_payout
    or v_payment.platform_fee_amount + v_payment.owner_payout <> v_payment.amount_total
    or v_payment.stripe_amount_total_minor is null
    or v_payment.stripe_amount_total_minor <> v_payment.amount_total * 100
  then
    raise exception 'Paid Stripe payment snapshot does not match reservation';
  end if;

  if
    v_payment.refund_status <> 'not_requested'
    or v_payment.stripe_refund_amount_minor <> 0
    or v_payment.stripe_refund_id is not null
  then
    raise exception 'Payment already has refund state';
  end if;

  if
    v_payment.transfer_status <> 'not_created'
    or v_payment.stripe_transfer_id is not null
  then
    raise exception 'Owner transfer state blocks paid cancellation';
  end if;

  v_refund_policy := case
    when p_cancelled_by_role = 'renter'
      then 'renter_external_cost_deducted'
    else 'owner_full_refund_owner_cost'
  end;

  insert into public.reservation_cancellations (
    reservation_id,
    payment_id,
    cancelled_by_role,
    cancelled_by_user_id,
    cancelled_at,
    cancellation_kind,
    exceptional_reason,
    refund_policy,
    payment_amount_minor,
    currency,
    created_at,
    updated_at
  ) values (
    v_reservation.id,
    v_payment.id,
    p_cancelled_by_role,
    p_cancelled_by_user_id,
    v_now,
    'paid_refund',
    case when v_now >= v_cutoff and p_cancelled_by_role = 'owner'
      then 'owner_unavailable' else null end,
    v_refund_policy,
    v_payment.stripe_amount_total_minor,
    'czk',
    v_now,
    v_now
  )
  returning * into v_cancellation;

  update public.payments p
  set
    refund_status = 'pending',
    refund_requested_at = coalesce(p.refund_requested_at, v_now),
    updated_at = v_now
  where p.id = v_payment.id
    and p.refund_status = 'not_requested'
    and p.stripe_refund_amount_minor = 0
    and p.stripe_refund_id is null
    and p.transfer_status = 'not_created'
    and p.stripe_transfer_id is null;

  get diagnostics v_updated_rows = row_count;

  if v_updated_rows <> 1 then
    raise exception 'Payment could not enter refund-pending state';
  end if;

  perform set_config('app.paid_cancellation_authorized', 'on', true);

  update public.reservations r
  set
    status = 'cancelled',
    updated_at = v_now
  where r.id = v_reservation.id
    and r.status = 'paid';

  get diagnostics v_updated_rows = row_count;

  if v_updated_rows <> 1 then
    raise exception 'Reservation could not enter paid cancellation state';
  end if;

  perform set_config('app.paid_cancellation_authorized', 'off', true);

  return query
  select
    v_cancellation.id,
    v_cancellation.reservation_id,
    v_cancellation.payment_id,
    v_cancellation.cancelled_by_role,
    v_cancellation.refund_policy,
    v_cancellation.payment_amount_minor,
    v_cancellation.currency,
    'pending'::text,
    v_cancellation.cancelled_at;
end;
$function$;
revoke all on function public.begin_paid_reservation_cancellation(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.begin_paid_reservation_cancellation(uuid,text,uuid) to service_role;


-- Owner exception for an approved/unpaid booking: do not force the renter to
-- pay merely so the owner can refund an unavailable item.
-- Only a clean, NOT-IN-FLIGHT Stripe state may be cancelled this way.
create table if not exists public.reservation_approved_exception_log (
  reservation_id uuid primary key references public.reservations(id) on delete cascade,
  owner_id uuid not null,
  reason text not null check (reason = 'owner_unavailable'),
  recorded_at timestamptz not null default clock_timestamp()
);
alter table public.reservation_approved_exception_log enable row level security;
revoke all on public.reservation_approved_exception_log from public, anon, authenticated;
grant all on public.reservation_approved_exception_log to service_role;

create or replace function public.cancel_approved_reservation_item_unavailable(
  p_reservation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_reservation public.reservations%rowtype;
  v_cutoff timestamptz;
  v_return timestamptz;
  v_count integer;
begin
  if auth.uid() is null then
    return false;
  end if;

  select * into v_reservation
  from public.reservations
  where id = p_reservation_id
  for update;

  if not found or v_reservation.owner_id <> auth.uid()
     or v_reservation.status <> 'approved'
     or v_reservation.pickup_time is null then
    return false;
  end if;

  v_cutoff := ((v_reservation.start_date + v_reservation.pickup_time)
    at time zone 'Europe/Prague')
    - make_interval(hours => v_reservation.cancellation_cutoff_hours);
  v_return := ((v_reservation.end_date + v_reservation.pickup_time)
    at time zone 'Europe/Prague');

  if clock_timestamp() < v_cutoff or clock_timestamp() >= v_return then
    return false;
  end if;

  -- An open Stripe Checkout, any in-flight/unknown attempt, or an already
  -- charged payment blocks early release of dates. The user must wait for
  -- safe expiry/manual reconciliation; no potentially payable link remains.
  if exists (
    select 1 from public.payments p
    where p.reservation_id = v_reservation.id
      and (
        p.status <> 'pending'
        or p.checkout_attempt_started_at is not null
        or p.checkout_inflight_started_at is not null
        or nullif(p.provider_payment_id, '') is not null
      )
  ) then
    return false;
  end if;

  perform set_config('app.owner_unavailable_approved_authorized', 'on', true);
  update public.reservations
  set status = 'cancelled', updated_at = clock_timestamp()
  where id = v_reservation.id and status = 'approved';
  get diagnostics v_count = row_count;
  perform set_config('app.owner_unavailable_approved_authorized', 'off', true);
  if v_count <> 1 then
    raise exception 'Approved reservation could not be cancelled';
  end if;

  insert into public.reservation_approved_exception_log (
    reservation_id, owner_id, reason
  ) values (v_reservation.id, auth.uid(), 'owner_unavailable');

  return true;
end;
$function$;
revoke all on function public.cancel_approved_reservation_item_unavailable(uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_approved_reservation_item_unavailable(uuid)
  to authenticated;

commit;
