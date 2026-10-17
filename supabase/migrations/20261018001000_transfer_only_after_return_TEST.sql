-- RENTULO BOD 01 / ETAPA 5 / Stripe owner transfer after return (TEST ONLY).
-- Do not trigger owner transfer on pickup. A new transfer is eligible ONLY after
-- confirmed return (returned) or finalized paid no-show (no_show).
-- Preserve the existing Stripe amount/currency, retry, refund, and idempotency protections.
-- Historical successful transfers are not modified or reversed.
begin;

do $test_project$
begin
  if not exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'rentulo_project_url'
      and btrim(s.decrypted_secret, '/') = 'https://vspposovhdgvbeukoivh.supabase.co'
  ) then
    raise exception 'BOD 01 transfer-after-return migration is TEST-only';
  end if;
end;
$test_project$;

-- The three currently active RPCs are redefined from the proven paid-no-show
-- release logic. The ONLY financial eligibility change is removing picked_up.
-- This closes both direct trusted calls and the automatic 5-minute retry path.

-- Current claim_stripe_owner_transfer_attempt: must not initiate a new transfer for picked_up.
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
     or v_reservation_status not in ('returned', 'no_show') then
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

-- Current record_stripe_owner_transfer_attempt: must not initiate a new transfer for picked_up.
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

  if v_reservation.status not in ('returned', 'no_show') then
    raise exception 'Reservation has not been returned or settled as no-show';
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

-- Current get_due_stripe_owner_transfer_retry_candidates: must not initiate a new transfer for picked_up.
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
    and r.status in ('returned', 'no_show')
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

revoke all on function public.claim_stripe_owner_transfer_attempt(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_stripe_owner_transfer_attempt(uuid, uuid)
  to service_role;

revoke all on function public.record_stripe_owner_transfer_attempt(
  uuid, uuid, integer, text, integer, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.record_stripe_owner_transfer_attempt(
  uuid, uuid, integer, text, integer, text, text, integer, text
) to service_role;

revoke all on function public.get_due_stripe_owner_transfer_retry_candidates(integer)
  from public, anon, authenticated;
grant execute on function public.get_due_stripe_owner_transfer_retry_candidates(integer)
  to service_role;

-- Old eight-parameter recorder has no caller in the current code path.
-- Disable its service-role EXECUTE permission so a legacy call cannot persist
-- a transfer under the obsolete picked_up eligibility. Current finalization
-- uses record_stripe_owner_transfer_attempt() exclusively.
revoke execute on function public.record_stripe_owner_transfer(
  uuid, uuid, text, integer, text, text, integer, text
) from public, anon, authenticated, service_role;

commit;
