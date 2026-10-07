begin;

-- Persist owner-transfer retry state separately from the Stripe transfer itself.
-- These fields are inert until the trusted payout backend starts using the claim
-- and failure RPCs added below.
alter table public.payments
  add column if not exists transfer_attempt_count integer not null default 0,
  add column if not exists transfer_last_attempt_at timestamptz,
  add column if not exists transfer_next_retry_at timestamptz,
  add column if not exists transfer_last_error text;

alter table public.payments
  drop constraint if exists payments_transfer_attempt_count_check,
  drop constraint if exists payments_transfer_attempt_timestamp_check,
  drop constraint if exists payments_transfer_next_retry_state_check,
  drop constraint if exists payments_transfer_last_error_length_check;

alter table public.payments
  add constraint payments_transfer_attempt_count_check
    check (transfer_attempt_count >= 0),
  add constraint payments_transfer_attempt_timestamp_check
    check (
      (transfer_attempt_count = 0 and transfer_last_attempt_at is null)
      or (transfer_attempt_count > 0 and transfer_last_attempt_at is not null)
    ),
  add constraint payments_transfer_next_retry_state_check
    check (
      transfer_next_retry_at is null
      or transfer_status = 'failed'
    ),
  add constraint payments_transfer_last_error_length_check
    check (
      transfer_last_error is null
      or char_length(transfer_last_error) <= 2000
    );

comment on column public.payments.transfer_attempt_count is
  'Number of trusted backend attempts to create or recover the owner Stripe transfer.';
comment on column public.payments.transfer_last_attempt_at is
  'Timestamp when the latest trusted owner-transfer attempt was claimed.';
comment on column public.payments.transfer_next_retry_at is
  'Earliest timestamp for the next automatic owner-transfer retry; null means no automatic retry is scheduled.';
comment on column public.payments.transfer_last_error is
  'Last owner-transfer processing error, capped at 2000 characters.';

-- Future retry workers will scan only failed transfers whose retry time is due.
create index if not exists payments_owner_transfer_retry_due_idx
  on public.payments (transfer_next_retry_at, id)
  where transfer_status = 'failed'
    and stripe_transfer_id is null
    and transfer_next_retry_at is not null;

-- Claim exactly one payout attempt. The row lock serializes concurrent callers.
-- A fresh pending attempt cannot be stolen; a process that died while pending can
-- be reclaimed after 15 minutes. Permanent failures have next_retry_at = null and
-- are therefore never automatically reclaimed.
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
     or v_reservation_status not in ('picked_up', 'returned') then
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

revoke all on function public.claim_stripe_owner_transfer_attempt(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_stripe_owner_transfer_attempt(uuid, uuid)
  to service_role;

-- Finish one claimed attempt as failed. The attempt number is a compare-and-set
-- boundary: a stale process cannot overwrite the result of a newer reclaimed
-- attempt. Retryable failures use bounded backoff; permanent failures keep a null
-- next_retry_at and therefore require deliberate intervention.
create or replace function public.mark_stripe_owner_transfer_attempt_failed(
  p_payment_id uuid,
  p_reservation_id uuid,
  p_attempt_count integer,
  p_error text,
  p_retryable boolean
)
returns table(
  payment_id uuid,
  reservation_id uuid,
  attempt_count integer,
  transfer_status text,
  next_retry_at timestamptz,
  last_error text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_payment public.payments%rowtype;
  v_now timestamptz := now();
  v_error text;
  v_next_retry_at timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;

  if p_payment_id is null or p_reservation_id is null then
    raise exception 'Payment and reservation are required';
  end if;

  if p_attempt_count is null or p_attempt_count < 1 then
    raise exception 'Owner transfer attempt count is invalid';
  end if;

  if p_retryable is null then
    raise exception 'Retryable flag is required';
  end if;

  v_error := left(
    coalesce(nullif(btrim(p_error), ''), 'Unknown owner transfer error'),
    2000
  );

  select p.*
  into v_payment
  from public.payments p
  where p.id = p_payment_id
    and p.reservation_id = p_reservation_id
  for update;

  if not found then
    raise exception 'Payment was not found for reservation';
  end if;

  if v_payment.stripe_transfer_id is not null
     or v_payment.transfer_status <> 'pending'
     or v_payment.transfer_attempt_count <> p_attempt_count then
    raise exception 'Owner transfer attempt is stale or not pending';
  end if;

  if p_retryable then
    v_next_retry_at := v_now + case
      when p_attempt_count = 1 then interval '5 minutes'
      when p_attempt_count = 2 then interval '15 minutes'
      when p_attempt_count = 3 then interval '1 hour'
      when p_attempt_count = 4 then interval '6 hours'
      else interval '24 hours'
    end;
  else
    v_next_retry_at := null;
  end if;

  return query
  update public.payments p
  set
    transfer_status = 'failed',
    transfer_next_retry_at = v_next_retry_at,
    transfer_last_error = v_error,
    updated_at = v_now
  where p.id = v_payment.id
    and p.reservation_id = p_reservation_id
    and p.transfer_status = 'pending'
    and p.transfer_attempt_count = p_attempt_count
    and p.stripe_transfer_id is null
  returning
    p.id,
    p.reservation_id,
    p.transfer_attempt_count,
    p.transfer_status,
    p.transfer_next_retry_at,
    p.transfer_last_error;
end;
$function$;

revoke all on function public.mark_stripe_owner_transfer_attempt_failed(
  uuid,
  uuid,
  integer,
  text,
  boolean
) from public, anon, authenticated;
grant execute on function public.mark_stripe_owner_transfer_attempt_failed(
  uuid,
  uuid,
  integer,
  text,
  boolean
) to service_role;

commit;
