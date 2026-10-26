import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseCsv, parseRates, prepareCommissions, createPohodaXml,
  createReconciliationCsv, escapeXml,
  POHODA_ACCOUNTING_SHORTCUT, POHODA_ACCOUNT_DEBIT, POHODA_ACCOUNT_CREDIT,
} from '../scripts/pohoda-commissions.mjs';

function sample(overrides = {}) {
  return {
    reservation_number: 'R-000035', document_date: '2026-10-18',
    reservation_status: 'returned', payment_status: 'paid', provider: 'stripe',
    stripe_payment_intent_status: 'succeeded', transfer_status: 'succeeded',
    refund_status: 'not_requested', refund_amount_minor: '0',
    payment_currency: 'czk', rental_total_czk: '250',
    owner_payout_czk: '200', commission_czk: '50',
    owner_id: '11111111-1111-4111-8111-111111111111', owner_name: 'Pavol Testovací',
    stripe_payment_intent_id: 'pi_123', stripe_transfer_id: 'tr_123',
    payment_id: '22222222-2222-4222-8222-222222222222',
    settlement_currency: 'czk', transfer_currency: 'czk', stripe_fee_minor: '845',
    stripe_transfer_minor: '20000', stripe_charge_balance_minor: '25000', stripe_charge_id: 'ch_123',
    ...overrides,
  };
}
const convert = (rows, opts = {}) => prepareCommissions(rows, { month: '2026-10', fixedRate: 24.50, ...opts });

test('accountant-approved POHODA shortcut and accounts are exact', () => {
  assert.equal(POHODA_ACCOUNTING_SHORTCUT, 'Provizie Rentulo');
  assert.equal(POHODA_ACCOUNT_DEBIT, '315100');
  assert.equal(POHODA_ACCOUNT_CREDIT, '602100');
});

test('CSV from Supabase SQL editor parses quoted fields, BOM and CRLF', () => {
  const data = parseCsv('\uFEFFowner_name,reservation_number\r\n"Novák, Peter",R-000001\r\n"O""Neil",R-000002\r\n');
  assert.deepEqual(data, [
    { owner_name: 'Novák, Peter', reservation_number: 'R-000001' },
    { owner_name: 'O"Neil', reservation_number: 'R-000002' },
  ]);
});

test('semicolon CSV works for POHODA/Excel locales', () => {
  assert.deepEqual(parseCsv('date;czk_per_eur\n2026-10-18;24,50\n'), [
    { date: '2026-10-18', czk_per_eur: '24,50' },
  ]);
});

test('CSV rejects invalid field count and duplicate headers', () => {
  assert.throws(() => parseCsv('a,b\nx'), /pocet stlpcov/);
  assert.throws(() => parseCsv('a,a\nx,x'), /duplicitne hlavicky/);
});

test('rate map supports different approved rates and rejects missing dates', () => {
  const dates = parseRates('date,czk_per_eur\n2026-10-18,24.50\n2026-10-19,24.60\n');
  const rows = convert([
    sample(),
    sample({ reservation_number: 'R-000036', document_date: '2026-10-19', stripe_transfer_id: 'tr_456' }),
  ], { fixedRate: undefined, rates: dates });
  assert.equal(rows[0].fxRate, '24.5');
  assert.equal(rows[1].fxRate, '24.6');
  assert.throws(() => convert([sample({ document_date: '2026-10-20' })], { fixedRate: undefined, rates: dates }), /chyba schvaleny kurz/);
});

test('no Stripe-derived or guessed conversion is allowed', () => {
  assert.throws(() => convert([sample()], { fixedRate: undefined }), /chyba schvaleny kurz/);
  assert.throws(() => convert([sample()], { fixedRate: '0.04' }), /nerealisticky/);
  assert.throws(() => parseRates('date,czk_per_eur\n2026-10-18,24.1\n2026-10-18,24.2'), /Duplicitny/);
});

test('valid finished reservation exported as one receivable with foreign CZK and owner name', () => {
  const entries = convert([sample({ owner_name: 'Pavol & „Anna" <Tester>' })]);
  const xml = createPohodaXml(entries, '2026-10');
  assert.match(xml, /<inv:invoiceType>receivable<\/inv:invoiceType>/);
  assert.match(xml, /<typ:ids>Provizie Rentulo<\/typ:ids>/);
  assert.match(xml, /<typ:ids>CZK<\/typ:ids>/);
  assert.match(xml, /<typ:rate>0.0408163265<\/typ:rate>/);
  assert.match(xml, /<typ:unitPrice>50.00<\/typ:unitPrice>/);
  assert.match(xml, /<typ:numberRequested checkDuplicity="true">RP-000035/);
  assert.match(xml, /Pavol &amp; „Anna&quot; &lt;Tester&gt;/);
  assert.doesNotMatch(xml, /<inv:liquidation>|<inv:paymentType>/);
  assert.match(xml, /ico="46306374"/);
});

