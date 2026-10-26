-- RENTULO V1 / PROD RELEASE CANDIDATE bd1b8d1 / 2026-10-24.
-- Apply only to a verified PROD database after backup and approval.
-- This SQL is staged separately: never copy over TEST migrations.
-- Cron activation is deferred; no automatic deployment is authorized.

-- RENTULO V1 / BOD 03A / PROD ONLY.
-- Internal incident evidence, SQL-Editor owner actions, user and offer restrictions.
-- No user-facing admin role, new pages, payment/Stripe operations or PROD rollout.
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


DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name = 'rentulo_prod_release_target'
      AND btrim(s.decrypted_secret, '/') = 'tfvgxrdjrpicgtvovehl'
  ) THEN
    RAISE EXCEPTION 'BOD03A: authorized PROD project required';
  END IF;
  IF to_regclass('public.offers') IS NULL
     OR to_regclass('public.reservations') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.dsa_content_notices') IS NULL
     OR to_regclass('public.reservation_return_incidents') IS NULL
     OR to_regclass('public.gdpr_legal_holds') IS NULL THEN
    RAISE EXCEPTION 'BOD03A: expected Rentulo BOD01/BOD02 tables missing';
  END IF;
END;
$preflight$;

-- Only the designated Supabase organization Owner uses the SQL Editor for V1.
-- postgres/SQL Editor is inherently privileged: DB code cannot stop the Owner
-- from bypassing SQL procedures or cryptographically identify the human user.
-- These functions enforce the approved normal workflow; see runbook.
CREATE OR REPLACE FUNCTION public.platform_admin_assert(p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
BEGIN
  IF session_user <> 'postgres' OR current_user <> 'postgres'
     OR auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'BOD03A: only the Supabase Owner SQL Editor may perform this action'
      USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 12 AND 2000 THEN
    RAISE EXCEPTION 'BOD03A: written administrative reason (12-2000 chars) required'
      USING ERRCODE = '22023';
  END IF;
END;
$function$;

-- A1: non-DSA, non-GDPR, non-return incident register. References are verified
-- at intake but stored as business IDs, not cascading FKs, because ordinary
-- GDPR data cleanup must not silently delete an incident history. Active legal
-- disputes require an existing gdpr_legal_holds entry under BOD02 procedures.
CREATE SEQUENCE IF NOT EXISTS public.platform_incident_number_seq AS bigint
  START WITH 1 INCREMENT BY 1 NO CYCLE;
CREATE TABLE IF NOT EXISTS public.platform_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_number text NOT NULL UNIQUE,
  incident_type text NOT NULL CHECK (
    incident_type IN ('damage', 'loss', 'fraud', 'problem_user')
  ),
  reservation_number text CHECK (
    reservation_number IS NULL OR reservation_number ~ '^R-[0-9]{6,}$'
  ),
  offer_number text CHECK (
    offer_number IS NULL OR offer_number ~ '^N-[0-9]{6,}$'
  ),
  subject_user_id uuid,
  reporter_email text CHECK (
    reporter_email IS NULL OR char_length(btrim(reporter_email)) BETWEEN 3 AND 254
  ),
  description text NOT NULL CHECK (
    char_length(btrim(description)) BETWEEN 15 AND 5000
  ),
  -- Only private mailbox message IDs, internal case references and file names;
  -- NEVER public links, access tokens, photos or evidence file contents.
  evidence_references text CHECK (
    evidence_references IS NULL
    OR char_length(btrim(evidence_references)) BETWEEN 4 AND 4000
  ),
  status text NOT NULL DEFAULT 'received' CHECK (
    status IN ('received', 'reviewing', 'closed')
  ),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decision_reason text,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT platform_incident_number_format CHECK (
    incident_number ~ '^I-[0-9]{6,}$'
  ),
  CONSTRAINT platform_incident_closure_pair CHECK (
    (status = 'closed') = (closed_at IS NOT NULL)
    AND (status <> 'closed' OR
         char_length(btrim(coalesce(decision_reason, ''))) BETWEEN 12 AND 5000)
  )
);
ALTER SEQUENCE public.platform_incident_number_seq
  OWNED BY public.platform_incidents.incident_number;
