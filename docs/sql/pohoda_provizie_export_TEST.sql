-- Rentulo / EBBI: iba citaci export pre internu uctovnicku, Supabase TEST!
-- Pred spustenim v SQL Editore skontrolujte project ref vspposovhdgvbeukoivh.
-- Zmente iba prvy riadok CTE na rok/mesiac exportu.
-- Neexportuje podrobne udaje najomcu ani udaje z bankovych uctov.
WITH requested_month AS (
  SELECT DATE '2026-10-01' AS starts
)
SELECT
  r.reservation_number,
  to_char(p.transfer_created_at AT TIME ZONE 'Europe/Prague', 'YYYY-MM-DD') AS document_date,
  r.status::text AS reservation_status,
  p.status::text AS payment_status,
  p.provider,
  p.stripe_payment_intent_status,
  p.transfer_status,
  p.refund_status,
  p.stripe_refund_amount_minor AS refund_amount_minor,
  p.currency AS payment_currency,
  p.amount_total AS rental_total_czk,
  p.owner_payout AS owner_payout_czk,
  p.platform_fee_amount AS commission_czk,
  r.owner_id::text AS owner_id,
  COALESCE(NULLIF(btrim(r.owner_name), ''), NULLIF(btrim(pr.full_name), ''), '') AS owner_name,
  p.stripe_payment_intent_id,
  p.stripe_transfer_id,
  p.id::text AS payment_id,
  p.stripe_charge_balance_currency AS settlement_currency,
  p.stripe_transfer_currency AS transfer_currency,
  p.stripe_fee_amount_minor AS stripe_fee_minor,
  p.stripe_transfer_amount_minor AS stripe_transfer_minor,
  p.stripe_charge_balance_amount_minor AS stripe_charge_balance_minor,
  p.stripe_charge_id
FROM requested_month m
JOIN public.payments p ON p.transfer_created_at >= (m.starts::timestamp AT TIME ZONE 'Europe/Prague')
  AND p.transfer_created_at < ((m.starts + INTERVAL '1 month')::timestamp AT TIME ZONE 'Europe/Prague')
JOIN public.reservations r ON r.id = p.reservation_id
LEFT JOIN public.profiles pr ON pr.id = r.owner_id
WHERE p.provider = 'stripe'
  AND p.transfer_status = 'succeeded'
  -- Exclude historical picked_up reservations even when their Stripe transfer succeeded.
  AND r.status::text IN ('returned', 'no_show')
ORDER BY p.transfer_created_at, r.reservation_number;
