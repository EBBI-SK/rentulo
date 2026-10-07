begin;

-- Payment collection for owner cancellation debts. This migration only adds the
-- trusted backend payment path; UI, overdue enforcement and reminders are added
-- separately so each release step stays small and testable.
alter table public.owner_cancellation_debts
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_payment_intent_status text,
  add column if not exists payment_requested_at timestamptz;

create unique index if not exists owner_cancellation_debts_stripe_checkout_session_unique
  on public.owner_cancellation_debts (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create unique index if not exists owner_cancellation_debts_stripe_payment_intent_unique
  on public.owner_cancellation_debts (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

comment on column public.owner_cancellation_debts.stripe_checkout_session_id is
  'Latest Stripe Checkout session created by the trusted owner-debt payment backend.';
comment on column public.owner_cancellation_debts.stripe_payment_intent_id is
  'Stripe PaymentIntent that settled this owner cancellation debt.';
comment on column public.owner_cancellation_debts.stripe_payment_intent_status is
  'Last trusted Stripe PaymentIntent status recorded for the debt payment.';
comment on column public.owner_cancellation_debts.payment_requested_at is
  'Timestamp when Rentulo successfully created a Stripe Checkout session for this debt.';

-- Link signed Stripe webhook audit rows to owner-debt payments without reusing
-- reservation payment identifiers.
alter table public.stripe_webhook_events
  add column if not exists owner_cancellation_debt_id uuid
    references public.owner_cancellation_debts(id) on delete set null;

create index if not exists stripe_webhook_events_owner_debt_idx
  on public.stripe_webhook_events (owner_cancellation_debt_id, received_at desc);

-- The webhook signature is verified in the Edge Function. This service-role-only
-- RPC re-validates the persisted debt, owner, currency and exact amount before
-- changing financial state. Re-delivery of the same successful PaymentIntent is
-- treated as idempotent success.
create or replace function public.complete_owner_cancellation_debt_payment_from_webhook(
  p_debt_id uuid,
  p_owner_id uuid,
  p_stripe_payment_intent_id text,
  p_stripe_payment_intent_status text,
  p_amount_received_minor integer,
  p_currency text
)
returns table(
  debt_id uuid,
  debt_status text,
  debt_settled_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_debt public.owner_cancellation_debts%rowtype;
  v_now timestamptz := now();
  v_updated_rows integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;

  if p_debt_id is null or p_owner_id is null then
    raise exception 'Debt and owner are required';
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

  select d.*
  into v_debt
  from public.owner_cancellation_debts d
  where d.id = p_debt_id
  for update;

  if not found then
    raise exception 'Owner cancellation debt was not found';
  end if;

  if v_debt.owner_id <> p_owner_id then
    raise exception 'Owner cancellation debt does not belong to owner';
  end if;

  if v_debt.currency <> 'czk' then
    raise exception 'Stored owner cancellation debt currency is not CZK';
  end if;

  if v_debt.amount_minor <> p_amount_received_minor then
    raise exception 'Stripe amount does not match owner cancellation debt';
  end if;

  if v_debt.stripe_payment_intent_id is not null
     and v_debt.stripe_payment_intent_id <> p_stripe_payment_intent_id then
    raise exception 'Stripe payment intent does not match owner cancellation debt';
  end if;

  if v_debt.status = 'paid' then
    if v_debt.settled_at is null
       or v_debt.settlement_reference <> p_stripe_payment_intent_id
       or v_debt.stripe_payment_intent_id <> p_stripe_payment_intent_id
       or v_debt.stripe_payment_intent_status <> 'succeeded' then
      raise exception 'Existing paid owner cancellation debt does not match Stripe event';
    end if;

    return query
    select v_debt.id, v_debt.status, v_debt.settled_at;
    return;
  end if;

  if v_debt.status <> 'open' then
    raise exception 'Owner cancellation debt is not payable';
  end if;

  if v_debt.stripe_checkout_session_id is null
     or btrim(v_debt.stripe_checkout_session_id) = ''
     or v_debt.payment_requested_at is null then
    raise exception 'Owner cancellation debt payment was not initialized';
  end if;

  update public.owner_cancellation_debts d
  set
    status = 'paid',
    settled_at = v_now,
    settlement_reference = p_stripe_payment_intent_id,
    stripe_payment_intent_id = p_stripe_payment_intent_id,
    stripe_payment_intent_status = 'succeeded',
    updated_at = v_now
  where d.id = v_debt.id
    and d.status = 'open';

  get diagnostics v_updated_rows = row_count;

  if v_updated_rows <> 1 then
    raise exception 'Owner cancellation debt could not be marked paid';
  end if;

  return query
  select d.id, d.status, d.settled_at
  from public.owner_cancellation_debts d
  where d.id = v_debt.id;
end;
$function$;

revoke all on function public.complete_owner_cancellation_debt_payment_from_webhook(
  uuid,
  uuid,
  text,
  text,
  integer,
  text
) from public, anon, authenticated;

grant execute on function public.complete_owner_cancellation_debt_payment_from_webhook(
  uuid,
  uuid,
  text,
  text,
  integer,
  text
) to service_role;

commit;
