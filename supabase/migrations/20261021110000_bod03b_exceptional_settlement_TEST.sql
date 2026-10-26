-- RENTULO V1 / BOD 03B / TEST ONLY. Independent documented dispute settlement.
-- No fake 'returned', no PIN modifications, no changes to normal paid/no-show flow.
-- Full owner contractual payout OR full original payer refund; never both.
BEGIN;

DO $test_preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name='rentulo_project_url'
      AND btrim(s.decrypted_secret,'/')='https://vspposovhdgvbeukoivh.supabase.co'
  ) THEN RAISE EXCEPTION 'BOD03B: TEST Supabase required; PROD forbidden'; END IF;
  IF to_regclass('public.reservation_return_incidents') IS NULL
     OR to_regclass('public.platform_incidents') IS NULL
     OR to_regprocedure('public.platform_admin_assert(text)') IS NULL
     OR to_regclass('public.gdpr_legal_holds') IS NULL
     OR to_regclass('public.payments') IS NULL THEN
    RAISE EXCEPTION 'BOD03B: completed BOD01/BOD02/BOD03A infrastructure required';
  END IF;
END;
$test_preflight$;

-- A case is irreversible after approval: never overwrite which side is paid.
-- The owner retains the paid->picked_up state until the item is actually returned.
-- Verified UUID business references intentionally have no hard FK to reservations
-- or payments: BOD02 lawful retention cleanup must not be blocked indefinitely
-- by closed financial audit history. Runtime settlement RPC verifies both rows.
CREATE TABLE public.reservation_dispute_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL UNIQUE,
  payment_id uuid NOT NULL UNIQUE,
  settlement_route text NOT NULL CHECK (settlement_route IN ('owner_full_payout','renter_full_refund')),
  basis_type text NOT NULL CHECK (basis_type IN ('joint_agreement','binding_order')),
  basis_reference text NOT NULL CHECK (char_length(btrim(basis_reference)) BETWEEN 12 AND 500),
  admin_reason text NOT NULL CHECK (char_length(btrim(admin_reason)) BETWEEN 12 AND 2000),
  operator_label text NOT NULL DEFAULT 'Supabase Owner / SQL Editor',
  status text NOT NULL DEFAULT 'authorized' CHECK
    (status IN ('authorized','processing','awaiting_refund','succeeded','manual_review')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz,
  stripe_refund_id text,
  stripe_refund_status text CHECK
    (stripe_refund_status IS NULL OR stripe_refund_status IN
      ('pending','requires_action','succeeded','failed','canceled')),
  last_error text,
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT bod03b_completed_pair CHECK (
    (status='succeeded') = (completed_at IS NOT NULL)
  ),
  CONSTRAINT bod03b_lease_pair CHECK (
    (lease_token IS NULL) = (lease_until IS NULL)
  )
);
CREATE INDEX reservation_dispute_refund_due_idx ON public.reservation_dispute_settlements
  (next_attempt_at,approved_at) WHERE settlement_route='renter_full_refund'
  AND status IN ('authorized','processing','awaiting_refund');