CREATE INDEX IF NOT EXISTS platform_incidents_open_idx
  ON public.platform_incidents(received_at) WHERE status <> 'closed';
CREATE INDEX IF NOT EXISTS platform_incidents_reservation_idx
  ON public.platform_incidents(reservation_number) WHERE reservation_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS platform_incidents_offer_idx
  ON public.platform_incidents(offer_number) WHERE offer_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS platform_incidents_user_idx
  ON public.platform_incidents(subject_user_id) WHERE subject_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.platform_incident_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES public.platform_incidents(id) ON DELETE RESTRICT,
  event_kind text NOT NULL CHECK (event_kind IN ('created', 'updated', 'closed')),
  operator_label text NOT NULL,
  db_session_user text NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 12 AND 2000),
  changed_fields text[] NOT NULL,
  previous_status text,
  new_status text NOT NULL,
  added_evidence_reference text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS platform_incident_events_case_idx
  ON public.platform_incident_events(incident_id, occurred_at);

CREATE TABLE IF NOT EXISTS public.platform_user_blocks (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_blocked boolean NOT NULL DEFAULT true,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 12 AND 2000),
  blocked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  unblocked_at timestamptz,
  last_changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT platform_block_timestamp_pair CHECK (
    (is_blocked AND unblocked_at IS NULL) OR
    (NOT is_blocked AND unblocked_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS platform_users_currently_blocked_idx
  ON public.platform_user_blocks(user_id) WHERE is_blocked;

-- Moderation is independent of an owner's normal hidden/active toggle.
-- Releasing moderation does NOT automatically republish the owner's offer.
CREATE TABLE IF NOT EXISTS public.platform_offer_moderation (
  offer_id uuid PRIMARY KEY REFERENCES public.offers(id) ON DELETE CASCADE,
  is_hidden boolean NOT NULL DEFAULT true,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 12 AND 2000),
  hidden_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  released_at timestamptz,
  last_changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT platform_offer_moderation_timestamp_pair CHECK (
    (is_hidden AND released_at IS NULL) OR
    (NOT is_hidden AND released_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS platform_offers_moderated_idx
  ON public.platform_offer_moderation(offer_id) WHERE is_hidden;

CREATE TABLE IF NOT EXISTS public.platform_admin_actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action_type text NOT NULL CHECK (
    action_type IN ('block_user', 'unblock_user', 'hide_offer', 'release_offer')
  ),
  target_id uuid NOT NULL,
  operator_label text NOT NULL,
  db_session_user text NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 12 AND 2000),
  previous_state boolean,
  new_state boolean NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS platform_admin_actions_target_idx
  ON public.platform_admin_actions(target_id, occurred_at);

-- Only approved functions set this transaction-local reason, and reset it
-- before returning. All ordinary clients are additionally denied table grants.
CREATE OR REPLACE FUNCTION public.platform_admin_require_write_context()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.platform_admin_assert(
    current_setting('rentulo.platform_admin_reason', true)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_incident_write_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_next bigint;
BEGIN
  PERFORM public.platform_admin_require_write_context();
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'received' OR NEW.decision_reason IS NOT NULL
       OR NEW.closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'BOD03A: new cases must start as received';
    END IF;
    v_next := nextval('public.platform_incident_number_seq'::regclass);
    NEW.incident_number := 'I-' || lpad(
      v_next::text, greatest(6, length(v_next::text)), '0'
    );
    NEW.received_at := clock_timestamp();
    NEW.created_at := NEW.received_at;
    NEW.updated_at := NEW.received_at;
    RETURN NEW;
  END IF;
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'BOD03A: a closed incident cannot be changed';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.incident_number IS DISTINCT FROM OLD.incident_number
     OR NEW.received_at IS DISTINCT FROM OLD.received_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.incident_type IS DISTINCT FROM OLD.incident_type
     OR NEW.reservation_number IS DISTINCT FROM OLD.reservation_number
     OR NEW.offer_number IS DISTINCT FROM OLD.offer_number
     OR NEW.subject_user_id IS DISTINCT FROM OLD.subject_user_id
     OR NEW.reporter_email IS DISTINCT FROM OLD.reporter_email
     OR NEW.description IS DISTINCT FROM OLD.description THEN
    RAISE EXCEPTION 'BOD03A: incident identity and intake are immutable';
  END IF;
  IF NEW.status = 'closed' THEN
    NEW.closed_at := clock_timestamp();
  ELSIF NEW.closed_at IS NOT NULL OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason THEN
    RAISE EXCEPTION 'BOD03A: decision is recorded only when closing a case';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_incident_event_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_fields text[] := ARRAY[]::text[];
  v_evidence text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_fields := ARRAY['incident_type', 'description', 'status',
      'reservation_number', 'offer_number', 'subject_user_id',
      'reporter_email', 'evidence_references'];
    v_evidence := NEW.evidence_references;
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      v_fields := array_append(v_fields, 'status');
    END IF;
    IF NEW.evidence_references IS DISTINCT FROM OLD.evidence_references THEN
      v_fields := array_append(v_fields, 'evidence_references');
      v_evidence := CASE
        WHEN OLD.evidence_references IS NULL THEN NEW.evidence_references
        ELSE substr(NEW.evidence_references,
          char_length(OLD.evidence_references) + 2)
      END;
    END IF;
    IF NEW.decision_reason IS DISTINCT FROM OLD.decision_reason THEN
      v_fields := array_append(v_fields, 'decision_reason');
    END IF;
  END IF;
  INSERT INTO public.platform_incident_events (
    incident_id, event_kind, operator_label, db_session_user, reason,
    changed_fields, previous_status, new_status, added_evidence_reference
  ) VALUES (
    NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN 'created'
         WHEN NEW.status = 'closed' THEN 'closed' ELSE 'updated' END,
    'Supabase Owner / SQL Editor', session_user,
    current_setting('rentulo.platform_admin_reason', true),
    v_fields, CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
    NEW.status, v_evidence
  );
  RETURN NEW;
END;
$function$;

-- Incident evidence and admin actions are append-only at application level.
-- The SQL Editor owner can still bypass triggers/permissions intentionally.
CREATE OR REPLACE FUNCTION public.platform_guard_audit_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.platform_admin_require_write_context();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_prevent_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'BOD03A: audit rows are append-only' USING ERRCODE = '42501';
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_prevent_incident_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'BOD03A: delete through GDPR-approved retention only' USING ERRCODE = '42501';
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_control_write_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.platform_admin_require_write_context();
  IF TG_OP = 'UPDATE' THEN
    IF (TG_TABLE_NAME = 'platform_user_blocks'
        AND NEW.user_id IS DISTINCT FROM OLD.user_id)
       OR (TG_TABLE_NAME = 'platform_offer_moderation'
        AND NEW.offer_id IS DISTINCT FROM OLD.offer_id) THEN
      RAISE EXCEPTION 'BOD03A: target identity cannot change';
    END IF;
    NEW.last_changed_at := clock_timestamp();
  ELSE
    NEW.last_changed_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_control_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_user boolean := TG_TABLE_NAME = 'platform_user_blocks';
  v_new_state boolean;
  v_old_state boolean;
  v_target uuid;
  v_action text;
BEGIN
  IF v_user THEN
    v_target := NEW.user_id;
    v_new_state := NEW.is_blocked;
    v_old_state := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.is_blocked END;
    v_action := CASE WHEN NEW.is_blocked THEN 'block_user' ELSE 'unblock_user' END;
  ELSE
    v_target := NEW.offer_id;
    v_new_state := NEW.is_hidden;
    v_old_state := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.is_hidden END;
    v_action := CASE WHEN NEW.is_hidden THEN 'hide_offer' ELSE 'release_offer' END;
  END IF;
  INSERT INTO public.platform_admin_actions (
    action_type, target_id, operator_label, db_session_user, reason,
    previous_state, new_state, occurred_at
  ) VALUES (
    v_action, v_target, 'Supabase Owner / SQL Editor', session_user,
    current_setting('rentulo.platform_admin_reason', true),
    v_old_state, v_new_state, clock_timestamp()
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_platform_incident_write_guard ON public.platform_incidents;
CREATE TRIGGER trg_platform_incident_write_guard
  BEFORE INSERT OR UPDATE ON public.platform_incidents
  FOR EACH ROW EXECUTE FUNCTION public.platform_incident_write_guard();
DROP TRIGGER IF EXISTS trg_platform_incident_event_write ON public.platform_incidents;
CREATE TRIGGER trg_platform_incident_event_write
  AFTER INSERT OR UPDATE ON public.platform_incidents
  FOR EACH ROW EXECUTE FUNCTION public.platform_incident_event_write();
DROP TRIGGER IF EXISTS trg_platform_incident_no_delete ON public.platform_incidents;
CREATE TRIGGER trg_platform_incident_no_delete
  BEFORE DELETE ON public.platform_incidents
  FOR EACH ROW EXECUTE FUNCTION public.platform_prevent_incident_deletion();

DROP TRIGGER IF EXISTS trg_platform_incident_events_write_guard ON public.platform_incident_events;
CREATE TRIGGER trg_platform_incident_events_write_guard
  BEFORE INSERT ON public.platform_incident_events
  FOR EACH ROW EXECUTE FUNCTION public.platform_guard_audit_insert();
DROP TRIGGER IF EXISTS trg_platform_admin_actions_write_guard ON public.platform_admin_actions;
CREATE TRIGGER trg_platform_admin_actions_write_guard
  BEFORE INSERT ON public.platform_admin_actions
  FOR EACH ROW EXECUTE FUNCTION public.platform_guard_audit_insert();

DROP TRIGGER IF EXISTS trg_platform_incident_events_append_only ON public.platform_incident_events;
CREATE TRIGGER trg_platform_incident_events_append_only
  BEFORE UPDATE OR DELETE ON public.platform_incident_events
  FOR EACH ROW EXECUTE FUNCTION public.platform_prevent_audit_mutation();
DROP TRIGGER IF EXISTS trg_platform_admin_actions_append_only ON public.platform_admin_actions;
CREATE TRIGGER trg_platform_admin_actions_append_only
  BEFORE UPDATE OR DELETE ON public.platform_admin_actions
  FOR EACH ROW EXECUTE FUNCTION public.platform_prevent_audit_mutation();

DROP TRIGGER IF EXISTS trg_platform_user_control_guard ON public.platform_user_blocks;
CREATE TRIGGER trg_platform_user_control_guard
  BEFORE INSERT OR UPDATE ON public.platform_user_blocks
  FOR EACH ROW EXECUTE FUNCTION public.platform_control_write_guard();
DROP TRIGGER IF EXISTS trg_platform_user_control_audit ON public.platform_user_blocks;
CREATE TRIGGER trg_platform_user_control_audit
  AFTER INSERT OR UPDATE ON public.platform_user_blocks
  FOR EACH ROW EXECUTE FUNCTION public.platform_control_audit();
DROP TRIGGER IF EXISTS trg_platform_offer_control_guard ON public.platform_offer_moderation;
CREATE TRIGGER trg_platform_offer_control_guard
  BEFORE INSERT OR UPDATE ON public.platform_offer_moderation
  FOR EACH ROW EXECUTE FUNCTION public.platform_control_write_guard();
DROP TRIGGER IF EXISTS trg_platform_offer_control_audit ON public.platform_offer_moderation;
CREATE TRIGGER trg_platform_offer_control_audit
  AFTER INSERT OR UPDATE ON public.platform_offer_moderation
  FOR EACH ROW EXECUTE FUNCTION public.platform_control_audit();

-- Owner-only SQL Editor interface. Every permitted change is a single atomic
-- transaction with trigger-generated evidence. No REST/browser grants.
CREATE OR REPLACE FUNCTION public.platform_admin_create_incident(
  p_type text, p_description text, p_admin_reason text,
  p_reservation_number text DEFAULT NULL, p_offer_number text DEFAULT NULL,
  p_subject_user_id uuid DEFAULT NULL, p_reporter_email text DEFAULT NULL,
  p_evidence_references text DEFAULT NULL
)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE v_number text;
BEGIN
  PERFORM public.platform_admin_assert(p_admin_reason);
  IF p_reservation_number IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.reservations r
    WHERE r.reservation_number = p_reservation_number
  ) THEN
    RAISE EXCEPTION 'BOD03A: reservation reference not found';
  END IF;
  IF p_offer_number IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.offers o WHERE o.offer_number = p_offer_number
  ) THEN
    RAISE EXCEPTION 'BOD03A: offer reference not found';
  END IF;
  IF p_subject_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles u WHERE u.id = p_subject_user_id
  ) THEN
    RAISE EXCEPTION 'BOD03A: user reference not found';
  END IF;
  PERFORM set_config('rentulo.platform_admin_reason', btrim(p_admin_reason), true);
  INSERT INTO public.platform_incidents (
    incident_type, description, reservation_number, offer_number,
    subject_user_id, reporter_email, evidence_references
  ) VALUES (
    p_type, btrim(p_description), p_reservation_number, p_offer_number,
    p_subject_user_id, NULLIF(btrim(p_reporter_email), ''),
    NULLIF(btrim(p_evidence_references), '')
  ) RETURNING incident_number INTO v_number;
  PERFORM set_config('rentulo.platform_admin_reason', '', true);
  RETURN v_number;
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_update_incident(
  p_incident_number text, p_admin_reason text,
  p_new_status text DEFAULT NULL, p_decision_reason text DEFAULT NULL,
  p_add_evidence_reference text DEFAULT NULL
)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_case public.platform_incidents%rowtype;
  v_new_status text;
  v_evidence text := NULLIF(btrim(p_add_evidence_reference), '');
BEGIN
  PERFORM public.platform_admin_assert(p_admin_reason);
  SELECT * INTO v_case FROM public.platform_incidents
  WHERE incident_number = p_incident_number FOR UPDATE;
  IF NOT FOUND OR v_case.status = 'closed' THEN
    RAISE EXCEPTION 'BOD03A: case not found or already closed';
  END IF;
  v_new_status := coalesce(p_new_status, v_case.status);
  IF v_new_status NOT IN ('received', 'reviewing', 'closed') OR
     (v_case.status = 'reviewing' AND v_new_status = 'received') THEN
    RAISE EXCEPTION 'BOD03A: invalid incident status transition';
  END IF;
  IF v_new_status <> 'closed' AND p_decision_reason IS NOT NULL THEN
    RAISE EXCEPTION 'BOD03A: decision reason belongs to case closure';
  END IF;
  IF v_new_status = 'closed' AND
     char_length(btrim(coalesce(p_decision_reason, ''))) NOT BETWEEN 12 AND 5000 THEN
    RAISE EXCEPTION 'BOD03A: case closure needs a written decision';
  END IF;
  IF v_new_status = v_case.status AND v_evidence IS NULL THEN
    RAISE EXCEPTION 'BOD03A: no incident change supplied';
  END IF;
  IF v_evidence IS NOT NULL AND char_length(v_evidence) NOT BETWEEN 4 AND 1000 THEN
    RAISE EXCEPTION 'BOD03A: short private evidence reference required';
  END IF;
  PERFORM set_config('rentulo.platform_admin_reason', btrim(p_admin_reason), true);
  UPDATE public.platform_incidents i SET
    status = v_new_status,
    decision_reason = CASE WHEN v_new_status = 'closed'
      THEN btrim(p_decision_reason) ELSE i.decision_reason END,
    evidence_references = CASE WHEN v_evidence IS NULL
      THEN i.evidence_references
      ELSE concat_ws(E'\n', i.evidence_references, v_evidence) END
  WHERE i.id = v_case.id;
  PERFORM set_config('rentulo.platform_admin_reason', '', true);
  RETURN v_new_status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_block_user(
  p_user_id uuid, p_reason text
)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE v_row public.platform_user_blocks%rowtype;
BEGIN
  PERFORM public.platform_admin_assert(p_reason);
  IF p_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_user_id
  ) THEN
    RAISE EXCEPTION 'BOD03A: profile to block not found';
  END IF;
  SELECT * INTO v_row FROM public.platform_user_blocks
  WHERE user_id = p_user_id FOR UPDATE;
  IF FOUND AND v_row.is_blocked THEN
    RAISE EXCEPTION 'BOD03A: user already blocked';
  END IF;
  PERFORM set_config('rentulo.platform_admin_reason', btrim(p_reason), true);
  INSERT INTO public.platform_user_blocks (
    user_id, is_blocked, reason, blocked_at, unblocked_at
  ) VALUES (p_user_id, true, btrim(p_reason), clock_timestamp(), NULL)
  ON CONFLICT (user_id) DO UPDATE SET
    is_blocked = true, reason = excluded.reason,
    blocked_at = clock_timestamp(), unblocked_at = NULL;
  PERFORM set_config('rentulo.platform_admin_reason', '', true);
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_unblock_user(
  p_user_id uuid, p_reason text
)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.platform_admin_assert(p_reason);
  PERFORM set_config('rentulo.platform_admin_reason', btrim(p_reason), true);
  UPDATE public.platform_user_blocks SET
    is_blocked = false, reason = btrim(p_reason),
    unblocked_at = clock_timestamp()
  WHERE user_id = p_user_id AND is_blocked;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOD03A: no active user restriction';
  END IF;
  PERFORM set_config('rentulo.platform_admin_reason', '', true);
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_hide_offer(
  p_offer_number text, p_reason text
)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE v_offer public.offers%rowtype;
BEGIN
  PERFORM public.platform_admin_assert(p_reason);
  SELECT * INTO v_offer FROM public.offers
  WHERE offer_number = p_offer_number FOR UPDATE;
  IF NOT FOUND OR v_offer.status = 'deleted' THEN
    RAISE EXCEPTION 'BOD03A: offer missing or deleted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.platform_offer_moderation
    WHERE offer_id = v_offer.id AND is_hidden
  ) THEN
    RAISE EXCEPTION 'BOD03A: offer already moderated';
  END IF;
  PERFORM set_config('rentulo.platform_admin_reason', btrim(p_reason), true);
  INSERT INTO public.platform_offer_moderation (
    offer_id, is_hidden, reason, hidden_at, released_at
  ) VALUES (v_offer.id, true, btrim(p_reason), clock_timestamp(), NULL)
  ON CONFLICT (offer_id) DO UPDATE SET
    is_hidden = true, reason = excluded.reason,
    hidden_at = clock_timestamp(), released_at = NULL;
  UPDATE public.offers SET status = 'hidden'::public.offer_status
  WHERE id = v_offer.id AND status <> 'hidden';
  PERFORM set_config('rentulo.platform_admin_reason', '', true);
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_release_offer(
  p_offer_number text, p_reason text
)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE v_offer_id uuid;
BEGIN
  PERFORM public.platform_admin_assert(p_reason);
  SELECT id INTO v_offer_id FROM public.offers
  WHERE offer_number = p_offer_number FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOD03A: offer not found';
  END IF;
  PERFORM set_config('rentulo.platform_admin_reason', btrim(p_reason), true);
  UPDATE public.platform_offer_moderation SET
    is_hidden = false, reason = btrim(p_reason),
    released_at = clock_timestamp()
  WHERE offer_id = v_offer_id AND is_hidden;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOD03A: no active offer moderation';
  END IF;
  PERFORM set_config('rentulo.platform_admin_reason', '', true);
  -- Do not auto-publish: owner may choose whether/when to republish.
  RETURN true;
