import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  parseCsv, parseRates, parseEcbHistoryXml, loadEcbHistory,
  prepareCommissions, createPohodaXml,
  createReconciliationCsv, escapeXml,
  POHODA_ACCOUNTING_SHORTCUT, POHODA_ACCOUNT_DEBIT, POHODA_ACCOUNT_CREDIT,
} from '../scripts/pohoda-commissions.mjs';

function sample(overrides = {}) {
  const reservation = overrides.reservation_number ?? 'R-000035';
  const n = Number(reservation.replace('R-', ''));
  const payment = overrides.payment_id ?? `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;
  return {
    source_type: 'original', source_id: payment,
    reservation_number: reservation, document_date: '2026-10-18', document_basis: 'confirmed_return',
    return_confirmed_at: '2026-10-18T10:00:00Z',
    reservation_status: 'returned', payment_status: 'paid', provider: 'stripe',
    stripe_payment_intent_status: 'succeeded', transfer_status: 'succeeded',
    refund_status: 'not_requested', refund_amount_minor: '0',
    parent_transfer_status: 'succeeded', parent_refund_status: 'not_requested',
    parent_refund_amount_minor: '0', parent_transfer_at: '2026-10-18T12:00:00Z',
    source_paid_at: '', card_disputes_count: '0', internal_settlements_count: '0',
    payment_currency: 'czk', rental_total_czk: '250',
    owner_payout_czk: '200', commission_czk: '50',
    owner_id: '11111111-1111-4111-8111-111111111111', owner_name: 'Pavol Testovací',
    parent_payment_owner_id: '11111111-1111-4111-8111-111111111111', extension_owner_id: '',
    stripe_payment_intent_id: `pi_${n}`, stripe_transfer_id: `tr_${n}`,
    payment_id: payment, settlement_currency: 'czk', transfer_currency: 'czk',
    stripe_fee_minor: '845', stripe_transfer_minor: '20000',
    stripe_charge_balance_minor: '25000', stripe_charge_id: `ch_${n}`,
    ...overrides,
  };
}
function extension(overrides = {}) {
  return sample({
    source_type: 'extension', source_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
    extension_owner_id: '11111111-1111-4111-8111-111111111111',
    document_date: '2026-10-18', document_basis: 'confirmed_return',
    stripe_payment_intent_status: 'verified_by_webhook',
    stripe_payment_intent_id: 'pi_extension_1', stripe_charge_id: 'ch_extension_1',
    stripe_transfer_id: 'tr_extension_1', stripe_transfer_minor: '15000',
    stripe_fee_minor: '', stripe_charge_balance_minor: '', settlement_currency: '',
    transfer_currency: 'czk', refund_status: 'not_tracked', refund_amount_minor: '',
    rental_total_czk: '150', owner_payout_czk: '150', commission_czk: '0',
    source_paid_at: '2026-10-17T10:00:00Z',
    ...overrides,
  });
}
function zeroPayoutExtension(overrides = {}) {
  return extension({
    rental_total_czk: '150', owner_payout_czk: '0', commission_czk: '150',
    stripe_transfer_id: '', stripe_transfer_minor: '', transfer_currency: '',
    transfer_status: 'not_created', document_basis: 'confirmed_return',
    ...overrides,
  });
}
const DEFAULT_RATES = new Map([
  ['2026-10-16', '24.5'], ['2026-10-19', '24.6'], ['2026-10-30', '24.353'],
]);
const convert = (rows, opts = {}) => prepareCommissions(rows, {
  month: '2026-10', rates: DEFAULT_RATES, ...opts,
});

function csvInput(rows) {
  const columns = Object.keys(rows[0]);
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return columns.join(',') + '\n' + rows.map((row) => columns.map((key) => quote(row[key])).join(',')).join('\n') + '\n';
}

function runCli(rows, extra = []) {
  const root = mkdtempSync(join(tmpdir(), 'rentulo-pohoda-'));
  const input = join(root, 'data.csv');
  const output = join(root, 'outputs');
  writeFileSync(input, csvInput(rows));
  const rates = join(root, 'ecb-rates.csv');
  writeFileSync(rates, 'date,czk_per_eur\n2026-10-16,24.50\n2026-10-19,24.60\n');
  const args = [resolve('scripts/export-pohoda-commissions.mjs'),
    '--month', '2026-10', '--input', input, '--rates', rates, '--out', output,
    ...extra];
  return { root, output, args, run: () => spawnSync(process.execPath, args, { encoding: 'utf8' }) };
}

test('accountant-approved POHODA shortcut, accounts and stable original documents are exact', () => {
  assert.equal(POHODA_ACCOUNTING_SHORTCUT, 'Provizie Rentulo');
  assert.equal(POHODA_ACCOUNT_DEBIT, '315100');
  assert.equal(POHODA_ACCOUNT_CREDIT, '602100');
  assert.equal(convert([sample()])[0].documentNumber, 'RP-000035');
});

test('CSV parsing handles BOM, quoted fields, delimiters and duplicate headers', () => {
  assert.deepEqual(parseCsv('\uFEFFowner_name,reservation_number\r\n"Novák, Peter",R-000001\r\n"O""Neil",R-000002\r\n'), [
    { owner_name: 'Novák, Peter', reservation_number: 'R-000001' },
    { owner_name: 'O"Neil', reservation_number: 'R-000002' },
  ]);
  assert.deepEqual(parseCsv('date;czk_per_eur\n2026-10-18;24,50\n'), [
    { date: '2026-10-18', czk_per_eur: '24,50' },
  ]);
  assert.throws(() => parseCsv('a,b\nx'), /pocet stlpcov/);
  assert.throws(() => parseCsv('a,a\nx,x'), /duplicitne hlavicky/);
});

test('ECB rates use latest publication strictly BEFORE delivery date, never same-day', () => {
  const rates = parseRates('date,czk_per_eur\n2026-10-16,24.50\n2026-10-19,24.60\n2026-10-20,24.70\n');
  const entries = convert([
    sample(), // Sunday 18 Oct -> Friday 16 Oct
    sample({ reservation_number: 'R-000036', document_date: '2026-10-19',
      return_confirmed_at: '2026-10-19T10:00:00Z', parent_transfer_at: '2026-10-19T12:00:00Z',
      stripe_payment_intent_id: 'pi_36', stripe_charge_id: 'ch_36', stripe_transfer_id: 'tr_36' }),
    sample({ reservation_number: 'R-000037', document_date: '2026-10-20',
      return_confirmed_at: '2026-10-20T10:00:00Z', parent_transfer_at: '2026-10-20T12:00:00Z',
      stripe_payment_intent_id: 'pi_37', stripe_charge_id: 'ch_37', stripe_transfer_id: 'tr_37' }),
  ], { rates });
  assert.deepEqual(entries.map((e) => e.fxPublicationDate),
    ['2026-10-16', '2026-10-16', '2026-10-19']);
  assert.deepEqual(entries.map((e) => e.fxRate), ['24.5', '24.5', '24.6']);
  assert.equal(entries[0].commissionEur, '2.04');
  assert.throws(() => convert([sample()], { rates: new Map([['2026-10-18', '24.5']]) }),
    /chyba kurz ECB pred/);
  assert.throws(() => convert([sample()], { rates: new Map([['2026-10-01', '24.5']]) }),
    /prilis stary/);
  assert.equal(convert([extension()], { rates: new Map() })[0].fxRate, '');
  assert.throws(() => parseRates('date,czk_per_eur\n2026-10-16,24.1\n2026-10-16,24.2'), /Duplicitny/);
  assert.throws(() => parseRates('date,czk_per_eur\n2026-10-16,0.04'), /nerealisticky/);
});

test('ECB historical XML loads CZK publications and ignores non-CZK and unpublished days', async () => {
  const xml = `<gesmes:Envelope><Cube>
    <Cube time='2026-10-19'><Cube currency='USD' rate='1.1'/><Cube currency='CZK' rate='24.343'/></Cube>
    <Cube time='2026-10-16'><Cube currency='CZK' rate='24.323'/></Cube>
  </Cube></gesmes:Envelope>`;
  const rates = parseEcbHistoryXml(xml);
  assert.equal(rates.get('2026-10-16'), '24.323');
  assert.equal(rates.get('2026-10-19'), '24.343');
  assert.equal((await loadEcbHistory(async (url) => {
    assert.match(url, /^https:\/\/www\.ecb\.europa\.eu\//);
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode(xml).buffer };
  })).get('2026-10-19'), '24.343');
  assert.throws(() => parseEcbHistoryXml('<Cube time="2026-10-19"><Cube currency="USD" rate="1.1"/></Cube>'), /neobsahuje/);
});

test('original commission remains one receivable, CZK foreign currency, no payment flag', () => {
  const [entry] = convert([sample({ owner_name: 'Pavol & „Anna" <Tester>' })]);
  const xml = createPohodaXml([entry], '2026-10');
  assert.match(xml, /<inv:invoiceType>receivable<\/inv:invoiceType>/);
  assert.match(xml, /<typ:ids>Provizie Rentulo<\/typ:ids>/);
  assert.match(xml, /<typ:ids>CZK<\/typ:ids>/);
  assert.match(xml, /<typ:rate>0.0408163265<\/typ:rate>/);
  assert.match(xml, /ECB 2026-10-16 1 EUR = 24.5 CZK/);
  assert.match(createReconciliationCsv([entry]), /"2026-10-16";"2.04"/);
  assert.match(xml, /<typ:unitPrice>50.00<\/typ:unitPrice>/);
  assert.match(xml, /<typ:numberRequested checkDuplicity="true">RP-000035/);
  assert.match(xml, /Pavol &amp; „Anna&quot; &lt;Tester&gt;/);
  assert.doesNotMatch(xml, /<inv:liquidation>|<inv:paymentType>/);
  assert.match(xml, /ico="46306374"/);
});

test('R-000045: 450+150, base 70 fee and zero extension fee -> one XML invoice, two CSV lines', () => {
  const base = sample({ reservation_number: 'R-000045', rental_total_czk: '450',
    owner_payout_czk: '380', commission_czk: '70', stripe_transfer_minor: '38000',
    stripe_charge_balance_minor: '45000',
  });
  const ext = extension({ reservation_number: 'R-000045' });
  const rows = convert([base, ext]);
  assert.equal(rows.length, 2);
  assert.equal(rows.reduce((s, r) => s + r.amount, 0), 600);
  assert.equal(rows.reduce((s, r) => s + r.commission, 0), 70);
  assert.equal(rows.reduce((s, r) => s + r.ownerPayout, 0), 530);
  assert.equal(rows.find((r) => r.sourceType === 'extension').documentNumber, '');
  const xml = createPohodaXml(rows, '2026-10');
  const csv = createReconciliationCsv(rows);
  assert.equal((xml.match(/<dat:dataPackItem /g) || []).length, 1);
  assert.equal((csv.match(/"R-000045"/g) || []).length, 2);
  assert.match(csv, /NOT_TRACKED_IN_EXTENSION_DB/);
  assert.match(csv, /NOT_STORED_CHECK_STRIPE/);
  assert.match(csv, /"NIE";"extension"/);
  assert.equal(rows.find((r) => r.sourceType === 'extension').stripeFeeMinor, '');
});

test('positive additional commission -> one stable separate extension receivable only after manual Stripe refund review', () => {
  const extra = extension({ commission_czk: '15', owner_payout_czk: '135',
    stripe_transfer_minor: '13500',
  });
  assert.throws(() => convert([extra]), /extension-review/);
  const [row] = convert([extra], { extensionReviewRef: 'STRIPE-REVIEW-2026-10' });
  assert.match(row.documentNumber, /^RE-[0-9A-F]{16}$/);
  assert.notEqual(row.documentNumber, 'RP-000035');
  assert.equal(row.extensionReviewRef, 'STRIPE-REVIEW-2026-10');
  const xml = createPohodaXml([row], '2026-10');
  assert.match(xml, /<typ:unitPrice>15.00<\/typ:unitPrice>/);
  assert.match(xml, /predĺženie rezervácie/);
  assert.match(xml, new RegExp(row.documentNumber));
  assert.match(createReconciliationCsv([row]), /STRIPE-REVIEW-2026-10/);
});

test('multiple paid extensions with stable unique documents, zero lines retained', () => {
  const rows = convert([
    extension(),
    extension({ source_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02',
      stripe_payment_intent_id: 'pi_extension_2', stripe_charge_id: 'ch_extension_2',
      stripe_transfer_id: 'tr_extension_2', commission_czk: '20',
      rental_total_czk: '150', owner_payout_czk: '130', stripe_transfer_minor: '13000',
    }),
    sample(),
  ], { extensionReviewRef: 'STRIPE-REVIEW-2026-10' });
  assert.equal(rows.length, 3);
  assert.equal(rows.filter((r) => r.documentNumber).length, 2);
  assert.equal((createPohodaXml(rows, '2026-10').match(/<dat:dataPackItem /g) || []).length, 2);
  assert.equal(parseCsv(createReconciliationCsv(rows)).length, 3);
});

test('zero-owner-payout extension has NO fictitious Stripe transfer and can have an invoice after manual review', () => {
  const [row] = convert([zeroPayoutExtension()], { extensionReviewRef: 'STRIPE-REVIEW-2026-10' });
  assert.equal(row.ownerPayout, 0);
  assert.equal(row.documentBasis, 'confirmed_return');
  assert.equal(row.transfer, '');
  assert.equal(row.stripeTransferMinor, '');
  assert.equal((createPohodaXml([row], '2026-10').match(/<dat:dataPackItem /g) || []).length, 1);
  assert.throws(() => convert([zeroPayoutExtension({ stripe_transfer_id: 'tr_fake' })], {
    extensionReviewRef: 'STRIPE-REVIEW-2026-10',
  }), /nesmie predstierat/);
});

test('month selection supports extension in a later month without creating a duplicate original invoice', () => {
  const [row] = prepareCommissions([
    extension({ document_date: '2026-11-02', return_confirmed_at: '2026-11-02T09:00:00Z',
      parent_transfer_at: '2026-11-02T10:00:00Z', source_paid_at: '2026-10-30T10:00:00Z' }),
  ], { month: '2026-11' });
  assert.equal(row.documentNumber, '');
  assert.equal(row.documentDate, '2026-11-02');
  assert.throws(() => convert([extension({ document_date: '2026-11-02' })]), /nie je v mesiaci/);
});

test('no-show and unknown historical return require review; no false return-date invoices', () => {
  assert.throws(() => convert([sample({ reservation_status: 'no_show',
    document_basis: 'no_show_manual_review', return_confirmed_at: '' })]), /no_show bez skutocneho vratenia/);
  assert.throws(() => convert([sample({ document_basis: 'return_date_unknown_manual_review',
    return_confirmed_at: '' })]), /doveryhodny datum/);
  assert.throws(() => convert([sample({ return_confirmed_at: '' })]), /chyba return_confirmed_at/);
  assert.throws(() => convert([sample({ document_date: '2026-10-19' })]), /nesuhlasi s dnom/);
  assert.throws(() => convert([sample({ parent_transfer_at: '2026-10-18T09:00:00Z' })]),
    /predchadza potvrdenemu vrateniu/);
});

test('picked_up, pending payment and refunds reject entire export', () => {
  for (const [key, value] of Object.entries({
    reservation_status: 'picked_up', payment_status: 'pending',
    transfer_status: 'not_created', stripe_payment_intent_status: 'requires_payment_method',
    refund_status: 'succeeded', refund_amount_minor: '100', provider: 'manual_test',
  })) {
    assert.throws(() => convert([sample({ [key]: value })]), /vysporiadanie|transfer/);
  }
  assert.throws(() => convert([sample({ parent_refund_status: 'succeeded' })]), /povodna platba/);
});

test('card dispute or internal settlement, even manually closed, blocks automatic booking export', () => {
  for (const key of ['card_disputes_count', 'internal_settlements_count']) {
    assert.throws(() => convert([sample({ [key]: '1' })]), /spor alebo interne vysporiadanie/);
    assert.throws(() => convert([extension({ [key]: '1' })]), /spor alebo interne vysporiadanie/);
  }
  assert.throws(() => convert([sample(), extension({ card_disputes_count: '1' })]), /spor/);
});

test('invalid fees, amounts, transfer evidence and duplicate identifiers block export', () => {
  assert.throws(() => convert([sample({ payment_currency: 'eur' })]), /nie je v CZK/);
  assert.throws(() => convert([sample({ commission_czk: '51' })]), /nesedi provizia/);
  assert.throws(() => convert([sample({ commission_czk: '0' })]), /neplatna hodnota/);
  assert.throws(() => convert([sample({ commission_czk: '12.99' })]), /ocakavame cele/);
  assert.throws(() => convert([extension({ stripe_transfer_minor: '14900' })]), /nesuhlasi s vyplatou/);
  assert.throws(() => convert([extension({ stripe_fee_minor: '0' })]), /neoverene/);
  assert.throws(() => convert([extension({ refund_status: 'not_requested' })]), /neoverene/);
  assert.throws(() => convert([sample(), sample()]), /duplicitny zdroj/);
  assert.throws(() => convert([sample(), sample({
    reservation_number: 'R-000036', stripe_transfer_id: 'tr_35',
  })]), /duplicitny Stripe transfer/);
  assert.throws(() => convert([sample({ owner_name: '' })]), /chyba owner_name/);
  assert.throws(() => convert([sample({ owner_name: 'Majitel' })]), /nedostatocna identifikacia/);
  assert.throws(() => convert([sample({ stripe_payment_intent_id: '' })]), /chyba stripe_payment_intent_id/);
  assert.throws(() => convert([sample({ stripe_charge_id: '' })]), /chyba stripe_charge_id/);
  assert.throws(() => convert([sample({ stripe_transfer_minor: '0' })]), /platny Stripe transfer/);
  assert.throws(() => convert([sample({ transfer_currency: 'eur' })]), /settlement mena/);
  assert.throws(() => convert([sample({ stripe_charge_balance_minor: '' })]), /settlement mena/);
});

test('XML strings, dates and CSV are safe', () => {
  assert.equal(escapeXml('<&>"\''), '&lt;&amp;&gt;&quot;&apos;');
  assert.throws(() => escapeXml('bad\u0001'), /Neplatne riadiace znaky/);
  assert.throws(() => convert([sample({ owner_name: 'A\u0003B' })]), /Neplatne riadiace znaky/);
  assert.throws(() => convert([sample({ document_date: '2026-02-30' })]), /datum/);
  assert.throws(() => convert([sample()], { month: '2026-13' }), /Mesiac/);
  assert.match(createReconciliationCsv(convert([sample({ owner_name: '=HYPERLINK("http://x")' })])), /"'=HYPERLINK/);
  assert.match(createReconciliationCsv(convert([sample()])), /"845"/);
  assert.match(createReconciliationCsv(convert([sample()])), /"315100";"602100"/);
  assert.equal((createPohodaXml(convert([]), '2026-10').match(/<dat:dataPackItem /g) || []).length, 0);
});

test('TEST SQL is a read-only UNION ledger of original and paid extensions; never fabricates missing fee', () => {
  const sql = readFileSync(new URL('../docs/sql/pohoda_provizie_export_TEST.sql', import.meta.url), 'utf8');
  assert.match(sql, /JOIN\s+public\.reservation_extensions\s+e/i);
  assert.match(sql, /e\.status\s*=\s*'paid'/);
  assert.match(sql, /UNION ALL/i);
  assert.match(sql, /e\.owner_payout\s*=\s*0/);
  assert.match(sql, /NULL::integer AS stripe_fee_minor/);
  assert.match(sql, /stripe_card_disputes/);
  assert.match(sql, /reservation_dispute_settlements/);
  assert.match(sql, /WHERE\s+p\.provider\s*=\s*'stripe'/i);
  assert.match(sql, /r\.status::text\s+IN\s*\('returned',\s*'no_show'\)/i);
  assert.match(sql, /r\.gdpr_finalized_at/);
  assert.match(sql, /accounting_selection_at/);
  assert.match(sql, /return_confirmed_at/);
  assert.match(sql, /no_show_manual_review/);
  assert.match(sql, /return_date_unknown_manual_review/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP)\s/i);
});

test('CLI outputs both XML and reconciliation; refuses overwrite of an existing month', () => {
  const scenario = runCli([sample(), extension()]);
  const first = scenario.run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(existsSync(join(scenario.output, 'rentulo-provizie-2026-10.xml')), true);
  assert.equal(existsSync(join(scenario.output, 'rentulo-provizie-2026-10-parovanie.csv')), true);
  const repeat = scenario.run();
  assert.notEqual(repeat.status, 0);
  assert.match(repeat.stderr, /EEXIST/);
});

test('CLI writes only reconciliation CSV when all commissions are zero', () => {
  const scenario = runCli([extension()]);
  const result = scenario.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Len nulove provizie/);
  assert.equal(existsSync(join(scenario.output, 'rentulo-provizie-2026-10.xml')), false);
  assert.equal(existsSync(join(scenario.output, 'rentulo-provizie-2026-10-parovanie.csv')), true);
});

test('CLI blocks positive extension invoice without manual refund review and succeeds after explicit reference', () => {
  const scenario = runCli([extension({ commission_czk: '15', owner_payout_czk: '135', stripe_transfer_minor: '13500' })]);
  const blocked = scenario.run();
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /extension-review/);
  assert.equal(existsSync(join(scenario.output, 'rentulo-provizie-2026-10.xml')), false);
  scenario.args.push('--extension-review', 'STRIPE-CHECK-2026-11-02');
  assert.equal(scenario.run().status, 0);
});

// Additional focused failure-mode cases retain coverage of the original generator.
for (const [name, changes, error] of [
  ['wrong payout total', { owner_payout_czk: '199' }, /nesedi provizia/],
  ['missing bank/Stripe payout ID', { stripe_transfer_id: '' }, /platny Stripe transfer/],
  ['missing owner uuid', { owner_id: '' }, /chyba owner_id/],
  ['missing parent transfer event', { parent_transfer_at: '' }, /povodna platba/],
  ['missing parent status', { parent_transfer_status: 'failed' }, /povodna platba/],
  ['invalid source id', { source_id: 'abc' }, /UUID zdroja/],
  ['mislinked original source', { source_id: '12345678-1234-4123-8123-123456789012' }, /nesuhlasi s payment_id/],
  ['bad original transfer amount', { stripe_transfer_minor: '26000' }, /prevysuje Stripe charge/],
  ['missing fee permitted but flagged', { stripe_fee_minor: '' }, null],
  ['unexpected dispute count', { card_disputes_count: '-1' }, /ocakavame cele/],
  ['unrecognized source', { source_type: 'other' }, /neznamy zdroj/],
  ['bad settlement currency', { settlement_currency: 'eur' }, /settlement mena/],
  ['duplicate month', { document_date: '2026-11-01' }, /nie je v mesiaci/],
]) {
  test(`original evidence validation: ${name}`, () => {
    if (error) assert.throws(() => convert([sample(changes)]), error);
    else assert.equal(convert([sample(changes)])[0].stripeFeeStatus, 'MISSING_CHECK_STRIPE');
  });
}

test('extension IDs differing only in last UUID bytes produce distinct stable document numbers', () => {
  const review = 'VERIFIED-STRIPE-2026-10-18';
  const a = convert([zeroPayoutExtension()], { extensionReviewRef: review })[0].documentNumber;
  const b = convert([zeroPayoutExtension({ source_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02' })], {
    extensionReviewRef: review,
  })[0].documentNumber;
  assert.notEqual(a, b);
  assert.equal(a, convert([zeroPayoutExtension()], { extensionReviewRef: review })[0].documentNumber);
  assert.ok(a.length <= 19);
});

test('unsafe extension refund and missing Stripe identities are never assumed safe', () => {
  assert.throws(() => convert([extension({ stripe_charge_id: '' })]), /chyba stripe_charge_id/);
  assert.throws(() => convert([extension({ source_paid_at: '' })]), /neoverene/);
  assert.throws(() => convert([extension({ transfer_status: 'failed' })]), /platny Stripe transfer/);
  assert.throws(() => convert([extension({ card_disputes_count: '1' })]), /spor/);
  assert.throws(() => convert([zeroPayoutExtension({
    refund_status: 'succeeded',
  })], { extensionReviewRef: 'VERIFIED-STRIPE-2026-10-18' }), /neoverene/);
});

test('accounting packet never creates a zero amount invoice even for multiple zero fee extensions', () => {
  const items = convert([
    extension(),
    extension({ source_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02',
      stripe_payment_intent_id: 'pi_extension_2', stripe_charge_id: 'ch_extension_2',
      stripe_transfer_id: 'tr_extension_2',
    }),
  ]);
  assert.equal((createPohodaXml(items, '2026-10').match(/<dat:dataPackItem /g) || []).length, 0);
  const csvRows = parseCsv(createReconciliationCsv(items));
  assert.equal(csvRows.length, 2);
  assert.ok(csvRows.every((r) => r.vytvorit_doklad === 'NIE' && r.cislo_dokladu === ''));
});


test('cross-owner misattribution blocks all accounting documents', () => {
  assert.throws(() => convert([sample({ parent_payment_owner_id: '99999999-9999-4999-8999-999999999999' })]), /nesuhlasi vlastnik/);
  assert.throws(() => convert([extension({ extension_owner_id: '99999999-9999-4999-8999-999999999999' })]), /nesuhlasi vlastnik/);
});

test('Supabase CSV literal null in optional columns is blank, not fabricated financial evidence', () => {
  const base = sample({
    reservation_number: 'R-000045', rental_total_czk: '450', commission_czk: '70',
    owner_payout_czk: '380', stripe_transfer_minor: '38000',
    stripe_charge_balance_minor: '45000',
    stripe_fee_minor: 'null', source_paid_at: 'null', extension_owner_id: 'null',
  });
  const extra = extension({
    reservation_number: 'R-000045', refund_amount_minor: 'null',
    settlement_currency: ' null ', stripe_fee_minor: 'NULL',
    stripe_charge_balance_minor: 'null',
  });
  const rows = convert(parseCsv(csvInput([base, extra])));
  assert.equal(rows.length, 2);
  assert.equal(rows.reduce((sum, x) => sum + x.amount, 0), 600);
  assert.equal(rows.reduce((sum, x) => sum + x.commission, 0), 70);
  assert.equal(rows.reduce((sum, x) => sum + x.ownerPayout, 0), 530);
  assert.equal(rows.find((x) => x.sourceType === 'original').stripeFeeStatus, 'MISSING_CHECK_STRIPE');
  assert.equal(rows.find((x) => x.sourceType === 'original').stripeFeeMinor, '');
  assert.equal(rows.find((x) => x.sourceType === 'extension').stripeFeeStatus, 'NOT_STORED_CHECK_STRIPE');
  assert.equal(rows.find((x) => x.sourceType === 'extension').settlementCurrency, '');
  assert.equal((createPohodaXml(rows, '2026-10').match(/<dat:dataPackItem /g) || []).length, 1);
  assert.equal(parseCsv(createReconciliationCsv(rows)).length, 2);
});

test('zero-payout extension accepts null only for absent transfer evidence', () => {
  const rows = convert(parseCsv(csvInput([zeroPayoutExtension({
    stripe_transfer_id: 'null', stripe_transfer_minor: 'null', transfer_currency: ' NULL ',
    refund_amount_minor: 'null', stripe_fee_minor: 'null',
    settlement_currency: 'null', stripe_charge_balance_minor: 'null',
  })])), { extensionReviewRef: 'STRIPE-REVIEW-2026-10' });
  assert.equal(rows[0].transfer, '');
  assert.equal(rows[0].stripeTransferMinor, '');
  assert.equal(rows[0].transferCurrency, '');
  assert.equal(rows[0].commission, 150);
  assert.throws(() => convert([extension({ stripe_transfer_id: 'null' })]), /platny Stripe transfer/);
  assert.throws(() => convert([extension({ stripe_transfer_minor: 'null' })]), /platny Stripe transfer/);
});

test('literal null in required owner, payment, refund and dispute evidence still blocks the entire export', () => {
  for (const [key, value] of Object.entries({
    owner_name: 'null', owner_id: ' NULL ', source_id: 'null',
    payment_id: 'null', stripe_payment_intent_id: 'null',
    stripe_charge_id: 'null', stripe_transfer_id: 'null',
    rental_total_czk: 'null', commission_czk: 'null',
    refund_amount_minor: 'null', parent_refund_amount_minor: 'null',
    card_disputes_count: 'null',
  })) {
    assert.throws(() => convert([sample({ [key]: value })]), undefined, `${key} must fail closed`);
  }
  assert.throws(() => convert([extension({ source_paid_at: 'null' })]), /neoverene/);
  assert.throws(() => convert([extension({ extension_owner_id: 'null' })]), /chyba extension_owner_id/);
});


test('CLI rejects old one-rate-per-month option to prevent wrong ECB accounting', () => {
  const scenario = runCli([sample()]);
  scenario.args.push('--rate', '24.5');
  const result = scenario.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Neznamy parameter/);
});

test('Prague date respects UTC boundary and DST for trusted returned timestamp', () => {
  const [oct] = convert([sample({ return_confirmed_at: '2026-10-17T22:30:00Z' })]);
  assert.equal(oct.documentDate, '2026-10-18');
  assert.throws(() => convert([sample({ return_confirmed_at: '2026-10-31T23:30:00Z',
    document_date: '2026-10-31', parent_transfer_at: '2026-11-01T01:00:00Z' })]),
    /nesuhlasi s dnom/);
});
