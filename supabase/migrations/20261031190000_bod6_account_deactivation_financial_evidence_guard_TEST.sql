-- RENTULO / BOD 6 / TEST ONLY
-- Block account deletion when unpaid extensions, unsettled transfers, disputes,
-- or evidence-preservation cases are still open.
-- Existing finalizer's offer/profile anonymization and return signature stay untouched.
BEGIN;

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name = 'rentulo_project_url'
      AND btrim(s.decrypted_secret, '/') = 'https://vspposovhdgvbeukoivh.supabase.co'
  ) THEN
    RAISE EXCEPTION 'BOD6: TEST Supabase required; PROD is forbidden';
  END IF;

  IF to_regprocedure('public.get_my_account_deactivation_status_v2()') IS NULL
    OR to_regprocedure('public.finalize_account_deactivation(uuid)') IS NULL
    OR to_regclass('public.reservation_extensions') IS NULL
    OR to_regclass('public.stripe_card_disputes') IS NULL
    OR to_regclass('public.reservation_dispute_settlements') IS NULL
    OR to_regclass('public.gdpr_legal_holds') IS NULL
    OR to_regclass('public.reservation_return_incidents') IS NULL
    OR to_regclass('public.platform_incidents') IS NULL
  THEN
    RAISE EXCEPTION 'BOD6: required TEST financial/evidence baseline is missing';
  END IF;
END;
$preflight$;

