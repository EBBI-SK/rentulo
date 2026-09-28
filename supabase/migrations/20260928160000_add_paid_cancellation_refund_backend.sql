begin;

-- Backend support for quoting and finalizing a paid Stripe cancellation.
-- Browser users cannot execute these functions directly. The Edge Function authenticates
-- the actor and invokes them with service_role after validating Stripe.

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
      - interval '6 hours';

    if now() >= v_cutoff then
      raise exception 'Reservation can no longer be cancelled within 6 hours of pickup';
    end if;
  end if;

  if v_reservation.pickup_time is not null then
    v_cutoff :=
      ((v_reservation.start_date + v_reservation.pickup_time) at time zone 'Europe/Prague')
      - interval '6 hours';
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

revoke all on function public.get_paid_reservation_cancellation_context(uuid, uuid)
from public, anon, authenticated;

grant execute on function public.get_paid_reservation_cancellation_context(uuid, uuid)
to service_role;

create or replace function public.finalize_paid_reservation_cancellation_refund(
  p_cancellation_id uuid,
  p_stripe_refund_id text,
  p_stripe_refund_status text,
  p_refund_amount_minor integer,
  p_stripe_refund_balance_transaction_id text,
  p_charge_balance_transaction_id text,
  p_charge_balance_amount_minor integer,
  p_charge_balance_currency text,
  p_external_cost_amount_minor integer,
  p_external_cost_provider_amount_minor integer,
  p_external_cost_provider_currency text,
  p_external_cost_provider_exchange_rate numeric
)
returns table(
  cancellation_id uuid,
  payment_id uuid,
  refund_status text,
  refund_amount_minor integer,
  external_cost_amount_minor integer,
  owner_debt_id uuid,
  owner_debt_due_at timestamptz,
  financials_finalized_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_cancellation public.reservation_cancellations%rowtype;
  v_payment public.payments%rowtype;
  v_reservation public.reservations%rowtype;
  v_expected_external_cost integer;
  v_is_accepted_refund boolean;
  v_financials_finalized_at timestamptz;
  v_owner_debt_id uuid;
  v_owner_debt_due_at timestamptz;
  v_now timestamptz := now();
  v_charged_to text;
  v_cost_key text;
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

  if p_charge_balance_transaction_id is null
     or btrim(p_charge_balance_transaction_id) = '' then
    raise exception 'Stripe charge balance transaction id is required';
  end if;

  if p_charge_balance_amount_minor is null or p_charge_balance_amount_minor <= 0 then
    raise exception 'Stripe charge settlement amount is invalid';
  end if;

  if p_charge_balance_currency not in ('czk', 'eur') then
    raise exception 'Unsupported Stripe settlement currency';
  end if;

  if p_external_cost_provider_currency <> p_charge_balance_currency then
    raise exception 'Stripe fee currency does not match settlement currency';
  end if;

  if p_external_cost_provider_amount_minor is null
     or p_external_cost_provider_amount_minor < 0 then
    raise exception 'Stripe provider fee amount is invalid';
  end if;

  if p_external_cost_provider_exchange_rate is null
     or p_external_cost_provider_exchange_rate <= 0 then
    raise exception 'Stripe provider exchange rate is invalid';
  end if;

  if p_external_cost_amount_minor is null or p_external_cost_amount_minor < 0 then
    raise exception 'External cancellation cost is invalid';
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
  where p.id = v_cancellation.payment_id
  for update;

  if not found then
    raise exception 'Paid cancellation payment was not found';
  end if;

  select r.*
  into v_reservation
  from public.reservations r
  where r.id = v_cancellation.reservation_id
  for update;

  if not found then
    raise exception 'Paid cancellation reservation was not found';
  end if;

  if
    v_cancellation.cancellation_kind <> 'paid_refund'
    or v_cancellation.payment_id <> v_payment.id
    or v_payment.reservation_id <> v_reservation.id
    or v_payment.provider <> 'stripe'
    or v_payment.status <> 'paid'
    or v_reservation.status <> 'cancelled'
    or v_payment.currency <> 'czk'
    or v_cancellation.currency <> 'czk'
    or v_cancellation.payment_amount_minor <> v_payment.stripe_amount_total_minor
    or v_payment.stripe_amount_total_minor is null
    or v_payment.stripe_amount_total_minor <> v_payment.amount_total * 100
  then
    raise exception 'Paid cancellation state is inconsistent';
  end if;

  if
    (v_cancellation.cancelled_by_role = 'renter' and v_cancellation.refund_policy <> 'renter_external_cost_deducted')
    or (v_cancellation.cancelled_by_role = 'owner' and v_cancellation.refund_policy <> 'owner_full_refund_owner_cost')
  then
    raise exception 'Paid cancellation actor and refund policy do not match';
  end if;

  if
    v_payment.transfer_status <> 'not_created'
    or v_payment.stripe_transfer_id is not null
  then
    raise exception 'Owner transfer state blocks refund finalization';
  end if;

  if p_refund_amount_minor > v_cancellation.payment_amount_minor then
    raise exception 'Refund cannot exceed the original payment';
  end if;

  v_expected_external_cost := round(
    p_external_cost_provider_amount_minor::numeric
    * v_cancellation.payment_amount_minor::numeric
    / p_charge_balance_amount_minor::numeric
  )::integer;

  if v_expected_external_cost <> p_external_cost_amount_minor then
    raise exception 'External cancellation cost does not match Stripe settlement evidence';
  end if;

  if
    (
      v_cancellation.refund_policy = 'renter_external_cost_deducted'
      and p_refund_amount_minor + p_external_cost_amount_minor
        <> v_cancellation.payment_amount_minor
    )
    or (
      v_cancellation.refund_policy = 'owner_full_refund_owner_cost'
      and p_refund_amount_minor <> v_cancellation.payment_amount_minor
    )
  then
    raise exception 'Refund amount does not match the cancellation policy';
  end if;

  if
    v_payment.stripe_refund_id is not null
    and v_payment.stripe_refund_id <> p_stripe_refund_id
  then
    raise exception 'Stripe refund id does not match existing refund';
  end if;

  if
    v_payment.stripe_refund_amount_minor <> 0
    and v_payment.stripe_refund_amount_minor <> p_refund_amount_minor
  then
    raise exception 'Stripe refund amount does not match existing refund';
  end if;

  if
    v_payment.stripe_refund_balance_transaction_id is not null
    and p_stripe_refund_balance_transaction_id is not null
    and v_payment.stripe_refund_balance_transaction_id
      <> p_stripe_refund_balance_transaction_id
  then
    raise exception 'Stripe refund balance transaction does not match existing refund';
  end if;

  if
    v_payment.stripe_charge_balance_transaction_id is not null
    and v_payment.stripe_charge_balance_transaction_id
      <> p_charge_balance_transaction_id
  then
    raise exception 'Stripe charge balance transaction does not match payment';
  end if;

  if
    v_payment.stripe_charge_balance_amount_minor is not null
    and v_payment.stripe_charge_balance_amount_minor
      <> p_charge_balance_amount_minor
  then
    raise exception 'Stripe charge settlement amount does not match payment';
  end if;

  if
    v_payment.stripe_charge_balance_currency is not null
    and v_payment.stripe_charge_balance_currency <> p_charge_balance_currency
  then
    raise exception 'Stripe charge settlement currency does not match payment';
  end if;

  update public.payments p
  set
    stripe_refund_id = coalesce(p.stripe_refund_id, p_stripe_refund_id),
    stripe_refund_balance_transaction_id = coalesce(
      p_stripe_refund_balance_transaction_id,
      p_stripe_refund_balance_transaction_id
    ),
    stripe_refund_amount_minor = p_refund_amount_minor,
    refund_status = p_stripe_refund_status,
    refunded_at = case
      when p_stripe_refund_status = 'succeeded'
        then coalesce(p.refunded_at, v_now)
      else p.refunded_at
    end,
    stripe_charge_balance_transaction_id = coalesce(
      p.stripe_charge_balance_transaction_id,
      p_charge_balance_transaction_id
    ),
    stripe_charge_balance_amount_minor = coalesce(
      p.stripe_charge_balance_amount_minor,
      p_charge_balance_amount_minor
    ),
    stripe_charge_balance_currency = coalesce(
      p.stripe_charge_balance_currency,
      p_charge_balance_currency
    ),
    updated_at = v_now
  where p.id = v_payment.id;

  update public.reservation_cancellations c
  set
    refund_amount_minor = p_refund_amount_minor,
    external_cost_amount_minor = p_external_cost_amount_minor,
    updated_at = v_now
  where c.id = v_cancellation.id;

  v_is_accepted_refund := p_stripe_refund_status in (
    'pending', 'requires_action', 'succeeded'
  );

  if v_is_accepted_refund then
    v_charged_to := case
      when v_cancellation.refund_policy = 'renter_external_cost_deducted'
        then 'renter'
      else 'owner'
    end;

    if p_external_cost_amount_minor > 0 then
      v_cost_key := 'stripe:processing_fee:' || p_charge_balance_transaction_id;

      insert into public.reservation_cancellation_cost_items (
        cancellation_id,
        cost_type,
        provider,
        source_reference_id,
        external_cost_key,
        description,
        amount_minor,
        currency,
        charged_to,
        incurred_at,
        provider_amount_minor,
        provider_currency,
        provider_exchange_rate
      ) values (
        v_cancellation.id,
        'stripe_processing_fee',
        'stripe',
        p_charge_balance_transaction_id,
        v_cost_key,
        'Stripe processing fee retained after cancellation refund',
        p_external_cost_amount_minor,
        'czk',
        v_charged_to,
        v_now,
        p_external_cost_provider_amount_minor,
        p_external_cost_provider_currency,
        p_external_cost_provider_exchange_rate
      )
      on conflict (external_cost_key) do nothing;
    end if;

    if
      v_cancellation.refund_policy = 'owner_full_refund_owner_cost'
      and p_external_cost_amount_minor > 0
    then
      insert into public.owner_cancellation_debts (
        cancellation_id,
        owner_id,
        amount_minor,
        currency,
        status,
        issued_at,
        due_at,
        created_at,
        updated_at
      ) values (
        v_cancellation.id,
        v_reservation.owner_id,
        p_external_cost_amount_minor,
        'czk',
        'open',
        v_now,
        v_now + interval '7 days',
        v_now,
        v_now
      )
      on conflict (cancellation_id) do nothing;
    end if;

    update public.reservation_cancellations c
    set
      financials_finalized_at = coalesce(c.financials_finalized_at, v_now),
      updated_at = v_now
    where c.id = v_cancellation.id
    returning c.financials_finalized_at
    into v_financials_finalized_at;
  else
    select c.financials_finalized_at
    into v_financials_finalized_at
    from public.reservation_cancellations c
    where c.id = v_cancellation.id;
  end if;

  select d.id, d.due_at
  into v_owner_debt_id, v_owner_debt_due_at
  from public.owner_cancellation_debts d
  where d.cancellation_id = v_cancellation.id;

  return query
  select
    v_cancellation.id,
    v_payment.id,
    p_stripe_refund_status,
    p_refund_amount_minor,
    p_external_cost_amount_minor,
    v_owner_debt_id,
    v_owner_debt_due_at,
    v_financials_finalized_at;
end;
$function$;

revoke all on function public.finalize_paid_reservation_cancellation_refund(
  uuid,
  text,
  text,
  integer,
  text,
  text,
  integer,
  text,
  integer,
  integer,
  text,
  numeric
) from public, anon, authenticated;

grant execute on function public.finalize_paid_reservation_cancellation_refund(
  uuid,
  text,
  text,
  integer,
  text,
  text,
  integer,
  text,
  integer,
  integer,
  text,
  numeric
) to service_role;

commit;
