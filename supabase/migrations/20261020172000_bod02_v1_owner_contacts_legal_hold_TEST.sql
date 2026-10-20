-- Rentulo V1 / BOD02 / TEST ONLY / operational owner contact minimization.
-- Requires both the 90-day fence and BOD02 legal hold foundation.
-- No historical data changes on installation; both deletion gates remain OFF.
BEGIN;
DO $preflight$
DECLARE v_current text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name='rentulo_project_url'
      AND btrim(s.decrypted_secret,'/')='https://vspposovhdgvbeukoivh.supabase.co') THEN
    RAISE EXCEPTION 'Owner GDPR contact cleanup migration is TEST-only';
  END IF;
  IF to_regprocedure('public.gdpr_has_reservation_legal_hold(uuid)') IS NULL
     OR to_regclass('public.gdpr_legal_holds') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.gdpr_reservation_contact_cleanup_gate
                    WHERE singleton AND NOT is_enabled) THEN
    RAISE EXCEPTION 'Legal hold helper or disabled renter gate missing';
  END IF;
  v_current := lower(pg_get_functiondef(
    'public.protect_reservation_immutable_fields()'::regprocedure));
  IF position('v_gdpr_contact_scrub_authorized' IN v_current)=0
     OR position('new.owner_phone is distinct from old.owner_phone' IN v_current)=0
     OR position('new.pickup_longitude is distinct from old.pickup_longitude' IN v_current)=0 THEN
    RAISE EXCEPTION 'Unexpected reservation immutability RPC; inspect before changing';
  END IF;
  v_current := lower(pg_get_functiondef(
    'public.gdpr_review_deactivated_renter_contacts(uuid,boolean)'::regprocedure));
  IF position('gdpr_closed_at' IN v_current)=0
     OR position('90 days' IN v_current)=0 THEN
    RAISE EXCEPTION 'Expected BOD02 90-day renter helper missing';
  END IF;
END;
$preflight$;

CREATE TABLE IF NOT EXISTS public.gdpr_reservation_owner_contact_cleanup_gate (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  is_enabled boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  approval_reference text,
  CHECK (NOT is_enabled OR (approved_at IS NOT NULL
    AND char_length(btrim(coalesce(approval_reference,'')))>=12))
);
INSERT INTO public.gdpr_reservation_owner_contact_cleanup_gate(singleton,is_enabled)
VALUES(true,false) ON CONFLICT(singleton) DO NOTHING;
DO $ensure_off$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.gdpr_reservation_owner_contact_cleanup_gate
                 WHERE singleton AND NOT is_enabled) THEN
    RAISE EXCEPTION 'Owner GDPR cleanup already enabled; refusing migration';
  END IF;
END;
$ensure_off$;
ALTER TABLE public.gdpr_reservation_owner_contact_cleanup_gate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gdpr_reservation_owner_contact_cleanup_gate
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gdpr_reservation_owner_contact_cleanup_gate TO service_role;

