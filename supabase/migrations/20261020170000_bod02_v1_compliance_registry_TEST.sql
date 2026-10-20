-- RENTULO V1 / BOD 02 / ETAPA 1 / TEST ONLY.
-- Internal compliance registers and server-stamped signup acceptance records.
-- No deletion, UPDATE of existing rows, financial changes, cron or outbound mail.
-- INSTALL ONLY after GitHub CI + explicit Supabase TEST confirmation.
BEGIN;

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name = 'rentulo_project_url'
      AND btrim(s.decrypted_secret, '/') = 'https://vspposovhdgvbeukoivh.supabase.co'
  ) THEN
    RAISE EXCEPTION 'BOD02 ETAPA1 is TEST-only; PROD forbidden';
  END IF;
  IF to_regclass('auth.users') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.reservations') IS NULL
     OR to_regclass('public.offers') IS NULL
     OR to_regclass('public.gdpr_reservation_contact_cleanup_gate') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_trigger t
       WHERE t.tgrelid = 'auth.users'::regclass
         AND t.tgname = 'on_auth_user_created' AND t.tgenabled = 'O'
     ) THEN
    RAISE EXCEPTION 'Expected Rentulo V1 signup schema or GDPR safeguards missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.gdpr_reservation_contact_cleanup_gate
    WHERE singleton = true AND is_enabled = false
  ) THEN
    RAISE EXCEPTION 'Existing GDPR cleanup gate must stay OFF';
  END IF;
END;
$preflight$;

-- Human-approved legal holds: refer to ONE subject only. Revisit within six
-- months, do not expire automatically. All records remain internal.
CREATE TABLE IF NOT EXISTS public.gdpr_legal_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid REFERENCES public.reservations(id) ON DELETE RESTRICT,
  offer_id uuid REFERENCES public.offers(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 12 AND 2000),
  opened_at timestamptz NOT NULL DEFAULT now(),
  last_reviewed_at timestamptz NOT NULL DEFAULT now(),
  last_review_note text,
  next_review_at timestamptz NOT NULL DEFAULT (now() + interval '6 months'),
  released_at timestamptz,
  release_reason text,
  CONSTRAINT gdpr_hold_one_subject CHECK (num_nonnulls(reservation_id, offer_id, user_id) = 1),
  CONSTRAINT gdpr_hold_review_window CHECK (
    last_reviewed_at >= opened_at
    AND next_review_at > last_reviewed_at
    AND next_review_at <= last_reviewed_at + interval '6 months'
    AND (last_reviewed_at = opened_at
      OR char_length(btrim(coalesce(last_review_note, ''))) >= 8)
  ),
  CONSTRAINT gdpr_hold_release_reason CHECK (
    released_at IS NULL
    OR (released_at >= opened_at AND char_length(btrim(coalesce(release_reason, ''))) >= 8)
  ),
  CONSTRAINT gdpr_hold_release_pair CHECK (
    (released_at IS NULL) = (release_reason IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS gdpr_legal_holds_open_res_idx
  ON public.gdpr_legal_holds(reservation_id) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS gdpr_legal_holds_open_offer_idx
  ON public.gdpr_legal_holds(offer_id) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS gdpr_legal_holds_open_user_idx
  ON public.gdpr_legal_holds(user_id) WHERE released_at IS NULL;

-- A hold write and future TEST-only retention workers use the SAME lock.
-- It prevents a hold from being added concurrently with a cleanup operation.
CREATE OR REPLACE FUNCTION public.gdpr_serialize_legal_hold_writes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(860808, 20261020);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_gdpr_serialize_legal_hold_writes ON public.gdpr_legal_holds;
CREATE TRIGGER trg_gdpr_serialize_legal_hold_writes
BEFORE INSERT OR UPDATE OR DELETE ON public.gdpr_legal_holds
FOR EACH ROW EXECUTE FUNCTION public.gdpr_serialize_legal_hold_writes();

-- Manual GDPR requests received at policy@rentulo.com. The one-month
-- statutory reply deadline is measured from received_at, NOT 30 days.
-- A justified extension must fit within a total of three calendar months.
CREATE TABLE IF NOT EXISTS public.gdpr_subject_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamptz NOT NULL DEFAULT now(),
  subject_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  contact_email text CHECK (contact_email IS NULL OR char_length(contact_email) <= 254),
  request_kind text NOT NULL CHECK (
    request_kind IN ('access','rectification','erasure','portability','restriction','objection','other')
  ),
  status text NOT NULL DEFAULT 'received' CHECK (
    status IN ('received','verifying','in_progress','closed','refused')
  ),
  identity_verified_at timestamptz,
  extended_until timestamptz,
  extension_reason text,
  responded_at timestamptz,
  decision_reason text,
  CONSTRAINT gdpr_request_extension_reason CHECK (
    (extended_until IS NULL AND extension_reason IS NULL)
    OR (
      extended_until > received_at + interval '1 month'
      AND extended_until <= received_at + interval '3 months'
      AND char_length(btrim(coalesce(extension_reason, ''))) >= 12
    )
  ),
  CONSTRAINT gdpr_request_closed_has_response CHECK (
    status NOT IN ('closed','refused') OR (
      responded_at IS NOT NULL AND
      char_length(btrim(coalesce(decision_reason, ''))) >= 12
    )
  )
);
CREATE INDEX IF NOT EXISTS gdpr_subject_requests_open_idx
  ON public.gdpr_subject_requests(received_at)
  WHERE status NOT IN ('closed','refused');

-- DSA notice-and-action sent to rentulo@rentulo.com. Receipt,
-- acknowledgement, decision and any appeal are manual actions in V1.
CREATE TABLE IF NOT EXISTS public.dsa_content_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamptz NOT NULL DEFAULT now(),
  reporter_email text CHECK (reporter_email IS NULL OR char_length(reporter_email) <= 254),
  offer_id uuid REFERENCES public.offers(id) ON DELETE SET NULL,
  reported_url text NOT NULL CHECK (char_length(btrim(reported_url)) BETWEEN 10 AND 2048),
  explanation text NOT NULL CHECK (char_length(btrim(explanation)) BETWEEN 10 AND 5000),
  status text NOT NULL DEFAULT 'received' CHECK (
    status IN ('received','reviewing','action_taken','rejected','closed')
  ),
  acknowledged_at timestamptz,
  decided_at timestamptz,
  decision_reason text,
  notified_at timestamptz,
  appeal_received_at timestamptz,
  appeal_decision_at timestamptz,
  CONSTRAINT dsa_decision_requires_reason CHECK (
    status IN ('received','reviewing') OR
    (decided_at IS NOT NULL AND
     char_length(btrim(coalesce(decision_reason, ''))) >= 12)
  ),
  CONSTRAINT dsa_appeal_chronology CHECK (
    appeal_decision_at IS NULL OR appeal_received_at IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS dsa_content_notices_open_idx
  ON public.dsa_content_notices(received_at)
  WHERE status IN ('received','reviewing');

-- Breach log. Reporting to the supervisory authority (when required)
-- is due if possible within 72 hours of awareness; no automatic email/filing.
CREATE TABLE IF NOT EXISTS public.gdpr_security_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detected_at timestamptz NOT NULL DEFAULT now(),
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 12 AND 5000),
  risk text NOT NULL DEFAULT 'under_review' CHECK (
    risk IN ('under_review','unlikely','risk','high_risk')
  ),
  contained_at timestamptz,
  authority_notified_at timestamptz,
  subjects_notified_at timestamptz,
  decision_reason text,
  corrective_actions text,
  closed_at timestamptz,
  CONSTRAINT incident_closure_requires_assessment CHECK (
    closed_at IS NULL OR
    (risk <> 'under_review' AND
     char_length(btrim(coalesce(decision_reason, ''))) >= 12)
  )
);
CREATE INDEX IF NOT EXISTS gdpr_security_incidents_open_idx
  ON public.gdpr_security_incidents(detected_at) WHERE closed_at IS NULL;

