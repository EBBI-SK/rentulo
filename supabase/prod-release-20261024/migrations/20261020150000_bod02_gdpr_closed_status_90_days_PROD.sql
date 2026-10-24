-- RENTULO V1 / PROD RELEASE CANDIDATE bd1b8d1 / 2026-10-24.
-- Apply only to a verified PROD database after backup and approval.
-- This SQL is staged separately: never copy over TEST migrations.
-- Cron activation is deferred; no automatic deployment is authorized.

-- RENTULO V1 / BOD02 / PROD ONLY / GDPR 90-day retention fence.
-- Installation is metadata/functions/triggers only; NO historical row UPDATE.
-- Existing gdpr_reservation_contact_cleanup_gate stays DISABLED.
-- Old cancelled/rejected rows without authenticated event timestamps stay
-- permanently ineligible for automatic cleanup (no guessed backfill).
-- Existing expired_at remains the only trusted anchor for expired status.
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
DECLARE
  v_current_rpc text;
  v_current_immutable text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name = 'rentulo_prod_release_target'
      AND btrim(s.decrypted_secret, '/') =
          'tfvgxrdjrpicgtvovehl'
  ) THEN
    RAISE EXCEPTION 'GDPR 90-day fence is PROD-only';
  END IF;

  IF to_regclass('public.gdpr_reservation_contact_cleanup_gate') IS NULL
     OR to_regclass('public.reservation_return_incidents') IS NULL
     OR to_regclass('public.reservation_email_deliveries') IS NULL
     OR to_regclass('public.payments') IS NULL
     OR to_regclass('public.reservation_cancellations') IS NULL
     OR to_regprocedure('public.gdpr_review_deactivated_renter_contacts(uuid,boolean)') IS NULL
  THEN
    RAISE EXCEPTION 'BOD02 GDPR prerequisite missing in PROD; stop before installation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.gdpr_reservation_contact_cleanup_gate g
    WHERE g.singleton = true AND g.is_enabled = false
  ) THEN
    RAISE EXCEPTION 'GDPR cleanup gate must remain disabled for migration';
  END IF;

  -- Refuse to overwrite a later, unreviewed version of the existing RPC.
  v_current_rpc := lower(pg_get_functiondef(
    'public.gdpr_review_deactivated_renter_contacts(uuid,boolean)'::regprocedure
  ));
  IF position('v_eligible' IN v_current_rpc) = 0
     OR position('v_with_payments' IN v_current_rpc) = 0
     OR position('v_legacy_emails' IN v_current_rpc) = 0
     OR position('v_enabled' IN v_current_rpc) = 0
     OR position('app.gdpr_reservation_scrub_authorized' IN v_current_rpc) = 0
     OR position('retention policy has not been approved' IN v_current_rpc) = 0
     OR position('reservation_return_incidents' IN v_current_rpc) = 0
  THEN
    RAISE EXCEPTION 'Unexpected GDPR cleanup RPC in PROD; manual review required';
  END IF;

  v_current_immutable := lower(pg_get_functiondef(
    'public.protect_reservation_immutable_fields()'::regprocedure
  ));
  IF position('v_gdpr_contact_scrub_authorized' IN v_current_immutable) = 0
     OR position('gdpr_reservation_contact_cleanup_gate' IN v_current_immutable) = 0
     OR position('new.renter_email is distinct from old.renter_email' IN v_current_immutable) = 0
  THEN
    RAISE EXCEPTION 'Unexpected immutability protection in PROD; manual review required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = 'public.reservations'::regclass
      AND t.tgname = 'trg_protect_reservation_immutable_fields'
      AND t.tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'Required reservation immutability trigger missing or disabled';
  END IF;
END;
$preflight$;

-- Separate trusted timestamp for NEW rejected/cancelled status transitions.
-- Do not infer timestamps for historical cancellations from emails/updated_at.
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS gdpr_closed_at timestamptz;

