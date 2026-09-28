begin;

-- Record asynchronous Stripe refund state changes for paid reservation cancellations.
-- The signed webhook is the provider source of truth; browser users never execute
-- this function directly. The RPC is intentionally narrow and revalidates every
-- Rentulo identifier before changing the payment refund state.
create or replace function public.record_paid_cancellation_refund_webhook(
  p_payment_id uuid,
  p_reservation_id uuid,
  p_cancellation_id uuid,
  p_stripe_refund_id text,
  p_stripe_refund_status text,
  p_refund_amount_minor integer,
  p_currency text,
  p_stripe_charge_id text,
  p_stripe_refund_balance_transaction_id text default null,
  p_event_created_at timestamptz default null
)
returns table(
  payment_id uuid,
  reservation_id uuid,
  cancellation_id uuid,
  refund_status text,
  refund_amount_minor integer,
  refunded_at timestamptz,
  stale boolean
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_cancellation public.reservation_cancellations%rowtype;
  v_payment public.payments%rowtype;
  v_reservation public.reservations%rowtype;
  v_current_status text;
  v_effective_status text;
  v_effective_refunded_at timestamptz;
  v_stale boolean := false;
  v_event_at timestamptz := coalesce(p_event_created_at, now());
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;

  if p_stripe_refund_id is null or btrim(p_stripe_refund_id) = '' then
    raise exception 'Stripe refund id is required';
  end if;

  if p_stripe_refund_status not in (
    'pending', 'requires_action', 'succeeded', 'failed', 'canceled'
  ) then
    raise exception 'Stripe refund status is invalid';
  end if;

  if p_refund_amount_minor is null or p_refund_amount_minor <= 0 then
    raise exception 'Stripe refund amount is invalid';
  end if;

  if lower(coalesce(p_currency, '')) <> 'czk' then
    raise exception 'Stripe refund currency must be CZK';
  end if;

  if p_stripe_charge_id is null or btrim(p_stripe_charge_id) = '' then
    raise exception 'Stripe refund charge id is required';
  end if;

  select c.*
  into v_cancellation
  from public.reservation_cancellations c
  where c.id = p_cancellation_id
  for update;

  if not found then
    raise exception 'Paid cancellation was not found';
  end if;

  select p.*
  into v_payment
  from public.payments p
  where p.id = p_payment_id
  for update;

  if not found then
    raise exception 'Paid cancellation payment was not found';
  end if;

  select r.*
  into v_reservation
  from public.reservations r
  where r.id = p_reservation_id
  for update;

  if not found then
    raise exception 'Paid cancellation reservation was not found';
  end if;

  if
    v_cancellation.cancellation_kind <> 'paid_refund'
    or v_cancellation.payment_id <> v_payment.id
    or v_cancellation.reservation_id <> v_reservation.id
    or v_payment.reservation_id <> v_reservation.id
    or v_payment.provider <> 'stripe'
    or v_payment.status <> 'paid'
    or v_reservation.status <> 'cancelled'
    or v_payment.currency <> 'czk'
    or v_cancellation.currency <> 'czk'
    or v_payment.stripe_charge_id is null
    or v_payment.stripe_charge_id <> p_stripe_charge_id
    or v_payment.stripe_amount_total_minor is null
    or v_payment.stripe_amount_total_minor <> v_payment.amount_total * 100
    or v_cancellation.payment_amount_minor <> v_payment.stripe_amount_total_minor
  then
    raise exception 'Paid cancellation refund webhook state is inconsistent';
  end if;

  if
    v_payment.transfer_status <> 'not_created'
    or v_payment.stripe_transfer_id is not null
  then
    raise exception 'Owner transfer state blocks refund webhook update';
  end if;

  if v_payment.refund_status = 'not_requested' then
    raise exception 'Payment has not entered the refund flow';
  end if;

  if
    v_cancellation.refund_amount_minor is not null
    and v_cancellation.refund_amount_minor <> p_refund_amount_minor
  then
    raise exception 'Stripe refund amount does not match cancellation';
  end if;

  if
    v_payment.stripe_refund_id is not null
    and v_payment.stripe_refund_id <> p_stripe_refund_id
  then
    raise exception 'Stripe refund id does not match payment';
  end if;

  if
    v_payment.stripe_refund_amount_minor <> 0
    and v_payment.stripe_refund_amount_minor <> p_refund_amount_minor
  then
    raise exception 'Stripe refund amount does not match payment';
  end if;

  if
    v_payment.stripe_refund_balance_transaction_id is not null
    and p_stripe_refund_balance_transaction_id is not null
    and v_payment.stripe_refund_balance_transaction_id
      <> p_stripe_refund_balance_transaction_id
  then
    raise exception 'Stripe refund balance transaction does not match payment';
  end if;

  v_current_status := v_payment.refund_status;
  v_effective_status := p_stripe_refund_status;

  -- Terminal provider states cannot be moved backwards by a delayed webhook.
  -- Likewise, requires_action must not regress to an older pending snapshot.
  if
    v_current_status in ('succeeded', 'failed', 'canceled')
    and v_current_status <> p_stripe_refund_status
  then
    v_stale := true;
    v_effective_status := v_current_status;
  elsif
    v_current_status = 'requires_action'
    and p_stripe_refund_status = 'pending'
  then
    v_stale := true;
    v_effective_status := v_current_status;
  end if;

  if not v_stale then
    update public.payments p
    set
      stripe_refund_id = coalesce(p.stripe_refund_id, p_stripe_refund_id),
      stripe_refund_amount_minor = case
        when p.stripe_refund_amount_minor = 0 then p_refund_amount_minor
        else p.stripe_refund_amount_minor
      end,
      stripe_refund_balance_transaction_id = case
        when p_stripe_refund_balance_transaction_id is null
          then p.stripe_refund_balance_transaction_id
        else coalesce(
          p.stripe_refund_balance_transaction_id,
          p_stripe_refund_balance_transaction_id
        )
      end,
      refund_status = p_stripe_refund_status,
      refunded_at = case
        when p_stripe_refund_status = 'succeeded'
          then coalesce(p.refunded_at, v_event_at)
        else p.refunded_at
      end,
      updated_at = now()
    where p.id = v_payment.id;
  end if;

  select p.refund_status, p.refunded_at
  into v_effective_status, v_effective_refunded_at
  from public.payments p
  where p.id = v_payment.id;

  return query
  select
    v_payment.id,
    v_reservation.id,
    v_cancellation.id,
    v_effective_status,
    case
      when v_payment.stripe_refund_amount_minor = 0
        then p_refund_amount_minor
      else v_payment.stripe_refund_amount_minor
    end,
    v_effective_refunded_at,
    v_stale;
end;
$function$;

revoke all on function public.record_paid_cancellation_refund_webhook(
  uuid,
  uuid,
  uuid,
  text,
  text,
  integer,
  text,
  text,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.record_paid_cancellation_refund_webhook(
  uuid,
  uuid,
  uuid,
  text,
  text,
  integer,
  text,
  text,
  text,
  timestamptz
) to service_role;

commit;
