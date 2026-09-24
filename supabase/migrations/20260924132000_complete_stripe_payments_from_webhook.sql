begin;

-- Allow the trusted Stripe completion RPC to perform approved -> paid while
-- preserving every existing owner/renter transition and the test-payment path.
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

  if
    old.status = 'approved'
    and new.status = 'paid'
    and auth.role() = 'service_role'
    and current_setting('app.stripe_payment_authorized', true) = 'on'
  then
    return new;
  end if;

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
      (old.status = 'pending' and new.status in ('approved', 'rejected'))
      or (old.status = 'paid' and new.status = 'picked_up')
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
    if
      old.status = 'approved'
      and new.status = 'paid'
      and current_setting(
        'app.test_payment_authorized',
        true
      ) = 'on'
      and exists (
        select 1
        from public.test_payment_users t
        where t.user_id = auth.uid()
      )
    then
      return new;
    end if;

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

-- One trusted, atomic completion path for Stripe payment_intent.succeeded.
-- The Edge Function verifies the Stripe signature; this RPC re-validates all
-- persisted identifiers and amounts before changing financial/reservation state.
create or replace function public.complete_stripe_payment_from_webhook(
  p_payment_id uuid,
  p_reservation_id uuid,
  p_stripe_payment_intent_id text,
  p_stripe_payment_intent_status text,
  p_amount_received_minor integer,
  p_currency text,
  p_stripe_charge_id text default null
)
returns table(
  payment_id uuid,
  reservation_id uuid,
  payment_status public.payment_status,
  reservation_status public.reservation_status,
  paid_at timestamp with time zone
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_payment public.payments%rowtype;
  v_reservation public.reservations%rowtype;
  v_paid_at timestamp with time zone := now();
  v_updated_rows integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;

  if p_stripe_payment_intent_id is null
     or btrim(p_stripe_payment_intent_id) = '' then
    raise exception 'Stripe payment intent id is required';
  end if;

  if p_stripe_payment_intent_status <> 'succeeded' then
    raise exception 'Stripe payment intent is not succeeded';
  end if;

  if lower(coalesce(p_currency, '')) <> 'czk' then
    raise exception 'Stripe payment currency must be CZK';
  end if;

  if p_amount_received_minor is null or p_amount_received_minor <= 0 then
    raise exception 'Stripe payment amount is invalid';
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

  if v_payment.provider <> 'stripe' then
    raise exception 'Payment provider is not Stripe';
  end if;

  if v_payment.currency <> 'czk' then
    raise exception 'Stored payment currency is not CZK';
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
     or v_payment.stripe_amount_total_minor <> p_amount_received_minor
     or v_payment.amount_total * 100 <> p_amount_received_minor then
    raise exception 'Stripe amount does not match payment';
  end if;

  if v_payment.stripe_payment_intent_id is not null
     and v_payment.stripe_payment_intent_id <> p_stripe_payment_intent_id then
    raise exception 'Stripe payment intent does not match existing payment';
  end if;

  if p_stripe_charge_id is not null
     and btrim(p_stripe_charge_id) <> ''
     and v_payment.stripe_charge_id is not null
     and v_payment.stripe_charge_id <> p_stripe_charge_id then
    raise exception 'Stripe charge does not match existing payment';
  end if;

  -- Stripe can retry the same event. A matching already-paid record is success,
  -- not a second state transition.
  if v_payment.status = 'paid' then
    if v_payment.stripe_payment_intent_id <> p_stripe_payment_intent_id
       or v_payment.stripe_payment_intent_status <> 'succeeded'
       or v_reservation.status not in ('paid', 'picked_up', 'returned') then
      raise exception 'Existing paid state does not match Stripe event';
    end if;

    return query
    select
      v_payment.id,
      v_reservation.id,
      v_payment.status,
      v_reservation.status,
      v_payment.paid_at;
    return;
  end if;

  if v_payment.status <> 'pending' then
    raise exception 'Payment is not pending';
  end if;

  if v_reservation.status <> 'approved' then
    raise exception 'Reservation is not approved for payment';
  end if;

  perform set_config('app.stripe_payment_authorized', 'on', true);

  update public.payments p
  set
    status = 'paid',
    paid_at = coalesce(p.paid_at, v_paid_at),
    stripe_payment_intent_id = p_stripe_payment_intent_id,
    stripe_payment_intent_status = 'succeeded',
    stripe_charge_id = case
      when p_stripe_charge_id is null or btrim(p_stripe_charge_id) = ''
        then p.stripe_charge_id
      else p_stripe_charge_id
    end,
    updated_at = v_paid_at
  where p.id = v_payment.id
    and p.status = 'pending';

  get diagnostics v_updated_rows = row_count;

  if v_updated_rows <> 1 then
    raise exception 'Payment could not be completed';
  end if;

  update public.reservations r
  set
    status = 'paid',
    paid_at = coalesce(r.paid_at, v_paid_at),
    payment_provider_status = 'succeeded',
    updated_at = v_paid_at
  where r.id = v_reservation.id
    and r.status = 'approved';

  get diagnostics v_updated_rows = row_count;

  if v_updated_rows <> 1 then
    raise exception 'Reservation could not be marked paid';
  end if;

  perform set_config('app.stripe_payment_authorized', 'off', true);

  return query
  select
    p.id,
    r.id,
    p.status,
    r.status,
    p.paid_at
  from public.payments p
  join public.reservations r on r.id = p.reservation_id
  where p.id = v_payment.id;
end;
$function$;

revoke all on function public.complete_stripe_payment_from_webhook(
  uuid,
  uuid,
  text,
  text,
  integer,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.complete_stripe_payment_from_webhook(
  uuid,
  uuid,
  text,
  text,
  integer,
  text,
  text
) to service_role;

commit;
