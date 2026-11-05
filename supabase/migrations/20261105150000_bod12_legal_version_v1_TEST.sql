-- RENTULO / BOD 12 / TEST ONLY / legal documents V1.0 effective 2026-12-01.
-- Match the approved frontend registration version to the existing PROD contract.
-- No old acceptance records are modified, backfilled or deleted.
-- Never run on PROD: PROD already accepts 1.0.
-- Apply to TEST only after a separate, explicit deployment approval.
BEGIN;

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name = 'rentulo_project_url'
      AND btrim(s.decrypted_secret, '/') = 'https://vspposovhdgvbeukoivh.supabase.co'
  ) THEN
    RAISE EXCEPTION 'BOD12 legal-version migration is TEST-only; PROD forbidden';
  END IF;

  IF to_regclass('auth.users') IS NULL
     OR to_regclass('public.gdpr_terms_acceptances') IS NULL
     OR to_regprocedure('public.gdpr_capture_signup_terms()') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_trigger t
       WHERE t.tgrelid = 'auth.users'::regclass
         AND t.tgname = 'trg_gdpr_capture_signup_terms'
         AND t.tgenabled = 'O'
     ) THEN
    RAISE EXCEPTION 'Expected signup acceptance registry or trigger is unavailable';
  END IF;
END;
$preflight$;

-- Update only the server-side version contract for NEW signups.
-- The server, not browser-provided metadata, decides which version is recorded.
-- Previous 1.0-test-2026-10-20 audit entries remain unchanged.
CREATE OR REPLACE FUNCTION public.gdpr_capture_signup_terms()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_lang text;
BEGIN
  IF NEW.raw_user_meta_data ->> 'terms_business_accepted' IS DISTINCT FROM 'true'
     OR NEW.raw_user_meta_data ->> 'terms_privacy_accepted' IS DISTINCT FROM 'true'
     OR NEW.raw_user_meta_data ->> 'private_individual_confirmed' IS DISTINCT FROM 'true'
  THEN
    RETURN NEW;
  END IF;

  IF NEW.raw_user_meta_data ->> 'terms_version' IS DISTINCT FROM '1.0'
     OR NEW.raw_user_meta_data ->> 'privacy_notice_version' IS DISTINCT FROM '1.0'
  THEN
    RAISE EXCEPTION 'Signup legal-document version mismatch; reload the registration page';
  END IF;

  v_lang := lower(coalesce(NEW.raw_user_meta_data ->> 'terms_language', 'cs'));
  IF v_lang NOT IN ('cs','sk','en','de','pl') THEN
    v_lang := 'cs';
  END IF;

  INSERT INTO public.gdpr_terms_acceptances (
    user_id, terms_version, privacy_version, language, accepted_at, source
  ) VALUES (
    NEW.id, '1.0', '1.0',
    v_lang, clock_timestamp(), 'auth_signup'
  ) ON CONFLICT (user_id, terms_version, source) DO NOTHING;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.gdpr_capture_signup_terms()
  FROM PUBLIC, anon, authenticated;
COMMIT;
