-- RENTULO V1 / BOD 1 / TEST ONLY / 2026-10-27.
-- Fix the extension finalizer against BOTH live CHECK constraints:
--   reservations_total_days_consistency_check: total_days = days
--   reservations_total_price_consistency_check: total_price = days * price_per_day
-- Original booking payment and financial snapshot stay unchanged.
-- Effective return date is extended; displayed days and price are computed
-- by adding PAID reservation_extensions to the original booking.
-- This script edits only two SQL function definitions; it changes NO data.
BEGIN;

DO $fix$
DECLARE
  v_finalize text;
  v_guard text;
  v_finalizer_old constant text := 'total_days=total_days+v_e.additional_days,';
  v_guard_old constant text := 'AND new.total_days = old.total_days + e.additional_days';
  v_guard_new constant text := 'AND new.total_days IS NOT DISTINCT FROM old.total_days';
BEGIN
  -- STOP unless explicitly connected to Rentulo Supabase TEST.
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name = 'rentulo_project_url'
      AND btrim(s.decrypted_secret, '/') = 'https://vspposovhdgvbeukoivh.supabase.co'
  ) THEN
    RAISE EXCEPTION 'TEST ONLY: unexpected Supabase project';
  END IF;

  -- Require both current accounting invariants; do not drop/relax them.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid='public.reservations'::regclass
      AND c.conname='reservations_total_days_consistency_check'
      AND position('total_days IS DISTINCT FROM days' IN pg_get_constraintdef(c.oid))>0
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid='public.reservations'::regclass
      AND c.conname='reservations_total_price_consistency_check'
      AND position('total_price IS DISTINCT FROM (days * price_per_day)' IN pg_get_constraintdef(c.oid))>0
  ) THEN
    RAISE EXCEPTION 'Unexpected booking price/day CHECK constraints: stop';
  END IF;

  IF to_regprocedure('public.complete_reservation_extension_payment(uuid,uuid,text,text,integer,text)') IS NULL
    OR to_regprocedure('public.protect_reservation_immutable_fields()') IS NULL
  THEN
    RAISE EXCEPTION 'Expected extension payment functions not found';
  END IF;

  v_finalize := pg_get_functiondef(
    'public.complete_reservation_extension_payment(uuid,uuid,text,text,integer,text)'::regprocedure
  );
  v_guard := pg_get_functiondef('public.protect_reservation_immutable_fields()'::regprocedure);

  IF position('p_amount_minor<>v_e.amount_total*100' IN v_finalize)=0
    OR position('reservation_extension_has_conflict(v_r.id,v_e.new_end_date)' IN v_finalize)=0
    OR position('app.reservation_extension_authorized' IN v_finalize)=0
    OR position('end_date=v_e.new_end_date,date_to=v_e.new_end_date,' IN v_finalize)=0
    OR position('AND new.days IS NOT DISTINCT FROM old.days' IN v_guard)=0
    OR position('app.stripe_payment_authorized' IN v_guard)=0
    OR position('new.total_price IS DISTINCT FROM old.total_price' IN v_guard)=0
    OR position('new.platform_fee_amount IS DISTINCT FROM old.platform_fee_amount' IN v_guard)=0
    OR position('new.owner_payout IS DISTINCT FROM old.owner_payout' IN v_guard)=0
  THEN
    RAISE EXCEPTION 'Unexpected Stripe/booking guard: stop without changes';
  END IF;

  -- Do not touch base days, total_days, price, commission, or owner payout.
  -- This exact shape is the previously deployed price-snapshot fix.
  IF position(v_finalizer_old IN v_finalize)>0 THEN
    IF (length(v_finalize)-length(replace(v_finalize,v_finalizer_old,'')))
        /length(v_finalizer_old) <> 1 THEN
      RAISE EXCEPTION 'Ambiguous extension finalizer: stop';
    END IF;
    EXECUTE replace(v_finalize, v_finalizer_old, '');
  ELSIF position('days=days+v_e.additional_days' IN v_finalize)>0 THEN
    RAISE EXCEPTION 'Unexpected legacy day mutation: stop';
  END IF;

  IF position(v_guard_old IN v_guard)>0 THEN
    IF (length(v_guard)-length(replace(v_guard,v_guard_old,'')))
        /length(v_guard_old) <> 1 THEN
      RAISE EXCEPTION 'Ambiguous extension day guard: stop';
    END IF;
    EXECUTE replace(v_guard, v_guard_old, v_guard_new);
  ELSIF position(v_guard_new IN v_guard)=0 THEN
    RAISE EXCEPTION 'Unexpected extension immutable guard: stop';
  END IF;

  -- Verify both replacements within one transaction; any failure rolls back.
  v_finalize := pg_get_functiondef(
    'public.complete_reservation_extension_payment(uuid,uuid,text,text,integer,text)'::regprocedure
  );
  v_guard := pg_get_functiondef('public.protect_reservation_immutable_fields()'::regprocedure);
  IF position(v_finalizer_old IN v_finalize)>0
    OR position('days=days+v_e.additional_days' IN v_finalize)>0
    OR position('end_date=v_e.new_end_date,date_to=v_e.new_end_date,' IN v_finalize)=0
    OR position(v_guard_new IN v_guard)=0
    OR position(v_guard_old IN v_guard)>0
  THEN
    RAISE EXCEPTION 'Verification of corrected functions failed: rollback';
  END IF;
END;
$fix$;

COMMIT;

SELECT CASE WHEN
  position('AND new.total_days IS NOT DISTINCT FROM old.total_days' IN
    pg_get_functiondef('public.protect_reservation_immutable_fields()'::regprocedure))>0
  AND position('total_days=total_days+v_e.additional_days' IN
    pg_get_functiondef('public.complete_reservation_extension_payment(uuid,uuid,text,text,integer,text)'::regprocedure))=0
  AND position('end_date=v_e.new_end_date,date_to=v_e.new_end_date,' IN
    pg_get_functiondef('public.complete_reservation_extension_payment(uuid,uuid,text,text,integer,text)'::regprocedure))>0
  THEN 'OK - extension dates only, all original financial/day snapshots preserved'
  ELSE 'FAIL - stop and investigate'
END AS vysledok;