CREATE OR REPLACE FUNCTION public.protect_reservation_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_payment_update_authorized boolean;
  v_gdpr_contact_scrub_authorized boolean;
  v_owner_contact_scrub_authorized boolean;
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
    AND NOT public.gdpr_has_reservation_legal_hold(old.id)
  );

  -- Narrowly scrub operational owner/pickup snapshots. Owner name and all
  -- financial / booking fields stay immutable as contractual evidence.
  v_owner_contact_scrub_authorized := (
    (coalesce(auth.role(), '') = 'service_role' OR session_user='postgres')
    AND coalesce(current_setting('app.gdpr_owner_contact_scrub_authorized',true),'')='on'
    AND coalesce(current_setting('app.gdpr_owner_contact_scrub_reservation_id',true),'')=old.id::text
    AND new.status IS NOT DISTINCT FROM old.status
    AND new.owner_phone IS NOT DISTINCT FROM ''
    AND new.pickup_phone IS NOT DISTINCT FROM ''
    AND new.pickup_street IS NOT DISTINCT FROM ''
    AND new.pickup_postal_code IS NOT DISTINCT FROM ''
    AND new.pickup_full_address IS NOT DISTINCT FROM ''
    AND new.pickup_note IS NOT DISTINCT FROM ''
    AND new.pickup_latitude IS NULL AND new.pickup_longitude IS NULL
    AND (CASE
      WHEN old.status::text IN ('cancelled','rejected') THEN old.gdpr_closed_at
      WHEN old.status::text='expired' THEN old.expired_at
      WHEN old.status::text IN ('returned','no_show') THEN old.gdpr_finalized_at
      ELSE NULL::timestamptz END) <= now()-interval '90 days'
    AND NOT public.gdpr_has_reservation_legal_hold(old.id)
    AND NOT EXISTS (SELECT 1 FROM public.reservation_return_incidents i WHERE i.reservation_id=old.id)
    AND NOT EXISTS (SELECT 1 FROM public.reservation_cancellations c
      WHERE c.reservation_id=old.id AND c.cancellation_kind='paid_refund')
    AND NOT EXISTS (SELECT 1 FROM public.owner_cancellation_debts debt
      JOIN public.reservation_cancellations c ON c.id=debt.cancellation_id
      WHERE c.reservation_id=old.id AND debt.status='open')
    AND (
      (old.status::text IN ('cancelled','rejected','expired')
       AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.reservation_id=old.id))
      OR
      (old.status::text IN ('returned','no_show')
       AND EXISTS (SELECT 1 FROM public.payments p WHERE p.reservation_id=old.id
         AND p.status='paid' AND p.transfer_status='succeeded'
         AND p.refund_status='not_requested')
       AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.reservation_id=old.id
         AND (p.status<>'paid' OR p.transfer_status<>'succeeded'
              OR p.refund_status<>'not_requested')))
    )
    AND EXISTS (SELECT 1 FROM public.gdpr_reservation_owner_contact_cleanup_gate g
      WHERE g.singleton=true AND g.is_enabled=true AND g.approved_at IS NOT NULL
        AND char_length(btrim(coalesce(g.approval_reference,'')))>=12)
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
     OR (new.owner_phone IS DISTINCT FROM old.owner_phone AND NOT v_owner_contact_scrub_authorized)
     OR (new.pickup_phone IS DISTINCT FROM old.pickup_phone AND NOT v_owner_contact_scrub_authorized)
     OR (new.pickup_street IS DISTINCT FROM old.pickup_street AND NOT v_owner_contact_scrub_authorized)
     OR new.pickup_city IS DISTINCT FROM old.pickup_city
     OR (new.pickup_postal_code IS DISTINCT FROM old.pickup_postal_code AND NOT v_owner_contact_scrub_authorized)
     OR (new.pickup_full_address IS DISTINCT FROM old.pickup_full_address AND NOT v_owner_contact_scrub_authorized)
     OR (new.pickup_note IS DISTINCT FROM old.pickup_note AND NOT v_owner_contact_scrub_authorized)
     OR (new.pickup_latitude IS DISTINCT FROM old.pickup_latitude AND NOT v_owner_contact_scrub_authorized)
     OR (new.pickup_longitude IS DISTINCT FROM old.pickup_longitude AND NOT v_owner_contact_scrub_authorized)
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
        'https://vspposovhdgvbeukoivh.supabase.co'
  ) THEN
    RAISE EXCEPTION 'GDPR contact cleanup is TEST-only';
  END IF;

  IF p_apply IS TRUE THEN
    -- Serialize with account deactivation and related reservation writes.
    PERFORM pg_advisory_xact_lock(860808, 20261020);
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
    )
    AND NOT public.gdpr_has_reservation_legal_hold(r.id);

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
      )
      AND NOT public.gdpr_has_reservation_legal_hold(r.id);
    GET DIAGNOSTICS v_scrubbed = ROW_COUNT;
    PERFORM set_config('app.gdpr_reservation_scrub_authorized', 'off', true);
    PERFORM set_config('app.gdpr_reservation_scrub_renter_id', '', true);
  END IF;

  RETURN QUERY SELECT v_eligible, v_with_payments, v_legacy_emails, v_scrubbed;
END;
$function$;

