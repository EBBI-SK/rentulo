import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root, 'js/results-page.js'), 'utf8');
const photo = 'https://example.supabase.co/storage/v1/object/public/offer-photos/drill.jpg';
const offers = [
  { id: 'offer-a', owner_id: 'owner-a', name: 'Vrtačka', category: 'Stavba', city: 'Zlín', price_per_day: 250, status: 'active', photo_url: photo },
  { id: 'offer-b', owner_id: 'owner-b', name: 'Bruska', category: 'Stavba', city: 'Brno', price_per_day: 150, status: 'active', photo_url: photo }
];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function createPage(ratingResponse) {
  const warnings = [];
  const elements = new Map();
  const element = () => ({
    value: '', min: '', textContent: '', dataset: {}, hidden: false, open: false,
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener() {}, contains() { return false; }, querySelector() { return null; }
  });
  const list = {
    writes: 0, ratings: [], _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(html) {
      this._html = html;
      this.writes++;
      this.ratings = [...html.matchAll(/<strong data-owner-rating-id="([^"]*)">([^<]*)<\/strong>/g)]
        .map((match) => ({
          ownerId: match[1], textContent: match[2],
          getAttribute(name) { return name === 'data-owner-rating-id' ? this.ownerId : null; }
        }));
    },
    querySelectorAll(selector) {
      assert.equal(selector, '[data-owner-rating-id]');
      return this.ratings;
    }
  };
  elements.set('resultsList', list);
  const context = {
    console: { warn: (message) => warnings.push(message), error() {} },
    URLSearchParams,
    localStorage: { removeItem() {} },
    normalizeText: (value) => String(value || '').toLocaleLowerCase('cs-CZ').normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
    getOfferName: (offer) => offer.name,
    getOfferPrice: (offer) => offer.pricePerDay || offer.price_per_day,
    escapeHtml: (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])),
    getSupabaseClient: () => ({
      from(name) {
        if (name === 'public_offers') {
          return { select() { return { async order() { return { data: offers, error: null }; } }; } };
        }
        assert.equal(name, 'user_rating_summary');
        return { select() { return { in() { return ratingResponse.promise; } }; } };
      }
    }),
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
      },
      querySelector() { return null; },
      addEventListener() {}
    },
    window: {
      location: { search: '', pathname: '/vysledky.html' },
      history: { replaceState() {} },
      getRentuloLanguage() { return 'cs'; }
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'results-page.js' });
  return { context, list, elements, warnings };
}

async function startPage(page) {
  const initialization = vm.runInContext('initializeResultsPage()', page.context);
  // Let the already-resolved offers and GPS promises settle, but leave ratings pending.
  await new Promise((resolve) => setImmediate(resolve));
  return { initialization };
}

test('19C4: offers and first-priority image render before owner ratings, then only rating text changes', async () => {
  const ratingResponse = deferred();
  const page = createPage(ratingResponse);
  const { initialization } = await startPage(page);

  assert.match(page.list.innerHTML, /Vrtačka/);
  assert.match(page.list.innerHTML, /loading="eager" fetchpriority="high"/);
  assert.match(page.list.innerHTML, /loading="lazy"/);
  assert.equal(page.list.ratings.length, 2);
  assert.ok(page.list.ratings.every((node) => node.textContent === 'Zatím bez hodnocení'));

  // A filter can change the visible cards while the rating request is still pending.
  page.elements.get('results-search-what').value = 'bruska';
  await vm.runInContext('renderResults()', page.context);
  assert.match(page.list.innerHTML, /Bruska/);
  assert.doesNotMatch(page.list.innerHTML, /Vrtačka/);
  const visibleRatings = page.list.ratings;
  const writesBeforeRatings = page.list.writes;
  const htmlBeforeRatings = page.list.innerHTML;

  ratingResponse.resolve({ data: [
    { user_id: 'owner-a', average_rating: 5, rating_count: 2 },
    { user_id: 'owner-b', average_rating: 4.5, rating_count: 3 }
  ], error: null });
  await initialization;

  assert.equal(page.list.writes, writesBeforeRatings, 'Ratings must not rebuild cards or reload photos');
  assert.equal(page.list.innerHTML, htmlBeforeRatings);
  assert.equal(page.list.ratings, visibleRatings, 'The already-rendered card elements must stay mounted');
  assert.match(page.list.ratings[0].textContent, /4,5 \/ 5 \(3 hodnocení\)/);

  // Subsequent filtering uses cached ratings even on cards that were not visible at response time.
  page.elements.get('results-search-what').value = 'vrtačka';
  await vm.runInContext('renderResults()', page.context);
  assert.match(page.list.ratings[0].textContent, /5 \/ 5 \(2 hodnocení\)/);
  assert.deepEqual(page.warnings, []);
});

test('19C4: failed ratings request does not prevent visible offers and their images', async () => {
  const ratingResponse = deferred();
  const page = createPage(ratingResponse);
  const { initialization } = await startPage(page);
  const writesBeforeRatings = page.list.writes;
  ratingResponse.reject(new Error('Network temporarily unavailable'));
  await initialization;
  assert.match(page.list.innerHTML, /Vrtačka/);
  assert.match(page.list.innerHTML, /<img src=/);
  assert.equal(page.list.writes, writesBeforeRatings);
  assert.equal(page.warnings.length, 1);
});
