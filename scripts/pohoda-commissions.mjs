// Private, offline-only POHODA export engine. Never ship service-role credentials
// or connect to Supabase from the public Rentulo frontend.
export const POHODA_ACCOUNTING_SHORTCUT = 'Provizie Rentulo';
export const POHODA_ACCOUNT_DEBIT = '315100';
export const POHODA_ACCOUNT_CREDIT = '602100';
export const POHODA_COMPANY_ICO = '46306374';

const NS = Object.freeze({
  dat: 'http://www.stormware.cz/schema/version_2/data.xsd',
  inv: 'http://www.stormware.cz/schema/version_2/invoice.xsd',
  typ: 'http://www.stormware.cz/schema/version_2/type.xsd',
});

export function parseCsv(text) {
  if (typeof text !== 'string') throw new Error('CSV vstup musi byt text.');
  const input = text.replace(/^\uFEFF/, '');
  const firstLine = input.split(/\r?\n/, 1)[0] || '';
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') {
      if (field !== '') throw new Error('Neplatny CSV format: uvodzovka v poli.');
      quoted = true;
    } else if (c === delimiter) {
      row.push(field); field = '';
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (quoted) throw new Error('Neuzavrete uvodzovky v CSV.');
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  if (!rows.length) throw new Error('CSV je prazdne.');
  const [headers, ...data] = rows;
  const names = headers.map((s) => s.trim());
  if (new Set(names).size !== names.length) throw new Error('CSV ma duplicitne hlavicky.');
  return data.map((values, i) => {
    if (values.length !== names.length) throw new Error(`CSV riadok ${i + 2}: iny pocet stlpcov.`);
    return Object.fromEntries(names.map((key, j) => [key, values[j]]));
  });
}

export function escapeXml(value) {
  const s = String(value);
  // XML 1.0 forbids nulls, most control characters, and unpaired UTF-16 surrogates.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF]/u.test(s)) {
    throw new Error('Neplatne riadiace znaky v poli XML.');
  }
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function required(row, key, label) {
  const value = String(row[key] ?? '').trim();
  if (!value) throw new Error(`${label}: chyba ${key}.`);
  return value;
}

function integer(value, label, { min = 0 } = {}) {
  if (!/^(0|[1-9]\d*)$/.test(String(value ?? '').trim())) {
    throw new Error(`${label}: ocakavame cele nezaporne cislo.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min) throw new Error(`${label}: neplatna hodnota.`);
  return parsed;
}

function validDay(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label}: neplatny datum YYYY-MM-DD.`);
  }
  return value;
}

function validMonth(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Mesiac musi mat tvar YYYY-MM.');
  return month;
}

// Input is 1 EUR = czkPerEur CZK. For Slovak POHODA home=EUR, foreign=CZK,
// XML typ:rate is EUR per one CZK (inverse), with typ:amount=1. The source
// CZK/EUR rate must come from the accountant; never guess from Stripe.
function validRate(value, label) {
  const str = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,6})?$/.test(str)) throw new Error(`${label}: zadany kurz nie je cislo.`);
  const rate = Number(str);
  if (!(rate >= 1 && rate < 1000)) throw new Error(`${label}: nerealisticky kurz CZK/EUR.`);
  return rate.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

export function parseRates(csv) {
  const rows = parseCsv(csv);
  const map = new Map();
  for (const row of rows) {
    const date = validDay(required(row, 'date', 'Kurzy'), 'Kurzy');
    if (map.has(date)) throw new Error(`Duplicitny datum v kurzovom subore: ${date}`);
    map.set(date, validRate(row.czk_per_eur, `Kurz ${date}`));
  }
  return map;
}

