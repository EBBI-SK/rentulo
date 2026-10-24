-- RENTULO V1 / PROD RELEASE CANDIDATE bd1b8d1 / 2026-10-24.
-- Apply only to a verified PROD database after backup and approval.
-- This SQL is staged separately: never copy over TEST migrations.
-- Cron activation is deferred; no automatic deployment is authorized.

-- RENTULO V1 / BOD 02 / GDPR reservation contact cleanup / PROD ONLY.
-- Prepared only. No historical row is changed by applying this migration.
-- The cleanup gate is inserted DISABLED. Legal retention approval is required
-- before enabling it and before making any apply=true RPC call.
-- Email delivery records are counted for review, never modified here.
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


DO $prod_project$
DECLARE
  v_definition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets s
    WHERE s.name = 'rentulo_prod_release_target'
      AND btrim(s.decrypted_secret, '/') =
        'tfvgxrdjrpicgtvovehl'
  ) THEN
    RAISE EXCEPTION 'BOD02 GDPR reservation contacts migration is PROD-only';
  END IF;

  IF to_regclass('public.reservation_return_incidents') IS NULL
     OR to_regclass('public.reservation_email_deliveries') IS NULL
     OR to_regclass('public.reservation_cancellations') IS NULL
     OR to_regclass('public.payments') IS NULL THEN
    RAISE EXCEPTION 'Expected BOD01/BOD02 tables missing in PROD: stop and review';
  END IF;

  -- Abort, rather than silently replacing a different reservation guard.
  v_definition := pg_get_functiondef(
    'public.protect_reservation_immutable_fields()'::regprocedure
  );
  IF position('v_payment_update_authorized' IN v_definition) = 0
     OR position('new.renter_name is distinct from old.renter_name' IN v_definition) = 0
     OR position('new.renter_email is distinct from old.renter_email' IN v_definition) = 0
     OR position('new.renter_phone is distinct from old.renter_phone' IN v_definition) = 0
     OR position('new.pickup_latitude is distinct from old.pickup_latitude' IN v_definition) = 0
     OR position('new.pickup_longitude is distinct from old.pickup_longitude' IN v_definition) = 0
     OR position('new.payment_provider_status' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected reservation immutability guard: review PROD database before applying';
  END IF;
END;
$prod_project$;

-- Only a privileged SQL-Editor change, after retention approval, can enable
-- this gate. API/service_role has no direct UPDATE privilege on the table.
CREATE TABLE IF NOT EXISTS public.gdpr_reservation_contact_cleanup_gate (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  is_enabled boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  approval_reference text,
  CONSTRAINT gdpr_reservation_contact_gate_requires_approval CHECK (
    NOT is_enabled OR (
      approved_at IS NOT NULL
      AND length(btrim(coalesce(approval_reference, ''))) >= 8
    )
  )
);
INSERT INTO public.gdpr_reservation_contact_cleanup_gate (singleton, is_enabled)
VALUES (true, false)
ON CONFLICT (singleton) DO NOTHING;
ALTER TABLE public.gdpr_reservation_contact_cleanup_gate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gdpr_reservation_contact_cleanup_gate
  FROM PUBLIC, anon, authenticated, service_role;

-- The original immutability rules remain intact. The only new exception is
-- blanking the THREE renter contact snapshots, and ONLY if all of these hold:
--   * trusted service role (or the SQL Editor's postgres session),
--   * a transaction-local marker naming the exact renter,
--   * a deactivated renter and a closed/unpaid reservation,
--   * the retention-approval gate has explicitly been enabled.
-- All reservation numbers, statuses, prices, dates, owner/pickup details,
-- payment snapshots and transfer fields remain protected as before.
CREATE OR REPLACE FUNCTION public.protect_reservation_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_payment_update_authorized boolean;
  v_gdpr_contact_scrub_authorized boolean;
BEGIN
  v_payment_update_authorized := coalesce((
    old.status = 'approved'
    AND new.status = 'paid'
    AND (
      current_setting('app.test_payment_authorized', true) = 'on'
      OR current_setting('app.payment_update_authorized', true) = 'on'
    )
  ), false);

  v_gdpr_contact_scrub_authorized := (
    (coalesce(auth.role(), '') = 'service_role' OR session_user = 'postgres')
    AND coalesce(current_setting('app.gdpr_reservation_scrub_authorized', true), '') = 'on'
    AND coalesce(current_setting('app.gdpr_reservation_scrub_renter_id', true), '') = old.renter_id::text
    AND new.status IS NOT DISTINCT FROM old.status
    AND old.status::text IN ('cancelled', 'expired', 'rejected')
    AND new.renter_name IS NOT DISTINCT FROM ''
    AND new.renter_email IS NOT DISTINCT FROM ''
    AND new.renter_phone IS NOT DISTINCT FROM ''
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = old.renter_id AND p.account_status = 'deactivated'
    )
    AND EXISTS (
      SELECT 1 FROM public.gdpr_reservation_contact_cleanup_gate g
      WHERE g.singleton = true AND g.is_enabled = true
        AND g.approved_at IS NOT NULL
        AND length(btrim(coalesce(g.approval_reference, ''))) >= 8
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.payments pay WHERE pay.reservation_id = old.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.reservation_cancellations c
      WHERE c.reservation_id = old.id AND c.cancellation_kind = 'paid_refund'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.reservation_return_incidents i
      WHERE i.reservation_id = old.id
    )
  );

  IF new.id IS DISTINCT FROM old.id
     OR new.offer_id IS DISTINCT FROM old.offer_id
     OR new.owner_id IS DISTINCT FROM old.owner_id
     OR new.renter_id IS DISTINCT FROM old.renter_id
     OR new.start_date IS DISTINCT FROM old.start_date
     OR new.end_date IS DISTINCT FROM old.end_date
     OR new.pickup_time IS DISTINCT FROM old.pickup_time
     OR new.date_from IS DISTINCT FROM old.date_from
     OR new.date_to IS DISTINCT FROM old.date_to
     OR new.days IS DISTINCT FROM old.days
     OR new.price_per_day IS DISTINCT FROM old.price_per_day
     OR new.total_price IS DISTINCT FROM old.total_price
     OR new.platform_fee_percent IS DISTINCT FROM old.platform_fee_percent
     OR new.platform_fee_amount IS DISTINCT FROM old.platform_fee_amount
     OR new.owner_payout IS DISTINCT FROM old.owner_payout
     OR new.created_at IS DISTINCT FROM old.created_at
     OR new.offer_name IS DISTINCT FROM old.offer_name
     OR new.category IS DISTINCT FROM old.category
     OR new.city IS DISTINCT FROM old.city
     OR new.total_days IS DISTINCT FROM old.total_days
     OR (
       new.renter_name IS DISTINCT FROM old.renter_name
       AND NOT v_gdpr_contact_scrub_authorized
     )
     OR (
       new.renter_email IS DISTINCT FROM old.renter_email
       AND NOT v_gdpr_contact_scrub_authorized
     )
     OR (
       new.renter_phone IS DISTINCT FROM old.renter_phone
       AND NOT v_gdpr_contact_scrub_authorized
     )
     OR new.owner_name IS DISTINCT FROM old.owner_name
     OR new.owner_phone IS DISTINCT FROM old.owner_phone
     OR new.pickup_phone IS DISTINCT FROM old.pickup_phone
     OR new.pickup_street IS DISTINCT FROM old.pickup_street
     OR new.pickup_city IS DISTINCT FROM old.pickup_city
     OR new.pickup_postal_code IS DISTINCT FROM old.pickup_postal_code
     OR new.pickup_full_address IS DISTINCT FROM old.pickup_full_address
     OR new.pickup_note IS DISTINCT FROM old.pickup_note
     OR new.pickup_latitude IS DISTINCT FROM old.pickup_latitude
     OR new.pickup_longitude IS DISTINCT FROM old.pickup_longitude
     OR (
       NOT v_payment_update_authorized
       AND (
         new.paid_at IS DISTINCT FROM old.paid_at
         OR new.payment_provider_status IS DISTINCT FROM old.payment_provider_status
       )
     )
  THEN
    RAISE EXCEPTION 'Immutable reservation fields cannot be changed';
  END IF;
  RETURN new;
END;
$function$;

-- Preview is the DEFAULT. Even apply=true remains blocked by the disabled
-- approval gate. The procedure never touches payment or email tables.
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
  'PROD-only, trusted-role GDPR preview (default). Applying is impossible until a documented retention approval explicitly enables a privileged gate. Only closed/unpaid renter contact snapshots may be blanked; financial and email records are untouched.';

COMMIT;
