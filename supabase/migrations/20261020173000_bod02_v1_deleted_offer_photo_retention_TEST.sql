-- Rentulo V1 / BOD02 / TEST ONLY: deleted-offer photo Storage cleanup queue.
-- INSTALLATION IS INERT: approval gate defaults OFF, no DELETE/UPDATE of offers.
-- Actual Storage deletion is performed by the separate locked-down TEST Edge
-- worker using service_role. Existing account-deactivation flow unchanged.
BEGIN;
DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name='rentulo_project_url'
      AND btrim(s.decrypted_secret,'/')='https://vspposovhdgvbeukoivh.supabase.co')
    OR to_regclass('public.gdpr_legal_holds') IS NULL
    OR to_regprocedure('public.gdpr_has_reservation_legal_hold(uuid)') IS NULL
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='offers' AND column_name='gdpr_deleted_at')
  THEN RAISE EXCEPTION 'BOD02 photo cleanup is TEST-only; prerequisites missing'; END IF;
END;
$preflight$;

CREATE TABLE IF NOT EXISTS public.gdpr_photo_cleanup_gate (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  is_enabled boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  approval_reference text,
  CHECK(NOT is_enabled OR (approved_at IS NOT NULL
    AND char_length(btrim(coalesce(approval_reference,''))) >= 12))
);
INSERT INTO public.gdpr_photo_cleanup_gate(singleton,is_enabled)
VALUES(true,false) ON CONFLICT(singleton) DO NOTHING;
DO $guard$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.gdpr_photo_cleanup_gate
                WHERE singleton AND is_enabled=false)
  THEN RAISE EXCEPTION 'Photo cleanup approval gate unexpectedly enabled'; END IF;
END;
$guard$;

CREATE TABLE IF NOT EXISTS public.gdpr_photo_cleanup_jobs (
  offer_id uuid PRIMARY KEY REFERENCES public.offers(id) ON DELETE RESTRICT,
  storage_path text NOT NULL,
  original_photo_url text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','retry','done','blocked')),
  attempts smallint NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 10),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error_code text CHECK(last_error_code IS NULL OR length(last_error_code)<=48),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gdpr_photo_cleanup_pending_idx
  ON public.gdpr_photo_cleanup_jobs(next_attempt_at)
  WHERE status IN ('queued','processing','retry');

ALTER TABLE public.gdpr_photo_cleanup_gate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gdpr_photo_cleanup_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gdpr_photo_cleanup_gate, public.gdpr_photo_cleanup_jobs
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gdpr_photo_cleanup_gate, public.gdpr_photo_cleanup_jobs
  TO service_role;