export function prepareCommissions(rawRows, { month, rates = new Map(), fixedRate } = {}) {
  validMonth(month);
  if (!(rates instanceof Map)) throw new Error('Nespravny format kurzov.');
  const fallback = fixedRate === undefined ? undefined : validRate(fixedRate, 'Fixny kurz');
  if (!Array.isArray(rawRows)) throw new Error('Vstupom musi byt zoznam platieb.');
  const results = [];
  const seenReservations = new Set();
  const seenTransfers = new Set();
  for (const row of rawRows) {
    const reservation = required(row, 'reservation_number', 'Rezervacia');
    if (!/^R-\d{6,}$/.test(reservation)) throw new Error(`Neplatne cislo rezervacie: ${reservation}`);
    if (seenReservations.has(reservation)) throw new Error(`Duplicitna rezervacia: ${reservation}`);
    seenReservations.add(reservation);
    const documentDate = validDay(required(row, 'document_date', reservation), reservation);
    if (documentDate.slice(0, 7) !== month) throw new Error(`${reservation}: datum ${documentDate} nie je v mesiaci ${month}.`);
    const allowed = ['returned', 'no_show'].includes(row.reservation_status) &&
      row.payment_status === 'paid' && row.provider === 'stripe' &&
      row.stripe_payment_intent_status === 'succeeded' &&
      row.transfer_status === 'succeeded' && row.refund_status === 'not_requested' &&
      String(row.refund_amount_minor ?? '') === '0';
    if (!allowed) throw new Error(`${reservation}: neuplne financne vysporiadanie, export zastaveny.`);
    if (row.payment_currency !== 'czk') throw new Error(`${reservation}: platba nie je v CZK.`);
    const amount = integer(row.rental_total_czk, `${reservation} suma`, { min: 1 });
    const commission = integer(row.commission_czk, `${reservation} provizia`, { min: 1 });
    const ownerPayout = integer(row.owner_payout_czk, `${reservation} majitel`);
    if (amount !== commission + ownerPayout) throw new Error(`${reservation}: nesedi provizia + podiel majitela.`);
    const ownerName = required(row, 'owner_name', reservation);
    if (ownerName === 'Majitel' || ownerName === 'Majiteľ') throw new Error(`${reservation}: nedostatocna identifikacia majitela.`);
    const transfer = required(row, 'stripe_transfer_id', reservation);
    const intent = required(row, 'stripe_payment_intent_id', reservation);
    const paymentId = required(row, 'payment_id', reservation);
    if (!/^tr_[\w-]+$/.test(transfer) || !/^pi_[\w-]+$/.test(intent)) {
      throw new Error(`${reservation}: neplatne Stripe identifikatory.`);
    }
    if (seenTransfers.has(transfer)) throw new Error(`${reservation}: duplicitny Stripe transfer ${transfer}`);
    seenTransfers.add(transfer);
    const fxRate = rates.get(documentDate) || fallback;
    if (!fxRate) throw new Error(`${reservation}: chyba schvaleny kurz CZK/EUR pre ${documentDate}.`);
    const transferMinor = integer(row.stripe_transfer_minor, `${reservation} Stripe transfer`, { min: 1 });
    const chargeMinor = integer(row.stripe_charge_balance_minor, `${reservation} Stripe charge`, { min: 1 });
    const settlementCurrency = required(row, 'settlement_currency', reservation).toLowerCase();
    const transferCurrency = required(row, 'transfer_currency', reservation).toLowerCase();
    if (!/^[a-z]{3}$/.test(settlementCurrency) || transferCurrency !== settlementCurrency) {
      throw new Error(`${reservation}: chyba suvisiaca Stripe settlement mena.`);
    }
    const stripeChargeId = required(row, 'stripe_charge_id', reservation);
    if (!/^ch_[\w-]+$/.test(stripeChargeId) || transferMinor > chargeMinor) {
      throw new Error(`${reservation}: neplatny Stripe charge alebo transfer.`);
    }
    const output = {
      reservation, documentDate, documentNumber: `RP-${reservation.slice(2)}`,
      ownerName, ownerId: required(row, 'owner_id', reservation),
      amount, ownerPayout, commission, fxRate, paymentId, transfer, intent,
      settlementCurrency,
      transferCurrency,
      stripeFeeMinor: String(row.stripe_fee_minor ?? ''),
      stripeTransferMinor: String(transferMinor),
      stripeChargeBalanceMinor: String(chargeMinor),
      stripeChargeId,
    };
    for (const val of Object.values(output)) if (typeof val === 'string') escapeXml(val);
    results.push(output);
  }
  return results.sort((a, b) => a.documentDate.localeCompare(b.documentDate) || a.reservation.localeCompare(b.reservation));
}

