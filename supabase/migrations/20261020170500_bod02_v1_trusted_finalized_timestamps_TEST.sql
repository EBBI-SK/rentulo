-- Rentulo V1 BOD02 / Stage 2 / TEST ONLY.
-- Adds trusted event times for *future* transitions only.
-- Historic rows are not updated. Existing stage-1 migration is unchanged.
BEGIN;
DO $guard$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets
  WHERE name='rentulo_project_url'
    AND btrim(decrypted_secret,'/')='https://vspposovhdgvbeukoivh.supabase.co')
  THEN RAISE EXCEPTION 'TEST only'; END IF;
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