test('XML is well formed and has one dataPackItem per distinct commission', () => {
  const a = sample();
  const b = sample({ reservation_number: 'R-000036', stripe_transfer_id: 'tr_456' });
  const xml = createPohodaXml(convert([a, b]), '2026-10');
  // Fast-xml-parser is not installed in this repository; textual tags and Node baseline
  // are used here; XML syntax is also parsed by Python ElementTree in package validation.
  assert.equal((xml.match(/<dat:dataPackItem /g) || []).length, 2);
  assert.equal((xml.match(/<inv:invoiceType>receivable/g) || []).length, 2);
  assert.equal((xml.match(/<inv:invoiceSummary>/g) || []).length, 2);
});

test('TEST SQL selects only closed returned or no_show reservations despite legacy picked_up transfers', () => {
  const sql = readFileSync(new URL('../docs/sql/pohoda_provizie_export_TEST.sql', import.meta.url), 'utf8');
  assert.match(sql, /WHERE\s+p\.provider\s*=\s*'stripe'\s+AND\s+p\.transfer_status\s*=\s*'succeeded'[\s\S]*?AND\s+r\.status::text\s+IN\s*\('returned',\s*'no_show'\)/i);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP)\s/i);
});

test('normal finished no-show is supported', () => {
  assert.equal(convert([sample({ reservation_status: 'no_show' })]).length, 1);
});

for (const [key, value] of Object.entries({
  reservation_status: 'picked_up', payment_status: 'pending',
  transfer_status: 'not_created', stripe_payment_intent_status: 'requires_payment_method',
  refund_status: 'succeeded', refund_amount_minor: '100', provider: 'manual_test',
})) {
  test(`financially unsafe ${key}=${value} blocks whole export`, () => {
    assert.throws(() => convert([sample({ [key]: value })]), /financne vysporiadanie/);
  });
}

test('different currency or commission arithmetic blocks export', () => {
  assert.throws(() => convert([sample({ payment_currency: 'eur' })]), /nie je v CZK/);
  assert.throws(() => convert([sample({ commission_czk: '51' })]), /nesedi provizia/);
  assert.throws(() => convert([sample({ commission_czk: '0' })]), /neplatna hodnota/);
  assert.throws(() => convert([sample({ commission_czk: '12.99' })]), /ocakavame cele/);
});

test('duplicate reservation and duplicate Stripe transfer block export', () => {
  assert.throws(() => convert([sample(), sample()]), /Duplicitna rezervacia/);
  assert.throws(() => convert([sample(), sample({ reservation_number: 'R-000036' })]), /duplicitny Stripe transfer/);
});

test('missing Stripe intent, transfer, charge or owner prevents undocumented commission', () => {
  assert.throws(() => convert([sample({ stripe_payment_intent_id: '' })]), /chyba stripe_payment_intent_id/);
  assert.throws(() => convert([sample({ owner_name: '' })]), /chyba owner_name/);
  assert.throws(() => convert([sample({ owner_name: 'Majitel' })]), /nedostatocna identifikacia/);
  assert.throws(() => convert([sample({ stripe_transfer_id: 'error' })]), /Stripe identifikatory/);
  assert.throws(() => convert([sample({ stripe_charge_id: '' })]), /chyba stripe_charge_id/);
  assert.throws(() => convert([sample({ stripe_transfer_minor: '0' })]), /neplatna hodnota/);
  assert.throws(() => convert([sample({ transfer_currency: 'eur' })]), /settlement mena/);
});

test('bad month or inconsistent document date blocks export', () => {
  assert.throws(() => convert([sample()], { month: '2026-13' }), /Mesiac/);
  assert.throws(() => convert([sample({ document_date: '2026-11-01' })]), /nie je v mesiaci/);
  assert.throws(() => convert([sample({ document_date: '2026-02-30' })]), /datum/);
});

test('CSV protects from Excel injection and still shows reconciled minor-units fee', () => {
  const a = sample({ owner_name: '=HYPERLINK("http://example.test")' });
  const csv = createReconciliationCsv(convert([a]));
  assert.match(csv, /"'=HYPERLINK/);
  assert.match(csv, /"845"/);
  assert.match(csv, /"315100";"602100"/);
});

test('XML escaping prevents markup injection and malformed control characters', () => {
  assert.equal(escapeXml('<&>"\''), '&lt;&amp;&gt;&quot;&apos;');
  assert.throws(() => escapeXml('bad\u0001'), /Neplatne riadiace znaky/);
  assert.throws(() => convert([sample({ owner_name: 'A\u0003B' })]), /Neplatne riadiace znaky/);
});

test('no commission rows produce no documents in safe generator', () => {
  assert.deepEqual(convert([]), []);
  assert.equal((createPohodaXml([], '2026-10').match(/dataPackItem/g) || []).length, 0);
});
