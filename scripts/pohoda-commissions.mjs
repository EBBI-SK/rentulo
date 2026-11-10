import { createHash } from 'node:crypto';

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
  // Supabase CSV can contain literal "null" for SQL NULL. Never accept that
  // sentinel as a real owner, payment identifier or other required evidence.
  if (absent(value)) throw new Error(`${label}: chyba ${key}.`);
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

// ECB publishes 1 EUR = czkPerEur CZK. For Slovak POHODA home=EUR,
// foreign=CZK, XML typ:rate is EUR per one CZK (inverse), amount=1.
// Rates are indexed by ECB PUBLICATION DATE, not document date.
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

// Official ECB historical reference rates XML (no customer data is sent to ECB).
export const ECB_HISTORY_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml';

export function parseEcbHistoryXml(xml) {
  if (typeof xml !== 'string' || !xml.includes('<Cube')) {
    throw new Error('Neplatny historicky XML kurzovy listok ECB.');
  }
  const dates = new Map();
  // ECB eurofxref-hist.xml has one nested <Cube time="YYYY-MM-DD"> per
  // publication day with self-closing <Cube currency="CZK" rate="..."/>.
  const dateBlocks = /<Cube\s+time=["'](\d{4}-\d{2}-\d{2})["']\s*>([\s\S]*?)<\/Cube>/g;
  for (const match of xml.matchAll(dateBlocks)) {
    const date = validDay(match[1], 'Datum publikacie ECB');
    const czk = match[2].match(/<Cube\s+currency=["']CZK["']\s+rate=["']([^"']+)["']\s*\/>/);
    if (!czk) continue;
    if (dates.has(date)) throw new Error(`Duplicitny datum ECB: ${date}`);
    dates.set(date, validRate(czk[1], `ECB ${date}`));
  }
  if (!dates.size) throw new Error('Historicky XML ECB neobsahuje ziadne kurzy CZK/EUR.');
  return dates;
}

export async function loadEcbHistory(fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetchImpl(ECB_HISTORY_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`ECB odpoved HTTP ${response.status}.`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 16 * 1024 * 1024) throw new Error('ECB XML je necakane velky.');
    return parseEcbHistoryXml(new TextDecoder('utf-8').decode(bytes));
  } catch (error) {
    throw new Error(`Kurz ECB sa nepodarilo nacitat (${error.message}). Skus znova alebo pouzi --rates s overenymi dennymi kurzami ECB.`);
  } finally {
    clearTimeout(timeout);
  }
}

function priorEcbRate(rates, documentDate, reservation) {
  const available = [...rates.keys()].filter((date) => date < documentDate).sort();
  const publicationDay = available.at(-1);
  if (!publicationDay) throw new Error(`${reservation}: chyba kurz ECB pred ${documentDate}.`);
  const daysOld = (Date.parse(`${documentDate}T00:00:00Z`) -
    Date.parse(`${publicationDay}T00:00:00Z`)) / 86400000;
  // A truncated, stale or incorrect rates file must never silently fall back
  // to an arbitrarily old ECB rate. Weekends and TARGET closures fit here.
  if (daysOld > 7) {
    throw new Error(`${reservation}: posledny kurz ECB ${publicationDay} je pre ${documentDate} prilis stary.`);
  }
  return { rate: validRate(rates.get(publicationDay), `ECB ${publicationDay}`), publicationDay };
}

function pragueDateFromUtc(value, reservation) {
  const timestamp = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(timestamp) ||
      !Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`${reservation}: chyba doveryhodny cas potvrdenia vratenia.`);
  }
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp))
    .filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function commissionEur(czk, rateText) {
  // Integer arithmetic avoids floating point rounding surprises for the
  // accountant's 2-decimal EUR preview. rateText has at most six decimals.
  const [whole, fractional = ''] = rateText.split('.');
  const micros = BigInt(whole) * 1000000n + BigInt(fractional.padEnd(6, '0'));
  const euroCents = (BigInt(czk) * 100n * 1000000n + micros / 2n) / micros;
  return `${euroCents / 100n}.${String(euroCents % 100n).padStart(2, '0')}`;
}