CREATE OR REPLACE FUNCTION public.gdpr_stamp_closed_status_time()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.gdpr_closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'GDPR status timestamp cannot be supplied by client';
    END IF;
    RETURN NEW;
  END IF;

  -- All direct timestamp changes are forbidden (including service_role).
  -- The trusted transition itself is stamped only below.
  IF NEW.gdpr_closed_at IS DISTINCT FROM OLD.gdpr_closed_at THEN
    RAISE EXCEPTION 'GDPR status timestamp cannot be changed directly';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status::text IN ('cancelled', 'rejected') THEN
    NEW.gdpr_closed_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$function$;

-- Sorted after zzzz_set_reservation_expiration and existing protection
-- triggers so that this timestamp reflects an allowed final transition.
DROP TRIGGER IF EXISTS zzzzzz_gdpr_stamp_closed_status_time
  ON public.reservations;
CREATE TRIGGER zzzzzz_gdpr_stamp_closed_status_time
BEFORE INSERT OR UPDATE OF status, gdpr_closed_at ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.gdpr_stamp_closed_status_time();

-- Defence in depth: even if a privileged caller sets the previously approved
-- transaction-local scrub marker, the renter contact snapshots cannot change
-- until the trusted CLOSED timestamp exists and >=90 full days have passed.
-- All other immutability checks remain in their ORIGINAL existing trigger.
CREATE OR REPLACE FUNCTION public.gdpr_enforce_contact_90_day_age()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_closed_at timestamptz;
BEGIN
  IF NEW.renter_name IS DISTINCT FROM OLD.renter_name
     OR NEW.renter_email IS DISTINCT FROM OLD.renter_email
     OR NEW.renter_phone IS DISTINCT FROM OLD.renter_phone
  THEN
    v_closed_at := CASE
      WHEN OLD.status::text IN ('cancelled', 'rejected') THEN OLD.gdpr_closed_at
      WHEN OLD.status::text = 'expired' THEN OLD.expired_at
      ELSE NULL::timestamptz
    END;

    IF v_closed_at IS NULL
       OR v_closed_at > now() - interval '90 days' THEN
      RAISE EXCEPTION 'GDPR minimum retention of 90 days has not elapsed';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zzzzzz_gdpr_enforce_contact_90_day_age
  ON public.reservations;
CREATE TRIGGER zzzzzz_gdpr_enforce_contact_90_day_age
BEFORE UPDATE OF renter_name, renter_email, renter_phone
  ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.gdpr_enforce_contact_90_day_age();

