-- RENTULO V1 / PROD RELEASE CANDIDATE bd1b8d1 / 2026-10-24.
-- Apply only to a verified PROD database after backup and approval.
-- This SQL is staged separately: never copy over TEST migrations.
-- Cron activation is deferred; no automatic deployment is authorized.

-- Rentulo V1 BOD02 / Stage 2 / PROD ONLY.
-- Adds trusted event times for *future* transitions only.
-- Historic rows are not updated. Existing stage-1 migration is unchanged.
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


DO $guard$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets
  WHERE name='rentulo_prod_release_target'
    AND btrim(decrypted_secret,'/')='tfvgxrdjrpicgtvovehl')
  THEN RAISE EXCEPTION 'PROD only'; END IF;
 IF to_regclass('public.reservations') IS NULL
    OR to_regclass('public.offers') IS NULL
    OR to_regclass('public.gdpr_legal_holds') IS NULL
    OR to_regclass('public.gdpr_terms_acceptances') IS NULL
    OR NOT EXISTS(SELECT 1 FROM public.gdpr_reservation_contact_cleanup_gate
      WHERE singleton AND is_enabled=false)
  THEN RAISE EXCEPTION 'Compliance stage 1 missing or GDPR cleanup gate enabled'; END IF;
END;
$guard$;

-- Trusted time of a NEW terminal returned/no_show status transition.
-- Historic rows are intentionally NOT backfilled using updated_at or end_date.
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS gdpr_finalized_at timestamptz;
CREATE OR REPLACE FUNCTION public.gdpr_stamp_reservation_finalized_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.gdpr_finalized_at IS NOT NULL THEN
      RAISE EXCEPTION 'Client-supplied GDPR finalization timestamp forbidden';
    END IF;
  ELSE
    IF NEW.gdpr_finalized_at IS DISTINCT FROM OLD.gdpr_finalized_at THEN
      RAISE EXCEPTION 'GDPR finalization timestamp is immutable';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND
       NEW.status::text IN ('returned','no_show') THEN
      NEW.gdpr_finalized_at := clock_timestamp();
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS zzzzzzz_gdpr_stamp_finalized_at ON public.reservations;
CREATE TRIGGER zzzzzzz_gdpr_stamp_finalized_at
BEFORE INSERT OR UPDATE OF status,gdpr_finalized_at ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.gdpr_stamp_reservation_finalized_at();

-- Authoritative deletion time for NEW manually deleted offers; old rows with
-- unknown deletion time are excluded from automatic photo cleanup.
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS gdpr_deleted_at timestamptz;
CREATE OR REPLACE FUNCTION public.gdpr_stamp_offer_deleted_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.gdpr_deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Client-supplied GDPR offer deletion timestamp forbidden';
    END IF;
  ELSE
    IF NEW.gdpr_deleted_at IS DISTINCT FROM OLD.gdpr_deleted_at THEN
      RAISE EXCEPTION 'GDPR offer deletion timestamp is immutable';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text = 'deleted' THEN
      NEW.gdpr_deleted_at := clock_timestamp();
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS zzzzzzz_gdpr_stamp_offer_deleted_at ON public.offers;
CREATE TRIGGER zzzzzzz_gdpr_stamp_offer_deleted_at
BEFORE INSERT OR UPDATE OF status,gdpr_deleted_at ON public.offers
FOR EACH ROW EXECUTE FUNCTION public.gdpr_stamp_offer_deleted_at();


COMMIT;