// Source identity is immutable: original = payment UUID, extension = extension UUID.
// An extension is not a new payment record in public.payments.
function normalizedSource(row, reservation) {
  const kind = required(row, 'source_type', reservation);
  if (kind !== 'original' && kind !== 'extension') {
    throw new Error(`${reservation}: neznamy zdroj provizie ${kind}.`);
  }
  const id = required(row, 'source_id', reservation).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw new Error(`${reservation}: nespravne UUID zdroja ${kind}.`);
  }
  const documentNumber = kind === 'original'
    ? `RP-${reservation.slice(2)}`
    : `RE-${createHash('sha256').update(id).digest('hex').slice(0, 16).toUpperCase()}`;
  return { kind, id, documentNumber };
}

function absent(value) {
  // Supabase's downloaded SQL CSV represents missing optional values as
  // empty cells or the literal text "null" (sometimes with whitespace/case).
  // Use this only for missing-value checks, never to default required amounts.
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  return text === '' || text.toLowerCase() === 'null';
}

function optionalMinor(value, label) {
  return absent(value) ? '' : String(integer(value, label));
}

function optionalText(value) {
  return absent(value) ? '' : String(value).trim();
}

function count(value, label) {
  return integer(value, label);
}

function parentSafe(row, reservation) {
  if (row.parent_transfer_status !== 'succeeded' ||
      row.parent_refund_status !== 'not_requested' ||
      count(row.parent_refund_amount_minor, `${reservation} parent refund`) !== 0 ||
      absent(row.parent_transfer_at) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(String(row.parent_transfer_at))) {
    throw new Error(`${reservation}: povodna platba nie je bezpecne vysporiadana.`);
  }
}