-- Always-fail-closed candidate predicate: trusted deletion >=30 days,
-- all related reservations demonstrably closed for >=30 days,
-- only fully settled paid reservations (no refund) if any,
-- no return incident, no open debt, no legal hold or shared photo URL.
-- Historical offers with unresolved financial evidence require manual review.
CREATE OR REPLACE FUNCTION public.gdpr_photo_is_safe_to_remove(p_offer_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
SELECT EXISTS (
  SELECT 1 FROM public.offers o
  WHERE o.id=p_offer_id AND o.status::text='deleted'
    AND o.gdpr_deleted_at <= now()-interval '30 days'
    AND o.photo_url LIKE
      'https://vspposovhdgvbeukoivh.supabase.co/storage/v1/object/public/offer-photos/' || o.owner_id::text || '/%'
    AND split_part(o.photo_url,'/storage/v1/object/public/offer-photos/',2)
      ~ '^[0-9a-f-]{36}/[0-9]{13,16}-offer[.]jpg$'
    AND NOT EXISTS (SELECT 1 FROM public.offers other
      WHERE other.id<>o.id AND other.photo_url=o.photo_url)
    AND NOT EXISTS (SELECT 1 FROM public.reservation_return_incidents i
      JOIN public.reservations r ON r.id=i.reservation_id WHERE r.offer_id=o.id)
    AND NOT EXISTS (SELECT 1 FROM public.owner_cancellation_debts d
      JOIN public.reservation_cancellations c ON c.id=d.cancellation_id
      JOIN public.reservations r ON r.id=c.reservation_id
      WHERE r.offer_id=o.id AND d.status='open')
    AND NOT EXISTS (SELECT 1 FROM public.gdpr_legal_holds h
      WHERE h.released_at IS NULL AND
        (h.offer_id=o.id OR h.user_id=o.owner_id))
    AND NOT EXISTS (SELECT 1 FROM public.reservations r
      WHERE r.offer_id=o.id AND (
        public.gdpr_has_reservation_legal_hold(r.id)
        OR EXISTS (SELECT 1 FROM public.reservation_cancellations c
          WHERE c.reservation_id=r.id AND c.cancellation_kind='paid_refund')
        OR EXISTS (SELECT 1 FROM public.payments p WHERE p.reservation_id=r.id
          AND (p.status IS DISTINCT FROM 'paid'
            OR p.transfer_status IS DISTINCT FROM 'succeeded'
            OR p.refund_status IS DISTINCT FROM 'not_requested'))
        OR (CASE
          WHEN r.status::text IN ('cancelled','rejected') THEN r.gdpr_closed_at
          WHEN r.status::text='expired' THEN r.expired_at
          WHEN r.status::text IN ('returned','no_show') THEN r.gdpr_finalized_at
          ELSE NULL::timestamptz END
        ) IS NULL
        OR (CASE
          WHEN r.status::text IN ('cancelled','rejected') THEN r.gdpr_closed_at
          WHEN r.status::text='expired' THEN r.expired_at
          WHEN r.status::text IN ('returned','no_show') THEN r.gdpr_finalized_at
          ELSE NULL::timestamptz END
        ) > now()-interval '30 days'
      ))
);
$function$;
REVOKE ALL ON FUNCTION public.gdpr_photo_is_safe_to_remove(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gdpr_photo_is_safe_to_remove(uuid)
  TO service_role;

-- Read-only candidate count; does not require enabling any gate.
CREATE OR REPLACE FUNCTION public.gdpr_preview_deleted_offer_photos()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_count bigint;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' AND session_user<>'postgres'
    THEN RAISE EXCEPTION 'Trusted backend required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets
    WHERE name='rentulo_project_url'
      AND btrim(decrypted_secret,'/')='https://vspposovhdgvbeukoivh.supabase.co')
    THEN RAISE EXCEPTION 'TEST-only'; END IF;
  SELECT count(*) INTO v_count FROM public.offers o
    WHERE o.status::text='deleted' AND o.gdpr_deleted_at <= now()-interval '30 days'
      AND public.gdpr_photo_is_safe_to_remove(o.id);
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.gdpr_preview_deleted_offer_photos()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gdpr_preview_deleted_offer_photos() TO service_role;

-- Claim one Storage path via service-role only, after separate operator
-- approval. No direct browser access; repeated calls can safely retry.
CREATE OR REPLACE FUNCTION public.gdpr_claim_deleted_offer_photo()
RETURNS TABLE(offer_id uuid, storage_path text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_job record;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' AND session_user<>'postgres'
    THEN RAISE EXCEPTION 'Trusted backend required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets
    WHERE name='rentulo_project_url'
      AND btrim(decrypted_secret,'/')='https://vspposovhdgvbeukoivh.supabase.co')
    THEN RAISE EXCEPTION 'TEST-only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gdpr_photo_cleanup_gate g
    WHERE g.singleton AND g.is_enabled AND g.approved_at IS NOT NULL
      AND length(btrim(coalesce(g.approval_reference,'')))>=12)
    THEN RETURN; END IF;

  PERFORM pg_advisory_xact_lock(860808,20261020);
  INSERT INTO public.gdpr_photo_cleanup_jobs(offer_id,storage_path,original_photo_url)
  SELECT o.id,
    split_part(o.photo_url,'/storage/v1/object/public/offer-photos/',2),
    o.photo_url
  FROM public.offers o
  WHERE o.status::text='deleted'
    AND o.gdpr_deleted_at <= now()-interval '30 days'
    AND public.gdpr_photo_is_safe_to_remove(o.id)
  ORDER BY o.gdpr_deleted_at LIMIT 50
  ON CONFLICT(offer_id) DO NOTHING;

  SELECT j.offer_id,j.storage_path INTO v_job
  FROM public.gdpr_photo_cleanup_jobs j
  JOIN public.offers o ON o.id=j.offer_id
  WHERE (j.status IN ('queued','retry') OR
         (j.status='processing' AND j.claimed_at<now()-interval '30 minutes'))
    AND j.attempts<10 AND j.next_attempt_at<=now()
    AND o.photo_url=j.original_photo_url
    AND public.gdpr_photo_is_safe_to_remove(o.id)
  ORDER BY j.created_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.gdpr_photo_cleanup_jobs j SET
    status='processing',claimed_at=now(),attempts=attempts+1
  WHERE j.offer_id=v_job.offer_id;
  RETURN QUERY SELECT v_job.offer_id::uuid,v_job.storage_path::text;
END;
$function$;
REVOKE ALL ON FUNCTION public.gdpr_claim_deleted_offer_photo()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gdpr_claim_deleted_offer_photo()
  TO service_role;

