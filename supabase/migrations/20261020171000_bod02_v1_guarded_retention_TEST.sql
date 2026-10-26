-- RENTULO V1 / BOD02 / TEST ONLY / GDPR retention engine.
-- Installs locked-off controls and dry-run previews. It DOES NOT delete rows
-- when installed. The cron stays inert unless a separately authorized, tested
-- retention gate is explicitly enabled by a privileged operator.
-- Financial transactions, Stripe event identifiers, booking history,
-- live offers, photos, reviews and legal-hold evidence are never deleted here.
BEGIN;
DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name='rentulo_project_url'
      AND btrim(s.decrypted_secret,'/')='https://vspposovhdgvbeukoivh.supabase.co'
  ) THEN
    RAISE EXCEPTION 'BOD02 retention migration is TEST-only';
  END IF;
  IF to_regclass('public.notifications') IS NULL
     OR to_regclass('public.reservations') IS NULL
     OR to_regclass('public.payments') IS NULL
     OR to_regclass('public.reservation_return_incidents') IS NULL
     OR to_regclass('public.gdpr_reservation_contact_cleanup_gate') IS NULL
     OR to_regclass('public.gdpr_legal_holds') IS NULL
     OR to_regclass('public.gdpr_terms_acceptances') IS NULL
     OR to_regclass('public.gdpr_subject_requests') IS NULL
     OR to_regclass('public.reservation_notification_deliveries') IS NULL
     OR to_regclass('public.reservation_email_deliveries') IS NULL
     OR to_regclass('public.reservation_notification_monitor_alerts') IS NULL
     OR to_regclass('public.reservation_pickup_security') IS NULL
     OR to_regclass('public.stripe_webhook_events') IS NULL
  THEN
    RAISE EXCEPTION 'Compliance registers / retention dependencies are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.gdpr_reservation_contact_cleanup_gate
    WHERE singleton AND NOT is_enabled
  ) THEN
    RAISE EXCEPTION 'Existing reservation scrub gate must be OFF';
  END IF;
END;
$preflight$;

CREATE TABLE IF NOT EXISTS public.gdpr_retention_execution_gate (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  is_enabled boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  approval_reference text,
  last_run_at timestamptz,
  CHECK (NOT is_enabled OR
    (approved_at IS NOT NULL AND length(btrim(coalesce(approval_reference,'')))>=12))
);
INSERT INTO public.gdpr_retention_execution_gate(singleton,is_enabled)
VALUES(true,false) ON CONFLICT(singleton) DO NOTHING;
DO $ensure_off$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.gdpr_retention_execution_gate
                 WHERE singleton AND is_enabled=false) THEN
    RAISE EXCEPTION 'Refusing to alter previously enabled retention gate';
  END IF;
END;
$ensure_off$;
ALTER TABLE public.gdpr_retention_execution_gate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gdpr_retention_execution_gate FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gdpr_retention_execution_gate TO service_role;

-- Independent approval for EACH of the seven technical cleanup classes.
-- The global gate alone can never enable all classes at once.
CREATE TABLE IF NOT EXISTS public.gdpr_retention_category_approvals (
  category text PRIMARY KEY CHECK (category IN (
    'ordinary_notifications','expired_pin_attempts',
    'unneeded_legacy_email_addresses','resolved_delivery_errors',
    'old_delivery_provider_ids','old_stripe_error_text',
    'resolved_monitor_alerts'
  )),
  is_enabled boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  approval_reference text,
  CHECK (NOT is_enabled OR (approved_at IS NOT NULL
    AND length(btrim(coalesce(approval_reference,''))) >= 12))
);
INSERT INTO public.gdpr_retention_category_approvals(category,is_enabled)
VALUES
 ('ordinary_notifications',false),
 ('expired_pin_attempts',false),
 ('unneeded_legacy_email_addresses',false),
 ('resolved_delivery_errors',false),
 ('old_delivery_provider_ids',false),
 ('old_stripe_error_text',false),
 ('resolved_monitor_alerts',false)
ON CONFLICT(category) DO NOTHING;
DO $ensure_categories_off$
BEGIN
  IF EXISTS(SELECT 1 FROM public.gdpr_retention_category_approvals
    WHERE is_enabled) OR
    (SELECT count(*) FROM public.gdpr_retention_category_approvals)<>7 THEN
    RAISE EXCEPTION 'Unexpected existing retention category approval; stop';
  END IF;
END;
$ensure_categories_off$;
ALTER TABLE public.gdpr_retention_category_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gdpr_retention_category_approvals
  FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.gdpr_retention_category_approvals TO service_role;

