begin;

-- Paid cancellation foundation.
-- This migration does not call Stripe and does not expose a browser cancellation path.
-- It creates the trusted database state that the later Edge Function will use for
-- paid cancellations, exact external-cost evidence and owner reimbursement debts.

alter table public.reservation_cancellations
  add column if not exists cancellation_kind text not null default 'ordinary',
  add column if not exists refund_policy text,
  add column if not exists payment_amount_minor integer,
  add column if not exists refund_amount_minor integer,
  add column if not exists external_cost_amount_minor integer,
  add column if not exists currency text,
  add column if not exists financials_finalized_at timestamptz;

alter table public.reservation_cancellations
  drop constraint if exists reservation_cancellations_kind_check,
  drop constraint if exists reservation_cancellations_refund_policy_check,
  drop constraint if exists reservation_cancellations_payment_amount_minor_check,
  drop constraint if exists reservation_cancellations_refund_amount_minor_check,
  drop constraint if exists reservation_cancellations_external_cost_amount_minor_check,
  drop constraint if exists reservation_cancellations_currency_check,
  drop constraint if exists reservation_cancellations_paid_refund_shape_check,
  drop constraint if exists reservation_cancellations_finalized_financials_check;

alter table public.reservation_cancellations
  add constraint reservation_cancellations_kind_check
    check (cancellation_kind in ('ordinary', 'paid_refund')),
  add constraint reservation_cancellations_refund_policy_check
    check (
      refund_policy is null
      or refund_policy in (
        'renter_external_cost_deducted',
        'owner_full_refund_owner_cost'
      )
    ),
  add constraint reservation_cancellations_payment_amount_minor_check
    check (payment_amount_minor is null or payment_amount_minor > 0),
  add constraint reservation_cancellations_refund_amount_minor_check
    check (refund_amount_minor is null or refund_amount_minor >= 0),
  add constraint reservation_cancellations_external_cost_amount_minor_check
    check (external_cost_amount_minor is null or external_cost_amount_minor >= 0),
  add constraint reservation_cancellations_currency_check
    check (currency is null or currency = 'czk'),
  add constraint reservation_cancellations_paid_refund_shape_check
    check (
      cancellation_kind <> 'paid_refund'
      or (
        payment_id is not null
        and refund_policy in (
          'renter_external_cost_deducted',
          'owner_full_refund_owner_cost'
        )
        and payment_amount_minor is not null
        and payment_amount_minor > 0
        and currency = 'czk'
      )
    ),
  add constraint reservation_cancellations_finalized_financials_check
    check (
      financials_finalized_at is null
      or (
        refund_amount_minor is not null
        and external_cost_amount_minor is not null
        and refund_amount_minor <= payment_amount_minor
        and (
          (
            refund_policy = 'renter_external_cost_deducted'
            and refund_amount_minor + external_cost_amount_minor = payment_amount_minor
          )
          or (
            refund_policy = 'owner_full_refund_owner_cost'
            and refund_amount_minor = payment_amount_minor
          )
        )
      )
    );

comment on column public.reservation_cancellations.refund_policy is
  'Paid-cancellation rule: renter receives payment minus actual external cost, or owner cancellation gives renter a full refund and charges the actual external cost to the owner.';
comment on column public.reservation_cancellations.payment_amount_minor is
  'Original renter payment snapshot in CZK minor units.';
comment on column public.reservation_cancellations.refund_amount_minor is
  'Final refund amount in CZK minor units. Filled only after the trusted refund flow determines the exact amount.';
comment on column public.reservation_cancellations.external_cost_amount_minor is
  'Exact evidenced external cancellation cost charged or deducted in CZK minor units.';

-- Preserve provider-native evidence when an external fee is settled in a
-- currency different from CZK. amount_minor remains the exact CZK amount used
-- for the renter deduction or owner reimbursement debt.
alter table public.reservation_cancellation_cost_items
  add column if not exists provider_amount_minor integer,
  add column if not exists provider_currency text,
  add column if not exists provider_exchange_rate numeric;

alter table public.reservation_cancellation_cost_items
  drop constraint if exists reservation_cancellation_cost_items_provider_amount_minor_check,
  drop constraint if exists reservation_cancellation_cost_items_provider_currency_check,
  drop constraint if exists reservation_cancellation_cost_items_provider_exchange_rate_check;

alter table public.reservation_cancellation_cost_items
  add constraint reservation_cancellation_cost_items_provider_amount_minor_check
    check (provider_amount_minor is null or provider_amount_minor > 0),
  add constraint reservation_cancellation_cost_items_provider_currency_check
    check (provider_currency is null or provider_currency ~ '^[a-z]{3}$'),
  add constraint reservation_cancellation_cost_items_provider_exchange_rate_check
    check (provider_exchange_rate is null or provider_exchange_rate > 0);

comment on column public.reservation_cancellation_cost_items.provider_amount_minor is
  'Provider-native external cost in the provider settlement currency minor unit.';
comment on column public.reservation_cancellation_cost_items.provider_currency is
  'ISO currency of provider_amount_minor, for example eur when Stripe settles a CZK charge in EUR.';
comment on column public.reservation_cancellation_cost_items.provider_exchange_rate is
  'Provider exchange rate used as evidence when the provider cost must be represented in CZK.';

-- If an owner cancels a paid reservation, the renter receives the full refund.
-- The exact external cost is then billed to the owner. The debt is not overdue
-- until seven days after it is issued; enforcement is intentionally added later.
create table if not exists public.owner_cancellation_debts (
  id uuid primary key default gen_random_uuid(),
  cancellation_id uuid not null unique
    references public.reservation_cancellations(id) on delete cascade,
  owner_id uuid not null
    references public.profiles(id) on delete restrict,
  amount_minor integer not null check (amount_minor > 0),
  currency text not null default 'czk' check (currency = 'czk'),
  status text not null default 'open'
    check (status in ('open', 'paid', 'waived')),
  issued_at timestamptz not null default now(),
  due_at timestamptz not null default (now() + interval '7 days'),
  settled_at timestamptz,
  settlement_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_cancellation_debts_due_at_check
    check (due_at = issued_at + interval '7 days'),
  constraint owner_cancellation_debts_settlement_check
    check (
      (status = 'open' and settled_at is null)
      or (status in ('paid', 'waived') and settled_at is not null)
    )
);

create index if not exists owner_cancellation_debts_owner_status_due_idx
  on public.owner_cancellation_debts (owner_id, status, due_at);

alter table public.owner_cancellation_debts enable row level security;
revoke all on table public.owner_cancellation_debts from public, anon, authenticated;
grant all on table public.owner_cancellation_debts to service_role;

-- Restore the complete status guard and add exactly one new trusted transition:
-- service-role paid -> cancelled when a paid-cancellation RPC authorizes it.
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

-- Start a paid cancellation atomically. This function deliberately does not
-- call Stripe. It only locks the financial/reservation state, blocks an owner
-- transfer via refund_status=pending, records who cancelled and releases the
-- reservation dates. A later trusted backend step creates/finalizes the refund.
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

  v_cutoff :=
    ((v_reservation.start_date + v_reservation.pickup_time) at time zone 'Europe/Prague')
    - interval '6 hours';

  if v_now >= v_cutoff then
    raise exception 'Reservation can no longer be cancelled within 6 hours of pickup';
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

revoke all on function public.begin_paid_reservation_cancellation(uuid, text, uuid)
from public, anon, authenticated;

grant execute on function public.begin_paid_reservation_cancellation(uuid, text, uuid)
to service_role;

commit;