export function prepareCommissions(rawRows, {
  month, rates = new Map(), extensionReviewRef,
} = {}) {
  validMonth(month);
  if (!(rates instanceof Map)) throw new Error('Nespravny format kurzov.');
  if (!Array.isArray(rawRows)) throw new Error('Vstupom musi byt zoznam financnych riadkov.');
  const results = [];
  const seenSource = new Set();
  const seenDocuments = new Set();
  const seenTransfers = new Set();
  const seenCharges = new Set();
  const seenIntents = new Set();
  const reviewed = typeof extensionReviewRef === 'string' ? extensionReviewRef.trim() : '';
  if (extensionReviewRef !== undefined && (reviewed.length < 8 || reviewed.length > 160)) {
    throw new Error('Referencia manualnej kontroly refundov musi mat 8 az 160 znakov.');
  }
  for (const row of rawRows) {
    const reservation = required(row, 'reservation_number', 'Rezervacia');
    if (!/^R-\d{6,}$/.test(reservation)) throw new Error(`Neplatne cislo rezervacie: ${reservation}`);
    const source = normalizedSource(row, reservation);
    const sourceKey = `${source.kind}:${source.id}`;
    if (seenSource.has(sourceKey)) throw new Error(`${reservation}: duplicitny zdroj ${sourceKey}.`);
    seenSource.add(sourceKey);
    // Validate document identifiers for all sources, including zero-fee extensions,
    // so the truncated UUID collision never silently creates an ambiguous mapping.
    if (seenDocuments.has(source.documentNumber)) {
      throw new Error(`${reservation}: kolizia cisla dokladu ${source.documentNumber}.`);
    }
    seenDocuments.add(source.documentNumber);
    const documentDate = validDay(required(row, 'document_date', reservation), reservation);
    if (documentDate.slice(0, 7) !== month) {
      throw new Error(`${reservation}: datum ${documentDate} nie je v mesiaci ${month}.`);
    }
    if (row.reservation_status === 'no_show') {
      throw new Error(`${reservation}: no_show bez skutocneho vratenia - datum dodania musi posudit uctovnicka; automaticky doklad sa nevystavi.`);
    }
    if (row.reservation_status !== 'returned' ||
        row.payment_status !== 'paid' || row.provider !== 'stripe') {
      throw new Error(`${reservation}: neuplne financne vysporiadanie, export zastaveny.`);
    }
    const basis = required(row, 'document_basis', reservation);
    if (basis !== 'confirmed_return') {
      throw new Error(`${reservation}: chyba doveryhodny datum potvrdeneho vratenia; bezpecny automaticky export nie je mozny.`);
    }
    const returnConfirmedAt = required(row, 'return_confirmed_at', reservation);
    if (pragueDateFromUtc(returnConfirmedAt, reservation) !== documentDate) {
      throw new Error(`${reservation}: datum dokladu nesuhlasi s dnom potvrdeneho vratenia (Praha).`);
    }
    parentSafe(row, reservation);
    if (Date.parse(row.parent_transfer_at) < Date.parse(returnConfirmedAt)) {
      throw new Error(`${reservation}: Stripe transfer predchadza potvrdenemu vrateniu.`);
    }
    if (count(row.card_disputes_count, `${reservation} kartove spory`) !== 0 ||
        count(row.internal_settlements_count, `${reservation} interne spory`) !== 0) {
      throw new Error(`${reservation}: evidovany Stripe spor alebo interne vysporiadanie - rucna kontrola.`);
    }
    if (row.payment_currency !== 'czk') throw new Error(`${reservation}: platba nie je v CZK.`);
    const amount = integer(row.rental_total_czk, `${reservation} suma`, { min: 1 });
    const commission = integer(row.commission_czk, `${reservation} provizia`, {
      min: source.kind === 'original' ? 1 : 0,
    });
    const ownerPayout = integer(row.owner_payout_czk, `${reservation} majitel`);
    if (amount !== commission + ownerPayout) {
      throw new Error(`${reservation}: nesedi provizia + podiel majitela.`);
    }
    const ownerName = required(row, 'owner_name', reservation);
    if (ownerName === 'Majitel' || ownerName === 'Majiteľ') {
      throw new Error(`${reservation}: nedostatocna identifikacia majitela.`);
    }
    const ownerId = required(row, 'owner_id', reservation);
    const paymentOwnerId = required(row, 'parent_payment_owner_id', reservation);
    if (ownerId.toLowerCase() !== paymentOwnerId.toLowerCase() ||
        (source.kind === 'extension' &&
         required(row, 'extension_owner_id', reservation).toLowerCase() !== ownerId.toLowerCase()) ||
        (source.kind === 'original' && !absent(row.extension_owner_id))) {
      throw new Error(`${reservation}: nesuhlasi vlastnik rezervacie a financneho zaznamu.`);
    }
    const paymentId = required(row, 'payment_id', reservation);
    if (!/^[0-9a-f-]{36}$/i.test(paymentId)) {
      throw new Error(`${reservation}: nespravny original payment UUID.`);
    }
    if (source.kind === 'original' && source.id !== paymentId.toLowerCase()) {
      throw new Error(`${reservation}: original source_id nesuhlasi s payment_id.`);
    }
    const intent = required(row, 'stripe_payment_intent_id', reservation);
    const stripeChargeId = required(row, 'stripe_charge_id', reservation);
    if (!/^pi_[\w-]+$/.test(intent) || !/^ch_[\w-]+$/.test(stripeChargeId)) {
      throw new Error(`${reservation}: neplatne Stripe identifikatory.`);
    }
    if (seenIntents.has(intent) || seenCharges.has(stripeChargeId)) {
      throw new Error(`${reservation}: duplicitny Stripe PaymentIntent/Charge.`);
    }
    seenIntents.add(intent);
    seenCharges.add(stripeChargeId);

    const feeMinor = optionalMinor(row.stripe_fee_minor, `${reservation} Stripe fee`);
    const chargeMinor = optionalMinor(row.stripe_charge_balance_minor, `${reservation} Stripe charge`);
    const transferMinor = optionalMinor(row.stripe_transfer_minor, `${reservation} Stripe transfer`);
    const transferId = optionalText(row.stripe_transfer_id);
    const settlementCurrency = optionalText(row.settlement_currency).toLowerCase();
    const transferCurrency = optionalText(row.transfer_currency).toLowerCase();
    let refundVerification = '';
    const rateNeeded = commission > 0;
    if (source.kind === 'original') {
      if (row.stripe_payment_intent_status !== 'succeeded' ||
          row.transfer_status !== 'succeeded' ||
          row.refund_status !== 'not_requested' ||
          count(row.refund_amount_minor, `${reservation} refund`) !== 0) {
        throw new Error(`${reservation}: neuplne financne vysporiadanie, export zastaveny.`);
      }
      if (!/^[a-z]{3}$/.test(settlementCurrency) || transferCurrency !== settlementCurrency ||
          !chargeMinor || Number(chargeMinor) < 1) {
        throw new Error(`${reservation}: chyba suvisiaca Stripe settlement mena alebo castka.`);
      }
      refundVerification = 'DB:NOT_REQUESTED';
    } else {
      if (row.stripe_payment_intent_status !== 'verified_by_webhook' ||
          row.refund_status !== 'not_tracked' || !absent(row.refund_amount_minor) ||
          !absent(row.settlement_currency) || !absent(row.stripe_fee_minor) ||
          !absent(row.stripe_charge_balance_minor) ||
          absent(row.source_paid_at) ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(String(row.source_paid_at))) {
        throw new Error(`${reservation}: neoverene alebo neocakavane zaznamy predlzenia.`);
      }
      refundVerification = 'NOT_TRACKED_IN_EXTENSION_DB';
      if (commission > 0 && !reviewed) {
        throw new Error(`${reservation}: kladna provizia predlzenia vyzaduje --extension-review a kontrolu refundu v Stripe.`);
      }
    }

    if (ownerPayout > 0) {
      if (row.transfer_status !== 'succeeded' ||
          !/^tr_[\w-]+$/.test(transferId) || !transferMinor ||
          Number(transferMinor) < 1 || !/^[a-z]{3}$/.test(transferCurrency)) {
        throw new Error(`${reservation}: vyplata nema platny Stripe transfer.`);
      }
      if (seenTransfers.has(transferId)) {
        throw new Error(`${reservation}: duplicitny Stripe transfer ${transferId}.`);
      }
      seenTransfers.add(transferId);
      if (source.kind === 'original' && Number(transferMinor) > Number(chargeMinor)) {
        throw new Error(`${reservation}: Stripe transfer prevysuje Stripe charge.`);
      }
      if (source.kind === 'extension' && transferCurrency === 'czk' &&
          Number(transferMinor) !== ownerPayout * 100) {
        throw new Error(`${reservation}: Stripe transfer predlzenia nesuhlasi s vyplatou v CZK.`);
      }
    } else if (source.kind !== 'extension' ||
        row.transfer_status !== 'not_created' ||
        transferId || transferMinor || transferCurrency) {
      throw new Error(`${reservation}: nulova vyplata nesmie predstierat uspesny Stripe transfer.`);
    }
    if (source.kind === 'extension' &&
        Date.parse(row.source_paid_at) > Date.parse(returnConfirmedAt)) {
      throw new Error(`${reservation}: predlzenie je zaplatene az po potvrdenom vrateni.`);
    }
    const ecb = rateNeeded ? priorEcbRate(rates, documentDate, reservation) : null;
    const fxRate = ecb?.rate ?? '';
    const fxPublicationDate = ecb?.publicationDay ?? '';
    const output = {
      sourceType: source.kind, sourceId: source.id,
      reservation, documentDate, returnConfirmedAt,
      documentNumber: commission > 0 ? source.documentNumber : '',
      documentBasis: basis, ownerName, ownerId,
      amount, ownerPayout, commission, fxRate, fxPublicationDate,
      commissionEur: ecb ? commissionEur(commission, fxRate) : '',
      paymentId, intent, transfer: transferId, stripeChargeId,
      settlementCurrency, transferCurrency,
      stripeFeeMinor: feeMinor, stripeFeeStatus: source.kind === 'extension'
        ? 'NOT_STORED_CHECK_STRIPE' : (feeMinor ? 'DB_STORED' : 'MISSING_CHECK_STRIPE'),
      stripeTransferMinor: transferMinor,
      stripeChargeBalanceMinor: chargeMinor,
      refundVerification,
      extensionReviewRef: source.kind === 'extension' && commission > 0 ? reviewed : '',
      cardDisputesCount: 0, internalSettlementsCount: 0,
    };
    for (const val of Object.values(output)) if (typeof val === 'string') escapeXml(val);
    results.push(output);
  }
  return results.sort((a, b) => a.documentDate.localeCompare(b.documentDate) ||
    a.reservation.localeCompare(b.reservation) || a.sourceType.localeCompare(b.sourceType) ||
    a.sourceId.localeCompare(b.sourceId));
}

