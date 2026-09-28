begin;

-- Stripe may settle a CZK customer charge into the platform balance in another
-- currency (for example EUR). A transfer tied to source_transaction must use the
-- source charge balance transaction currency, so persist that settlement snapshot
-- together with the actual transfer currency.
alter table public.payments
  add column if not exists stripe_charge_balance_amount_minor integer,
  add column if not exists stripe_charge_balance_currency text,
  add column if not exists stripe_transfer_currency text;

alter table public.payments
  drop constraint if exists payments_stripe_charge_balance_amount_minor_check,
  drop constraint if exists payments_stripe_charge_balance_currency_check,
  drop constraint if exists payments_stripe_transfer_currency_check;

alter table public.payments
  add constraint payments_stripe_charge_balance_amount_minor_check
    check (
      stripe_charge_balance_amount_minor is null
      or stripe_charge_balance_amount_minor > 0
    ),
  add constraint payments_stripe_charge_balance_currency_check
    check (
      stripe_charge_balance_currency is null
      or stripe_charge_balance_currency ~ '^[a-z]{3}$'
    ),
  add constraint payments_stripe_transfer_currency_check
    check (
      stripe_transfer_currency is null
      or stripe_transfer_currency ~ '^[a-z]{3}$'
    );

comment on column public.payments.stripe_charge_balance_transaction_id is
  'Stripe balance transaction backing the source charge used for the owner transfer.';
comment on column public.payments.stripe_charge_balance_amount_minor is
  'Gross source charge amount after Stripe settlement conversion, in the settlement currency minor unit.';
comment on column public.payments.stripe_charge_balance_currency is
  'ISO settlement currency of the source charge Stripe balance transaction.';
comment on column public.payments.stripe_transfer_currency is
  'ISO currency actually used for the Stripe Connect owner transfer.';

-- Replace the original recorder signature so there is only one trusted finalizer.
drop function if exists public.record_stripe_owner_transfer(
  uuid,
  uuid,
  text,
  integer
);

create function public.record_stripe_owner_transfer(
  p_payment_id uuid,
  p_reservation_id uuid,
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

  if v_reservation.status not in ('picked_up', 'returned') then
    raise exception 'Reservation has not been picked up';
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

  -- Preserve the configured CZK payout ratio after Stripe converts the source
  -- charge into the platform settlement currency. Positive values use standard
  -- half-up rounding to the destination currency minor unit.
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

  -- Idempotent database recording: the exact same transfer may be safely retried
  -- after a transient database failure following a successful Stripe request.
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

  if v_payment.transfer_status <> 'not_created' then
    raise exception 'Owner transfer is not in a creatable state';
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
    updated_at = v_now
  where p.id = v_payment.id
    and p.stripe_transfer_id is null
    and p.transfer_status = 'not_created';

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

revoke all on function public.record_stripe_owner_transfer(
  uuid,
  uuid,
  text,
  integer,
  text,
  text,
  integer,
  text
) from public, anon, authenticated;

grant execute on function public.record_stripe_owner_transfer(
  uuid,
  uuid,
  text,
  integer,
  text,
  text,
  integer,
  text
) to service_role;

commit;