-- Append-only audit trail. No public files or user personal evidence stored here.
CREATE TABLE public.reservation_dispute_settlement_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  settlement_id uuid NOT NULL REFERENCES public.reservation_dispute_settlements(id) ON DELETE RESTRICT,
  event_kind text NOT NULL,
  old_status text,
  new_status text NOT NULL,
  reason text NOT NULL,
  actor_label text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION public.bod03b_settlement_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_admin_retry boolean :=
  coalesce(current_setting('rentulo.bod03b_admin_retry',true)='true',false);
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BOD03B: approved financial decisions cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.platform_admin_assert(current_setting('rentulo.bod03b_reason', true));
    IF NEW.status <> 'authorized' OR NEW.attempt_count <> 0
      OR NEW.stripe_refund_id IS NOT NULL OR NEW.lease_token IS NOT NULL
      OR NEW.completed_at IS NOT NULL OR NEW.last_error IS NOT NULL THEN
      RAISE EXCEPTION 'BOD03B: only documented authorized cases can be created';
    END IF;
    RETURN NEW;
  END IF;
  IF v_admin_retry THEN
    PERFORM public.platform_admin_assert(current_setting('rentulo.bod03b_reason',true));
    IF OLD.status<>'manual_review'
       OR NEW.settlement_route<>'renter_full_refund'
       OR NEW.status NOT IN ('authorized','awaiting_refund') THEN
      RAISE EXCEPTION 'BOD03B: owner may only requeue the same documented refund case';
    END IF;
  ELSIF auth.role() IS DISTINCT FROM 'service_role'
     OR current_setting('rentulo.bod03b_worker',true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'BOD03B: only trusted finance RPC or documented owner retry may update the case';
  END IF;
  IF (NEW.id,NEW.reservation_id,NEW.payment_id,NEW.settlement_route,
      NEW.basis_type,NEW.basis_reference,NEW.admin_reason,NEW.operator_label,NEW.approved_at)
     IS DISTINCT FROM
     (OLD.id,OLD.reservation_id,OLD.payment_id,OLD.settlement_route,
      OLD.basis_type,OLD.basis_reference,OLD.admin_reason,OLD.operator_label,OLD.approved_at) THEN
    RAISE EXCEPTION 'BOD03B: case decision and evidence are immutable';
  END IF;
  IF OLD.status='succeeded' OR (OLD.status='manual_review' AND NOT v_admin_retry) THEN
    RAISE EXCEPTION 'BOD03B: finalized/manual cases cannot be auto-edited';
  END IF;
  IF NOT v_admin_retry AND NOT (
    (OLD.status='authorized' AND NEW.status IN ('authorized','processing','succeeded','manual_review'))
    OR (OLD.status='processing' AND NEW.status IN ('authorized','processing','awaiting_refund','succeeded','manual_review'))
    OR (OLD.status='awaiting_refund' AND NEW.status IN ('processing','manual_review'))
  ) THEN RAISE EXCEPTION 'BOD03B: prohibited case status transition'; END IF;
  IF NEW.settlement_route='owner_full_payout'
     AND NEW.status NOT IN ('authorized','succeeded') THEN
    RAISE EXCEPTION 'BOD03B: owner payment uses only the existing Stripe transfer worker';
  END IF;
  IF NEW.status='processing' AND (NEW.lease_token IS NULL OR NEW.lease_until IS NULL) THEN
    RAISE EXCEPTION 'BOD03B: refund processing requires a claim lease';
  END IF;
  IF NEW.status <> 'processing' AND NEW.lease_token IS NOT NULL THEN
    RAISE EXCEPTION 'BOD03B: claim lease must be released';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.bod03b_audit_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  INSERT INTO public.reservation_dispute_settlement_events
    (settlement_id,event_kind,old_status,new_status,reason,actor_label)
  VALUES (
    NEW.id,
    CASE WHEN TG_OP='INSERT' THEN 'authorized'
         WHEN current_setting('rentulo.bod03b_admin_retry',true)='true' THEN 'admin_requeued'
         WHEN NEW.status='succeeded' THEN 'settled'
         WHEN NEW.status='manual_review' THEN 'manual_review'
         ELSE 'worker_progress' END,
    CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.status END,
    NEW.status,
    coalesce(nullif(current_setting('rentulo.bod03b_reason',true),''),'Finance worker status update'),
    CASE WHEN TG_OP='INSERT' OR current_setting('rentulo.bod03b_admin_retry',true)='true'
         THEN 'Supabase Owner / SQL Editor'
         ELSE 'Trusted TEST finance worker' END
  );
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.bod03b_no_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  RAISE EXCEPTION 'BOD03B: dispute audit is append-only';
END;
$fn$;

CREATE TRIGGER trg_bod03b_settlement_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.reservation_dispute_settlements
  FOR EACH ROW EXECUTE FUNCTION public.bod03b_settlement_guard();
CREATE TRIGGER trg_bod03b_audit_event
  AFTER INSERT OR UPDATE ON public.reservation_dispute_settlements
  FOR EACH ROW EXECUTE FUNCTION public.bod03b_audit_event();
CREATE TRIGGER trg_bod03b_audit_append_only
  BEFORE UPDATE OR DELETE ON public.reservation_dispute_settlement_events
  FOR EACH ROW EXECUTE FUNCTION public.bod03b_no_audit_mutation();

-- Owner must inspect the actual agreement/judgment outside this database.
-- The stored reference is an INTERNAL evidence index, never a public URL or token.
CREATE OR REPLACE FUNCTION public.bod03b_admin_authorize_settlement(
  p_reservation_number text,
  p_settlement_route text,
  p_basis_type text,
  p_basis_reference text,
  p_admin_reason text
)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $fn$
DECLARE
  v_res public.reservations%rowtype;
  v_pay public.payments%rowtype;
  v_id uuid;
BEGIN
  PERFORM public.platform_admin_assert(p_admin_reason);
  IF p_settlement_route NOT IN ('owner_full_payout','renter_full_refund')
    OR p_basis_type NOT IN ('joint_agreement','binding_order')
    OR char_length(btrim(coalesce(p_basis_reference,''))) NOT BETWEEN 12 AND 500 THEN
    RAISE EXCEPTION 'BOD03B: approved full outcome and private evidence reference required';
  END IF;
  SELECT * INTO v_res FROM public.reservations
    WHERE reservation_number=p_reservation_number FOR UPDATE;
  IF NOT FOUND OR v_res.status <> 'picked_up' OR v_res.pickup_time IS NULL
    OR clock_timestamp() < (((v_res.end_date + v_res.pickup_time)
        AT TIME ZONE 'Europe/Prague') + interval '2 hours') THEN
    RAISE EXCEPTION 'BOD03B: only genuinely overdue picked-up reservations can be settled';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.reservation_return_incidents ri
       WHERE ri.reservation_id=v_res.id AND ri.resolved_at IS NULL
     ) AND NOT EXISTS (
       SELECT 1 FROM public.platform_incidents pi
       WHERE pi.reservation_number=v_res.reservation_number
         AND pi.incident_type IN ('damage','loss','fraud')
     ) THEN
    RAISE EXCEPTION 'BOD03B: documented return, damage, loss or fraud incident required';
  END IF;
  SELECT * INTO v_pay FROM public.payments p
    WHERE p.reservation_id=v_res.id FOR UPDATE;
  IF NOT FOUND OR v_pay.status <> 'paid'
    OR v_pay.provider <> 'stripe' OR v_pay.currency <> 'czk'
    OR v_pay.stripe_payment_intent_status <> 'succeeded'
    OR coalesce(v_pay.stripe_charge_id,'') = ''
    OR coalesce(v_pay.stripe_payment_intent_id,'') = ''
    OR v_pay.stripe_amount_total_minor <> v_pay.amount_total * 100
    OR v_pay.owner_id <> v_res.owner_id OR v_pay.payer_id <> v_res.renter_id
    OR v_pay.amount_total <> v_res.total_price
    OR v_pay.platform_fee_amount <> v_res.platform_fee_amount
    OR v_pay.owner_payout <> v_res.owner_payout
    OR v_pay.platform_fee_amount + v_pay.owner_payout <> v_pay.amount_total
    OR v_pay.transfer_status <> 'not_created'
    OR v_pay.stripe_transfer_id IS NOT NULL
    OR v_pay.transfer_attempt_count <> 0
    OR v_pay.refund_status <> 'not_requested'
    OR v_pay.stripe_refund_id IS NOT NULL
    OR v_pay.stripe_refund_amount_minor <> 0 THEN
    RAISE EXCEPTION 'BOD03B: Stripe payment has unresolved, incompatible or used funds';
  END IF;
  IF EXISTS (SELECT 1 FROM public.reservation_dispute_settlements d
              WHERE d.reservation_id=v_res.id) THEN
    RAISE EXCEPTION 'BOD03B: a settlement decision already exists';
  END IF;
  PERFORM set_config('rentulo.bod03b_reason',btrim(p_admin_reason),true);
  INSERT INTO public.reservation_dispute_settlements
    (reservation_id,payment_id,settlement_route,basis_type,basis_reference,admin_reason)
  VALUES (v_res.id,v_pay.id,p_settlement_route,p_basis_type,
          btrim(p_basis_reference),btrim(p_admin_reason))
  RETURNING id INTO v_id;
  PERFORM set_config('rentulo.bod03b_reason','',true);
  RETURN v_id;