export function createPohodaXml(rows, month) {
  validMonth(month);
  // Zero-commission extension rows stay in reconciliation CSV, NEVER in XML.
  // Document numbers derive from immutable payment/extension identities. The
  // actual duplicate rule must still be checked in a test POHODA company.
  const items = rows.filter((r) => r.commission > 0).map((r) => {
    const detail = r.sourceType === 'extension'
      ? `predĺženie rezervácie ${r.reservation}`
      : `rezervácia ${r.reservation}`;
    return `  <dat:dataPackItem id="${escapeXml(r.documentNumber)}" version="2.0">
    <inv:invoice version="2.0">
      <inv:invoiceHeader>
        <inv:invoiceType>receivable</inv:invoiceType>
        <inv:number><typ:numberRequested checkDuplicity="true">${escapeXml(r.documentNumber)}</typ:numberRequested></inv:number>
        <inv:date>${r.documentDate}</inv:date>
        <inv:dateAccounting>${r.documentDate}</inv:dateAccounting>
        <inv:dateDue>${r.documentDate}</inv:dateDue>
        <inv:accounting><typ:ids>${escapeXml(POHODA_ACCOUNTING_SHORTCUT)}</typ:ids></inv:accounting>
        <inv:text>${escapeXml(`Provízia Rentulo – ${detail}`)}</inv:text>
        <inv:partnerIdentity><typ:address><typ:name>${escapeXml(r.ownerName)}</typ:name></typ:address></inv:partnerIdentity>
        <inv:intNote>${escapeXml(`Rezervacia ${r.reservation}; typ ${r.sourceType}; zdroj ${r.sourceId}; Stripe payment ${r.intent}; Stripe charge ${r.stripeChargeId}; Stripe transfer ${r.transfer || 'bez transferu (nulova vyplata)'}; povodny payment_id ${r.paymentId}; ECB ${r.fxPublicationDate} 1 EUR = ${r.fxRate} CZK. Uhradu a dalsie Stripe kontroly vykona uctovnicka.`)}</inv:intNote>
      </inv:invoiceHeader>
      <inv:invoiceDetail>
        <inv:invoiceItem>
          <inv:text>${escapeXml(`Sprostredkovateľská provízia Rentulo – ${detail}`)}</inv:text>
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
  </dat:dataPackItem>`;
  });
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
    'cislo_dokladu', 'vytvorit_doklad', 'zdroj', 'zdroj_uuid', 'rezervacia', 'datum', 'datum_basis', 'vratenie_potvrdene_utc',
    'prenajimatel', 'prenajimatel_uuid', 'cena_prenajmu_czk', 'majitel_czk', 'provizia_czk',
    'kurz_czk_za_1_eur', 'ecb_kurz_publikovany', 'provizia_eur', 'stripe_payment_intent', 'stripe_charge_id',
    'stripe_transfer_id', 'povodny_payment_uuid',
    'stripe_poplatok_minor_jednotky', 'stripe_poplatok_stav',
    'mena_settlementu', 'mena_transferu',
    'stripe_transfer_minor_jednotky', 'stripe_charge_balance_minor_jednotky',
    'refund_overenie', 'manualna_kontrola_predlzenia',
    'pocet_kartovych_sporov', 'pocet_internych_vysporiadani',
    'predkontacia', 'MD', 'D',
  ];
  const body = rows.map((r) => [
    r.documentNumber, r.commission > 0 ? 'ANO' : 'NIE', r.sourceType, r.sourceId,
    r.reservation, r.documentDate, r.documentBasis, r.returnConfirmedAt, r.ownerName, r.ownerId,
    r.amount, r.ownerPayout, r.commission, r.fxRate, r.fxPublicationDate, r.commissionEur,
    r.intent, r.stripeChargeId, r.transfer, r.paymentId,
    r.stripeFeeMinor, r.stripeFeeStatus,
    r.settlementCurrency, r.transferCurrency, r.stripeTransferMinor,
    r.stripeChargeBalanceMinor, r.refundVerification, r.extensionReviewRef,
    r.cardDisputesCount, r.internalSettlementsCount,
    r.commission > 0 ? POHODA_ACCOUNTING_SHORTCUT : '',
    r.commission > 0 ? POHODA_ACCOUNT_DEBIT : '',
    r.commission > 0 ? POHODA_ACCOUNT_CREDIT : '',
  ].map(protectCsvText).join(';'));
  return '\uFEFF' + names.join(';') + '\r\n' + body.join('\r\n') + (body.length ? '\r\n' : '');
}