END;
$function$;

-- Preserve the existing BOD02 transport rule, except for a strictly
-- owner-audited HIDE of a moderated existing legacy transport offer.
create or replace function public.enforce_v1_transport_offer_policy()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  v_category text := lower(btrim(coalesce(new.category, '')));
  v_title text := lower(coalesce(new.name, ''));
begin
  -- Admin-only moderation must be able to HIDE grandfathered invalid offers.
  -- This exception cannot create or republish a transport offer and only
  -- applies AFTER BOD03A moderation has recorded its active restriction.
  if TG_OP = 'UPDATE' and new.status = 'hidden'::public.offer_status
     and session_user = 'postgres'
     and char_length(btrim(coalesce(
       current_setting('rentulo.platform_admin_reason', true), ''))) >= 12
     and exists (select 1 from public.platform_offer_moderation m
                 where m.offer_id = new.id and m.is_hidden) then
    return new;
  end if;
  -- Retain old category aliases as a guard against forged API payloads.
  if v_category in (
      'auto a doprava', 'auto & transport', 'vehicles', 'transport',
      'dopravní prostředky', 'dopravné prostriedky'
    )
    or v_title ~ '(^|[^[:alnum:]])(auto|automobil|automobily|osobni auto|osobní auto|osobni automobil|osobní automobil|motorove vozidlo|motorové vozidlo|motorka|motocykl|motocykel|moped|skutr|skútr|scooter|elektroskutr|elektroskútr|jizdni kolo|jízdní kolo|bicykl|bicykel|bicycle|elektrokolo|e-bike|kolobezka|koloběžka|elektrokolobezka|elektrokoloběžka|e-scooter|motorcycle|motorbike|motorboat|caravan|karavan|obytny vuz|obytný vůz|obytny automobil|obytný automobil|privesny vozik|přívěsný vozík|prives|přívěs|lod|loď|clun|člun|kajak|kanoe|boat|motorhome|car|bike|kayak|canoe|trailer|fahrrad|motorrad|roller|boot|kanu|wohnmobil|anhanger|anhänger|samochod|samochód|rower|hulajnoga|lodz|łódź|skuter|motorower|przyczepa|paddleboard)([^[:alnum:]]|$)'
  then
    raise exception using errcode = '23514',
      message = 'RENTULO_V1_TRANSPORT_NOT_ALLOWED';
  end if;

  return new;
