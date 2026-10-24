-- RENTULO V1 / PROD RELEASE CANDIDATE bd1b8d1 / 2026-10-24.
-- Apply only to a verified PROD database after backup and approval.
-- This SQL is staged separately: never copy over TEST migrations.
-- Cron activation is deferred; no automatic deployment is authorized.

-- Rentulo V1 / PROD ONLY / 2026-10-23.
-- Fix Stripe payment_intent.succeeded: the trusted completion RPC sets
-- app.stripe_payment_authorized, but the reservation immutable-fields guard
-- previously recognized only app.payment_update_authorized/test flags.
-- The ONLY new permission is paid_at/payment_provider_status during the
-- service-role-authorized approved -> paid Stripe transition.
-- No reservation/payment rows are modified by this migration.
BEGIN;


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


DO $rentulo_fix$
DECLARE
  v_definition text;
  v_needle constant text := 'current_setting(''app.payment_update_authorized'', true) = ''on''';
  v_stripe_check constant text := 'current_setting(''app.stripe_payment_authorized'', true) = ''on''';
  v_replacement text;
  v_occurrences integer;
BEGIN
  -- A PROD release guard prevents execution in an unauthorized project.
  IF NOT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets s
    WHERE s.name = 'rentulo_prod_release_target'
      AND btrim(s.decrypted_secret, '/') =
          'tfvgxrdjrpicgtvovehl'
  ) THEN
    RAISE EXCEPTION 'PROD only: expected Rentulo Supabase PROD project';
  END IF;

  IF to_regprocedure('public.protect_reservation_immutable_fields()') IS NULL
     OR to_regprocedure('public.protect_reservation_status_transition()') IS NULL
     OR to_regprocedure('public.complete_stripe_payment_from_webhook(uuid,uuid,text,text,integer,text,text)') IS NULL
  THEN
    RAISE EXCEPTION 'Expected Stripe/reservation database functions are missing; no changes made';
  END IF;

  -- Fail closed if another change already modified the current guard.
  v_definition := pg_get_functiondef(
    'public.protect_reservation_immutable_fields()'::regprocedure
  );
  v_occurrences := (
    length(v_definition) - length(replace(v_definition, v_needle, ''))
  ) / length(v_needle);

  IF v_occurrences <> 1
     OR position('v_gdpr_contact_scrub_authorized' IN v_definition) = 0
     OR position('v_owner_contact_scrub_authorized' IN v_definition) = 0
     OR position('new.paid_at IS DISTINCT FROM old.paid_at' IN v_definition) = 0
     OR position('new.payment_provider_status IS DISTINCT FROM old.payment_provider_status' IN v_definition) = 0
  THEN
    RAISE EXCEPTION 'Unexpected reservation immutability guard; no changes made';
  END IF;

  IF position('app.stripe_payment_authorized' IN pg_get_functiondef(
      'public.complete_stripe_payment_from_webhook(uuid,uuid,text,text,integer,text,text)'::regprocedure
    )) = 0
     OR position('app.stripe_payment_authorized' IN pg_get_functiondef(
      'public.protect_reservation_status_transition()'::regprocedure
    )) = 0
  THEN
    RAISE EXCEPTION 'Expected Stripe authorization path is missing; no changes made';
  END IF;

  -- Surgical update of the existing function. Preserves its remaining rules,
  -- SECURITY DEFINER, grants, GDPR conditions, and reservation snapshots.
  v_replacement := v_needle || E'\n      OR (\n        coalesce(auth.role(), '''') = ''service_role''\n        AND ' || v_stripe_check || E'\n      )';

  -- The function may already contain this narrow permission; replays are guarded.
  IF position(v_replacement IN v_definition) > 0 THEN
    IF (
      length(v_definition) - length(replace(v_definition, v_stripe_check, ''))
    ) / length(v_stripe_check) <> 1 THEN
      RAISE EXCEPTION 'Unexpected duplicated Stripe permission; no changes made';
    END IF;
    -- Desired narrow exception already exists. Do not redefine the function.
  ELSIF position(v_stripe_check IN v_definition) = 0 THEN
    EXECUTE replace(v_definition, v_needle, v_replacement);
  ELSE
    RAISE EXCEPTION 'Unexpected Stripe authorization shape; no changes made';
  END IF;

  IF position(v_replacement IN pg_get_functiondef(
      'public.protect_reservation_immutable_fields()'::regprocedure
    )) = 0
  THEN
    RAISE EXCEPTION 'Post-change verification failed; transaction will roll back';
  END IF;
END;
$rentulo_fix$;

COMMIT;

-- Optional read-only confirmation (safe to run after applying migration).
SELECT
  CASE
    WHEN pg_get_functiondef('public.protect_reservation_immutable_fields()'::regprocedure)
         LIKE '%app.stripe_payment_authorized%'
    THEN 'OK - Stripe authorization accepted by immutability guard'
    ELSE 'FAIL - stop and investigate'
  END AS vysledok;
