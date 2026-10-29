'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const validFrom = '2035-12-01';
const validTo = '2035-12-04';
const offerA = '123e4567-e89b-42d3-a456-426614174000';
const offerB = '123e4567-e89b-42d3-a456-426614174001';

function makeElement(value = '') {
  return {
    value, hidden: false, textContent: '', innerHTML: '', dataset: {}, min: '',
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener() {}, setAttribute() {}, removeAttribute() {}
  };
}

function loadResults(opts = {}) {
  const elements = {
    'results-date-from': makeElement(opts.from || ''),
    'results-date-to': makeElement(opts.to || ''),
    'results-date-from-label': makeElement(),
    'results-date-to-label': makeElement(),
    'results-date-status': makeElement(),
    'results-search-what': makeElement(),
    'results-search-where': makeElement(),
    'categoryFilter': makeElement(),
    'priceFilter': makeElement(),
    'resultsList': makeElement()
  };
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (opts.rpc) return opts.rpc(name, args);
      return { data: args.p_offer_ids.map((offer_id) => ({ offer_id })), error: null };
    }
  };
  const ctx = {
    URL, URLSearchParams, Intl, Date, Set,
    console: { error() {}, warn() {}, log() {} },
    document: {
      getElementById(name) { return elements[name] || null; },
      addEventListener() {}
    },
    getSupabaseClient() { return client; },
    normalizeText(value) { return String(value || '').toLowerCase(); },
    getOfferId(offer) { return offer.id; },
    getOfferName(offer) { return offer.name; },
    getOfferCategory(offer) { return offer.category; },
    getOfferCity(offer) { return offer.city; },
    getOfferPrice(offer) { return offer.price; },
    escapeHtml(value) { return String(value).replaceAll('&', '&amp;'); }
  };
  ctx.window = ctx;
  ctx.window.location = { search: '', pathname: '/vysledky.html' };
  ctx.window.getRentuloLanguage = () => opts.language || 'cs';
  ctx.window.history = { replaceState() {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/results-page.js'), 'utf8'), ctx);
  vm.runInContext('renderOfferCard = (o) => `<article>${o.id}</article>`;', ctx);
  vm.runInContext('updateNearbyBanner = () => {};', ctx);
  vm.runInContext('renderEmptyResults = () => { document.getElementById("resultsList").innerHTML = "NO_MATCH"; };', ctx);
  return { ctx, elements, calls };
}

function setOffers(ctx, offers) {
  ctx.__offers = offers;
  vm.runInContext('resultsOffers = __offers; resultsLoadState = "ready";', ctx);
}

function sampleOffer(id, min = 1) {
  return { id, name: 'Drill', category: 'Stavba', city: 'Praha', price: 150, min_rental_days: min };
}

test('date range is optional and rejects half-filled, past or reversed windows', () => {
  const { ctx, elements } = loadResults();
  assert.equal(ctx.getResultsDateRange().enabled, false);
  elements['results-date-from'].value = validFrom;
  assert.equal(ctx.getResultsDateRange().error, 'both');
  elements['results-date-to'].value = '2035-11-30';
  assert.equal(ctx.getResultsDateRange().error, 'invalid');
  elements['results-date-to'].value = validTo;
  assert.equal(ctx.getResultsDateRange().days, 3);
  elements['results-date-from'].value = '2020-10-01';
  elements['results-date-to'].value = '2020-10-03';
  assert.equal(ctx.getResultsDateRange().error, 'past');
});

test('without dates the existing results behavior runs without availability RPC', async () => {
  const { ctx, elements, calls } = loadResults();
  setOffers(ctx, [sampleOffer(offerA)]);
  await ctx.renderResults();
  assert.equal(calls.length, 0);
  assert.match(elements.resultsList.innerHTML, new RegExp(offerA));
  assert.equal(elements['results-date-status'].hidden, true);
});

test('available date results follow the server-validated minimum rental duration and conflicts', async () => {
  const { ctx, elements, calls } = loadResults({
    from: validFrom, to: validTo,
    rpc: async () => ({ data: [{ offer_id: offerA }], error: null })
  });
  setOffers(ctx, [sampleOffer(offerA, 1), sampleOffer(offerB, 4)]);
  await ctx.renderResults();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'get_available_offer_ids_for_dates');
  assert.equal(calls[0].args.p_start_date, validFrom);
  assert.equal(calls[0].args.p_end_date, validTo);
  assert.equal(calls[0].args.p_offer_ids.length, 2);
  assert.match(elements.resultsList.innerHTML, new RegExp(offerA));
  assert.doesNotMatch(elements.resultsList.innerHTML, new RegExp(offerB));
  assert.match(ctx.getResultOfferDetailLink(offerA), /\?od=2035-12-01&do=2035-12-04$/);
});

test('the public availability call batches IDs at 50 per request', async () => {
  const { ctx, calls } = loadResults();
  const offers = Array.from({ length: 103 }, (_, i) => ({ id: `offer-${i}` }));
  const allowed = await ctx.getAvailableOfferIdsForDates(offers, validFrom, validTo);
  assert.equal(allowed.size, 103);
  assert.deepEqual(calls.map((item) => item.args.p_offer_ids.length), [50, 50, 3]);
});

