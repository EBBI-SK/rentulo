-- RENTULO / BOD 9 / PROD ONLY / owner financial history RPC.
-- Exact SELECT/return columns and function grants from the tested BOD7.2 TEST reader.
-- New PROD version 20261104150000. Do NOT replay TEST version 20261102090000.
-- One isolated migration only; never root db push. Prior migration 20261104120000
-- was deployed and verified (127 total) on 2026-11-04.
-- No payment, reservation, dispute, transfer, email, SMS, or cron writes.
-- Deploy ONLY after separately approved PROD preflight and usable backup.
BEGIN;

DO $prod_guard$
BEGIN
  -- Both the release identity and the configured runtime URL MUST be PROD.
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name = 'rentulo_prod_release_target'
      AND btrim(s.decrypted_secret, '/') = 'tfvgxrdjrpicgtvovehl'
  ) OR NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name = 'rentulo_project_url'
      AND btrim(s.decrypted_secret, '/') = 'https://tfvgxrdjrpicgtvovehl.supabase.co'
  ) THEN
    RAISE EXCEPTION 'BOD9 history: explicit configured Rentulo PROD project required';
  END IF;

  -- Do not replay the TEST version or allow a half-applied/duplicated release.
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version IN ('20261102090000', '20261104150000')
  ) OR NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20261104120000'
  ) OR NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20261102160000'
  ) OR NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20261031180000'
  ) OR NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20261031190000'
  ) THEN
    RAISE EXCEPTION 'BOD9 history: migration history mismatch or prerequisite missing';
  END IF;

  -- An unexpected function (even an overload) must never be overwritten.
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_my_history_owner_transfers'
  ) THEN
    RAISE EXCEPTION 'BOD9 history: owner financial function already exists';
  END IF;

  IF to_regclass('public.reservations') IS NULL
    OR to_regclass('public.payments') IS NULL
    OR to_regclass('public.reservation_extensions') IS NULL
    OR to_regclass('public.stripe_card_disputes') IS NULL
    OR to_regprocedure('auth.uid()') IS NULL
  THEN
    RAISE EXCEPTION 'BOD9 history: required financial tables or auth function missing';
  END IF;

  -- Verify every referenced column before defining a SECURITY DEFINER reader.
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('reservations', 'id'),
      ('reservations', 'owner_id'),
      ('reservations', 'status'),
      ('reservations', 'created_at'),
      ('payments', 'reservation_id'),
      ('payments', 'amount_total'),
      ('payments', 'platform_fee_amount'),
      ('payments', 'owner_payout'),
      ('payments', 'provider'),
      ('payments', 'status'),
      ('payments', 'stripe_payment_intent_status'),
      ('payments', 'refund_status'),
      ('payments', 'transfer_status'),
      ('stripe_card_disputes', 'reservation_id'),
      ('stripe_card_disputes', 'payout_blocked')
    ) AS required(table_name, column_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = required.table_name
        AND c.column_name = required.column_name
    )
  ) THEN
    RAISE EXCEPTION 'BOD9 history: existing financial schema differs from TEST';
  END IF;
END;
$prod_guard$;

-- SECURITY DEFINER is necessary because browsers must not read payments and
-- card-dispute ledgers directly. auth.uid() restricts rows to the current
-- signed-in owner; missing/refunded evidence is returned but never marked paid.
CREATE FUNCTION public.get_my_history_owner_transfers()
RETURNS TABLE (
  reservation_id uuid,
  original_amount_total integer,
  original_platform_fee_amount integer,
  original_owner_payout integer,
  payment_provider text,
  payment_status text,
  stripe_payment_intent_status text,
  refund_status text,
  original_transfer_status text,
  payout_blocked boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    r.id,
    p.amount_total,
    p.platform_fee_amount,
    p.owner_payout,
    p.provider::text,
    p.status::text,
    p.stripe_payment_intent_status,
    p.refund_status,
    p.transfer_status,
    EXISTS (
      SELECT 1
      FROM public.stripe_card_disputes d
      WHERE d.reservation_id = r.id
        AND d.payout_blocked IS TRUE
    )
  FROM public.reservations r
  LEFT JOIN public.payments p ON p.reservation_id = r.id
  WHERE auth.uid() IS NOT NULL
    AND r.owner_id = auth.uid()
    AND r.status::text IN ('returned', 'no_show')
  ORDER BY r.created_at DESC;
$function$;

REVOKE ALL ON FUNCTION public.get_my_history_owner_transfers()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_history_owner_transfers()
  TO authenticated;

-- No historical backfill, changes to financial records or background jobs.
NOTIFY pgrst, 'reload schema';
COMMIT;
