-- RENTULO V1 / BOD 7.2 / OWNER HISTORY FINANCIAL READ -- TEST ONLY.
-- Read-only snapshot. Does not alter payments, transfers, fee rules or workers.
BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets s
    WHERE s.name = 'rentulo_project_url'
      AND btrim(s.decrypted_secret, '/') = 'https://vspposovhdgvbeukoivh.supabase.co'
  ) THEN
    RAISE EXCEPTION 'BOD7.2: TEST project required; PROD forbidden';
  END IF;

  IF to_regclass('public.reservation_extensions') IS NULL
     OR to_regclass('public.stripe_card_disputes') IS NULL
     OR to_regclass('public.payments') IS NULL THEN
    RAISE EXCEPTION 'BOD7.2: financial security prerequisites are missing';
  END IF;
END;
$guard$;

-- Never expose raw Stripe identifiers, private contact data, or any renter's
-- other payments. The authenticated owner is resolved solely by auth.uid().
-- A missing or refunded original payment remains visible as an unverified
-- snapshot so the website will NOT claim the owner has been paid.
CREATE OR REPLACE FUNCTION public.get_my_history_owner_transfers()
RETURNS TABLE (
  reservation_id uuid,
  original_amount_total integer,
  original_platform_fee_amount integer,
  original_owner_payout integer,
  payment_provider text,
  payment_status text,
  stripe_payment_intent_status text,
  refund_status text,
  original_transfer_status text,
  payout_blocked boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    r.id,
    p.amount_total,
    p.platform_fee_amount,
    p.owner_payout,
    p.provider::text,
    p.status::text,
    p.stripe_payment_intent_status,
    p.refund_status,
    p.transfer_status,
    EXISTS (
      SELECT 1
      FROM public.stripe_card_disputes d
      WHERE d.reservation_id = r.id
        AND d.payout_blocked IS TRUE
    )
  FROM public.reservations r
  LEFT JOIN public.payments p ON p.reservation_id = r.id
  WHERE auth.uid() IS NOT NULL
    AND r.owner_id = auth.uid()
    AND r.status::text IN ('returned', 'no_show')
  ORDER BY r.created_at DESC;
$function$;

REVOKE ALL ON FUNCTION public.get_my_history_owner_transfers()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_history_owner_transfers()
  TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