end;
$function$;

-- Server-side enforcement cannot be bypassed by direct client API writes.
-- This does NOT change paid/returned/refund/Stripe flows for old reservations.
CREATE OR REPLACE FUNCTION public.platform_offer_activity_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_is_blocked boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (
      SELECT 1 FROM public.platform_user_blocks b
      WHERE b.user_id = NEW.owner_id AND b.is_blocked
    ) THEN
      RAISE EXCEPTION 'RENTULO_USER_RESTRICTED' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.platform_offer_moderation m
    WHERE m.offer_id = OLD.id AND m.is_hidden
  ) AND NOT (
    -- Soft deletion and GDPR account-deactivation anonymization must work.
    -- They can never reactivate the moderated listing.
    NEW.status = 'deleted'::public.offer_status
    OR (session_user = 'postgres'
      AND char_length(btrim(coalesce(
        current_setting('rentulo.platform_admin_reason', true), ''))) >= 12)
  ) THEN
    RAISE EXCEPTION 'RENTULO_OFFER_MODERATED' USING ERRCODE = '42501';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.platform_user_blocks b
    WHERE b.user_id = NEW.owner_id AND b.is_blocked
  ) INTO v_is_blocked;
  IF v_is_blocked AND NEW.status = 'active'
     AND (OLD.status IS DISTINCT FROM NEW.status
       OR NEW.name IS DISTINCT FROM OLD.name
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.price_per_day IS DISTINCT FROM OLD.price_per_day) THEN
    RAISE EXCEPTION 'RENTULO_USER_RESTRICTED' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_reservation_activity_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (
      SELECT 1 FROM public.platform_user_blocks b
      WHERE b.user_id IN (NEW.renter_id, NEW.owner_id) AND b.is_blocked
    ) THEN
      RAISE EXCEPTION 'RENTULO_USER_RESTRICTED' USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'approved' THEN
    IF EXISTS (
      SELECT 1 FROM public.platform_user_blocks b
      WHERE b.user_id IN (NEW.renter_id, NEW.owner_id) AND b.is_blocked
    ) THEN
      RAISE EXCEPTION 'RENTULO_USER_RESTRICTED' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_platform_offer_activity_guard ON public.offers;
