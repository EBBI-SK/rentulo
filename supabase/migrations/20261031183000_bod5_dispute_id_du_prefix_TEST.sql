-- RENTULO BOD5 | TEST ONLY. Fix Stripe charge dispute IDs (du_ prefix).
-- Applies on top of the already executed 20261031180000 TEST migration.
-- Does not alter payment states, release holds or activate scheduled workers.
BEGIN;
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name='rentulo_project_url' AND
      btrim(s.decrypted_secret,'/')='https://vspposovhdgvbeukoivh.supabase.co') THEN
    RAISE EXCEPTION 'BOD5 DU: TEST project required; PROD forbidden';
  END IF;
  IF to_regclass('public.stripe_card_disputes') IS NULL OR
     to_regprocedure('public.bod5_record_stripe_card_dispute(text,text,text,text,text,text,bigint,text,boolean,timestamptz)') IS NULL OR
     NOT EXISTS (SELECT 1 FROM pg_constraint
       WHERE conrelid='public.stripe_card_disputes'::regclass
         AND conname='stripe_card_disputes_dispute_id_check') THEN
    RAISE EXCEPTION 'BOD5 DU: original TEST dispute ledger/function/check required';
  END IF;
END;
$guard$;

-- Stripe dispute objects use du_...; keep the full alphanumeric format check.
-- Existing incompatible IDs cause a transaction rollback, never a silent conversion.
ALTER TABLE public.stripe_card_disputes
  DROP CONSTRAINT stripe_card_disputes_dispute_id_check,
  ADD CONSTRAINT stripe_card_disputes_dispute_id_check
    CHECK (dispute_id ~ '^du_[A-Za-z0-9]+$');

