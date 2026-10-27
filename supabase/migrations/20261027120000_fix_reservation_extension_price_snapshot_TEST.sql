-- RENTULO V1 / BOD 1 / TEST ONLY / 2026-10-27.
-- Fix extension checkout finalization without modifying original payment values.
-- Original reservations.days and reservations.total_price remain original booking snapshots.
-- reservations.total_days and the effective return dates include paid extensions.
-- No reservation, payment, extension or Stripe event rows are updated here.
BEGIN;

DO $fix$
DECLARE
  v_finalize text;
  v_guard text;
  v_finalize_old constant text := 'days=days+v_e.additional_days,total_days=total_days+v_e.additional_days,';
  v_finalize_new constant text := 'total_days=total_days+v_e.additional_days,';
  v_guard_old constant text := 'AND new.days = old.days + e.additional_days';
  v_guard_new constant text := 'AND new.days IS NOT DISTINCT FROM old.days';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name = 'rentulo_project_url'
      AND btrim(s.decrypted_secret, '/') = 'https://vspposovhdgvbeukoivh.supabase.co'
  ) THEN
    RAISE EXCEPTION 'TEST ONLY: unexpected Supabase project';
  END IF;

  IF to_regprocedure('public.complete_reservation_extension_payment(uuid,uuid,text,text,integer,text)') IS NULL
     OR to_regprocedure('public.protect_reservation_immutable_fields()') IS NULL
  THEN
    RAISE EXCEPTION 'Expected reservation extension functions are missing';
  END IF;

  v_finalize := pg_get_functiondef(
    'public.complete_reservation_extension_payment(uuid,uuid,text,text,integer,text)'::regprocedure
  );
  v_guard := pg_get_functiondef('public.protect_reservation_immutable_fields()'::regprocedure);

  -- Abort on any unexpected shape instead of changing broad accounting rules.
  IF position('reservation_extension_has_conflict' IN v_finalize) = 0
     OR position('p_amount_minor<>v_e.amount_total*100' IN v_finalize) = 0
     OR position('app.reservation_extension_authorized' IN v_finalize) = 0
     OR position('app.stripe_payment_authorized' IN v_guard) = 0
     OR position('new.total_price IS DISTINCT FROM old.total_price' IN v_guard) = 0
     OR position('new.platform_fee_amount IS DISTINCT FROM old.platform_fee_amount' IN v_guard) = 0
     OR position('new.owner_payout IS DISTINCT FROM old.owner_payout' IN v_guard) = 0
  THEN
    RAISE EXCEPTION 'Unexpected extension/payment guard: stop, no changes made';
  END IF;

  IF position(v_finalize_old IN v_finalize) > 0 THEN
    IF (length(v_finalize)-length(replace(v_finalize,v_finalize_old,'')))/length(v_finalize_old) <> 1 THEN
      RAISE EXCEPTION 'Unexpected duplicate finalizer update: stop';
    END IF;
    EXECUTE replace(v_finalize,v_finalize_old,v_finalize_new);
  ELSIF position(v_finalize_new IN v_finalize) = 0 THEN
    RAISE EXCEPTION 'Unexpected extension finalizer shape: stop';
  END IF;

  IF position(v_guard_old IN v_guard) > 0 THEN
    IF (length(v_guard)-length(replace(v_guard,v_guard_old,'')))/length(v_guard_old) <> 1 THEN
      RAISE EXCEPTION 'Unexpected duplicate immutable guard: stop';
    END IF;
    EXECUTE replace(v_guard,v_guard_old,v_guard_new);
  ELSIF position(v_guard_new IN v_guard) = 0 THEN
    RAISE EXCEPTION 'Unexpected extension immutable guard shape: stop';
  END IF;

  -- Both replacements must be in place atomically.
  v_finalize := pg_get_functiondef(
    'public.complete_reservation_extension_payment(uuid,uuid,text,text,integer,text)'::regprocedure
  );
  v_guard := pg_get_functiondef('public.protect_reservation_immutable_fields()'::regprocedure);
  IF position(v_finalize_old IN v_finalize)>0
     OR position(v_finalize_new IN v_finalize)=0
     OR position(v_guard_old IN v_guard)>0
     OR position(v_guard_new IN v_guard)=0
  THEN
    RAISE EXCEPTION 'Post-change verification failed; rollback';
  END IF;
END;
$fix$;

COMMIT;

-- Safe read-only confirmation after the transaction.
SELECT
  CASE
    WHEN position('AND new.days IS NOT DISTINCT FROM old.days' IN
      pg_get_functiondef('public.protect_reservation_immutable_fields()'::regprocedure)) > 0
     AND position('total_days=total_days+v_e.additional_days' IN
      pg_get_functiondef('public.complete_reservation_extension_payment(uuid,uuid,text,text,integer,text)'::regprocedure)) > 0
     AND position('days=days+v_e.additional_days,total_days' IN
      pg_get_functiondef('public.complete_reservation_extension_payment(uuid,uuid,text,text,integer,text)'::regprocedure)) = 0
    THEN 'OK - original price snapshot preserved, extension finalizer fixed'
    ELSE 'FAIL - stop and investigate'
  END AS vysledok;
