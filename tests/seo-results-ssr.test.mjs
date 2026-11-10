import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import handler, {
  renderServerResultsHtml, renderServerOfferCard, canRenderInitialOffers, offerPreviewKey
} from '../api/results-page.mjs';
import { getOfferSeoConfig } from '../api/offer-page.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cfg = getOfferSeoConfig({});
const id = index => `e0aa1a00-0000-4000-8000-${String(index).padStart(12, '0')}`;
const photo = n => `${cfg.supabaseOrigin}/storage/v1/object/public/offer-photos/offer-${n}.jpg`;
const offer = n => ({
  id: id(n), owner_id: id(n + 20), name: n === 1 ? 'Vrtačka' : `Pila ${n}`,
  city: 'Zlín', category: 'Stavba', price_per_day: 250, status: 'active',
  photo_url: photo(n), created_at: `2026-11-09T00:0${n}:00Z`, updated_at: `2026-11-09T00:0${n}:00Z`
});
const htmlTag = (html, tag) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].map(m => m[0]);

function response() {
  return { statusCode: 200, headers: {}, body: '',
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    end(body) { this.body = body; } };
}

async function request(rows, opts = {}) {
  const previous = global.fetch;
  let called = 0;
  let url = '';
  let requestOptions;
  global.fetch = async (input, settings) => {
    called++;
    url = String(input);
    requestOptions = settings;
    if (opts.reject) throw new Error('Supabase unavailable');
    return { ok: !opts.badStatus, json: async () => rows };
  };
  const res = response();
  try {
    await handler({ method: opts.method || 'GET',
      url: opts.url || '/vysledky.html?utm_source=chatgpt.com',
      headers: { host: opts.host || 'rentulo.eu' } }, res);
    return { res, called, url, requestOptions };
  } finally { global.fetch = previous; }
}