END;
$fn$;

-- Existing owner-transfer eligibility is unchanged EXCEPT one approved 03B route.
-- A renter-refund decision vetoes transfers even if a return is confirmed later.
CREATE OR REPLACE FUNCTION public.bod03b_owner_transfer_allowed(
  p_reservation_id uuid, p_payment_id uuid, p_reservation_status text
)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT
    (
      p_reservation_status IN ('returned','no_show')
      AND NOT EXISTS (SELECT 1 FROM public.reservation_dispute_settlements d
        WHERE d.reservation_id=p_reservation_id
          AND d.settlement_route='renter_full_refund')
    )
    OR
    (
      p_reservation_status='picked_up'
      AND EXISTS (SELECT 1 FROM public.reservation_dispute_settlements d
        WHERE d.reservation_id=p_reservation_id AND d.payment_id=p_payment_id
          AND d.settlement_route='owner_full_payout'
          AND d.status IN ('authorized','succeeded'))
    );
$fn$;
REVOKE ALL ON FUNCTION public.bod03b_owner_transfer_allowed(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bod03b_owner_transfer_allowed(uuid,uuid,text)
  TO service_role;

-- Only the trusted webhook-grade worker may claim and finalize refund work.
-- A short lease and a stable Stripe idempotency key allow recoverable retries.
CREATE OR REPLACE FUNCTION public.bod03b_claim_due_refunds(p_limit integer DEFAULT 2)
RETURNS TABLE (
  settlement_id uuid, claim_token uuid, reservation_id uuid, payment_id uuid,
  stripe_charge_id text, stripe_payment_intent_id text,
  stripe_amount_minor integer, prior_refund_id text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_case public.reservation_dispute_settlements%rowtype;
  v_pay public.payments%rowtype; v_token uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'BOD03B: trusted service role and small batch required';
  END IF;
  FOR v_case IN
    SELECT d.* FROM public.reservation_dispute_settlements d
    WHERE d.settlement_route='renter_full_refund'
      AND (
         (d.status IN ('authorized','awaiting_refund')
          AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=clock_timestamp()))
         OR (d.status='processing' AND d.lease_until<clock_timestamp())
      )
    ORDER BY d.approved_at, d.id
    LIMIT p_limit FOR UPDATE SKIP LOCKED
  LOOP
    SELECT * INTO v_pay FROM public.payments p
      WHERE p.id=v_case.payment_id AND p.reservation_id=v_case.reservation_id
      FOR UPDATE;
    -- Safety: no second payout, invalid payment, or fake return state.
    IF NOT FOUND OR v_pay.provider <> 'stripe' OR v_pay.status <> 'paid'
      OR v_pay.currency <> 'czk' OR v_pay.stripe_payment_intent_status <> 'succeeded'
      OR v_pay.stripe_transfer_id IS NOT NULL
      OR v_pay.transfer_status <> 'not_created'
      OR v_pay.stripe_amount_total_minor <> v_pay.amount_total*100
      OR coalesce(v_pay.stripe_charge_id,'')=''
      OR coalesce(v_pay.stripe_payment_intent_id,'')=''
      OR (v_pay.stripe_refund_id IS NOT NULL AND
          v_pay.stripe_refund_id IS DISTINCT FROM v_case.stripe_refund_id)
      OR (v_pay.refund_status NOT IN ('not_requested','pending','requires_action')
          AND v_case.stripe_refund_id IS NULL) THEN
      -- Record the incompatibility instead of retrying silently for ever.
      PERFORM set_config('rentulo.bod03b_worker','true',true);
      PERFORM set_config('rentulo.bod03b_reason','Refund case financial preflight failed; manual review',true);
      UPDATE public.reservation_dispute_settlements d SET
        status='manual_review', lease_token=NULL, lease_until=NULL,
        next_attempt_at=NULL, last_error='Payment no longer qualifies for approved full refund'
      WHERE d.id=v_case.id;
      PERFORM set_config('rentulo.bod03b_worker','',true);
      PERFORM set_config('rentulo.bod03b_reason','',true);
      CONTINUE;
    END IF;
    v_token := gen_random_uuid();
    PERFORM set_config('rentulo.bod03b_worker','true',true);
    PERFORM set_config('rentulo.bod03b_reason','Trusted refund worker leased an approved case',true);
    UPDATE public.reservation_dispute_settlements d SET
      status='processing', lease_token=v_token,
      lease_until=clock_timestamp()+interval '3 minutes', next_attempt_at=NULL,
      attempt_count=d.attempt_count+1
    WHERE d.id=v_case.id;
    PERFORM set_config('rentulo.bod03b_worker','',true);
    PERFORM set_config('rentulo.bod03b_reason','',true);
    RETURN QUERY SELECT v_case.id,v_token,v_case.reservation_id,v_case.payment_id,
      v_pay.stripe_charge_id,v_pay.stripe_payment_intent_id,
      v_pay.stripe_amount_total_minor,v_case.stripe_refund_id;
  END LOOP;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.bod03b_record_refund_result(
  p_settlement_id uuid, p_claim_token uuid,
  p_stripe_refund_id text, p_refund_status text, p_amount_minor integer,
  p_currency text, p_charge_id text
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_case public.reservation_dispute_settlements%rowtype;
  v_pay public.payments%rowtype; v_new_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'BOD03B: service role required'; END IF;
  IF p_refund_status IS NULL OR p_refund_status NOT IN ('pending','requires_action','succeeded','failed','canceled')
     OR btrim(coalesce(p_stripe_refund_id,''))='' OR p_currency<>'czk' THEN
    RAISE EXCEPTION 'BOD03B: invalid Stripe refund receipt';
  END IF;
  SELECT * INTO v_case FROM public.reservation_dispute_settlements d
    WHERE d.id=p_settlement_id FOR UPDATE;
  IF NOT FOUND OR v_case.status<>'processing'
    OR v_case.lease_token IS DISTINCT FROM p_claim_token
    OR v_case.settlement_route<>'renter_full_refund' THEN
    RAISE EXCEPTION 'BOD03B: expired or mismatched refund lease';
  END IF;
  SELECT * INTO v_pay FROM public.payments p
    WHERE p.id=v_case.payment_id AND p.reservation_id=v_case.reservation_id FOR UPDATE;
  IF NOT FOUND OR v_pay.status<>'paid' OR v_pay.provider<>'stripe'
    OR v_pay.stripe_charge_id IS DISTINCT FROM p_charge_id
    OR p_amount_minor IS DISTINCT FROM v_pay.stripe_amount_total_minor
    OR v_pay.stripe_transfer_id IS NOT NULL OR v_pay.transfer_status<>'not_created'
    OR (v_case.stripe_refund_id IS NOT NULL AND
         v_case.stripe_refund_id IS DISTINCT FROM p_stripe_refund_id)
    OR (v_pay.stripe_refund_id IS NOT NULL AND
         v_pay.stripe_refund_id IS DISTINCT FROM p_stripe_refund_id) THEN
    RAISE EXCEPTION 'BOD03B: refund cannot be reconciled against unchanged payment';
  END IF;
  v_new_status := CASE WHEN p_refund_status='succeeded' THEN 'succeeded'
     WHEN p_refund_status IN ('failed','canceled','requires_action') THEN 'manual_review'
     ELSE 'awaiting_refund' END;
  UPDATE public.payments p SET
    stripe_refund_id=p_stripe_refund_id,
    stripe_refund_amount_minor=p_amount_minor,
    refund_status=p_refund_status,
    refund_requested_at=coalesce(p.refund_requested_at,clock_timestamp()),
    refunded_at=CASE WHEN p_refund_status='succeeded' THEN clock_timestamp()
                    ELSE p.refunded_at END,
    updated_at=clock_timestamp()
  WHERE p.id=v_pay.id;
  PERFORM set_config('rentulo.bod03b_worker','true',true);
  PERFORM set_config('rentulo.bod03b_reason','Stripe refund result reconciled with approved full amount',true);
  UPDATE public.reservation_dispute_settlements d SET
    status=v_new_status, stripe_refund_id=p_stripe_refund_id,
    stripe_refund_status=p_refund_status,
    lease_token=NULL, lease_until=NULL,
    next_attempt_at=CASE WHEN v_new_status='awaiting_refund'
      THEN clock_timestamp()+interval '5 minutes' ELSE NULL END,
    completed_at=CASE WHEN v_new_status='succeeded' THEN clock_timestamp() ELSE NULL END,
    last_error=CASE WHEN v_new_status='manual_review'
      THEN 'Stripe requires individual review of refund status' ELSE NULL END
  WHERE d.id=v_case.id;
  PERFORM set_config('rentulo.bod03b_worker','',true);
  PERFORM set_config('rentulo.bod03b_reason','',true);
  IF v_new_status='succeeded' THEN
    UPDATE public.reservation_return_incidents i SET
      resolved_at=clock_timestamp(), resolution='financially_refunded'
    WHERE i.reservation_id=v_case.reservation_id AND i.resolved_at IS NULL;
  END IF;
  RETURN v_new_status;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.bod03b_record_refund_error(
  p_settlement_id uuid, p_claim_token uuid, p_error text, p_manual_review boolean DEFAULT false
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_case public.reservation_dispute_settlements%rowtype;
  v_next text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'BOD03B: service role required'; END IF;
  SELECT * INTO v_case FROM public.reservation_dispute_settlements d
    WHERE d.id=p_settlement_id FOR UPDATE;
  IF NOT FOUND OR v_case.status<>'processing'
    OR v_case.lease_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'BOD03B: refund lease not current';
  END IF;
  v_next := CASE WHEN p_manual_review OR v_case.attempt_count>=6
    THEN 'manual_review'
    WHEN v_case.stripe_refund_id IS NOT NULL THEN 'awaiting_refund'
    ELSE 'authorized' END;
  PERFORM set_config('rentulo.bod03b_worker','true',true);
  PERFORM set_config('rentulo.bod03b_reason','Stripe transport requires review or scheduled retry',true);
  UPDATE public.reservation_dispute_settlements d SET
    status=v_next, lease_token=NULL, lease_until=NULL,
    next_attempt_at=CASE WHEN v_next='manual_review' THEN NULL
      ELSE clock_timestamp()+interval '15 minutes' END,
    last_error=left(coalesce(nullif(btrim(p_error),''),'Unknown Stripe issue'),300)
  WHERE d.id=v_case.id;
  PERFORM set_config('rentulo.bod03b_worker','',true);
  PERFORM set_config('rentulo.bod03b_reason','',true);
  RETURN v_next;
END;
$fn$;

-- Manual review is a fail-closed state, not a permanently unmanageable case.
-- The Owner may only requeue the SAME immutable decision with a written reason;
-- no route change, no manual refund/transfer, no direct UPDATE of payment fields.
CREATE OR REPLACE FUNCTION public.bod03b_admin_retry_refund(
  p_settlement_id uuid, p_admin_reason text
)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $fn$
DECLARE v_case public.reservation_dispute_settlements%rowtype;
  v_pay public.payments%rowtype; v_next text;
BEGIN
  PERFORM public.platform_admin_assert(p_admin_reason);
  SELECT * INTO v_case FROM public.reservation_dispute_settlements d
    WHERE d.id=p_settlement_id FOR UPDATE;
  IF NOT FOUND OR v_case.settlement_route<>'renter_full_refund'
    OR v_case.status<>'manual_review' THEN
    RAISE EXCEPTION 'BOD03B: only a reviewed full-refund case can be retried';
  END IF;
  SELECT * INTO v_pay FROM public.payments p WHERE p.id=v_case.payment_id FOR UPDATE;
  IF NOT FOUND OR v_pay.status<>'paid' OR v_pay.transfer_status<>'not_created'
    OR v_pay.stripe_transfer_id IS NOT NULL
    OR v_pay.stripe_refund_id IS DISTINCT FROM v_case.stripe_refund_id THEN
    RAISE EXCEPTION 'BOD03B: manually verify financial state before retry';
  END IF;
  v_next:=CASE WHEN v_case.stripe_refund_id IS NULL THEN 'authorized'
               ELSE 'awaiting_refund' END;
  PERFORM set_config('rentulo.bod03b_admin_retry','true',true);
  PERFORM set_config('rentulo.bod03b_reason',btrim(p_admin_reason),true);
  UPDATE public.reservation_dispute_settlements d SET
    status=v_next, lease_token=NULL, lease_until=NULL,
    next_attempt_at=clock_timestamp(), attempt_count=0, last_error=NULL
  WHERE d.id=v_case.id;
  PERFORM set_config('rentulo.bod03b_admin_retry','',true);
  PERFORM set_config('rentulo.bod03b_reason','',true);
  RETURN v_next;
END;
$fn$;

-- Preserve existing incident report; make administrative financial settlement a
-- distinct truthful resolution from a confirmed physical return.
ALTER TABLE public.reservation_return_incidents
  DROP CONSTRAINT IF EXISTS reservation_return_incidents_resolution_check;
ALTER TABLE public.reservation_return_incidents
  DROP CONSTRAINT IF EXISTS return_incident_resolution_pair_check;
ALTER TABLE public.reservation_return_incidents
  ADD CONSTRAINT reservation_return_incidents_resolution_check CHECK (
    resolution IS NULL OR resolution IN
      ('confirmed_returned','financially_settled_owner','financially_refunded')
  ),
  ADD CONSTRAINT return_incident_resolution_pair_check CHECK (
    (resolved_at IS NULL AND resolution IS NULL)
    OR (resolved_at IS NOT NULL AND resolution IN
       ('confirmed_returned','financially_settled_owner','financially_refunded'))
  );

CREATE OR REPLACE FUNCTION public.bod03b_close_owner_settlement_after_transfer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_case public.reservation_dispute_settlements%rowtype;
BEGIN
  IF old.transfer_status IS DISTINCT FROM 'succeeded'
     AND new.transfer_status='succeeded' THEN
    SELECT * INTO v_case FROM public.reservation_dispute_settlements d
      WHERE d.payment_id=new.id AND d.reservation_id=new.reservation_id
        AND d.settlement_route='owner_full_payout' AND d.status='authorized'
      FOR UPDATE;
    IF FOUND THEN
      PERFORM set_config('rentulo.bod03b_worker','true',true);
      PERFORM set_config('rentulo.bod03b_reason','Stripe owner transfer succeeded under documented dispute decision',true);
      UPDATE public.reservation_dispute_settlements d SET
        status='succeeded', completed_at=clock_timestamp()
      WHERE d.id=v_case.id;
      PERFORM set_config('rentulo.bod03b_worker','',true);
      PERFORM set_config('rentulo.bod03b_reason','',true);
      UPDATE public.reservation_return_incidents i SET
        resolved_at=clock_timestamp(), resolution='financially_settled_owner'
      WHERE i.reservation_id=new.reservation_id AND i.resolved_at IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER trg_bod03b_close_owner_settlement
  AFTER UPDATE OF transfer_status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.bod03b_close_owner_settlement_after_transfer();

-- New finance queue uses its own secret: do not reuse a service-role key in Cron.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
DO $secret$
DECLARE v_secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets
                 WHERE name='rentulo_dispute_refund_cron_secret') THEN
    v_secret := replace(gen_random_uuid()::text,'-','')
      || replace(gen_random_uuid()::text,'-','')
      || replace(gen_random_uuid()::text,'-','')
      || replace(gen_random_uuid()::text,'-','');
    PERFORM vault.create_secret(v_secret,'rentulo_dispute_refund_cron_secret',
      'BOD03B TEST refund worker authentication');
  END IF;
END;
$secret$;
CREATE OR REPLACE FUNCTION public.bod03b_verify_refund_cron_secret(p_secret text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT coalesce(char_length(p_secret)>=64 AND EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name='rentulo_dispute_refund_cron_secret'
      AND s.decrypted_secret=p_secret),false);
$fn$;

-- STRICT security: no grants to browser roles or general service API tables.
ALTER TABLE public.reservation_dispute_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_dispute_settlement_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reservation_dispute_settlements,
  public.reservation_dispute_settlement_events
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.reservation_dispute_settlement_events_id_seq
  FROM PUBLIC, anon, authenticated, service_role;
DO $revoke$
DECLARE v_f text;
BEGIN
  FOREACH v_f IN ARRAY ARRAY[
    'bod03b_settlement_guard()',
    'bod03b_audit_event()',
    'bod03b_no_audit_mutation()',
    'bod03b_admin_authorize_settlement(text,text,text,text,text)',
    'bod03b_owner_transfer_allowed(uuid,uuid,text)',
    'bod03b_claim_due_refunds(integer)',
    'bod03b_record_refund_result(uuid,uuid,text,text,integer,text,text)',
    'bod03b_record_refund_error(uuid,uuid,text,boolean)',
    'bod03b_admin_retry_refund(uuid,text)',
    'bod03b_close_owner_settlement_after_transfer()',
    'bod03b_verify_refund_cron_secret(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role',v_f);
  END LOOP;
END;
$revoke$;
GRANT EXECUTE ON FUNCTION public.bod03b_owner_transfer_allowed(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bod03b_claim_due_refunds(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.bod03b_record_refund_result(uuid,uuid,text,text,integer,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bod03b_record_refund_error(uuid,uuid,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.bod03b_verify_refund_cron_secret(text) TO service_role;
-- SQL Editor postgres still owns bod03b_admin_authorize_settlement and may call it.

-- Preserve all existing payment snapshots, retry states, Stripe provider evidence.

-- BOD03B narrowly gated update: claim
create or replace function public.claim_stripe_owner_transfer_attempt(
  p_payment_id uuid,
  p_reservation_id uuid
)
returns table(
  payment_id uuid,
  reservation_id uuid,
  attempt_count integer,
  transfer_status text,
  last_attempt_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_payment public.payments%rowtype;
  v_reservation_status text;
  v_now timestamptz := now();
  v_stale_reference timestamptz;
  v_can_claim boolean := false;
begin
  if auth.role() IS DISTINCT FROM 'service_role' then
    raise exception 'Service role is required';
  end if;

  if p_payment_id is null or p_reservation_id is null then
    raise exception 'Payment and reservation are required';
  end if;

  select p.*
  into v_payment
  from public.payments p
  where p.id = p_payment_id
    and p.reservation_id = p_reservation_id
  for update;

  if not found then
    raise exception 'Payment was not found for reservation';
  end if;

  select r.status
  into v_reservation_status
  from public.reservations r
  where r.id = p_reservation_id;

  if not found then
    raise exception 'Reservation was not found';
  end if;

  -- Only an otherwise eligible, untransferred picked-up reservation can enter
  -- the retry state machine. Detailed Stripe evidence is still revalidated by
  -- create-owner-transfer before money is sent.
  if v_payment.stripe_transfer_id is not null
     or v_payment.transfer_status in ('succeeded', 'reversed')
     or v_payment.provider <> 'stripe'
     or v_payment.status <> 'paid'
     or v_payment.currency <> 'czk'
     or v_payment.stripe_payment_intent_status <> 'succeeded'
     or v_payment.stripe_payment_intent_id is null
     or btrim(v_payment.stripe_payment_intent_id) = ''
     or v_payment.stripe_charge_id is null
     or btrim(v_payment.stripe_charge_id) = ''
     or v_payment.refund_status <> 'not_requested'
     or v_payment.stripe_refund_amount_minor <> 0
     or not public.bod03b_owner_transfer_allowed(p_reservation_id, v_payment.id, v_reservation_status) then
    return;
  end if;

  v_stale_reference := coalesce(v_payment.transfer_last_attempt_at, v_payment.updated_at);

  if v_payment.transfer_status = 'not_created' then
    v_can_claim := true;
  elsif v_payment.transfer_status = 'failed'
        and v_payment.transfer_next_retry_at is not null
        and v_payment.transfer_next_retry_at <= v_now then
    v_can_claim := true;
  elsif v_payment.transfer_status = 'pending'
        and v_stale_reference <= v_now - interval '15 minutes' then
    v_can_claim := true;
  end if;

  if not v_can_claim then
    return;
  end if;

  return query
  update public.payments p
  set
    transfer_status = 'pending',
    transfer_attempt_count = p.transfer_attempt_count + 1,
    transfer_last_attempt_at = v_now,
    transfer_next_retry_at = null,
    transfer_last_error = null,
    updated_at = v_now
  where p.id = v_payment.id
    and p.reservation_id = p_reservation_id
  returning
    p.id,
    p.reservation_id,
    p.transfer_attempt_count,
    p.transfer_status,
    p.transfer_last_attempt_at;
end;
$function$;

-- BOD03B narrowly gated update: record
create or replace function public.record_stripe_owner_transfer_attempt(
  p_payment_id uuid,
  p_reservation_id uuid,
  p_attempt_count integer,
  p_stripe_transfer_id text,
  p_transfer_amount_minor integer,
  p_transfer_currency text,
  p_stripe_charge_balance_transaction_id text,
  p_stripe_charge_balance_amount_minor integer,
  p_stripe_charge_balance_currency text
)
returns table(
  payment_id uuid,
  reservation_id uuid,
  stripe_transfer_id text,
  transfer_amount_minor integer,
  transfer_currency text,
  transfer_status text,
  transfer_created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_payment public.payments%rowtype;
  v_reservation public.reservations%rowtype;
  v_profile public.profiles%rowtype;
  v_now timestamptz := now();
  v_expected_transfer_minor integer;
begin
  if auth.role() IS DISTINCT FROM 'service_role' then
    raise exception 'Service role is required';
  end if;

  if p_attempt_count is null or p_attempt_count < 1 then
    raise exception 'Owner transfer attempt count is invalid';
  end if;

  if p_stripe_transfer_id is null or btrim(p_stripe_transfer_id) = '' then
    raise exception 'Stripe transfer id is required';
  end if;

  if p_transfer_amount_minor is null or p_transfer_amount_minor <= 0 then
    raise exception 'Stripe transfer amount is invalid';
  end if;

  if p_transfer_currency is null
     or p_transfer_currency !~ '^[a-z]{3}$' then
    raise exception 'Stripe transfer currency is invalid';
  end if;

  if p_stripe_charge_balance_transaction_id is null
     or btrim(p_stripe_charge_balance_transaction_id) = '' then
    raise exception 'Stripe balance transaction id is required';
  end if;

  if p_stripe_charge_balance_amount_minor is null
     or p_stripe_charge_balance_amount_minor <= 0 then
    raise exception 'Stripe settlement amount is invalid';
  end if;

  if p_stripe_charge_balance_currency is null
     or p_stripe_charge_balance_currency !~ '^[a-z]{3}$'
     or p_stripe_charge_balance_currency <> p_transfer_currency then
    raise exception 'Stripe settlement currency does not match transfer currency';
  end if;

  select p.*
  into v_payment
  from public.payments p
  where p.id = p_payment_id
    and p.reservation_id = p_reservation_id
  for update;

  if not found then
    raise exception 'Payment was not found for reservation';
  end if;

  select r.*
  into v_reservation
  from public.reservations r
  where r.id = p_reservation_id
  for update;

  if not found then
    raise exception 'Reservation was not found';
  end if;

  select pr.*
  into v_profile
  from public.profiles pr
  where pr.id = v_payment.owner_id;

  if not found then
    raise exception 'Owner profile was not found';
  end if;

  if v_payment.provider <> 'stripe'
     or v_payment.status <> 'paid'
     or v_payment.currency <> 'czk'
     or v_payment.stripe_payment_intent_status <> 'succeeded'
     or v_payment.stripe_payment_intent_id is null
     or btrim(v_payment.stripe_payment_intent_id) = ''
     or v_payment.stripe_charge_id is null
     or btrim(v_payment.stripe_charge_id) = '' then
    raise exception 'Payment is not eligible for owner transfer';
  end if;

  if not public.bod03b_owner_transfer_allowed(p_reservation_id, v_payment.id, v_reservation.status::text) then
    raise exception 'Reservation has not been returned or settled as no-show';
  end if;

  if v_payment.payer_id <> v_reservation.renter_id
     or v_payment.owner_id <> v_reservation.owner_id then
    raise exception 'Payment parties do not match reservation';
  end if;

  if v_payment.amount_total <> v_reservation.total_price
     or v_payment.platform_fee_amount <> v_reservation.platform_fee_amount
     or v_payment.owner_payout <> v_reservation.owner_payout
     or v_payment.platform_fee_amount + v_payment.owner_payout <> v_payment.amount_total then
    raise exception 'Payment snapshot does not match reservation';
  end if;

  if v_payment.stripe_amount_total_minor is null
     or v_payment.stripe_amount_total_minor <> v_payment.amount_total * 100 then
    raise exception 'Stored Stripe amount is invalid';
  end if;

  v_expected_transfer_minor := round(
    p_stripe_charge_balance_amount_minor::numeric
    * v_payment.owner_payout::numeric
    / v_payment.amount_total::numeric
  )::integer;

  if v_expected_transfer_minor <= 0
     or v_expected_transfer_minor > p_stripe_charge_balance_amount_minor
     or p_transfer_amount_minor <> v_expected_transfer_minor then
    raise exception 'Stripe transfer amount does not match owner payout ratio';
  end if;

  if v_payment.refund_status <> 'not_requested'
     or v_payment.stripe_refund_amount_minor <> 0 then
    raise exception 'Refund state blocks owner transfer';
  end if;

  if v_profile.stripe_connected_account_id is null
     or btrim(v_profile.stripe_connected_account_id) = ''
     or v_profile.stripe_connect_status <> 'ready'
     or v_profile.stripe_connect_transfers_enabled is not true then
    raise exception 'Owner Stripe account is not ready';
  end if;

  if v_payment.stripe_charge_balance_transaction_id is not null
     and v_payment.stripe_charge_balance_transaction_id <> p_stripe_charge_balance_transaction_id then
    raise exception 'Existing Stripe balance transaction does not match';
  end if;

  if v_payment.stripe_charge_balance_amount_minor is not null
     and v_payment.stripe_charge_balance_amount_minor <> p_stripe_charge_balance_amount_minor then
    raise exception 'Existing Stripe settlement amount does not match';
  end if;

  if v_payment.stripe_charge_balance_currency is not null
     and v_payment.stripe_charge_balance_currency <> p_stripe_charge_balance_currency then
    raise exception 'Existing Stripe settlement currency does not match';
  end if;

  -- Idempotent success is still allowed when the exact transfer has already been
  -- recorded. This branch performs no mutation and therefore cannot let an old
  -- attempt overwrite a newer one.
  if v_payment.stripe_transfer_id is not null then
    if v_payment.stripe_transfer_id <> p_stripe_transfer_id
       or v_payment.stripe_transfer_amount_minor <> p_transfer_amount_minor
       or v_payment.stripe_transfer_currency <> p_transfer_currency
       or v_payment.stripe_charge_balance_transaction_id <> p_stripe_charge_balance_transaction_id
       or v_payment.stripe_charge_balance_amount_minor <> p_stripe_charge_balance_amount_minor
       or v_payment.stripe_charge_balance_currency <> p_stripe_charge_balance_currency
       or v_payment.transfer_status <> 'succeeded' then
      raise exception 'Existing owner transfer does not match';
    end if;

    return query
    select
      v_payment.id,
      v_reservation.id,
      v_payment.stripe_transfer_id,
      v_payment.stripe_transfer_amount_minor,
      v_payment.stripe_transfer_currency,
      v_payment.transfer_status,
      v_payment.transfer_created_at;
    return;
  end if;

  if v_payment.transfer_status <> 'pending'
     or v_payment.transfer_attempt_count <> p_attempt_count then
    raise exception 'Owner transfer attempt is stale or not pending';
  end if;

  update public.payments p
  set
    stripe_charge_balance_transaction_id = p_stripe_charge_balance_transaction_id,
    stripe_charge_balance_amount_minor = p_stripe_charge_balance_amount_minor,
    stripe_charge_balance_currency = p_stripe_charge_balance_currency,
    stripe_transfer_id = p_stripe_transfer_id,
    stripe_transfer_amount_minor = p_transfer_amount_minor,
    stripe_transfer_currency = p_transfer_currency,
    transfer_status = 'succeeded',
    transfer_created_at = coalesce(p.transfer_created_at, v_now),
    transfer_next_retry_at = null,
    transfer_last_error = null,
    updated_at = v_now
  where p.id = v_payment.id
    and p.reservation_id = p_reservation_id
    and p.stripe_transfer_id is null
    and p.transfer_status = 'pending'
    and p.transfer_attempt_count = p_attempt_count;

  if not found then
    raise exception 'Owner transfer could not be recorded';
  end if;

  return query
  select
    p.id,
    r.id,
    p.stripe_transfer_id,
    p.stripe_transfer_amount_minor,
    p.stripe_transfer_currency,
    p.transfer_status,
    p.transfer_created_at
  from public.payments p
  join public.reservations r on r.id = p.reservation_id
  where p.id = v_payment.id;
end;
$function$;

-- BOD03B narrowly gated update: candidates
create or replace function public.get_due_stripe_owner_transfer_retry_candidates(
  p_limit integer default 10
)
returns table(
  payment_id uuid,
  reservation_id uuid,
  transfer_status text,
  transfer_attempt_count integer,
  eligible_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_now timestamptz := now();
begin
  if auth.role() IS DISTINCT FROM 'service_role' then
    raise exception 'Service role is required';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Owner transfer retry limit must be between 1 and 50';
  end if;

  return query
  select
    p.id,
    r.id,
    p.transfer_status,
    p.transfer_attempt_count,
    case
      when p.transfer_status = 'failed' then p.transfer_next_retry_at
      when p.transfer_status = 'pending' then
        coalesce(p.transfer_last_attempt_at, p.updated_at) + interval '15 minutes'
      else p.updated_at
    end as eligible_at
  from public.payments p
  join public.reservations r
    on r.id = p.reservation_id
  where p.stripe_transfer_id is null
    and p.provider = 'stripe'
    and p.status = 'paid'
    and p.currency = 'czk'
    and p.stripe_payment_intent_status = 'succeeded'
    and p.stripe_payment_intent_id is not null
    and btrim(p.stripe_payment_intent_id) <> ''
    and p.stripe_charge_id is not null
    and btrim(p.stripe_charge_id) <> ''
    and p.refund_status = 'not_requested'
    and p.stripe_refund_amount_minor = 0
    and public.bod03b_owner_transfer_allowed(r.id, p.id, r.status::text)
    and p.owner_id = r.owner_id
    and p.payer_id = r.renter_id
    and p.amount_total = r.total_price
    and p.platform_fee_amount = r.platform_fee_amount
    and p.owner_payout = r.owner_payout
    and p.platform_fee_amount + p.owner_payout = p.amount_total
    and p.stripe_amount_total_minor = p.amount_total * 100
    and (
      p.transfer_status = 'not_created'
      or (
        p.transfer_status = 'failed'
        and p.transfer_next_retry_at is not null
        and p.transfer_next_retry_at <= v_now
      )
      or (
        p.transfer_status = 'pending'
        and coalesce(p.transfer_last_attempt_at, p.updated_at)
          <= v_now - interval '15 minutes'
      )
    )
  order by
    case
      when p.transfer_status = 'failed' then p.transfer_next_retry_at
      when p.transfer_status = 'pending' then
        coalesce(p.transfer_last_attempt_at, p.updated_at) + interval '15 minutes'
      else p.updated_at
    end asc,
    p.id asc
  limit p_limit;
end;
$function$;

-- Re-apply minimal RPC grant posture for the three unchanged-trust workers.
REVOKE ALL ON FUNCTION public.claim_stripe_owner_transfer_attempt(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.record_stripe_owner_transfer_attempt(
  uuid,uuid,integer,text,integer,text,text,integer,text)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_due_stripe_owner_transfer_retry_candidates(integer)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_stripe_owner_transfer_attempt(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_stripe_owner_transfer_attempt(
  uuid,uuid,integer,text,integer,text,text,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_due_stripe_owner_transfer_retry_candidates(integer)
  TO service_role;

-- Only authorized cases are fetched. The cron worker is inert with an empty queue.
SELECT cron.schedule(
  'rentulo-process-dispute-refunds-every-5-minutes',
  '*/5 * * * *',
  $cron$
    SELECT net.http_post(
      url := rtrim(cfg.project_url, '/') || '/functions/v1/process-dispute-refunds',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-rentulo-dispute-cron-secret',cfg.cron_secret
      ),
      body := jsonb_build_object('limit',2),
      timeout_milliseconds := 60000
    ) AS request_id
    FROM (
      SELECT
        (SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name='rentulo_project_url') AS project_url,
        (SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name='rentulo_dispute_refund_cron_secret') AS cron_secret
    ) cfg
    WHERE cfg.project_url='https://vspposovhdgvbeukoivh.supabase.co'
      AND char_length(cfg.cron_secret)>=64;
  $cron$
);
COMMENT ON TABLE public.reservation_dispute_settlements IS
  'BOD03B TEST: immutable dispute authorization, refund/owner transfer mutually exclusive, never fake item return.';
COMMIT;