CREATE TABLE IF NOT EXISTS public.gdpr_retention_run_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ran_at timestamptz NOT NULL DEFAULT now(),
  dry_run boolean NOT NULL,
  category text NOT NULL,
  eligible_count bigint NOT NULL CHECK(eligible_count >= 0),
  applied_count bigint NOT NULL DEFAULT 0 CHECK(applied_count >= 0)
);
ALTER TABLE public.gdpr_retention_run_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gdpr_retention_run_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gdpr_retention_run_log TO service_role;

-- Common legal-hold predicate: reservations are protected by any active hold
-- on themselves, their offer or either participant.
CREATE OR REPLACE FUNCTION public.gdpr_has_reservation_legal_hold(p_reservation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
 SELECT EXISTS (
   SELECT 1 FROM public.reservations r JOIN public.gdpr_legal_holds h
   ON h.released_at IS NULL AND (
     h.reservation_id = r.id OR h.offer_id = r.offer_id
     OR h.user_id IN (r.owner_id,r.renter_id)
   ) WHERE r.id = p_reservation_id
 );
$function$;
REVOKE ALL ON FUNCTION public.gdpr_has_reservation_legal_hold(uuid)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gdpr_has_reservation_legal_hold(uuid) TO service_role;

-- Returns a fixed row per category; no personal values, only counts.
-- p_apply=false is always safe read-only. p_apply=true additionally requires
-- explicit approval AND refuses any non-TEST environment. Run via SQL Editor
-- or trusted service role only; never expose to browser roles.
CREATE OR REPLACE FUNCTION public.gdpr_retention_maintenance(p_apply boolean DEFAULT false)
RETURNS TABLE(category text, eligible_count bigint, applied_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
 v_eligible bigint;
 v_applied bigint;
 v_enabled boolean;
 v_now timestamptz := now();
BEGIN
 IF coalesce(auth.role(),'') <> 'service_role' AND session_user <> 'postgres' THEN
   RAISE EXCEPTION 'Trusted backend required' USING errcode='42501';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM vault.decrypted_secrets s WHERE s.name='rentulo_project_url'
   AND btrim(s.decrypted_secret,'/')='https://vspposovhdgvbeukoivh.supabase.co'
 ) THEN
   RAISE EXCEPTION 'GDPR retention is TEST-only';
 END IF;
 IF p_apply THEN
   SELECT g.is_enabled INTO v_enabled FROM public.gdpr_retention_execution_gate g WHERE g.singleton FOR UPDATE;
   IF NOT coalesce(v_enabled,false) THEN
     RAISE EXCEPTION 'Retention execution gate disabled; run preview first';
   END IF;
   PERFORM pg_advisory_xact_lock(860808, 20261020);
 END IF;

 -- Ordinary in-app notifications; a legal/paid reservation's evidence is
 -- intentionally excluded. Financial records are never removed.
 SELECT count(*) INTO v_eligible FROM public.notifications n
 LEFT JOIN public.reservations r ON r.id=n.related_reservation_id
 WHERE n.created_at <= v_now-interval '90 days'
   AND (r.id IS NULL OR (
      r.status::text IN ('cancelled','expired','rejected','returned','no_show')
      AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.reservation_id=r.id)
      AND NOT EXISTS (SELECT 1 FROM public.reservation_return_incidents i WHERE i.reservation_id=r.id)
   ))
   AND NOT EXISTS (SELECT 1 FROM public.gdpr_legal_holds h
     WHERE h.released_at IS NULL AND (h.user_id=n.user_id
       OR h.offer_id=n.related_offer_id OR h.reservation_id=n.related_reservation_id))
   AND (r.id IS NULL OR NOT public.gdpr_has_reservation_legal_hold(r.id));
 v_applied := 0;
 IF p_apply AND EXISTS (
   SELECT 1 FROM public.gdpr_retention_category_approvals a
   WHERE a.category='ordinary_notifications' AND a.is_enabled
     AND a.approved_at IS NOT NULL
     AND length(btrim(coalesce(a.approval_reference,'')))>=12
 ) THEN
   DELETE FROM public.notifications n WHERE n.created_at<=v_now-interval '90 days'
     AND (n.related_reservation_id IS NULL OR EXISTS (
       SELECT 1 FROM public.reservations r WHERE r.id=n.related_reservation_id
       AND r.status::text IN ('cancelled','expired','rejected','returned','no_show')
       AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.reservation_id=r.id)
       AND NOT EXISTS (SELECT 1 FROM public.reservation_return_incidents i WHERE i.reservation_id=r.id)
       AND NOT public.gdpr_has_reservation_legal_hold(r.id)
     ))
     AND NOT EXISTS (SELECT 1 FROM public.gdpr_legal_holds h
       WHERE h.released_at IS NULL AND (h.user_id=n.user_id
       OR h.offer_id=n.related_offer_id OR h.reservation_id=n.related_reservation_id));
   GET DIAGNOSTICS v_applied=ROW_COUNT;
 END IF;
 RETURN QUERY SELECT 'ordinary_notifications'::text,v_eligible,v_applied;
 IF p_apply THEN
   INSERT INTO public.gdpr_retention_run_log(dry_run,category,eligible_count,applied_count)
   VALUES(false,'ordinary_notifications',v_eligible,v_applied);
 END IF;

 -- PIN security: discard only failed counters + elapsed lock, NEVER the
 -- confirmed_at transfer proof. Final status must have trustworthy timestamp.
 SELECT count(*) INTO v_eligible FROM public.reservation_pickup_security sec
 JOIN public.reservations r ON r.id=sec.reservation_id
 WHERE (sec.failed_attempts <> 0 OR sec.locked_until IS NOT NULL)
   AND (CASE
       WHEN r.status::text IN ('cancelled','rejected') THEN r.gdpr_closed_at
       WHEN r.status::text='expired' THEN r.expired_at
       WHEN r.status::text IN ('returned','no_show') THEN r.gdpr_finalized_at
       ELSE NULL::timestamptz END) <= v_now-interval '30 days'
   AND NOT public.gdpr_has_reservation_legal_hold(r.id);
 v_applied:=0;
 IF p_apply AND EXISTS (
   SELECT 1 FROM public.gdpr_retention_category_approvals a
   WHERE a.category='expired_pin_attempts' AND a.is_enabled
     AND a.approved_at IS NOT NULL
     AND length(btrim(coalesce(a.approval_reference,'')))>=12
 ) THEN
   UPDATE public.reservation_pickup_security sec
   SET failed_attempts=0,locked_until=NULL,updated_at=v_now
   FROM public.reservations r
   WHERE r.id=sec.reservation_id
     AND (sec.failed_attempts<>0 OR sec.locked_until IS NOT NULL)
     AND (CASE
       WHEN r.status::text IN ('cancelled','rejected') THEN r.gdpr_closed_at
       WHEN r.status::text='expired' THEN r.expired_at
       WHEN r.status::text IN ('returned','no_show') THEN r.gdpr_finalized_at
       ELSE NULL::timestamptz END) <= v_now-interval '30 days'
     AND NOT public.gdpr_has_reservation_legal_hold(r.id);
   GET DIAGNOSTICS v_applied=ROW_COUNT;
 END IF;
 RETURN QUERY SELECT 'expired_pin_attempts'::text,v_eligible,v_applied;
 IF p_apply THEN
   INSERT INTO public.gdpr_retention_run_log(dry_run,category,eligible_count,applied_count)
   VALUES(false,'expired_pin_attempts',v_eligible,v_applied);
 END IF;

 -- Old email address snapshots for non-paid closed reservations only. The
 -- recipient/email *row* remains as deduplication and event evidence.
 SELECT count(*) INTO v_eligible FROM public.reservation_email_deliveries d
 JOIN public.reservations r ON r.id=d.reservation_id
 WHERE d.status='sent'
   AND length(btrim(coalesce(d.recipient_email,'')))>0
   AND (CASE
     WHEN r.status::text IN ('cancelled','rejected') THEN r.gdpr_closed_at
     WHEN r.status::text='expired' THEN r.expired_at
     WHEN r.status::text IN ('returned','no_show') THEN r.gdpr_finalized_at
     ELSE NULL::timestamptz END) <= v_now-interval '90 days'
   AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.reservation_id=r.id)
   AND NOT EXISTS (SELECT 1 FROM public.reservation_return_incidents i WHERE i.reservation_id=r.id)
   AND NOT public.gdpr_has_reservation_legal_hold(r.id);
 v_applied:=0;
 IF p_apply AND EXISTS (
   SELECT 1 FROM public.gdpr_retention_category_approvals a
   WHERE a.category='unneeded_legacy_email_addresses' AND a.is_enabled
     AND a.approved_at IS NOT NULL
     AND length(btrim(coalesce(a.approval_reference,'')))>=12
 ) THEN
   UPDATE public.reservation_email_deliveries d SET recipient_email=''
   FROM public.reservations r WHERE r.id=d.reservation_id
     AND d.status='sent'
     AND length(btrim(coalesce(d.recipient_email,'')))>0
     AND (CASE
       WHEN r.status::text IN ('cancelled','rejected') THEN r.gdpr_closed_at
       WHEN r.status::text='expired' THEN r.expired_at
       WHEN r.status::text IN ('returned','no_show') THEN r.gdpr_finalized_at
       ELSE NULL::timestamptz END) <= v_now-interval '90 days'
     AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.reservation_id=r.id)
     AND NOT EXISTS (SELECT 1 FROM public.reservation_return_incidents i WHERE i.reservation_id=r.id)
     AND NOT public.gdpr_has_reservation_legal_hold(r.id);
   GET DIAGNOSTICS v_applied=ROW_COUNT;
 END IF;
 RETURN QUERY SELECT 'unneeded_legacy_email_addresses'::text,v_eligible,v_applied;
 IF p_apply THEN
   INSERT INTO public.gdpr_retention_run_log(dry_run,category,eligible_count,applied_count)
   VALUES(false,'unneeded_legacy_email_addresses',v_eligible,v_applied);
 END IF;

 -- Only resolved, ordinary outbox error strings. Do not delete rows with
 -- unique notification keys or an unresolved/dead/retry status.
 SELECT count(*) INTO v_eligible FROM public.reservation_notification_deliveries d
 WHERE d.status IN ('sent','simulated','skipped')
   AND d.last_error IS NOT NULL
   AND coalesce(d.sent_at,d.updated_at) <= v_now-interval '90 days'
   AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.reservation_id=d.reservation_id)
   AND NOT public.gdpr_has_reservation_legal_hold(d.reservation_id);
 v_applied:=0;
 IF p_apply AND EXISTS (
   SELECT 1 FROM public.gdpr_retention_category_approvals a
   WHERE a.category='resolved_delivery_errors' AND a.is_enabled
     AND a.approved_at IS NOT NULL
     AND length(btrim(coalesce(a.approval_reference,'')))>=12
 ) THEN
   UPDATE public.reservation_notification_deliveries d SET last_error=NULL
   WHERE d.status IN ('sent','simulated','skipped') AND d.last_error IS NOT NULL
     AND coalesce(d.sent_at,d.updated_at) <= v_now-interval '90 days'
     AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.reservation_id=d.reservation_id)
     AND NOT public.gdpr_has_reservation_legal_hold(d.reservation_id);
   GET DIAGNOSTICS v_applied=ROW_COUNT;
 END IF;
 RETURN QUERY SELECT 'resolved_delivery_errors'::text,v_eligible,v_applied;
 IF p_apply THEN
   INSERT INTO public.gdpr_retention_run_log(dry_run,category,eligible_count,applied_count)
   VALUES(false,'resolved_delivery_errors',v_eligible,v_applied);
 END IF;

 SELECT count(*) INTO v_eligible FROM public.reservation_notification_deliveries d
 WHERE d.status IN ('sent','simulated','skipped')
   AND d.provider_message_id IS NOT NULL
   AND coalesce(d.sent_at,d.updated_at) <= v_now-interval '12 months'
   AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.reservation_id=d.reservation_id)
   AND NOT public.gdpr_has_reservation_legal_hold(d.reservation_id);
 v_applied:=0;
 IF p_apply AND EXISTS (
   SELECT 1 FROM public.gdpr_retention_category_approvals a
   WHERE a.category='old_delivery_provider_ids' AND a.is_enabled
     AND a.approved_at IS NOT NULL
     AND length(btrim(coalesce(a.approval_reference,'')))>=12
 ) THEN
   UPDATE public.reservation_notification_deliveries d SET provider_message_id=NULL
   WHERE d.status IN ('sent','simulated','skipped') AND d.provider_message_id IS NOT NULL
     AND coalesce(d.sent_at,d.updated_at) <= v_now-interval '12 months'
     AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.reservation_id=d.reservation_id)
     AND NOT public.gdpr_has_reservation_legal_hold(d.reservation_id);
   GET DIAGNOSTICS v_applied=ROW_COUNT;
 END IF;
 RETURN QUERY SELECT 'old_delivery_provider_ids'::text,v_eligible,v_applied;
 IF p_apply THEN
   INSERT INTO public.gdpr_retention_run_log(dry_run,category,eligible_count,applied_count)
   VALUES(false,'old_delivery_provider_ids',v_eligible,v_applied);
 END IF;

 -- Stripe event ID and financial linkage must be preserved indefinitely here
 -- for idempotency. Remove only unnecessary error text on finalized events.
 SELECT count(*) INTO v_eligible FROM public.stripe_webhook_events e
 WHERE e.processing_status IN ('processed','ignored')
   AND e.last_error IS NOT NULL
   AND coalesce(e.processed_at,e.received_at) <= v_now-interval '180 days'
   AND e.event_type NOT ILIKE '%dispute%'
   AND (e.reservation_id IS NULL OR NOT public.gdpr_has_reservation_legal_hold(e.reservation_id));
 v_applied:=0;
 IF p_apply AND EXISTS (
   SELECT 1 FROM public.gdpr_retention_category_approvals a
   WHERE a.category='old_stripe_error_text' AND a.is_enabled
     AND a.approved_at IS NOT NULL
     AND length(btrim(coalesce(a.approval_reference,'')))>=12
 ) THEN
   UPDATE public.stripe_webhook_events e SET last_error=NULL
   WHERE e.processing_status IN ('processed','ignored') AND e.last_error IS NOT NULL
     AND coalesce(e.processed_at,e.received_at)<=v_now-interval '180 days'
     AND e.event_type NOT ILIKE '%dispute%'
     AND (e.reservation_id IS NULL OR NOT public.gdpr_has_reservation_legal_hold(e.reservation_id));
   GET DIAGNOSTICS v_applied=ROW_COUNT;
 END IF;
 RETURN QUERY SELECT 'old_stripe_error_text'::text,v_eligible,v_applied;
 IF p_apply THEN
   INSERT INTO public.gdpr_retention_run_log(dry_run,category,eligible_count,applied_count)
   VALUES(false,'old_stripe_error_text',v_eligible,v_applied);
 END IF;

 -- Resolved monitoring events only. Active alarms MUST stay in the database.
 SELECT count(*) INTO v_eligible FROM public.reservation_notification_monitor_alerts a
 WHERE NOT a.active AND a.resolved_at <= v_now-interval '90 days';
 v_applied:=0;
 IF p_apply AND EXISTS (
   SELECT 1 FROM public.gdpr_retention_category_approvals a
   WHERE a.category='resolved_monitor_alerts' AND a.is_enabled
     AND a.approved_at IS NOT NULL
     AND length(btrim(coalesce(a.approval_reference,'')))>=12
 ) THEN
   DELETE FROM public.reservation_notification_monitor_alerts a
   WHERE NOT a.active AND a.resolved_at<=v_now-interval '90 days';
   GET DIAGNOSTICS v_applied=ROW_COUNT;
 END IF;
 RETURN QUERY SELECT 'resolved_monitor_alerts'::text,v_eligible,v_applied;
 IF p_apply THEN
   INSERT INTO public.gdpr_retention_run_log(dry_run,category,eligible_count,applied_count)
   VALUES(false,'resolved_monitor_alerts',v_eligible,v_applied);
 END IF;

 -- A signed-off retention run reports aggregate counts only, and never logs
 -- personal values. Dry-run does not insert any log rows or alter state.
 IF p_apply THEN
   UPDATE public.gdpr_retention_execution_gate SET last_run_at=v_now WHERE singleton;
 END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.gdpr_retention_maintenance(boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gdpr_retention_maintenance(boolean) TO service_role;

-- Cron entry point is a NO-OP while the explicit gate is disabled; do
-- not flood cron logs with errors. The actual maintenance call is still
-- protected by the independent TEST project identity assertion.
CREATE OR REPLACE FUNCTION public.gdpr_retention_daily_if_enabled()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.gdpr_retention_execution_gate g
             WHERE g.singleton=true AND g.is_enabled=true)
     AND EXISTS (SELECT 1 FROM public.gdpr_retention_category_approvals a
       WHERE a.is_enabled=true AND a.approved_at IS NOT NULL
         AND length(btrim(coalesce(a.approval_reference,'')))>=12) THEN
    PERFORM 1 FROM public.gdpr_retention_maintenance(true);
    RETURN true;
  END IF;
  RETURN false;
END;
$function$;
REVOKE ALL ON FUNCTION public.gdpr_retention_daily_if_enabled()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gdpr_retention_daily_if_enabled() TO service_role;

-- Schedule only in TEST. Engine remains intentionally INERT while gate OFF;
-- it cannot erase anything merely because this SQL has been installed.
DO $schedule$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE EXCEPTION 'pg_cron prerequisite missing; do not install partially';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'rentulo-bod02-gdpr-retention-daily-TEST'
  ) THEN
  PERFORM cron.schedule(
    'rentulo-bod02-gdpr-retention-daily-TEST',
    '35 3 * * *',
    'SELECT public.gdpr_retention_daily_if_enabled()'
  );
  END IF;
END;
$schedule$;

COMMENT ON FUNCTION public.gdpr_retention_maintenance(boolean) IS
  'TEST-only. Dry-run by default. Apply requires explicit signed-off gate; retains financial/Stripe event IDs, history, legal holds and untrusted historic rows.';
COMMIT;