-- Revalidate immediately before calling Supabase Storage. The worker cannot
-- choose a URL or path; it may use only the currently claimed DB snapshot.
CREATE OR REPLACE FUNCTION public.gdpr_revalidate_deleted_offer_photo(
  p_offer_id uuid, p_storage_path text
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_ok boolean;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' AND session_user<>'postgres'
    THEN RAISE EXCEPTION 'Trusted backend required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets
    WHERE name='rentulo_project_url'
      AND btrim(decrypted_secret,'/')='https://vspposovhdgvbeukoivh.supabase.co')
    THEN RAISE EXCEPTION 'TEST-only'; END IF;
  PERFORM pg_advisory_xact_lock(860808,20261020);
  SELECT EXISTS (
    SELECT 1 FROM public.gdpr_photo_cleanup_jobs j
    JOIN public.offers o ON o.id=j.offer_id
    JOIN public.gdpr_photo_cleanup_gate g ON g.singleton=true
    WHERE j.offer_id=p_offer_id AND j.storage_path=p_storage_path
      AND j.status='processing' AND j.claimed_at IS NOT NULL
      AND j.attempts BETWEEN 1 AND 10
      AND o.photo_url=j.original_photo_url
      AND g.is_enabled AND g.approved_at IS NOT NULL
      AND length(btrim(coalesce(g.approval_reference,'')))>=12
      AND public.gdpr_photo_is_safe_to_remove(o.id)
  ) INTO v_ok;
  RETURN v_ok;
END;
$function$;
REVOKE ALL ON FUNCTION public.gdpr_revalidate_deleted_offer_photo(uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gdpr_revalidate_deleted_offer_photo(uuid,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.gdpr_finish_deleted_offer_photo(
  p_offer_id uuid, p_storage_path text, p_success boolean DEFAULT false
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_job public.gdpr_photo_cleanup_jobs%rowtype;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' AND session_user<>'postgres'
    THEN RAISE EXCEPTION 'Trusted backend required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets
    WHERE name='rentulo_project_url'
      AND btrim(decrypted_secret,'/')='https://vspposovhdgvbeukoivh.supabase.co')
    THEN RAISE EXCEPTION 'TEST-only'; END IF;
  PERFORM pg_advisory_xact_lock(860808,20261020);
  SELECT * INTO v_job FROM public.gdpr_photo_cleanup_jobs j
    WHERE j.offer_id=p_offer_id FOR UPDATE;
  IF NOT FOUND OR v_job.status<>'processing' OR
      v_job.storage_path IS DISTINCT FROM p_storage_path THEN
    RETURN false;
  END IF;
  IF p_success THEN
    IF NOT EXISTS(SELECT 1 FROM public.gdpr_photo_cleanup_gate g
      WHERE g.singleton AND g.is_enabled AND g.approved_at IS NOT NULL
        AND length(btrim(coalesce(g.approval_reference,'')))>=12)
      OR NOT public.gdpr_photo_is_safe_to_remove(p_offer_id) THEN
      UPDATE public.gdpr_photo_cleanup_jobs j
        SET status='blocked',last_error_code='RECHECK_FAILED'
      WHERE j.offer_id=p_offer_id;
      RETURN false;
    END IF;
    -- Only clear the URL of the same *still deleted* offer. Even when storage
    -- deletion succeeded, never change an active offer in a race condition.
    UPDATE public.offers o SET photo_url=''
    WHERE o.id=p_offer_id AND o.status::text='deleted'
      AND o.photo_url=v_job.original_photo_url;
    IF NOT FOUND THEN
      UPDATE public.gdpr_photo_cleanup_jobs j
        SET status='blocked',last_error_code='OFFER_CHANGED'
      WHERE j.offer_id=p_offer_id;
      RETURN false;
    END IF;
    UPDATE public.gdpr_photo_cleanup_jobs j
      SET status='done',completed_at=now(),last_error_code=NULL
    WHERE j.offer_id=p_offer_id;
    RETURN true;
  END IF;
  UPDATE public.gdpr_photo_cleanup_jobs j
    SET status=CASE WHEN attempts>=10 THEN 'blocked' ELSE 'retry' END,
        next_attempt_at=now()+interval '1 hour',last_error_code='STORAGE_REMOVE_ERROR'
  WHERE j.offer_id=p_offer_id;
  RETURN false;
END;
$function$;
REVOKE ALL ON FUNCTION public.gdpr_finish_deleted_offer_photo(uuid,text,boolean)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gdpr_finish_deleted_offer_photo(uuid,text,boolean)
  TO service_role;

COMMENT ON FUNCTION public.gdpr_claim_deleted_offer_photo() IS
  'TEST-only, inactive while photo gate OFF. Claims limited, settled, no-hold unneeded photo candidates; actual Storage deletion via separately secured Edge worker.';
COMMIT;