export function createPohodaXml(rows, month) {
  validMonth(month);
  // Stable pack+item IDs AND requested document numbers make re-import safe when
  // the POHODA XML import duplicate check is enabled.
  const items = rows.map((r) => `  <dat:dataPackItem id="${escapeXml(r.documentNumber)}" version="2.0">
    <inv:invoice version="2.0">
      <inv:invoiceHeader>
        <inv:invoiceType>receivable</inv:invoiceType>
        <inv:number><typ:numberRequested checkDuplicity="true">${escapeXml(r.documentNumber)}</typ:numberRequested></inv:number>
        <inv:date>${r.documentDate}</inv:date>
        <inv:dateAccounting>${r.documentDate}</inv:dateAccounting>
        <inv:dateDue>${r.documentDate}</inv:dateDue>
        <inv:accounting><typ:ids>${escapeXml(POHODA_ACCOUNTING_SHORTCUT)}</typ:ids></inv:accounting>
        <inv:text>${escapeXml(`Provízia Rentulo – rezervácia ${r.reservation}`)}</inv:text>
        <inv:partnerIdentity><typ:address><typ:name>${escapeXml(r.ownerName)}</typ:name></typ:address></inv:partnerIdentity>
        <inv:intNote>${escapeXml(`Rezervacia ${r.reservation}; Stripe payment ${r.intent}; Stripe transfer ${r.transfer}; payment_id ${r.paymentId}. Uhradu oznaci uctovnicka na zaklade vypisov.`)}</inv:intNote>
      </inv:invoiceHeader>
      <inv:invoiceDetail>
        <inv:invoiceItem>
          <inv:text>${escapeXml(`Sprostredkovateľská provízia Rentulo – ${r.reservation}`)}</inv:text>
          <inv:quantity>1</inv:quantity>
          <inv:payVAT>false</inv:payVAT>
          <inv:rateVAT>none</inv:rateVAT>
          <inv:foreignCurrency><typ:unitPrice>${r.commission}.00</typ:unitPrice></inv:foreignCurrency>
        </inv:invoiceItem>
      </inv:invoiceDetail>
      <inv:invoiceSummary>
        <inv:foreignCurrency>
          <typ:currency><typ:ids>CZK</typ:ids></typ:currency>
          <typ:rate>${(1 / Number(r.fxRate)).toFixed(10).replace(/0+$/, '').replace(/\.$/, '')}</typ:rate>
          <typ:amount>1</typ:amount>
          <typ:priceNone>${r.commission}.00</typ:priceNone>
        </inv:foreignCurrency>
      </inv:invoiceSummary>
    </inv:invoice>
  </dat:dataPackItem>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<dat:dataPack xmlns:dat="${NS.dat}" xmlns:inv="${NS.inv}" xmlns:typ="${NS.typ}" id="RENTULO-${month}" ico="${POHODA_COMPANY_ICO}" application="Rentulo POHODA export" version="2.0" note="Samostatne ostatne pohladavky za provizie Rentulo">\n${items.join('\n')}\n</dat:dataPack>\n`;
}

function protectCsvText(value) {
  let s = String(value ?? '');
  // Excel/LibreOffice formula injection mitigation for exported user names.
  if (/^[\s]*[=+@\-]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function createReconciliationCsv(rows) {
  const names = [
    'cislo_dokladu', 'rezervacia', 'datum', 'prenajimatel', 'prenajimatel_uuid',
    'cena_prenajmu_czk', 'majitel_czk', 'provizia_czk', 'kurz_czk_za_1_eur',
    'stripe_payment_intent', 'stripe_transfer_id', 'payment_uuid',
    'stripe_poplatok_minor_jednotky', 'mena_settlementu', 'mena_transferu',
    'stripe_transfer_minor_jednotky', 'stripe_charge_balance_minor_jednotky', 'stripe_charge_id',
    'predkontacia', 'MD', 'D'
  ];
  const body = rows.map((r) => [
    r.documentNumber, r.reservation, r.documentDate, r.ownerName, r.ownerId,
    r.amount, r.ownerPayout, r.commission, r.fxRate, r.intent, r.transfer,
    r.paymentId, r.stripeFeeMinor, r.settlementCurrency, r.transferCurrency,
    r.stripeTransferMinor, r.stripeChargeBalanceMinor, r.stripeChargeId,
    POHODA_ACCOUNTING_SHORTCUT, POHODA_ACCOUNT_DEBIT, POHODA_ACCOUNT_CREDIT
  ].map(protectCsvText).join(';'));
  return '\uFEFF' + names.join(';') + '\r\n' + body.join('\r\n') + (body.length ? '\r\n' : '');
}