CREATE TRIGGER trg_platform_offer_activity_guard
  BEFORE INSERT OR UPDATE ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.platform_offer_activity_guard();
-- Named after `prepare_reservation_before_insert` so NEW owner/renter is filled.
DROP TRIGGER IF EXISTS trg_platform_reservation_activity_insert ON public.reservations;
CREATE TRIGGER trg_platform_reservation_activity_insert
  BEFORE INSERT ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.platform_reservation_activity_guard();
DROP TRIGGER IF EXISTS trg_platform_reservation_activity_approve ON public.reservations;
CREATE TRIGGER trg_platform_reservation_activity_approve
  BEFORE UPDATE OF status ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.platform_reservation_activity_guard();

-- Internal registers: RLS ON; only postgres/SQL Editor uses the interface.
-- No service_role/authenticated/anon table grants or RPC permissions.
DO $secure$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'platform_incidents', 'platform_incident_events',
    'platform_user_blocks', 'platform_offer_moderation',
    'platform_admin_actions'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', v_table);
  END LOOP;
END;
$secure$;
REVOKE ALL ON SEQUENCE public.platform_incident_number_seq,
  public.platform_incident_events_id_seq,
  public.platform_admin_actions_id_seq
  FROM PUBLIC, anon, authenticated, service_role;