-- Preserve the existing signed-webhook/RPC service-role and payout-hold logic;
-- change only the ID-prefix validation in the already deployed function.
CREATE OR REPLACE FUNCTION public.bod5_record_stripe_card_dispute(
  p_event_id text, p_event_type text, p_dispute_id text,
  p_charge_id text, p_status text, p_reason text,
  p_amount_minor bigint, p_currency text, p_livemode boolean,
  p_event_created_at timestamptz
)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_original_reservation uuid;
  v_extension_reservation uuid;
  v_extension_id uuid;
  v_known_reservation uuid;
  v_reservation uuid;
  v_kind text;
  v_old public.stripe_card_disputes%rowtype;
  v_latest boolean;
  v_block boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'BOD5: trusted webhook required';
  END IF;
  IF p_event_id !~ '^evt_[A-Za-z0-9]+$'
    OR p_dispute_id !~ '^du_[A-Za-z0-9]+$'
    OR p_charge_id !~ '^ch_[A-Za-z0-9]+$'
    OR p_event_type NOT IN (
      'charge.dispute.created','charge.dispute.updated','charge.dispute.closed',
      'charge.dispute.funds_withdrawn','charge.dispute.funds_reinstated'
    )
    OR p_status NOT IN ('needs_response','under_review','won','lost',
      'warning_needs_response','warning_under_review','warning_closed')
    OR p_amount_minor IS NULL OR p_amount_minor<=0 OR p_currency !~ '^[a-z]{3}$'
    OR p_livemode IS NULL OR p_event_created_at IS NULL THEN
    RAISE EXCEPTION 'BOD5: invalid Stripe dispute payload';
  END IF;

  SELECT p.reservation_id INTO v_original_reservation
    FROM public.payments p WHERE p.stripe_charge_id=p_charge_id
      AND p.provider='stripe' AND p.status='paid';
  SELECT e.reservation_id, e.id INTO v_extension_reservation, v_extension_id
    FROM public.reservation_extensions e WHERE e.stripe_charge_id=p_charge_id
      AND e.status='paid';
  IF v_original_reservation IS NOT NULL AND v_extension_reservation IS NOT NULL THEN
    RAISE EXCEPTION 'BOD5: disputed charge maps to multiple payment sources';
  END IF;
  -- Retained dispute audit survives closed-booking GDPR retention. Reuse its
  -- verified prior mapping if the original booking record is no longer present.
  SELECT d.reservation_id INTO v_known_reservation
    FROM public.stripe_card_disputes d WHERE d.dispute_id=p_dispute_id;
  v_reservation := coalesce(v_original_reservation,v_extension_reservation,v_known_reservation);
  v_kind := CASE WHEN v_original_reservation IS NOT NULL THEN 'original'
                 WHEN v_extension_reservation IS NOT NULL THEN 'extension'
                 ELSE 'unmatched' END;
  IF v_reservation IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_reservation::text, 5005));
  END IF;
  SELECT * INTO v_old FROM public.stripe_card_disputes
    WHERE dispute_id=p_dispute_id FOR UPDATE;
  IF FOUND AND (v_old.charge_id<>p_charge_id OR v_old.livemode<>p_livemode
       OR (v_old.reservation_id IS NOT NULL AND
          v_reservation IS DISTINCT FROM v_old.reservation_id)) THEN
    RAISE EXCEPTION 'BOD5: Stripe dispute identity or reservation changed';
  END IF;
  v_latest := NOT FOUND OR p_event_created_at >= v_old.event_created_at;
  v_block := CASE
    WHEN NOT FOUND OR v_old.reviewed_at IS NULL THEN true
    WHEN p_event_created_at > v_old.reviewed_at
      AND p_status NOT IN ('won','warning_closed') THEN true
    ELSE v_old.payout_blocked END;

  PERFORM set_config('rentulo.bod5_verified_write','on',true);
  IF v_old.dispute_id IS NULL THEN
    INSERT INTO public.stripe_card_disputes
      (dispute_id,charge_id,reservation_id,extension_id,payment_kind,
       dispute_status,dispute_reason,amount_minor,currency,livemode,
       funds_reinstated,payout_blocked,event_created_at,last_stripe_event_id)
    VALUES (p_dispute_id,p_charge_id,v_reservation,v_extension_id,v_kind,
       p_status,NULLIF(left(coalesce(p_reason,''),200),''),p_amount_minor,p_currency,p_livemode,
       p_event_type='charge.dispute.funds_reinstated',true,p_event_created_at,p_event_id);
  ELSE
    UPDATE public.stripe_card_disputes d SET
      reservation_id=coalesce(d.reservation_id,v_reservation),
      extension_id=coalesce(d.extension_id,v_extension_id),
      payment_kind=CASE WHEN d.payment_kind='unmatched' THEN v_kind ELSE d.payment_kind END,
      dispute_status=CASE WHEN v_latest THEN p_status ELSE d.dispute_status END,
      dispute_reason=CASE WHEN v_latest THEN NULLIF(left(coalesce(p_reason,''),200),'') ELSE d.dispute_reason END,
      amount_minor=CASE WHEN v_latest THEN p_amount_minor ELSE d.amount_minor END,
      currency=CASE WHEN v_latest THEN p_currency ELSE d.currency END,
      funds_reinstated=d.funds_reinstated OR p_event_type='charge.dispute.funds_reinstated',
      payout_blocked=d.payout_blocked OR v_block,
      event_created_at=CASE WHEN v_latest THEN p_event_created_at ELSE d.event_created_at END,
      last_stripe_event_id=CASE WHEN v_latest THEN p_event_id ELSE d.last_stripe_event_id END,
      updated_at=clock_timestamp()
    WHERE d.dispute_id=p_dispute_id;
  END IF;
  INSERT INTO public.stripe_card_dispute_events
    (dispute_id,stripe_event_id,event_type,event_status,note,actor_label)
  VALUES (p_dispute_id,p_event_id,p_event_type,p_status,
    CASE WHEN v_reservation IS NULL THEN 'Unmatched charge: pending payment reconciliation'
         ELSE 'Verified Stripe webhook; financial hold applies to whole reservation' END,
    'Stripe signed webhook')
  ON CONFLICT (stripe_event_id) DO NOTHING;
  PERFORM set_config('rentulo.bod5_verified_write','',true);
  RETURN CASE WHEN v_reservation IS NULL THEN 'unmatched' ELSE 'recorded' END;
END;
$fn$;

COMMIT;
