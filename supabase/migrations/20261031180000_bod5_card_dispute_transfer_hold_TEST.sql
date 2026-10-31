-- RENTULO BOD5 | TEST ONLY. Does not activate workers or modify existing payments.
BEGIN;
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name='rentulo_project_url' AND
      btrim(s.decrypted_secret,'/')='https://vspposovhdgvbeukoivh.supabase.co') THEN
    RAISE EXCEPTION 'BOD5: TEST project required; PROD forbidden';
  END IF;
  IF to_regclass('public.stripe_card_disputes') IS NOT NULL OR
     to_regclass('public.reservation_extensions') IS NULL OR
     to_regclass('public.reservation_dispute_settlements') IS NULL OR
     to_regclass('public.stripe_webhook_events') IS NULL OR
     to_regprocedure('public.platform_admin_assert(text)') IS NULL THEN
    RAISE EXCEPTION 'BOD5: missing baseline or existing dispute ledger';
  END IF;
END;
$guard$;

-- BOD 5: bank card disputes are separate from internal BOD03B settlements.
-- One disputed original OR extension charge holds EVERY not-yet-issued transfer
-- associated with the same booking. Closed disputes stay on hold for review.

CREATE TABLE public.stripe_card_disputes (
  dispute_id text PRIMARY KEY CHECK (dispute_id ~ '^dp_[A-Za-z0-9]+$'),
  charge_id text NOT NULL CHECK (charge_id ~ '^ch_[A-Za-z0-9]+$'),
  reservation_id uuid,
  extension_id uuid,
  payment_kind text NOT NULL CHECK (payment_kind IN ('original','extension','unmatched')),
  dispute_status text NOT NULL CHECK (length(dispute_status) BETWEEN 2 AND 80),
  dispute_reason text,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  livemode boolean NOT NULL,
  funds_reinstated boolean NOT NULL DEFAULT false,
  payout_blocked boolean NOT NULL DEFAULT true,
  event_created_at timestamptz NOT NULL,
  last_stripe_event_id text NOT NULL,
  reviewed_at timestamptz,
  review_reason text CHECK (review_reason IS NULL OR length(btrim(review_reason)) BETWEEN 12 AND 2000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT bod5_release_review_pair CHECK (payout_blocked OR reviewed_at IS NOT NULL),
  CONSTRAINT bod5_release_reason_pair CHECK ((reviewed_at IS NULL) = (review_reason IS NULL)),
  CONSTRAINT bod5_mapping_pair CHECK (
    (payment_kind='unmatched' AND reservation_id IS NULL AND extension_id IS NULL)
    OR (payment_kind='original' AND reservation_id IS NOT NULL AND extension_id IS NULL)
    OR (payment_kind='extension' AND reservation_id IS NOT NULL AND extension_id IS NOT NULL)
  )
);
CREATE INDEX stripe_card_disputes_booking_block_idx
  ON public.stripe_card_disputes (reservation_id) WHERE payout_blocked;
CREATE INDEX stripe_card_disputes_charge_idx
  ON public.stripe_card_disputes (charge_id);

CREATE TABLE public.stripe_card_dispute_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dispute_id text NOT NULL REFERENCES public.stripe_card_disputes(dispute_id) ON DELETE RESTRICT,
  stripe_event_id text UNIQUE,
  event_type text NOT NULL,
  event_status text NOT NULL,
  note text,
  actor_label text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION public.bod5_reject_audit_edit()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $fn$
BEGIN
  RAISE EXCEPTION 'BOD5 dispute audit is append-only';
END;
$fn$;
CREATE TRIGGER bod5_dispute_audit_append_only
  BEFORE UPDATE OR DELETE ON public.stripe_card_dispute_events
  FOR EACH ROW EXECUTE FUNCTION public.bod5_reject_audit_edit();

CREATE OR REPLACE FUNCTION public.bod5_guard_dispute_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'BOD5: Stripe dispute evidence cannot be deleted';
  END IF;
  IF current_setting('rentulo.bod5_verified_write',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'BOD5: only verified Stripe webhook or documented Owner review can change dispute state';
  END IF;
  IF TG_OP='UPDATE' AND (
    NEW.dispute_id IS DISTINCT FROM OLD.dispute_id OR
    NEW.charge_id IS DISTINCT FROM OLD.charge_id OR
    (OLD.reservation_id IS NOT NULL AND NEW.reservation_id IS DISTINCT FROM OLD.reservation_id) OR
    (OLD.extension_id IS NOT NULL AND NEW.extension_id IS DISTINCT FROM OLD.extension_id) OR
    NEW.created_at IS DISTINCT FROM OLD.created_at OR
    NEW.livemode IS DISTINCT FROM OLD.livemode
  ) THEN
    RAISE EXCEPTION 'BOD5: immutable dispute identity/mapping cannot change';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER bod5_dispute_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.stripe_card_disputes
  FOR EACH ROW EXECUTE FUNCTION public.bod5_guard_dispute_write();

CREATE OR REPLACE FUNCTION public.bod5_reservation_has_card_dispute(p_reservation_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.stripe_card_disputes d
    WHERE d.reservation_id=p_reservation_id AND d.payout_blocked
  );
$fn$;

-- Some Stripe Charges retain disputed=true after a successful challenge.
-- Only a previously recorded, manually released WON dispute is eligible.
CREATE OR REPLACE FUNCTION public.bod5_charge_dispute_cleared(
  p_reservation_id uuid, p_charge_id text
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.stripe_card_disputes d
    WHERE d.reservation_id=p_reservation_id AND d.charge_id=p_charge_id
      AND d.dispute_status IN ('won','warning_closed') AND NOT d.payout_blocked
  ) AND NOT EXISTS (
    SELECT 1 FROM public.stripe_card_disputes d
    WHERE d.reservation_id=p_reservation_id AND d.charge_id=p_charge_id
      AND d.payout_blocked
  );
$fn$;

-- Transaction-level database gate. It protects both original and extension
-- claims even if a stale cron candidate or direct service-role request retries.
-- A transfer already sent to Stripe MAY still be reconciled as succeeded: never
-- hide an actual outgoing transfer just because a dispute arrived meanwhile.
CREATE OR REPLACE FUNCTION public.bod5_block_new_transfer_attempt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF NEW.transfer_status='pending' AND
     (OLD.transfer_status IS DISTINCT FROM 'pending' OR
      NEW.transfer_attempt_count > OLD.transfer_attempt_count) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.reservation_id::text, 5005));
    IF public.bod5_reservation_has_card_dispute(NEW.reservation_id) THEN
      RAISE EXCEPTION 'BOD5: payout blocked by a Stripe card dispute';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER bod5_hold_original_owner_transfer
  BEFORE UPDATE OF transfer_status, transfer_attempt_count ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.bod5_block_new_transfer_attempt();
