begin;

-- Fix PostgreSQL PL/pgSQL ambiguity: RETURNS TABLE exposes cancellation_id as
-- an output variable, so ON CONFLICT (cancellation_id) is ambiguous.
-- Target the unique constraint created with owner_cancellation_debts in the
-- original migration. Retain all other policy, validations, locks and grants.
-- This migration does not mutate existing financial rows or contact Stripe.

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
      on conflict on constraint owner_cancellation_debts_cancellation_id_key do nothing;
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