-- Bounded preview by default. Trust server data, not user-supplied dates.
CREATE OR REPLACE FUNCTION public.gdpr_review_closed_owner_contacts(
  p_reservation_id uuid, p_apply boolean DEFAULT false
)
RETURNS TABLE(eligible_count integer, scrubbed_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_r public.reservations%rowtype;
  v_eligible integer := 0;
  v_scrubbed integer := 0;
  v_stamp timestamptz;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' AND session_user<>'postgres' THEN
    RAISE EXCEPTION 'Trusted backend required' USING errcode='42501';
  END IF;
  IF p_reservation_id IS NULL THEN RAISE EXCEPTION 'Reservation required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name='rentulo_project_url'
      AND btrim(s.decrypted_secret,'/')='https://vspposovhdgvbeukoivh.supabase.co') THEN
    RAISE EXCEPTION 'TEST-only GDPR owner cleanup';
  END IF;

  IF p_apply THEN
    PERFORM pg_advisory_xact_lock(860808,20261020);
    PERFORM pg_advisory_xact_lock(860808,hashtext(p_reservation_id::text));
    SELECT * INTO v_r FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
  ELSE
    SELECT * INTO v_r FROM public.reservations WHERE id=p_reservation_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found'; END IF;

  v_stamp := CASE
    WHEN v_r.status::text IN ('cancelled','rejected') THEN v_r.gdpr_closed_at
    WHEN v_r.status::text='expired' THEN v_r.expired_at
    WHEN v_r.status::text IN ('returned','no_show') THEN v_r.gdpr_finalized_at
    ELSE NULL::timestamptz END;

  IF v_stamp <= now()-interval '90 days'
    AND NOT public.gdpr_has_reservation_legal_hold(v_r.id)
    AND NOT EXISTS (SELECT 1 FROM public.reservation_return_incidents i
      WHERE i.reservation_id=v_r.id)
    AND NOT EXISTS (SELECT 1 FROM public.reservation_cancellations c
      WHERE c.reservation_id=v_r.id AND c.cancellation_kind='paid_refund')
    AND NOT EXISTS (SELECT 1 FROM public.owner_cancellation_debts debt
      JOIN public.reservation_cancellations c ON c.id=debt.cancellation_id
      WHERE c.reservation_id=v_r.id AND debt.status='open')
    AND (
      (v_r.status::text IN ('cancelled','rejected','expired')
       AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.reservation_id=v_r.id))
      OR
      (v_r.status::text IN ('returned','no_show')
       AND EXISTS (SELECT 1 FROM public.payments p WHERE p.reservation_id=v_r.id
        AND p.status='paid' AND p.transfer_status='succeeded'
        AND p.refund_status='not_requested')
       AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.reservation_id=v_r.id
        AND (p.status<>'paid' OR p.transfer_status<>'succeeded'
             OR p.refund_status<>'not_requested')))
    )
    AND (
      btrim(coalesce(v_r.owner_phone,''))<>'' OR btrim(coalesce(v_r.pickup_phone,''))<>''
      OR btrim(coalesce(v_r.pickup_street,''))<>''
      OR btrim(coalesce(v_r.pickup_postal_code,''))<>''
      OR btrim(coalesce(v_r.pickup_full_address,''))<>''
      OR btrim(coalesce(v_r.pickup_note,''))<>''
      OR v_r.pickup_latitude IS NOT NULL OR v_r.pickup_longitude IS NOT NULL
    ) THEN
    v_eligible := 1;
  END IF;

  IF p_apply THEN
    IF NOT EXISTS (SELECT 1 FROM public.gdpr_reservation_owner_contact_cleanup_gate
      WHERE singleton AND is_enabled AND approved_at IS NOT NULL
        AND char_length(btrim(coalesce(approval_reference,'')))>=12) THEN
      RAISE EXCEPTION 'Owner-contact retention gate disabled';
    END IF;
    IF v_eligible=1 THEN
      PERFORM set_config('app.gdpr_owner_contact_scrub_authorized','on',true);
      PERFORM set_config('app.gdpr_owner_contact_scrub_reservation_id',v_r.id::text,true);
      UPDATE public.reservations SET owner_phone='',pickup_phone='',
        pickup_street='',pickup_postal_code='',pickup_full_address='',
        pickup_note='',pickup_latitude=NULL,pickup_longitude=NULL
      WHERE id=v_r.id;
      GET DIAGNOSTICS v_scrubbed=ROW_COUNT;
      PERFORM set_config('app.gdpr_owner_contact_scrub_authorized','off',true);
      PERFORM set_config('app.gdpr_owner_contact_scrub_reservation_id','',true);
    END IF;
  END IF;
  RETURN QUERY SELECT v_eligible,v_scrubbed;
END;
$function$;
REVOKE ALL ON FUNCTION public.gdpr_review_closed_owner_contacts(uuid,boolean)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gdpr_review_closed_owner_contacts(uuid,boolean)
  TO service_role;
COMMENT ON FUNCTION public.gdpr_review_closed_owner_contacts(uuid,boolean) IS
  'TEST-only: preview by default; 90-day proof, settled finance and legal hold fences. Never clears owner_name, reservation history or payments.';
COMMIT;