test('missing half of a date range and Supabase errors fail closed', async () => {
  const x = loadResults({ from: validFrom, to: '' });
  setOffers(x.ctx, [sampleOffer(offerA)]);
  await x.ctx.renderResults();
  assert.equal(x.calls.length, 0);
  assert.equal(x.elements.resultsList.innerHTML, '');
  assert.equal(x.elements['results-date-status'].hidden, false);

  const y = loadResults({
    from: validFrom, to: validTo,
    rpc: async () => ({ data: null, error: new Error('Temporary error') })
  });
  setOffers(y.ctx, [sampleOffer(offerA)]);
  await y.ctx.renderResults();
  assert.equal(y.elements.resultsList.innerHTML, '');
  assert.equal(y.elements['results-date-status'].hidden, false);
});

test('an old availability response cannot overwrite a later search', async () => {
  let resolveOld;
  const x = loadResults({
    from: validFrom, to: validTo,
    rpc: () => new Promise((resolve) => { resolveOld = resolve; })
  });
  setOffers(x.ctx, [sampleOffer(offerA)]);
  const old = x.ctx.renderResults();
  x.elements['results-date-from'].value = '';
  x.elements['results-date-to'].value = '';
  await x.ctx.renderResults();
  resolveOld({ data: [], error: null });
  await old;
  assert.match(x.elements.resultsList.innerHTML, new RegExp(offerA));
});

test('date-specific labels and messages are translated in five languages', () => {
  for (const language of ['cs', 'sk', 'en', 'de', 'pl']) {
    const { ctx } = loadResults({ language });
    assert.notEqual(ctx.resultsDateText('hint'), 'hint');
    assert.ok(ctx.resultsDateText('checking').length > 18);
    assert.ok(ctx.resultsDateText('both').length > 10);
  }
});

test('detail recognizes only real and correctly ordered dates and retains login handoff', () => {
  const ctx = {
    URL, URLSearchParams, Date,
    console: { warn() {}, log() {}, error() {} },
    document: { addEventListener() {}, getElementById() { return null; } }
  };
  ctx.window = ctx;
  ctx.window.location = {
    pathname: '/nabidka/' + offerA,
    search: `?od=${validFrom}&do=${validTo}`
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/detail-page.js'), 'utf8'), ctx);
  assert.equal(ctx.getDetailSearchDates().from, validFrom);
  assert.match(ctx.getOfferLoginReturnTo(), /od=2035-12-01&do=2035-12-04/);
  const historyUrls = [];
  ctx.window.location.pathname = '/detail.html';
  ctx.window.location.protocol = 'https:';
  ctx.window.history = { state: null, replaceState(_, __, url) { historyUrls.push(url); } };
  ctx.showCanonicalOfferUrl({ id: offerA });
  assert.equal(historyUrls[0], `/nabidka/${offerA}?od=${validFrom}&do=${validTo}`);
  ctx.window.location.search = '?od=2035-02-30&do=2035-03-03';
  assert.equal(ctx.getDetailSearchDates(), null);
  assert.doesNotMatch(ctx.getOfferLoginReturnTo(), /&od=/);
});

test('login permits only sanitized detail date handoffs, never external redirects', () => {
  const ctx = {
    URL, URLSearchParams, Date,
    document: { addEventListener() {} },
    console: { log() {}, warn() {}, error() {} }
  };
  ctx.window = ctx;
  ctx.window.location = {
    origin: 'https://rentulo.eu',
    search: '?returnTo=' + encodeURIComponent(`detail.html?id=${offerA}&od=${validFrom}&do=${validTo}`)
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/login-page.js'), 'utf8'), ctx);
  assert.match(ctx.loginGetSafeReturnTo(), /&od=2035-12-01&do=2035-12-04$/);
  ctx.window.location.search = '?returnTo=' + encodeURIComponent(`detail.html?id=${offerA}&od=2035-02-30&do=2035-03-04`);
  assert.doesNotMatch(ctx.loginGetSafeReturnTo(), /&od=/);
  ctx.window.location.search = '?returnTo=' + encodeURIComponent(`https://bad.example/detail.html?id=${offerA}&od=${validFrom}&do=${validTo}`);
  assert.equal(ctx.loginGetSafeReturnTo(), '');
});

test('SQL only exposes safe offer IDs and uses the canonical exact pickup RPC', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261029162000_search_offers_by_available_dates.sql'), 'utf8');
  assert.match(sql, /RETURNS TABLE \(offer_id uuid\)/);
  assert.match(sql, /p_offer_ids IS NULL OR cardinality\(p_offer_ids\) NOT BETWEEN 1 AND 50/);
  assert.match(sql, /offer\.status = 'active'/);
  assert.match(sql, /offer\.min_rental_days/);
  assert.match(sql, /generate_series\(0, 95\)/);
  assert.match(sql, /NOT public\.has_offer_reservation_time_conflict/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION/);
  assert.doesNotMatch(sql, /RETURNS TABLE\s*\(\s*reservation/);
});

test('date controls exist only on the results screen and preserve original filters', () => {
  const html = fs.readFileSync(path.join(root, 'vysledky.html'), 'utf8');
  assert.match(html, /id="results-date-from" type="date"/);
  assert.match(html, /id="results-date-to" type="date"/);
  assert.match(html, /id="categoryFilter"/);
  assert.match(html, /id="priceFilter"/);
});
