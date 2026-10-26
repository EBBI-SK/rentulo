-- RENTULO V1 / PROD RELEASE CANDIDATE bd1b8d1 / 2026-10-24.
-- Apply only to a verified PROD database after backup and approval.
-- This SQL is staged separately: never copy over TEST migrations.
-- Cron activation is deferred; no automatic deployment is authorized.

begin;


DO $rentulo_prod_release_guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets AS s
    WHERE s.name = 'rentulo_prod_release_target'
      AND s.decrypted_secret = 'tfvgxrdjrpicgtvovehl'
  ) THEN
    RAISE EXCEPTION 'Rentulo PROD release guard missing: check target project and approval';
  END IF;
  IF EXISTS (
    SELECT 1 FROM vault.decrypted_secrets AS s
    WHERE s.name = 'rentulo_project_url'
      AND btrim(s.decrypted_secret, '/') NOT IN
        ('UNCONFIGURED', 'https://tfvgxrdjrpicgtvovehl.supabase.co')
  ) THEN
    RAISE EXCEPTION 'Unexpected runtime project URL; release aborted';
  END IF;
END;
$rentulo_prod_release_guard$;


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
