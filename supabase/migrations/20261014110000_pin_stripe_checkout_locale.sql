begin;

-- A Stripe idempotency key may be replayed only with IDENTICAL POST parameters.
-- Pin the UI locale to the first trusted Checkout attempt in the database, so
-- changing language in Rentulo can never alter an in-flight Stripe request.
-- Both tables are already service-role-only and remain that way.
alter table public.payments
  add column if not exists stripe_checkout_locale text;

alter table public.payments
  drop constraint if exists payments_stripe_checkout_locale_check;
alter table public.payments
  add constraint payments_stripe_checkout_locale_check
    check (stripe_checkout_locale is null or stripe_checkout_locale in ('cs', 'sk', 'en', 'de', 'pl'));

-- Old reservation Checkout always used explicit locale=cs. Preserve the exact
-- locale on old pending payments, including ambiguous old Stripe POST attempts.
update public.payments
set stripe_checkout_locale = 'cs'
where status = 'pending' and stripe_checkout_locale is null;

comment on column public.payments.stripe_checkout_locale is
  'Locale pinned on first trusted Stripe Checkout creation; never change for the payment idempotency key.';

alter table public.owner_cancellation_debts
  add column if not exists stripe_checkout_locale text;

alter table public.owner_cancellation_debts
  drop constraint if exists owner_cancellation_debts_stripe_checkout_locale_check;
alter table public.owner_cancellation_debts
  add constraint owner_cancellation_debts_stripe_checkout_locale_check
    check (stripe_checkout_locale is null or stripe_checkout_locale in ('cs', 'sk', 'en', 'de', 'pl', 'legacy'));

-- Previous owner-debt Checkout omitted locale and used an ASCII item name.
-- Mark ALL existing debts as legacy, including ambiguous attempts which failed
-- before the session id was recorded. New debts get a NULL locale initially.
-- Legacy retries retain the original request parameters to prevent Stripe's
-- idempotency-key mismatch; existing Checkout sessions remain unchanged.
update public.owner_cancellation_debts
set stripe_checkout_locale = 'legacy'
where stripe_checkout_locale is null;

comment on column public.owner_cancellation_debts.stripe_checkout_locale is
  'Pinned Stripe Checkout locale. legacy means pre-migration locale omitted and item title unchanged; never overwrite after pinning.';

commit;