-- Server-side snapshot of a signup assertion: the browser submits three
-- explicit checked flags; the SERVER chooses exact published test versions
-- and timestamps. Never fabricate acceptance for historical/auth-admin users.
-- Not cryptographic proof that the person read the linked documents.
CREATE TABLE IF NOT EXISTS public.gdpr_terms_acceptances (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  terms_version text NOT NULL,
  privacy_version text NOT NULL,
  language text NOT NULL CHECK (language IN ('cs','sk','en','de','pl')),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  source text NOT NULL CHECK (source = 'auth_signup'),
  UNIQUE (user_id, terms_version, source)
);

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

  -- The server must never label an outdated form as having shown a newer version.
  IF NEW.raw_user_meta_data ->> 'terms_version' IS DISTINCT FROM '1.0-test-2026-10-20'
     OR NEW.raw_user_meta_data ->> 'privacy_notice_version' IS DISTINCT FROM '1.0-test-2026-10-20'
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
    NEW.id, '1.0-test-2026-10-20', '1.0-test-2026-10-20',
    v_lang, clock_timestamp(), 'auth_signup'
  ) ON CONFLICT (user_id, terms_version, source) DO NOTHING;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_gdpr_capture_signup_terms ON auth.users;
CREATE TRIGGER trg_gdpr_capture_signup_terms
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.gdpr_capture_signup_terms();

-- The terms audit is append-only, including for service_role. A later
-- carefully reviewed retention migration must provide an explicit safe purge.
CREATE OR REPLACE FUNCTION public.gdpr_prevent_terms_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'GDPR terms acceptance audit is append-only' USING ERRCODE = '42501';
END;
$function$;
DROP TRIGGER IF EXISTS trg_gdpr_prevent_terms_audit_mutation
  ON public.gdpr_terms_acceptances;
CREATE TRIGGER trg_gdpr_prevent_terms_audit_mutation
BEFORE UPDATE OR DELETE ON public.gdpr_terms_acceptances
FOR EACH ROW EXECUTE FUNCTION public.gdpr_prevent_terms_audit_mutation();

-- No user-facing REST access. No permissive RLS policies are installed.
-- Only the trusted backend role may read/write operational registers;
-- accepting terms is written EXCLUSIVELY by the auth.users trigger.
DO $secure$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'gdpr_legal_holds','gdpr_subject_requests',
    'dsa_content_notices','gdpr_security_incidents',
    'gdpr_terms_acceptances'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', v_table);
  END LOOP;
  FOREACH v_table IN ARRAY ARRAY[
    'gdpr_legal_holds','gdpr_subject_requests',
    'dsa_content_notices','gdpr_security_incidents'
  ] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO service_role', v_table);
  END LOOP;
END;
$secure$;
GRANT SELECT ON TABLE public.gdpr_terms_acceptances TO service_role;
REVOKE ALL ON SEQUENCE public.gdpr_terms_acceptances_id_seq
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.gdpr_capture_signup_terms()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gdpr_prevent_terms_audit_mutation()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gdpr_serialize_legal_hold_writes()
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.gdpr_terms_acceptances IS
  'Server-timestamped assertion from current TEST signup form, not consent to GDPR processing. Existing accounts are never backfilled or falsely marked as accepted.';
COMMENT ON TABLE public.gdpr_legal_holds IS
  'Manual legal holds: one reservation/offer/profile subject, human-reviewed at least every six months. Does not itself activate data cleanup.';
COMMIT;