-- Central predicate used by both the self-service check and the last-mile
-- database trigger. Never returns personal or evidence content, only counts.
CREATE OR REPLACE FUNCTION public.bod6_account_deactivation_blockers(p_user_id uuid)
RETURNS TABLE (
  pending_extensions_count bigint,
  unresolved_extension_payouts_count bigint,
  active_card_disputes_count bigint,
  unresolved_internal_settlements_count bigint,
  active_legal_holds_count bigint,
  unresolved_return_incidents_count bigint,
  open_platform_incidents_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT
    (SELECT count(*) FROM public.reservation_extensions e
     WHERE (e.renter_id = p_user_id OR e.owner_id = p_user_id)
       AND e.status IN ('pending', 'approved')),
    (SELECT count(*) FROM public.reservation_extensions e
     WHERE e.owner_id = p_user_id AND e.status = 'paid'
       AND e.owner_payout > 0 AND e.transfer_status IS DISTINCT FROM 'succeeded'),
    (SELECT count(*) FROM public.stripe_card_disputes d
     JOIN public.reservations r ON r.id = d.reservation_id
     WHERE (r.owner_id = p_user_id OR r.renter_id = p_user_id)
       AND d.payout_blocked),
    (SELECT count(*) FROM public.reservation_dispute_settlements s
     JOIN public.reservations r ON r.id = s.reservation_id
     WHERE (r.owner_id = p_user_id OR r.renter_id = p_user_id)
       AND s.status IS DISTINCT FROM 'succeeded'),
    (SELECT count(*) FROM public.gdpr_legal_holds h
     WHERE h.released_at IS NULL AND (
       h.user_id = p_user_id
       OR EXISTS (SELECT 1 FROM public.offers o
                  WHERE o.id = h.offer_id AND o.owner_id = p_user_id)
       OR EXISTS (SELECT 1 FROM public.reservations r
                  WHERE r.id = h.reservation_id
                    AND (r.owner_id = p_user_id OR r.renter_id = p_user_id))
     )),
    (SELECT count(*) FROM public.reservation_return_incidents i
     JOIN public.reservations r ON r.id = i.reservation_id
     WHERE i.resolved_at IS NULL
       AND (r.owner_id = p_user_id OR r.renter_id = p_user_id)),
    (SELECT count(*) FROM public.platform_incidents i
     WHERE i.status <> 'closed' AND (
       i.subject_user_id = p_user_id
       OR EXISTS (SELECT 1 FROM public.reservations r
                  WHERE r.reservation_number = i.reservation_number
                    AND (r.owner_id = p_user_id OR r.renter_id = p_user_id))
       OR EXISTS (SELECT 1 FROM public.offers o
                  WHERE o.offer_number = i.offer_number AND o.owner_id = p_user_id)
     ));
$fn$;
REVOKE ALL ON FUNCTION public.bod6_account_deactivation_blockers(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bod6_account_deactivation_blockers(uuid)
  TO service_role;

-- V2 signature remains unchanged for existing consumers. V3 adds explicit
-- reason counters, so the frontend does not show misleading zero-blocker text.
CREATE OR REPLACE FUNCTION public.get_my_account_deactivation_status_v3()
RETURNS TABLE (
  account_status text,
  can_deactivate boolean,
  blocking_reservations_count bigint,
  blocking_as_owner_count bigint,
  blocking_as_renter_count bigint,
  offers_to_close_count bigint,
  open_owner_debts_count bigint,
  unfinished_refunds_count bigint,
  unresolved_owner_transfers_count bigint,
  pending_extensions_count bigint,
  unresolved_extension_payouts_count bigint,
  active_card_disputes_count bigint,
  unresolved_internal_settlements_count bigint,
  active_legal_holds_count bigint,
  unresolved_return_incidents_count bigint,
  open_platform_incidents_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT
    base.account_status,
    base.can_deactivate AND (
      extra.pending_extensions_count = 0
      AND extra.unresolved_extension_payouts_count = 0
      AND extra.active_card_disputes_count = 0
      AND extra.unresolved_internal_settlements_count = 0
      AND extra.active_legal_holds_count = 0
      AND extra.unresolved_return_incidents_count = 0
      AND extra.open_platform_incidents_count = 0
    ),
    base.blocking_reservations_count,
    base.blocking_as_owner_count,
    base.blocking_as_renter_count,
    base.offers_to_close_count,
    base.open_owner_debts_count,
    base.unfinished_refunds_count,
    base.unresolved_owner_transfers_count,
    extra.pending_extensions_count,
    extra.unresolved_extension_payouts_count,
    extra.active_card_disputes_count,
    extra.unresolved_internal_settlements_count,
    extra.active_legal_holds_count,
    extra.unresolved_return_incidents_count,
    extra.open_platform_incidents_count
  FROM public.get_my_account_deactivation_status_v2() base
  CROSS JOIN LATERAL public.bod6_account_deactivation_blockers(auth.uid()) extra;
$fn$;
REVOKE ALL ON FUNCTION public.get_my_account_deactivation_status_v3()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_account_deactivation_status_v3()
  TO authenticated;

-- Database-enforced guard: even a direct call to the trusted finalizer cannot
-- transition an active account into 'deactivated' with an unresolved case.
-- If it raises, the finalizer transaction also rolls back offer sanitization.
CREATE OR REPLACE FUNCTION public.bod6_guard_account_deactivation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_pending bigint;
  v_extension_payouts bigint;
  v_card bigint;
  v_internal bigint;
  v_holds bigint;
  v_returns bigint;
  v_incidents bigint;
BEGIN
  IF OLD.account_status = 'active' AND NEW.account_status = 'deactivated' THEN
    SELECT b.pending_extensions_count,
           b.unresolved_extension_payouts_count,
           b.active_card_disputes_count,
           b.unresolved_internal_settlements_count,
           b.active_legal_holds_count,
           b.unresolved_return_incidents_count,
           b.open_platform_incidents_count
      INTO v_pending, v_extension_payouts, v_card, v_internal,
           v_holds, v_returns, v_incidents
    FROM public.bod6_account_deactivation_blockers(OLD.id) b;

    IF v_pending > 0 OR v_extension_payouts > 0 OR v_card > 0
      OR v_internal > 0 OR v_holds > 0 OR v_returns > 0
      OR v_incidents > 0 THEN
      RAISE EXCEPTION 'Account has unresolved financial obligations'
        USING ERRCODE = 'P0001',
          DETAIL = format(
            'pending_extensions=%s, extension_payouts=%s, card_disputes=%s, internal_settlements=%s, legal_holds=%s, return_incidents=%s, platform_incidents=%s',
            v_pending, v_extension_payouts, v_card, v_internal,
            v_holds, v_returns, v_incidents
          );
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.bod6_guard_account_deactivation()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bod6_guard_account_deactivation ON public.profiles;
CREATE TRIGGER bod6_guard_account_deactivation
BEFORE UPDATE OF account_status ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.bod6_guard_account_deactivation();

COMMENT ON FUNCTION public.get_my_account_deactivation_status_v3() IS
  'BOD6 TEST-only read-only deactivation check, including extensions, disputes and evidence holds.';
COMMENT ON FUNCTION public.bod6_guard_account_deactivation() IS
  'BOD6 TEST-only last-mile block of irreversible account/offer anonymization while financial or evidentiary cases remain open.';

COMMIT;
