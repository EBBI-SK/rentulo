begin;

-- Stripe foundation for real CZK payments.
-- Existing amount_total/platform_fee_amount/owner_payout columns remain in whole CZK
-- for backward compatibility. Stripe-facing monetary amounts are stored in minor
-- units so provider fees such as 6.50 CZK can be represented exactly.
alter table public.payments
  add column if not exists currency text not null default 'czk',
  add column if not exists stripe_amount_total_minor integer,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_payment_intent_status text,
  add column if not exists stripe_charge_id text,
  add column if not exists stripe_charge_balance_transaction_id text,
  add column if not exists stripe_fee_amount_minor integer,
  add column if not exists stripe_transfer_id text,
  add column if not exists stripe_transfer_amount_minor integer,
  add column if not exists transfer_status text not null default 'not_created',
  add column if not exists transfer_created_at timestamptz,
  add column if not exists stripe_refund_id text,
  add column if not exists stripe_refund_balance_transaction_id text,
  add column if not exists stripe_refund_amount_minor integer not null default 0,
  add column if not exists refund_status text not null default 'not_requested',
  add column if not exists refund_requested_at timestamptz,
  add column if not exists refunded_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.payments
  drop constraint if exists payments_currency_check,
  drop constraint if exists payments_stripe_amount_total_minor_check,
  drop constraint if exists payments_stripe_fee_amount_minor_check,
  drop constraint if exists payments_stripe_transfer_amount_minor_check,
  drop constraint if exists payments_stripe_refund_amount_minor_check,
  drop constraint if exists payments_transfer_status_check,
  drop constraint if exists payments_refund_status_check;

alter table public.payments
  add constraint payments_currency_check
    check (currency = 'czk'),
  add constraint payments_stripe_amount_total_minor_check
    check (stripe_amount_total_minor is null or stripe_amount_total_minor >= 0),
  add constraint payments_stripe_fee_amount_minor_check
    check (stripe_fee_amount_minor is null or stripe_fee_amount_minor >= 0),
  add constraint payments_stripe_transfer_amount_minor_check
    check (stripe_transfer_amount_minor is null or stripe_transfer_amount_minor >= 0),
  add constraint payments_stripe_refund_amount_minor_check
    check (stripe_refund_amount_minor >= 0),
  add constraint payments_transfer_status_check
    check (transfer_status in ('not_created', 'pending', 'succeeded', 'failed', 'reversed')),
  add constraint payments_refund_status_check
    check (refund_status in ('not_requested', 'pending', 'requires_action', 'succeeded', 'failed', 'canceled'));

comment on column public.payments.currency is
  'ISO currency code for the Stripe payment. Rentulo currently settles rentals in CZK.';
comment on column public.payments.stripe_amount_total_minor is
  'Total Stripe charge amount in the currency minor unit (haler for CZK).';
comment on column public.payments.stripe_fee_amount_minor is
  'Actual Stripe processing cost from the related Stripe balance transaction, in minor units.';
comment on column public.payments.stripe_transfer_amount_minor is
  'Amount actually transferred to the owner through Stripe Connect, in minor units.';
comment on column public.payments.stripe_refund_amount_minor is
  'Amount actually refunded through Stripe, in minor units.';

create unique index if not exists payments_stripe_payment_intent_id_unique
  on public.payments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create unique index if not exists payments_stripe_charge_id_unique
  on public.payments (stripe_charge_id)
  where stripe_charge_id is not null;

create unique index if not exists payments_stripe_transfer_id_unique
  on public.payments (stripe_transfer_id)
  where stripe_transfer_id is not null;

create unique index if not exists payments_stripe_refund_id_unique
  on public.payments (stripe_refund_id)
  where stripe_refund_id is not null;

-- The browser must not create payment rows once real Stripe payments are enabled.
-- Future Edge Functions will create and update payment records with service_role.
drop trigger if exists prepare_payment_before_insert on public.payments;
drop function if exists public.prepare_payment_insert();

drop policy if exists payments_insert_as_payer on public.payments;
drop policy if exists payments_select_related on public.payments;

revoke all on table public.payments from public, anon, authenticated;
grant all on table public.payments to service_role;

-- Stripe webhook receipt log. stripe_event_id is the idempotency boundary:
-- the same Stripe event cannot be persisted twice.
create table if not exists public.stripe_webhook_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  object_type text,
  object_id text,
  livemode boolean not null,
  stripe_created_at timestamptz,
  received_at timestamptz not null default now(),
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processing', 'processed', 'ignored', 'failed')),
  attempt_count integer not null default 0
    check (attempt_count >= 0),
  processed_at timestamptz,
  last_error text,
  payment_id uuid references public.payments(id) on delete set null,
  reservation_id uuid references public.reservations(id) on delete set null
);

create index if not exists stripe_webhook_events_payment_idx
  on public.stripe_webhook_events (payment_id, received_at desc);

create index if not exists stripe_webhook_events_reservation_idx
  on public.stripe_webhook_events (reservation_id, received_at desc);

alter table public.stripe_webhook_events enable row level security;
revoke all on table public.stripe_webhook_events from public, anon, authenticated;
grant all on table public.stripe_webhook_events to service_role;

-- One cancellation audit record per reservation. This does not yet enable
-- paid -> cancelled transitions; it only prepares the trusted-backend data model.
create table if not exists public.reservation_cancellations (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null unique
    references public.reservations(id) on delete cascade,
  payment_id uuid
    references public.payments(id) on delete set null,
  cancelled_by_role text not null
    check (cancelled_by_role in ('renter', 'owner', 'rentulo')),
  cancelled_by_user_id uuid
    references public.profiles(id) on delete set null,
  cancelled_at timestamptz not null default now(),
  reason_code text,
  reason_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reservation_cancellations_payment_idx
  on public.reservation_cancellations (payment_id);

alter table public.reservation_cancellations enable row level security;
revoke all on table public.reservation_cancellations from public, anon, authenticated;
grant all on table public.reservation_cancellations to service_role;

-- Itemized, evidenced, non-refundable costs caused by a cancellation.
-- The platform success fee is deliberately not an allowed cancellation cost.
create table if not exists public.reservation_cancellation_cost_items (
  id uuid primary key default gen_random_uuid(),
  cancellation_id uuid not null
    references public.reservation_cancellations(id) on delete cascade,
  cost_type text not null
    check (cost_type in (
      'stripe_processing_fee',
      'stripe_refund_fee',
      'sms',
      'email',
      'other_external'
    )),
  provider text not null,
  source_reference_id text not null,
  external_cost_key text not null unique,
  description text not null,
  amount_minor integer not null check (amount_minor > 0),
  currency text not null default 'czk' check (currency = 'czk'),
  charged_to text not null
    check (charged_to in ('renter', 'owner', 'rentulo')),
  incurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists reservation_cancellation_cost_items_cancellation_idx
  on public.reservation_cancellation_cost_items (cancellation_id, incurred_at);

alter table public.reservation_cancellation_cost_items enable row level security;
revoke all on table public.reservation_cancellation_cost_items from public, anon, authenticated;
grant all on table public.reservation_cancellation_cost_items to service_role;

commit;