CREATE TRIGGER bod5_hold_extension_owner_transfer
  BEFORE UPDATE OF transfer_status, transfer_attempt_count ON public.reservation_extensions
  FOR EACH ROW EXECUTE FUNCTION public.bod5_block_new_transfer_attempt();

-- Existing BOD03B exceptional decisions predate individually paid extensions.
-- Prevent accidentally refunding ONLY the original payment, or finalizing
-- only the original owner payout, if additional paid charges also exist.
-- A fully documented multi-charge settlement is a separate controlled phase.
CREATE OR REPLACE FUNCTION public.bod5_guard_partial_internal_settlement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.reservation_extensions e
    WHERE e.reservation_id=NEW.reservation_id AND e.status='paid'
  ) THEN
    RAISE EXCEPTION 'BOD5: internal BOD03B settlement must also include paid extensions; manual financial review required';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER bod5_prevent_partial_bod03b_settlement
  BEFORE INSERT ON public.reservation_dispute_settlements
  FOR EACH ROW EXECUTE FUNCTION public.bod5_guard_partial_internal_settlement();

-- Called only by a signature-verified Stripe webhook with service-role DB access.
-- Unmatched Stripe charges remain recorded for diagnosis and cause an HTTP
-- retry (503) until the matching original/additional payment is recorded.
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
    OR p_dispute_id !~ '^dp_[A-Za-z0-9]+$'
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

-- Only Supabase Owner / SQL Editor; requires documented Stripe Dashboard review.
-- Even when Stripe says 'won', NO release happens automatically on webhook.
-- A lost dispute cannot be released through this route.
CREATE OR REPLACE FUNCTION public.bod5_admin_release_won_dispute(
  p_dispute_id text, p_reason text
)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $fn$
DECLARE v_case public.stripe_card_disputes%rowtype;
BEGIN
  PERFORM public.platform_admin_assert(p_reason);
  SELECT * INTO v_case FROM public.stripe_card_disputes
    WHERE dispute_id=p_dispute_id;
  IF NOT FOUND OR v_case.reservation_id IS NULL THEN
    RAISE EXCEPTION 'BOD5: no linked Stripe dispute to release';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_case.reservation_id::text, 5005));
  SELECT * INTO v_case FROM public.stripe_card_disputes
    WHERE dispute_id=p_dispute_id FOR UPDATE;
  IF v_case.payout_blocked IS NOT TRUE OR
    v_case.dispute_status NOT IN ('won','warning_closed') THEN
    RAISE EXCEPTION 'BOD5: only a verified won/closed-warning dispute can be released';
  END IF;
  PERFORM set_config('rentulo.bod5_verified_write','on',true);
  UPDATE public.stripe_card_disputes SET
    payout_blocked=false, reviewed_at=clock_timestamp(),
    review_reason=p_reason, updated_at=clock_timestamp()
    WHERE dispute_id=p_dispute_id;
  INSERT INTO public.stripe_card_dispute_events
    (dispute_id,event_type,event_status,note,actor_label)
  VALUES (p_dispute_id,'manual_release',v_case.dispute_status,
    p_reason,'Supabase Owner / SQL Editor');
  PERFORM set_config('rentulo.bod5_verified_write','',true);
  RETURN true;
END;
$fn$;

ALTER TABLE public.stripe_card_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_card_dispute_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stripe_card_disputes, public.stripe_card_dispute_events
  FROM public, anon, authenticated;
REVOKE ALL ON SEQUENCE public.stripe_card_dispute_events_id_seq
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.bod5_charge_dispute_cleared(uuid,text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bod5_charge_dispute_cleared(uuid,text)
  TO service_role;
REVOKE ALL ON FUNCTION public.bod5_reservation_has_card_dispute(uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bod5_reservation_has_card_dispute(uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.bod5_record_stripe_card_dispute(
  text,text,text,text,text,text,bigint,text,boolean,timestamptz
) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bod5_record_stripe_card_dispute(
  text,text,text,text,text,text,bigint,text,boolean,timestamptz
) TO service_role;
REVOKE ALL ON FUNCTION public.bod5_admin_release_won_dispute(text,text)
  FROM public,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.bod5_guard_partial_internal_settlement()
  FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.bod5_block_new_transfer_attempt()
  FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.bod5_guard_dispute_write()
  FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.bod5_reject_audit_edit()
  FROM public,anon,authenticated;

COMMIT;
