-- KROK 79: paid reservation without pickup by the end of its entire rental period in Europe/Prague.
-- This migration intentionally runs ONLY in the selected environment.
-- The new enum label must already exist (previous migration).
begin;

-- Refuse every project except the explicitly approved Rentulo TEST database.
do $test_project$
begin
  if not exists (
    select 1 from vault.decrypted_secrets v
    where v.name = 'rentulo_project_url'
      and btrim(v.decrypted_secret, '/') = 'https://vspposovhdgvbeukoivh.supabase.co'
  ) then
    raise exception 'KROK 79 is authorized only for the Rentulo TEST Supabase project';
  end if;
end;
$test_project$;

-- Only completed Stripe money can be settled as no-show. Inconsistencies are
-- persisted for manual inspection; an unknown payment never triggers a payout.
create table if not exists public.reservation_no_show_issues (
  reservation_id uuid primary key references public.reservations(id) on delete cascade,
  reason text not null,
  last_checked_at timestamptz not null default now(),
  attempt_count integer not null default 1 check (attempt_count > 0)
);
alter table public.reservation_no_show_issues enable row level security;
revoke all on public.reservation_no_show_issues from public, anon, authenticated;
grant all on public.reservation_no_show_issues to service_role;

-- Never retroactively pay out reservations created before new terms become active
-- even if their pickup day is in the future. Deploy new terms and payment
-- warning FIRST, then this SQL migration. At deployment, the first eligible
-- pickup date is TOMORROW in Prague.
create table if not exists public.reservation_no_show_activation (
  singleton boolean primary key default true check (singleton),
  first_pickup_date date not null,
  -- Booking must have been created only AFTER this rule became active.
  first_reservation_created_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.reservation_no_show_activation enable row level security;
revoke all on public.reservation_no_show_activation from public, anon, authenticated;
insert into public.reservation_no_show_activation (singleton, first_pickup_date)
values (true, (now() at time zone 'Europe/Prague')::date + 1)
on conflict (singleton) do nothing;

create index if not exists reservations_paid_no_show_due_idx
  on public.reservations (end_date, pickup_time, id) where status = 'paid';

-- Explicitly preserve all existing trusted transitions (Stripe, PIN, refunds).
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

-- The existing email and SMS outbox is the only notification transport.
-- No SMS is enabled for no-show.
alter table public.reservation_notification_deliveries
  drop constraint if exists reservation_notification_deliveries_event_type_check;
alter table public.reservation_notification_deliveries
  add constraint reservation_notification_deliveries_event_type_check
  check (event_type in (
    'new_request', 'approved', 'rejected', 'cancelled',
    'paid', 'picked_up', 'returned', 'paid_cancelled',
    'expiry_reminder_pending', 'expiry_reminder_approved',
    'expired_pending', 'expired_approved', 'no_show'
  ));

alter table public.reservation_email_deliveries
  drop constraint if exists reservation_email_deliveries_event_type_check;
alter table public.reservation_email_deliveries
  add constraint reservation_email_deliveries_event_type_check
  check (event_type in (
    'new_request', 'approved', 'rejected', 'cancelled',
    'paid', 'picked_up', 'returned', 'paid_cancelled',
    'expiry_reminder_pending', 'expiry_reminder_approved',
    'expired_pending', 'expired_approved', 'no_show'
  ));

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
    if new.status = 'no_show' then
      -- One durable email for each party; SMS remains opt-in and unchanged.
      perform public.queue_reservation_notification(new.id, 'no_show', new.owner_id, false);
      perform public.queue_reservation_notification(new.id, 'no_show', new.renter_id, false);
      return new;
    end if;
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

-- Reuse the existing Stripe claim, finalization, retry and idempotency machinery.
-- Only the reservation eligibility expands; Stripe evidence, amounts and refund
-- protections are deliberately kept byte-for-byte unchanged.
create or replace function public.claim_stripe_owner_transfer_attempt(
  p_payment_id uuid,
  p_reservation_id uuid
)
returns table(
  payment_id uuid,
  reservation_id uuid,
  attempt_count integer,
  transfer_status text,
  last_attempt_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_payment public.payments%rowtype;
  v_reservation_status text;
  v_now timestamptz := now();
  v_stale_reference timestamptz;
  v_can_claim boolean := false;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;

  if p_payment_id is null or p_reservation_id is null then
    raise exception 'Payment and reservation are required';
  end if;

  select p.*
  into v_payment
  from public.payments p
  where p.id = p_payment_id
    and p.reservation_id = p_reservation_id
  for update;

  if not found then
    raise exception 'Payment was not found for reservation';
  end if;

  select r.status
  into v_reservation_status
  from public.reservations r
  where r.id = p_reservation_id;

  if not found then
    raise exception 'Reservation was not found';
  end if;

  -- Only an otherwise eligible, untransferred picked-up reservation can enter
  -- the retry state machine. Detailed Stripe evidence is still revalidated by
  -- create-owner-transfer before money is sent.
  if v_payment.stripe_transfer_id is not null
     or v_payment.transfer_status in ('succeeded', 'reversed')
     or v_payment.provider <> 'stripe'
     or v_payment.status <> 'paid'
     or v_payment.currency <> 'czk'
     or v_payment.stripe_payment_intent_status <> 'succeeded'
     or v_payment.stripe_payment_intent_id is null
     or btrim(v_payment.stripe_payment_intent_id) = ''
     or v_payment.stripe_charge_id is null
     or btrim(v_payment.stripe_charge_id) = ''
     or v_payment.refund_status <> 'not_requested'
     or v_payment.stripe_refund_amount_minor <> 0
     or v_reservation_status not in ('picked_up', 'returned', 'no_show') then
    return;
  end if;

  v_stale_reference := coalesce(v_payment.transfer_last_attempt_at, v_payment.updated_at);

  if v_payment.transfer_status = 'not_created' then
    v_can_claim := true;
  elsif v_payment.transfer_status = 'failed'
        and v_payment.transfer_next_retry_at is not null
        and v_payment.transfer_next_retry_at <= v_now then
    v_can_claim := true;
  elsif v_payment.transfer_status = 'pending'
        and v_stale_reference <= v_now - interval '15 minutes' then
    v_can_claim := true;
  end if;

  if not v_can_claim then
    return;
  end if;

  return query
  update public.payments p
  set
    transfer_status = 'pending',
    transfer_attempt_count = p.transfer_attempt_count + 1,
    transfer_last_attempt_at = v_now,
    transfer_next_retry_at = null,
    transfer_last_error = null,
    updated_at = v_now
  where p.id = v_payment.id
    and p.reservation_id = p_reservation_id
  returning
    p.id,
    p.reservation_id,
    p.transfer_attempt_count,
    p.transfer_status,
    p.transfer_last_attempt_at;
end;
$function$;

create or replace function public.record_stripe_owner_transfer_attempt(
  p_payment_id uuid,
  p_reservation_id uuid,
  p_attempt_count integer,
  p_stripe_transfer_id text,
  p_transfer_amount_minor integer,
  p_transfer_currency text,
  p_stripe_charge_balance_transaction_id text,
  p_stripe_charge_balance_amount_minor integer,
  p_stripe_charge_balance_currency text
)
returns table(
  payment_id uuid,
  reservation_id uuid,
  stripe_transfer_id text,
  transfer_amount_minor integer,
  transfer_currency text,
  transfer_status text,
  transfer_created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_payment public.payments%rowtype;
  v_reservation public.reservations%rowtype;
  v_profile public.profiles%rowtype;
  v_now timestamptz := now();
  v_expected_transfer_minor integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;

  if p_attempt_count is null or p_attempt_count < 1 then
    raise exception 'Owner transfer attempt count is invalid';
  end if;

  if p_stripe_transfer_id is null or btrim(p_stripe_transfer_id) = '' then
    raise exception 'Stripe transfer id is required';
  end if;

  if p_transfer_amount_minor is null or p_transfer_amount_minor <= 0 then
    raise exception 'Stripe transfer amount is invalid';
  end if;

  if p_transfer_currency is null
     or p_transfer_currency !~ '^[a-z]{3}$' then
    raise exception 'Stripe transfer currency is invalid';
  end if;

  if p_stripe_charge_balance_transaction_id is null
     or btrim(p_stripe_charge_balance_transaction_id) = '' then
    raise exception 'Stripe balance transaction id is required';
  end if;

  if p_stripe_charge_balance_amount_minor is null
     or p_stripe_charge_balance_amount_minor <= 0 then
    raise exception 'Stripe settlement amount is invalid';
  end if;

  if p_stripe_charge_balance_currency is null
     or p_stripe_charge_balance_currency !~ '^[a-z]{3}$'
     or p_stripe_charge_balance_currency <> p_transfer_currency then
    raise exception 'Stripe settlement currency does not match transfer currency';
  end if;

  select p.*
  into v_payment
  from public.payments p
  where p.id = p_payment_id
    and p.reservation_id = p_reservation_id
  for update;

  if not found then
    raise exception 'Payment was not found for reservation';
  end if;

  select r.*
  into v_reservation
  from public.reservations r
  where r.id = p_reservation_id
  for update;

  if not found then
    raise exception 'Reservation was not found';
  end if;

  select pr.*
  into v_profile
  from public.profiles pr
  where pr.id = v_payment.owner_id;

  if not found then
    raise exception 'Owner profile was not found';
  end if;

  if v_payment.provider <> 'stripe'
     or v_payment.status <> 'paid'
     or v_payment.currency <> 'czk'
     or v_payment.stripe_payment_intent_status <> 'succeeded'
     or v_payment.stripe_payment_intent_id is null
     or btrim(v_payment.stripe_payment_intent_id) = ''
     or v_payment.stripe_charge_id is null
     or btrim(v_payment.stripe_charge_id) = '' then
    raise exception 'Payment is not eligible for owner transfer';
  end if;

  if v_reservation.status not in ('picked_up', 'returned', 'no_show') then
    raise exception 'Reservation has not been handed over or settled as no-show';
  end if;

  if v_payment.payer_id <> v_reservation.renter_id
     or v_payment.owner_id <> v_reservation.owner_id then
    raise exception 'Payment parties do not match reservation';
  end if;

  if v_payment.amount_total <> v_reservation.total_price
     or v_payment.platform_fee_amount <> v_reservation.platform_fee_amount
     or v_payment.owner_payout <> v_reservation.owner_payout
     or v_payment.platform_fee_amount + v_payment.owner_payout <> v_payment.amount_total then
    raise exception 'Payment snapshot does not match reservation';
  end if;

  if v_payment.stripe_amount_total_minor is null
     or v_payment.stripe_amount_total_minor <> v_payment.amount_total * 100 then
    raise exception 'Stored Stripe amount is invalid';
  end if;

  v_expected_transfer_minor := round(
    p_stripe_charge_balance_amount_minor::numeric
    * v_payment.owner_payout::numeric
    / v_payment.amount_total::numeric
  )::integer;

  if v_expected_transfer_minor <= 0
     or v_expected_transfer_minor > p_stripe_charge_balance_amount_minor
     or p_transfer_amount_minor <> v_expected_transfer_minor then
    raise exception 'Stripe transfer amount does not match owner payout ratio';
  end if;

  if v_payment.refund_status <> 'not_requested'
     or v_payment.stripe_refund_amount_minor <> 0 then
    raise exception 'Refund state blocks owner transfer';
  end if;

  if v_profile.stripe_connected_account_id is null
     or btrim(v_profile.stripe_connected_account_id) = ''
     or v_profile.stripe_connect_status <> 'ready'
     or v_profile.stripe_connect_transfers_enabled is not true then
    raise exception 'Owner Stripe account is not ready';
  end if;

  if v_payment.stripe_charge_balance_transaction_id is not null
     and v_payment.stripe_charge_balance_transaction_id <> p_stripe_charge_balance_transaction_id then
    raise exception 'Existing Stripe balance transaction does not match';
  end if;

  if v_payment.stripe_charge_balance_amount_minor is not null
     and v_payment.stripe_charge_balance_amount_minor <> p_stripe_charge_balance_amount_minor then
    raise exception 'Existing Stripe settlement amount does not match';
  end if;

  if v_payment.stripe_charge_balance_currency is not null
     and v_payment.stripe_charge_balance_currency <> p_stripe_charge_balance_currency then
    raise exception 'Existing Stripe settlement currency does not match';
  end if;

  -- Idempotent success is still allowed when the exact transfer has already been
  -- recorded. This branch performs no mutation and therefore cannot let an old
  -- attempt overwrite a newer one.
  if v_payment.stripe_transfer_id is not null then
    if v_payment.stripe_transfer_id <> p_stripe_transfer_id
       or v_payment.stripe_transfer_amount_minor <> p_transfer_amount_minor
       or v_payment.stripe_transfer_currency <> p_transfer_currency
       or v_payment.stripe_charge_balance_transaction_id <> p_stripe_charge_balance_transaction_id
       or v_payment.stripe_charge_balance_amount_minor <> p_stripe_charge_balance_amount_minor
       or v_payment.stripe_charge_balance_currency <> p_stripe_charge_balance_currency
       or v_payment.transfer_status <> 'succeeded' then
      raise exception 'Existing owner transfer does not match';
    end if;

    return query
    select
      v_payment.id,
      v_reservation.id,
      v_payment.stripe_transfer_id,
      v_payment.stripe_transfer_amount_minor,
      v_payment.stripe_transfer_currency,
      v_payment.transfer_status,
      v_payment.transfer_created_at;
    return;
  end if;

  if v_payment.transfer_status <> 'pending'
     or v_payment.transfer_attempt_count <> p_attempt_count then
    raise exception 'Owner transfer attempt is stale or not pending';
  end if;

  update public.payments p
  set
    stripe_charge_balance_transaction_id = p_stripe_charge_balance_transaction_id,
    stripe_charge_balance_amount_minor = p_stripe_charge_balance_amount_minor,
    stripe_charge_balance_currency = p_stripe_charge_balance_currency,
    stripe_transfer_id = p_stripe_transfer_id,
    stripe_transfer_amount_minor = p_transfer_amount_minor,
    stripe_transfer_currency = p_transfer_currency,
    transfer_status = 'succeeded',
    transfer_created_at = coalesce(p.transfer_created_at, v_now),
    transfer_next_retry_at = null,
    transfer_last_error = null,
    updated_at = v_now
  where p.id = v_payment.id
    and p.reservation_id = p_reservation_id
    and p.stripe_transfer_id is null
    and p.transfer_status = 'pending'
    and p.transfer_attempt_count = p_attempt_count;

  if not found then
    raise exception 'Owner transfer could not be recorded';
  end if;

  return query
  select
    p.id,
    r.id,
    p.stripe_transfer_id,
    p.stripe_transfer_amount_minor,
    p.stripe_transfer_currency,
    p.transfer_status,
    p.transfer_created_at
  from public.payments p
  join public.reservations r on r.id = p.reservation_id
  where p.id = v_payment.id;
end;
$function$;

create or replace function public.get_due_stripe_owner_transfer_retry_candidates(
  p_limit integer default 10
)
returns table(
  payment_id uuid,
  reservation_id uuid,
  transfer_status text,
  transfer_attempt_count integer,
  eligible_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_now timestamptz := now();
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Owner transfer retry limit must be between 1 and 50';
  end if;

  return query
  select
    p.id,
    r.id,
    p.transfer_status,
    p.transfer_attempt_count,
    case
      when p.transfer_status = 'failed' then p.transfer_next_retry_at
      when p.transfer_status = 'pending' then
        coalesce(p.transfer_last_attempt_at, p.updated_at) + interval '15 minutes'
      else p.updated_at
    end as eligible_at
  from public.payments p
  join public.reservations r
    on r.id = p.reservation_id
  where p.stripe_transfer_id is null
    and p.provider = 'stripe'
    and p.status = 'paid'
    and p.currency = 'czk'
    and p.stripe_payment_intent_status = 'succeeded'
    and p.stripe_payment_intent_id is not null
    and btrim(p.stripe_payment_intent_id) <> ''
    and p.stripe_charge_id is not null
    and btrim(p.stripe_charge_id) <> ''
    and p.refund_status = 'not_requested'
    and p.stripe_refund_amount_minor = 0
    and r.status in ('picked_up', 'returned', 'no_show')
    and p.owner_id = r.owner_id
    and p.payer_id = r.renter_id
    and p.amount_total = r.total_price
    and p.platform_fee_amount = r.platform_fee_amount
    and p.owner_payout = r.owner_payout
    and p.platform_fee_amount + p.owner_payout = p.amount_total
    and p.stripe_amount_total_minor = p.amount_total * 100
    and (
      p.transfer_status = 'not_created'
      or (
        p.transfer_status = 'failed'
        and p.transfer_next_retry_at is not null
        and p.transfer_next_retry_at <= v_now
      )
      or (
        p.transfer_status = 'pending'
        and coalesce(p.transfer_last_attempt_at, p.updated_at)
          <= v_now - interval '15 minutes'
      )
    )
  order by
    case
      when p.transfer_status = 'failed' then p.transfer_next_retry_at
      when p.transfer_status = 'pending' then
        coalesce(p.transfer_last_attempt_at, p.updated_at) + interval '15 minutes'
      else p.updated_at
    end asc,
    p.id asc
  limit p_limit;
end;
$function$;

-- Account deletion must not strand the no-show owner's unsettled Stripe payout.
create or replace function public.get_my_account_deactivation_status_v2()
returns table (
  account_status text,
  can_deactivate boolean,
  blocking_reservations_count bigint,
  blocking_as_owner_count bigint,
  blocking_as_renter_count bigint,
  offers_to_close_count bigint,
  open_owner_debts_count bigint,
  unfinished_refunds_count bigint,
  unresolved_owner_transfers_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_account_status text;
  v_reservations bigint := 0;
  v_as_owner bigint := 0;
  v_as_renter bigint := 0;
  v_offers bigint := 0;
  v_debts bigint := 0;
  v_refunds bigint := 0;
  v_transfers bigint := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select p.account_status into v_account_status
  from public.profiles p
  where p.id = v_user_id;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  select
    count(*),
    count(*) filter (where r.owner_id = v_user_id),
    count(*) filter (where r.renter_id = v_user_id)
  into v_reservations, v_as_owner, v_as_renter
  from public.reservations r
  where (r.owner_id = v_user_id or r.renter_id = v_user_id)
    and r.status in (
      'pending'::public.reservation_status,
      'approved'::public.reservation_status,
      'paid'::public.reservation_status,
      'picked_up'::public.reservation_status
    );

  select count(*) into v_offers
  from public.offers o
  where o.owner_id = v_user_id
    and o.status <> 'deleted'::public.offer_status;

  -- Settled ('paid') or waived debts do not block account deletion.
  select count(*) into v_debts
  from public.owner_cancellation_debts d
  where d.owner_id = v_user_id
    and d.status = 'open';

  -- A paid cancellation can leave a refund pending after its reservation is
  -- already 'cancelled'. Neither party should lose access before settlement.
  select count(*) into v_refunds
  from public.reservation_cancellations c
  join public.reservations r on r.id = c.reservation_id
  join public.payments p on p.id = c.payment_id
  where c.cancellation_kind = 'paid_refund'
    and (r.owner_id = v_user_id or r.renter_id = v_user_id)
    and (
      c.financials_finalized_at is null
      or p.refund_status is distinct from 'succeeded'
    );

  -- A returned reservation is no longer active, but its owner's transfer can
  -- still be missing, pending, failed, or reversed. The retry worker must be
  -- allowed to finish while the owner retains access to payout setup.
  select count(*) into v_transfers
  from public.payments p
  join public.reservations r on r.id = p.reservation_id
  where p.owner_id = v_user_id
    and r.status in (
      'picked_up'::public.reservation_status,
      'returned'::public.reservation_status,
      'no_show'::public.reservation_status
    )
    and p.provider = 'stripe'
    and p.status = 'paid'
    and p.refund_status = 'not_requested'
    and p.transfer_status is distinct from 'succeeded';

  return query
  select
    v_account_status,
    (
      v_account_status = 'active'
      and v_reservations = 0
      and v_debts = 0
      and v_refunds = 0
      and v_transfers = 0
    ),
    v_reservations,
    v_as_owner,
    v_as_renter,
    v_offers,
    v_debts,
    v_refunds,
    v_transfers;
end;
$function$;

create or replace function public.finalize_account_deactivation(target_user_id uuid)
returns table (
  account_status text,
  closed_offers_count bigint,
  deactivated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_status text;
  v_existing_deactivated_at timestamptz;
  v_blocking_count bigint := 0;
  v_open_debts bigint := 0;
  v_unfinished_refunds bigint := 0;
  v_unresolved_transfers bigint := 0;
  v_closed_offers_count bigint := 0;
  v_deactivated_at timestamptz;
begin
  if target_user_id is null then
    raise exception 'Target user is required' using errcode = '22023';
  end if;

  -- The same advisory lock as prepare_reservation_insert() protects against
  -- a reservation appearing between the eligibility check and deactivation.
  perform pg_advisory_xact_lock(860808, hashtext(target_user_id::text));

  select p.account_status, p.deactivated_at
  into v_account_status, v_existing_deactivated_at
  from public.profiles p
  where p.id = target_user_id
  for update;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if v_account_status = 'deactivated' then
    return query select v_account_status, 0::bigint, v_existing_deactivated_at;
    return;
  end if;

  if v_account_status <> 'active' then
    raise exception 'Account is not active' using errcode = 'P0001';
  end if;

  select count(*) into v_blocking_count
  from public.reservations r
  where (r.owner_id = target_user_id or r.renter_id = target_user_id)
    and r.status in (
      'pending'::public.reservation_status,
      'approved'::public.reservation_status,
      'paid'::public.reservation_status,
      'picked_up'::public.reservation_status
    );

  if v_blocking_count > 0 then
    raise exception 'Account has active reservations'
      using errcode = 'P0001',
        detail = 'blocking_reservations=' || v_blocking_count::text;
  end if;

  select count(*) into v_open_debts
  from public.owner_cancellation_debts d
  where d.owner_id = target_user_id
    and d.status = 'open';

  select count(*) into v_unfinished_refunds
  from public.reservation_cancellations c
  join public.reservations r on r.id = c.reservation_id
  join public.payments p on p.id = c.payment_id
  where c.cancellation_kind = 'paid_refund'
    and (r.owner_id = target_user_id or r.renter_id = target_user_id)
    and (
      c.financials_finalized_at is null
      or p.refund_status is distinct from 'succeeded'
    );

  select count(*) into v_unresolved_transfers
  from public.payments p
  join public.reservations r on r.id = p.reservation_id
  where p.owner_id = target_user_id
    and r.status in (
      'picked_up'::public.reservation_status,
      'returned'::public.reservation_status,
      'no_show'::public.reservation_status
    )
    and p.provider = 'stripe'
    and p.status = 'paid'
    and p.refund_status = 'not_requested'
    and p.transfer_status is distinct from 'succeeded';

  if v_open_debts > 0 or v_unfinished_refunds > 0 or v_unresolved_transfers > 0 then
    raise exception 'Account has unresolved financial obligations'
      using errcode = 'P0001',
        detail = format(
          'open_debts=%s, unfinished_refunds=%s, unresolved_transfers=%s',
          v_open_debts, v_unfinished_refunds, v_unresolved_transfers
        );
  end if;

  update public.offers o
  set status = 'deleted'::public.offer_status,
      updated_at = now()
  where o.owner_id = target_user_id
    and o.status <> 'deleted'::public.offer_status;

  get diagnostics v_closed_offers_count = row_count;
  v_deactivated_at := now();

  update public.profiles p
  set account_status = 'deactivated',
      deactivation_requested_at = coalesce(p.deactivation_requested_at, v_deactivated_at),
      deactivated_at = v_deactivated_at,
      updated_at = v_deactivated_at
  where p.id = target_user_id;

  return query
  select 'deactivated'::text, v_closed_offers_count, v_deactivated_at;
end;
$function$;

-- Runs server-side, directly under the database postgres Cron role. It never
-- trusts the browser and never calls Stripe inside a database transaction.
-- Re-running or overlapping Cron jobs cannot settle the same reservation twice.
create or replace function public.process_due_reservation_no_shows(p_limit integer default 10)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_reservation public.reservations%rowtype;
  v_payment public.payments%rowtype;
  v_payment_count integer;
  v_count integer := 0;
  v_rows integer;
  v_error text;
begin
  if session_user <> 'postgres' then
    raise exception 'Only the database Cron role can settle no-show reservations';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 25 then
    raise exception 'No-show batch limit must be 1-25';
  end if;

  for v_reservation in
    select r.*
    from public.reservations r
    join public.reservation_no_show_activation a on a.singleton = true
    left join public.reservation_no_show_issues i on i.reservation_id = r.id
    where r.status = 'paid'
      and r.start_date >= a.first_pickup_date
      and r.created_at >= a.first_reservation_created_at
      -- Also load old/malformed rows with missing pickup_time after their last
      -- calendar day, so they are flagged for review rather than paid out.
      and (
        (r.pickup_time is not null
          and clock_timestamp() >= ((r.end_date + r.pickup_time) at time zone 'Europe/Prague'))
        or (r.pickup_time is null
          and r.end_date < (now() at time zone 'Europe/Prague')::date)
      )
      and (i.last_checked_at is null
        or i.last_checked_at <= now() - interval '15 minutes')
    order by r.end_date, r.id
    for update of r skip locked
    limit p_limit
  loop
    v_error := null;
    select count(*) into v_payment_count
    from public.payments p where p.reservation_id = v_reservation.id;
    if v_payment_count <> 1 then
      v_error := 'Expected exactly one stored payment';
    else
      select p.* into v_payment
      from public.payments p
      where p.reservation_id = v_reservation.id
      for update;
      if v_reservation.pickup_time is null
         or v_payment.provider <> 'stripe' or v_payment.status <> 'paid'
         or v_payment.currency <> 'czk'
         or v_payment.stripe_payment_intent_status <> 'succeeded'
         or nullif(btrim(coalesce(v_payment.stripe_payment_intent_id, '')), '') is null
         or nullif(btrim(coalesce(v_payment.stripe_charge_id, '')), '') is null
         or v_payment.stripe_amount_total_minor is distinct from v_payment.amount_total * 100
         or v_payment.payer_id is distinct from v_reservation.renter_id
         or v_payment.owner_id is distinct from v_reservation.owner_id
         or v_payment.amount_total is distinct from v_reservation.total_price
         or v_payment.platform_fee_amount is distinct from v_reservation.platform_fee_amount
         or v_payment.owner_payout is distinct from v_reservation.owner_payout
         or v_payment.platform_fee_amount + v_payment.owner_payout <> v_payment.amount_total
         or v_payment.refund_status is distinct from 'not_requested'
         or v_payment.stripe_refund_amount_minor is distinct from 0
         or v_payment.stripe_refund_id is not null
         or v_payment.transfer_status is distinct from 'not_created'
         or v_payment.stripe_transfer_id is not null
         or exists (select 1 from public.reservation_cancellations c
                    where c.reservation_id = v_reservation.id)
      then
        v_error := 'Payment, refund or transfer state is not eligible for no-show';
      end if;
    end if;

    if v_error is not null then
      insert into public.reservation_no_show_issues (reservation_id, reason)
      values (v_reservation.id, v_error)
      on conflict (reservation_id) do update
        set reason = excluded.reason, last_checked_at = now(),
            attempt_count = public.reservation_no_show_issues.attempt_count + 1;
      continue;
    end if;

    perform set_config('app.no_show_authorized', 'on', true);
    update public.reservations r
    set status = 'no_show', updated_at = now()
    where r.id = v_reservation.id and r.status = 'paid'
      and r.created_at >= (
        select a.first_reservation_created_at
        from public.reservation_no_show_activation a
        where a.singleton = true
      )
      and r.pickup_time is not null
      and clock_timestamp() >= ((r.end_date + r.pickup_time) at time zone 'Europe/Prague');
    get diagnostics v_rows = row_count;
    perform set_config('app.no_show_authorized', 'off', true);
    if v_rows = 1 then
      v_count := v_count + 1;
      delete from public.reservation_no_show_issues i where i.reservation_id = v_reservation.id;
    end if;
  end loop;

  return v_count;
end;
$function$;
revoke all on function public.process_due_reservation_no_shows(integer)
  from public, anon, authenticated, service_role;

-- Cron runs each minute and settles at the first run ON/AFTER the scheduled
-- Prague-local return timestamp, including DST changes (not at midnight).
-- Only when NEW no-shows are settled, immediately ask the already-secured
-- transfer retry worker to attempt Stripe transfers. Its regular 5-minute
-- schedule remains in place for retry/recovery. Missing Vault config makes
-- this outbound call inert; it never points at the other project.
select cron.schedule(
  'rentulo-paid-no-show-every-minute',
  '* * * * *',
  $cron$
    with processed as (
      select public.process_due_reservation_no_shows(10) as completed
    ), cfg as (
      select
        max(s.decrypted_secret) filter (
          where s.name = 'rentulo_project_url'
        ) as project_url,
        max(s.decrypted_secret) filter (
          where s.name = 'rentulo_owner_transfer_retry_cron_secret'
        ) as cron_secret
      from vault.decrypted_secrets s
      where s.name in (
        'rentulo_project_url', 'rentulo_owner_transfer_retry_cron_secret'
      )
    )
    select net.http_post(
      url := trim(trailing '/' from cfg.project_url)
        || '/functions/v1/retry-owner-transfers',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-rentulo-cron-secret', cfg.cron_secret
      ),
      body := jsonb_build_object('limit', 10),
      timeout_milliseconds := 60000
    ) as request_id
    from processed cross join cfg
    where processed.completed > 0
      and cfg.project_url = 'https://vspposovhdgvbeukoivh.supabase.co'
      and length(cfg.cron_secret) >= 64;
  $cron$
);

commit;