DO $revoke_functions$
DECLARE v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'platform_admin_assert(text)',
    'platform_admin_require_write_context()',
    'platform_incident_write_guard()',
    'platform_incident_event_write()',
    'platform_prevent_audit_mutation()',
    'platform_guard_audit_insert()',
    'platform_prevent_incident_deletion()',
    'platform_control_write_guard()',
    'platform_control_audit()',
    'platform_admin_create_incident(text,text,text,text,text,uuid,text,text)',
    'platform_admin_update_incident(text,text,text,text,text)',
    'platform_admin_block_user(uuid,text)',
    'platform_admin_unblock_user(uuid,text)',
    'platform_admin_hide_offer(text,text)',
    'platform_admin_release_offer(text,text)',
    'platform_offer_activity_guard()',
    'platform_reservation_activity_guard()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', v_signature);
  END LOOP;
END;
$revoke_functions$;

COMMENT ON TABLE public.platform_incidents IS
  'BOD03A PROD: human-reviewed damage/loss/fraud/problem-user cases only; DSA/GDPR/return remain separate registers. No client API access.';
COMMENT ON TABLE public.platform_admin_actions IS
  'BOD03A PROD: SQL Editor moderation actions, with mandatory reason. Actor is the designated Supabase Owner, but DB session alone does not prove human identity.';
COMMIT;
