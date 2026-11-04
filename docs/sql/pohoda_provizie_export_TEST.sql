-- RENTULO / POHODA / TEST: iba citaci SELECT (ziadny zapis, ziadna RPC).
-- Spustat LEN v Supabase TEST project ref vspposovhdgvbeukoivh.
-- Zmenit iba mesiac v requested_month. Vysledny CSV je citlivy (mena a UUID).
-- Tento export vracia VSETKY pripravene financne riadky vratane 0 CZK provizii.
-- Neznamenaju automaticky pohladavku: XML generuje len provizie > 0 CZK.
-- Datum dodania pri returned = cas potvrdeneho vratenia (gdpr_finalized_at).
-- Pri no_show a historickom returned bez trusted casu sa nikdy nevytvara doklad:
-- riadok je oznaceny manual_review a generator bezpecne zastavi spracovanie.
-- Kurz ECB sa pouzije z posledneho zverejneneho dna PRED datumom dodania.
-- Kladna provizia predlzenia vyzaduje manualne overenie refundov v Stripe:
-- reservation_extensions NEMA stlpce o refunde, charge balance ani Stripe fee.
-- Pri spore alebo internom vysporiadani exporter zastavi CELY subor.
-- Mesacny vyber je podla dna vratenia; historicke neznáme vratenie a
-- no_show pouzivaju iba pre NAVRH MANUALNEJ KONTROLY cas finalizacie alebo
-- transferu. Nevysvetlujte tento nahradny cas ako datum dodania sluzby.
-- Nevyplatene zaznamy a zaznamy mimo spravneho mesiaca preverit osobitne.
WITH requested_month AS (
  SELECT DATE '2026-10-01' AS starts
), closed_parent AS (
  SELECT
    r.id AS reservation_key,
    r.reservation_number,
    r.status::text AS reservation_status,
    r.owner_id::text AS reservation_owner_id,
    COALESCE(NULLIF(btrim(r.owner_name), ''), NULLIF(btrim(pr.full_name), ''), '') AS reservation_owner_name,
    CASE WHEN r.status::text = 'returned' AND r.gdpr_finalized_at IS NOT NULL
         THEN r.gdpr_finalized_at
         ELSE COALESCE(r.gdpr_finalized_at, p.transfer_created_at)
    END AS accounting_selection_at,
    CASE WHEN r.status::text = 'no_show' THEN 'no_show_manual_review'
         WHEN r.gdpr_finalized_at IS NULL THEN 'return_date_unknown_manual_review'
         ELSE 'confirmed_return'
    END AS accounting_basis,
    CASE WHEN r.status::text = 'returned' THEN r.gdpr_finalized_at
         ELSE NULL::timestamptz END AS return_confirmed_at,
    p.*,
    (SELECT count(*) FROM public.stripe_card_disputes d
       WHERE d.reservation_id = r.id) AS card_disputes_count,
    (SELECT count(*) FROM public.reservation_dispute_settlements s
       WHERE s.reservation_id = r.id) AS internal_settlements_count
  FROM public.payments p
  JOIN public.reservations r ON r.id = p.reservation_id
  LEFT JOIN public.profiles pr ON pr.id = r.owner_id
  WHERE p.provider = 'stripe'
    AND p.transfer_status = 'succeeded'
    AND r.status::text IN ('returned', 'no_show')
), financial_rows AS (
  SELECT
    'original'::text AS source_type,
    p.id::text AS source_id,
    p.reservation_number,
    p.accounting_selection_at AS document_at,
    p.accounting_basis AS document_basis,
    p.reservation_status,
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
    p.reservation_owner_id AS owner_id,
    p.reservation_owner_name AS owner_name,
    p.owner_id::text AS parent_payment_owner_id,
    NULL::text AS extension_owner_id,
    p.stripe_payment_intent_id,
    p.stripe_transfer_id,
    p.id::text AS payment_id,
    p.stripe_charge_balance_currency AS settlement_currency,
    p.stripe_transfer_currency AS transfer_currency,
    p.stripe_fee_amount_minor AS stripe_fee_minor,
    p.stripe_transfer_amount_minor AS stripe_transfer_minor,
    p.stripe_charge_balance_amount_minor AS stripe_charge_balance_minor,
    p.stripe_charge_id,
    p.transfer_status AS parent_transfer_status,
    p.refund_status AS parent_refund_status,
    p.stripe_refund_amount_minor AS parent_refund_amount_minor,
    p.transfer_created_at AS parent_transfer_at,
    NULL::timestamptz AS source_paid_at,
    p.return_confirmed_at,
    p.card_disputes_count,
    p.internal_settlements_count
  FROM closed_parent p
  UNION ALL
  SELECT
    'extension'::text AS source_type,
    e.id::text AS source_id,
    p.reservation_number,
    p.accounting_selection_at AS document_at,
    p.accounting_basis AS document_basis,
    p.reservation_status,
    e.status AS payment_status,
    'stripe'::text AS provider,
    'verified_by_webhook'::text AS stripe_payment_intent_status,
    e.transfer_status,
    'not_tracked'::text AS refund_status,
    NULL::integer AS refund_amount_minor,
    e.currency AS payment_currency,
    e.amount_total AS rental_total_czk,
    e.owner_payout AS owner_payout_czk,
    e.platform_fee_amount AS commission_czk,
    p.reservation_owner_id AS owner_id,
    p.reservation_owner_name AS owner_name,
    p.owner_id::text AS parent_payment_owner_id,
    e.owner_id::text AS extension_owner_id,
    e.stripe_payment_intent_id,
    e.stripe_transfer_id,
    p.id::text AS payment_id, -- UUID povodnej platby, NIE samostatna platba predlzenia
    NULL::text AS settlement_currency, -- neuklada sa pre predlzenia
    e.stripe_transfer_currency AS transfer_currency,
    NULL::integer AS stripe_fee_minor, -- neuklada sa pre predlzenia
    e.stripe_transfer_amount_minor AS stripe_transfer_minor,
    NULL::integer AS stripe_charge_balance_minor, -- neuklada sa pre predlzenia
    e.stripe_charge_id,
    p.transfer_status AS parent_transfer_status,
    p.refund_status AS parent_refund_status,
    p.stripe_refund_amount_minor AS parent_refund_amount_minor,
    p.transfer_created_at AS parent_transfer_at,
    e.paid_at AS source_paid_at,
    p.return_confirmed_at,
    p.card_disputes_count,
    p.internal_settlements_count
  FROM closed_parent p
  JOIN public.reservation_extensions e ON e.reservation_id = p.reservation_key
  WHERE e.status = 'paid'
    AND (e.owner_payout = 0 OR e.transfer_status = 'succeeded')
)
SELECT
  x.source_type, x.source_id, x.reservation_number,
  to_char(x.document_at AT TIME ZONE 'Europe/Prague', 'YYYY-MM-DD') AS document_date,
  x.document_basis,
  x.reservation_status, x.payment_status, x.provider,
  x.stripe_payment_intent_status, x.transfer_status,
  x.refund_status, x.refund_amount_minor, x.payment_currency,
  x.rental_total_czk, x.owner_payout_czk, x.commission_czk,
  x.owner_id, x.owner_name, x.parent_payment_owner_id, x.extension_owner_id,
  x.stripe_payment_intent_id, x.stripe_transfer_id, x.payment_id,
  x.settlement_currency, x.transfer_currency, x.stripe_fee_minor,
  x.stripe_transfer_minor, x.stripe_charge_balance_minor, x.stripe_charge_id,
  x.parent_transfer_status, x.parent_refund_status, x.parent_refund_amount_minor,
  to_char(x.parent_transfer_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS parent_transfer_at,
  to_char(x.source_paid_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS source_paid_at,
  to_char(x.return_confirmed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS return_confirmed_at,
  x.card_disputes_count, x.internal_settlements_count
FROM financial_rows x
CROSS JOIN requested_month m
WHERE x.document_at >= (m.starts::timestamp AT TIME ZONE 'Europe/Prague')
  AND x.document_at < ((m.starts + INTERVAL '1 month')::timestamp AT TIME ZONE 'Europe/Prague')
ORDER BY document_date, reservation_number, source_type, source_id;