test('19C4 SSR: Vercel routes TEST results to a function; PROD static output remains', () => {
  const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
  assert.deepEqual(config.rewrites.find(r => r.source === '/vysledky.html'),
    { source: '/vysledky.html', destination: '/api/results-page' });
  assert.match(config.functions['api/results-page.mjs'].includeFiles, /vysledky\.html/);
  assert.match(config.functions['api/results-page.mjs'].includeFiles, /js\/supabase-config\.js/);
  const dir = mkdtempSync(join(tmpdir(), 'rentulo-ssr-build-'));
  try {
    const cmd = [join(root, 'scripts/build-site.mjs'), dir];
    const testBuild = spawnSync(process.execPath, cmd, { cwd: root, encoding: 'utf8',
      env: { ...process.env, RENTULO_DEPLOY_TARGET: 'test', RENTULO_SUPABASE_URL: '', RENTULO_SUPABASE_PUBLISHABLE_KEY: '' } });
    assert.equal(testBuild.status, 0, testBuild.stderr);
    assert.equal(existsSync(join(dir, 'vysledky.html')), false,
      'A static TEST file would take precedence over the server rewrite');
    assert.ok(existsSync(join(dir, 'js/results-page.js')));
    assert.ok(existsSync(join(dir, 'js/seo.js')));
    const prodKey = 'sb_publishable_' + 'SafeDummyKey_'.repeat(3);
    const prodBuild = spawnSync(process.execPath, cmd, { cwd: root, encoding: 'utf8',
      env: { ...process.env, RENTULO_DEPLOY_TARGET: 'prod',
        RENTULO_SUPABASE_URL: 'https://tfvgxrdjrpicgtvovehl.supabase.co/',
        RENTULO_SUPABASE_PUBLISHABLE_KEY: prodKey } });
    assert.equal(prodBuild.status, 0, prodBuild.stderr);
    const prodPage = readFileSync(join(dir, 'vysledky.html'), 'utf8');
    assert.match(prodPage, /<section class="results-list" id="resultsList" aria-live="polite"><\/section>/);
    assert.match(prodPage, /rel="preconnect" href="https:\/\/tfvgxrdjrpicgtvovehl\.supabase\.co"/);
    assert.doesNotMatch(prodPage, /data-server-preview/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('19C4 SSR: initial HTML has first four live public cards with discoverable, optimized images', () => {
  const page = renderServerResultsHtml([offer(1), offer(2), offer(3), offer(4)], cfg);
  assert.match(page, /<html lang="cs">/);
  assert.match(page, /<meta name="robots" content="noindex"/);
  assert.match(page, /<meta name="description" content="Výsledky vyhledávání věcí k půjčení na Rentulu\."/);
  assert.match(page, /<link rel="preconnect" href="https:\/\/vspposovhdgvbeukoivh\.supabase\.co"/);
  assert.match(page, /<script src="js\/i18n\.js"><\/script>/);
  assert.match(page, /<script src="js\/seo\.js"><\/script>/);
  assert.equal((page.match(/<article class="result-card"/g) || []).length, 4);
  assert.equal((page.match(/data-server-offer-key=/g) || []).length, 4);
  const images = htmlTag(page, 'img');
  const resultImages = images.filter(i => /offer-\d\.jpg/.test(i));
  assert.equal(resultImages.length, 4);
  assert.match(resultImages[0], /render\/image\/public\/offer-photos\/offer-1\.jpg\?width=320&amp;quality=75/);
  assert.match(resultImages[0], /offer-1\.jpg\?width=640&amp;quality=75/);
  assert.match(resultImages[0], /fetchpriority="high"/);
  assert.match(resultImages[0], /loading="eager"/);
  for (const later of resultImages.slice(1)) {
    assert.match(later, /loading="lazy"/);
    assert.doesNotMatch(later, /fetchpriority="high"/);
  }
  assert.match(page, /Zobrazit detail/);
  assert.match(page, /data-owner-rating-id=/);
  assert.doesNotMatch(page, /data-private|service_role|sb_secret_/);
});

test('19C4 SSR: never emit private or malformed listings or untrusted photo sources', () => {
  const row = { ...offer(1), name: '<img src=x onerror=alert(1)>' };
  const card = renderServerOfferCard(row, 0, cfg);
  assert.match(card, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(card, /<img src=x onerror=alert/);
  assert.ok(!renderServerOfferCard({ ...row, photo_url: 'https://external.example/tracker.jpg' }, 0, cfg));
  assert.ok(!renderServerOfferCard({ ...offer(1), status: 'inactive' }, 0, cfg));
  assert.ok(!renderServerOfferCard({ ...offer(1), id: "x' onmouseover='pwned" }, 0, cfg));
  assert.ok(!renderServerOfferCard({ ...offer(1), price_per_day: -1 }, 0, cfg));
  const page = renderServerResultsHtml([offer(1), { ...offer(2), status: 'inactive' }], cfg);
  assert.doesNotMatch(page, /data-server-preview/,
    'Do not render a partial misleading preview if the public response is invalid');
});

test('19C4 SSR: all user filters, GPS and availability bypass the preview; tracking params do not', () => {
  for (const key of ['co', 'kde', 'kategorie', 'cena', 'od', 'do', 'okoli', 'lat', 'lng', 'dostupnost']) {
    assert.equal(canRenderInitialOffers(`/vysledky.html?${key}=1`), false, key);
  }
  assert.equal(canRenderInitialOffers('/vysledky.html'), true);
  assert.equal(canRenderInitialOffers('/vysledky.html?utm_source=chatgpt.com&gclid=123'), true);
});

test('19C4 SSR: function fetches only active public offers with a publishable key and no-store', async () => {
  const { res, called, url, requestOptions } = await request([offer(1), offer(2)]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-rentulo-ssr'], 'rendered');
  assert.equal(res.headers['cache-control'], 'private, no-store');
  assert.equal(res.headers['x-robots-tag'], 'noindex');
  assert.equal(called, 1);
  const params = new URL(url).searchParams;
  assert.equal(params.get('status'), 'eq.active');
  assert.equal(params.get('limit'), '4');
  assert.equal(params.get('order'), 'created_at.desc');
  assert.equal(params.get('select'), 'id,owner_id,name,category,city,price_per_day,status,photo_url,created_at,updated_at');
  assert.ok(requestOptions.headers.apikey.startsWith('sb_publishable_'));
  assert.equal(requestOptions.cache, 'no-store');
  assert.match(res.body, /Vrtačka/);
});

test('19C4 SSR: filtered URL and HEAD need no database request', async () => {
  const filtered = await request([offer(1)], { url: '/vysledky.html?co=bruska&od=2026-12-01' });
  assert.equal(filtered.called, 0);
  assert.equal(filtered.res.headers['x-rentulo-ssr'], 'client-filtered');
  assert.doesNotMatch(filtered.res.body, /data-server-preview/);
  const head = await request([offer(1)], { method: 'HEAD' });
  assert.equal(head.called, 0);
  assert.equal(head.res.body, '');
});

test('19C4 SSR: upstream errors return a usable page with JS fallback (no stale photos)', async () => {
  for (const opts of [{ reject: true }, { badStatus: true }]) {
    const { res } = await request([], opts);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['x-rentulo-ssr'], 'fallback');
    assert.match(res.body, /<section class="results-list" id="resultsList" aria-live="polite"><\/section>/);
    assert.match(res.body, /<script src="js\/results-page\.js"><\/script>/);
    assert.doesNotMatch(res.body, /data-server-preview/);
  }
});

test('19C4 SSR: unexpected request methods and PROD hosts are denied', async () => {
  const post = await request([], { method: 'POST' });
  assert.equal(post.res.statusCode, 405);
  assert.equal(post.called, 0);
  const prod = await request([offer(1)], { host: 'rentulo.com' });
  assert.equal(prod.res.statusCode, 404);
  assert.equal(prod.called, 0);
});

test('19C4 SSR: client keeps server images on live-data match and replaces them on mismatch', async () => {
  const source = readFileSync(join(root, 'js/results-page.js'), 'utf8');
  const initial = [offer(1), offer(2)];
  function setup(match) {
    const first = { ...initial[0] };
    const second = { ...initial[1] };
    if (!match) first.name = 'Změněná vrtačka';
    const serverCards = initial.map(row => ({
      attrs: { 'data-server-offer-key': offerPreviewKey(row) },
      getAttribute(name) { return this.attrs[name] ?? null; },
      removeAttribute(name) { delete this.attrs[name]; }
    }));
    const list = {
      attrs: { 'data-server-preview': '1' },
      writes: 0, appends: 0, html: 'SERVER_FIRST_CARDS',
      get innerHTML() { return this.html; },
      set innerHTML(value) { this.html = value; this.writes++; },
      getAttribute(name) { return this.attrs[name] ?? null; },
      removeAttribute(name) { delete this.attrs[name]; },
      querySelectorAll(selector) {
        if (selector === '[data-server-offer-key]') return serverCards;
        return [];
      },
      insertAdjacentHTML(position, value) {
        assert.equal(position, 'beforeend');
        this.appends++;
        this.html += value;
      }
    };
    const elements = new Map([['resultsList', list]]);
    const generic = () => ({ value: '', dataset: {}, hidden: false, textContent: '',
      classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} });
    const context = {
      URLSearchParams, console,
      normalizeText: value => String(value || '').toLocaleLowerCase('cs-CZ').normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
      getOfferName: row => row.name,
      getOfferPrice: row => Number(row.pricePerDay ?? row.price_per_day),
      escapeHtml: value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])),
      document: { getElementById(name) {
        if (!elements.has(name)) elements.set(name, generic());
        return elements.get(name);
      }, addEventListener() {} },
      window: { getRentuloLanguage: () => 'cs', location: { search:'', pathname: '/vysledky.html' } }
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    vm.runInContext('resultsLoadState = "ready";', context);
    // Match the same normalized public view shape as loadOffersFromSupabase().
    context.firstOffers = [first, second].map(row => ({
      ...row, price: row.price_per_day, pricePerDay: row.price_per_day,
      photoUrl: row.photo_url, ownerId: row.owner_id,
      updatedAt: row.updated_at, supabaseStatus: row.status
    }));
    vm.runInContext('resultsOffers = firstOffers;', context);
    return { context, list };
  }
  const same = setup(true);
  await vm.runInContext('renderResults()', same.context);
  assert.equal(same.list.writes, 0, 'Hydration must not replace already-loaded images');
  assert.equal(same.list.attrs['data-server-preview'], undefined);
  assert.equal(same.list.appends, 0, 'Both SSR cards are already present');

  const changed = setup(false);
  await vm.runInContext('renderResults()', changed.context);
  assert.equal(changed.list.writes, 1, 'Changed public data replaces potentially stale preview');
  assert.match(changed.list.innerHTML, /Změněná vrtačka/);
});