-- Original helper preserved, with an ADDITIONAL mandatory 90-day check in
-- both eligible preview and the actual write predicate.
CREATE OR REPLACE FUNCTION public.gdpr_review_deactivated_renter_contacts(
  p_renter_id uuid,
  p_apply boolean DEFAULT false
)
RETURNS TABLE (
  eligible_reservations bigint,
  reservations_with_payments bigint,
  legacy_email_rows_with_address bigint,
  scrubbed_reservations bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_eligible bigint := 0;
  v_with_payments bigint := 0;
  v_legacy_emails bigint := 0;
  v_scrubbed bigint := 0;
  v_enabled boolean := false;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'Trusted backend required' USING errcode = '42501';
  END IF;
  IF p_renter_id IS NULL THEN
    RAISE EXCEPTION 'Renter id is required' USING errcode = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name = 'rentulo_project_url'
      AND btrim(s.decrypted_secret, '/') =
        'https://tfvgxrdjrpicgtvovehl.supabase.co'
  ) THEN
    RAISE EXCEPTION 'GDPR contact cleanup is PROD-only';
  END IF;

  IF p_apply IS TRUE THEN
    -- Serialize with account deactivation and related reservation writes.
    PERFORM pg_advisory_xact_lock(860808, hashtext(p_renter_id::text));
    PERFORM 1 FROM public.profiles p
      WHERE p.id = p_renter_id AND p.account_status = 'deactivated'
      FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.profiles p
      WHERE p.id = p_renter_id AND p.account_status = 'deactivated';
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subject must be a deactivated renter';
  END IF;

  SELECT count(*) INTO v_eligible
  FROM public.reservations r
  WHERE r.renter_id = p_renter_id
    AND r.status::text IN ('cancelled', 'expired', 'rejected')
    AND (
      CASE
        WHEN r.status::text IN ('cancelled', 'rejected') THEN r.gdpr_closed_at
        WHEN r.status::text = 'expired' THEN r.expired_at
        ELSE NULL::timestamptz
      END
    ) <= now() - interval '90 days'
    AND (
      btrim(coalesce(r.renter_name, '')) <> ''
      OR btrim(coalesce(r.renter_email, '')) <> ''
      OR btrim(coalesce(r.renter_phone, '')) <> ''
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.payments pay WHERE pay.reservation_id = r.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.reservation_cancellations c
      WHERE c.reservation_id = r.id AND c.cancellation_kind = 'paid_refund'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.reservation_return_incidents i
      WHERE i.reservation_id = r.id
    );

  SELECT count(*) INTO v_with_payments
  FROM public.reservations r
  WHERE r.renter_id = p_renter_id
    AND r.status::text IN ('cancelled', 'expired', 'rejected')
    AND (
      btrim(coalesce(r.renter_name, '')) <> ''
      OR btrim(coalesce(r.renter_email, '')) <> ''
      OR btrim(coalesce(r.renter_phone, '')) <> ''
    )
    AND EXISTS (
      SELECT 1 FROM public.payments pay WHERE pay.reservation_id = r.id
    );

  SELECT count(*) INTO v_legacy_emails
  FROM public.reservation_email_deliveries d
  WHERE d.recipient_id = p_renter_id
    AND btrim(coalesce(d.recipient_email, '')) <> '';

  IF p_apply IS TRUE THEN
    SELECT g.is_enabled INTO v_enabled
    FROM public.gdpr_reservation_contact_cleanup_gate g
    WHERE g.singleton = true;
    IF NOT coalesce(v_enabled, false) THEN
      RAISE EXCEPTION 'Retention policy has not been approved: cleanup is disabled';
    END IF;

    PERFORM set_config('app.gdpr_reservation_scrub_authorized', 'on', true);
    PERFORM set_config('app.gdpr_reservation_scrub_renter_id', p_renter_id::text, true);
    UPDATE public.reservations r
    SET renter_name = '', renter_email = '', renter_phone = ''
    WHERE r.renter_id = p_renter_id
      AND r.status::text IN ('cancelled', 'expired', 'rejected')
      AND (
        CASE
          WHEN r.status::text IN ('cancelled', 'rejected') THEN r.gdpr_closed_at
          WHEN r.status::text = 'expired' THEN r.expired_at
          ELSE NULL::timestamptz
        END
      ) <= now() - interval '90 days'
      AND (
        btrim(coalesce(r.renter_name, '')) <> ''
        OR btrim(coalesce(r.renter_email, '')) <> ''
        OR btrim(coalesce(r.renter_phone, '')) <> ''
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.payments pay WHERE pay.reservation_id = r.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.reservation_cancellations c
        WHERE c.reservation_id = r.id AND c.cancellation_kind = 'paid_refund'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.reservation_return_incidents i
        WHERE i.reservation_id = r.id
      );
    GET DIAGNOSTICS v_scrubbed = ROW_COUNT;
    PERFORM set_config('app.gdpr_reservation_scrub_authorized', 'off', true);
    PERFORM set_config('app.gdpr_reservation_scrub_renter_id', '', true);
  END IF;

  RETURN QUERY SELECT v_eligible, v_with_payments, v_legacy_emails, v_scrubbed;
END;
$function$;


REVOKE ALL ON FUNCTION public.gdpr_review_deactivated_renter_contacts(uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gdpr_review_deactivated_renter_contacts(uuid, boolean)
  TO service_role;

COMMENT ON FUNCTION public.gdpr_review_deactivated_renter_contacts(uuid, boolean) IS
  'PROD-only trusted GDPR preview; minimum 90 days since trusted final status time for eligible unpaid, closed reservations. Apply is additionally blocked until explicit legal approval enables the existing gate. No email, payment or history deletion.';
COMMENT ON COLUMN public.reservations.gdpr_closed_at IS
  'Trusted timestamp of a NEW transition to cancelled/rejected. NULL for historical rows without reliable event timing. Never backfilled from updated_at or email timestamps.';

COMMIT;
