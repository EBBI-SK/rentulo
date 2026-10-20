// Rentulo V1 / BOD02 Stage 3 - behavioural GPS security tests and legal copy checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (...paths) => fs.readFileSync(path.join(root, ...paths), 'utf8');
const gpsSource = read('js', 'nearby-location.js');
const homeSource = read('js', 'home-page.js');
const resultsSource = read('js', 'results-page.js');
const i18nSource = read('js', 'i18n.js');

function makeGpsContext(startTime = 1000000) {
  const store = new Map();
  const updates = [];
  let time = startTime;
  const fakeWindow = {
    sessionStorage: {
      getItem: (key) => store.has(key) ? store.get(key) : null,
      setItem: (key, value) => { store.set(key, String(value)); },
      removeItem: (key) => { store.delete(key); }
    },
    location: { href: 'https://rentulo.eu/vysledky.html?okoli=1' },
    history: { state: { prev: 7 }, replaceState: (...args) => updates.push(args) }
  };
  const FakeDate = class extends Date { static now() { return time; } };
  vm.runInNewContext(gpsSource, { window: fakeWindow, URL, Date: FakeDate });
  return { bridge: fakeWindow.rentuloNearbyLocation, fakeWindow, store, updates, tick(ms) { time += ms; } };
}

test('stage3: GPS is never placed in URL or localStorage; one-time handoff', () => {
  const ctx = makeGpsContext();
  assert.equal(ctx.bridge.saveForNextPage(49.8, 15.5), true);
  assert.equal(ctx.store.size, 1);
  const text = Array.from(ctx.store.values())[0];
  assert.match(text, /49\.8/);
  assert.equal(ctx.fakeWindow.location.href, 'https://rentulo.eu/vysledky.html?okoli=1');
  const loc = ctx.bridge.consumeOnce();
  assert.equal(loc.latitude, 49.8);
  assert.equal(loc.longitude, 15.5);
  assert.equal(ctx.store.size, 0);
  assert.equal(ctx.bridge.consumeOnce(), null);
});

test('stage3: expired handoffs are rejected and removed', () => {
  const ctx = makeGpsContext();
  assert.equal(ctx.bridge.saveForNextPage(49.8, 15.5), true);
  ctx.tick(120001);
  assert.equal(ctx.bridge.consumeOnce(), null);
  assert.equal(ctx.store.size, 0);
});

test('stage3: invalid coordinates fail closed without persisting', () => {
  const ctx = makeGpsContext();
  for (const coord of [[91, 0], [0, -181], [NaN, 20], [null, 0], ['', 0]]) {
    assert.equal(ctx.bridge.saveForNextPage(...coord), false);
  }
  assert.equal(ctx.store.size, 0);
});

test('stage3: blocked sessionStorage never falls back to URL or persistent storage', () => {
  const ctx = makeGpsContext();
  ctx.fakeWindow.sessionStorage.setItem = () => { throw new Error('blocked'); };
  assert.equal(ctx.bridge.saveForNextPage(49.8, 15.5), false);
  assert.equal(ctx.updates.length, 0);
});

test('stage3: stored coordinates are removed before JSON processing, even on malformed data', () => {
  const ctx = makeGpsContext();
  ctx.store.set('rentuloNearbyOnceV1', '{oops');
  assert.equal(ctx.bridge.consumeOnce(), null);
  assert.equal(ctx.store.size, 0);
});

test('stage3: legacy URL query coordinates are removed, not used', () => {
  const ctx = makeGpsContext();
  ctx.fakeWindow.location.href = 'https://rentulo.eu/vysledky.html?co=stan&lat=49.2&lng=16.6&okoli=1#map';
  ctx.bridge.stripLegacyCoordinatesFromUrl();
  assert.equal(ctx.updates.length, 1);
  const [, , url] = ctx.updates[0];
  assert.equal(url, '/vysledky.html?co=stan&okoli=1#map');
  assert.equal(ctx.bridge.consumeOnce(), null);
});

test('stage3: home page does not ask for location on initial load', () => {
  const handlers = {};
  const button = { disabled: false, addEventListener: (type, cb) => handlers['button:' + type] = cb };
  const status = { textContent: '' };
  const fakeDocument = {
    addEventListener: (type, cb) => { handlers[type] = cb; },
    getElementById: (id) => id === 'homeNearbySearchButton' ? button : id === 'homeNearbySearchStatus' ? status : null,
    querySelectorAll: () => [], querySelector: () => null
  };
  const fakeWindow = {
    location: { hash: '', assign: (url) => { fakeWindow.redirect = url; } },
    history: { state: null },
    sessionStorage: makeGpsContext().fakeWindow.sessionStorage,
    rentuloNearbyLocation: makeGpsContext().bridge,
    setTimeout() {}
  };
  // Both APIs must refer to the same sessionStorage for the click test.
  const ctx = makeGpsContext();
  fakeWindow.sessionStorage = ctx.fakeWindow.sessionStorage;
  fakeWindow.rentuloNearbyLocation = ctx.bridge;
  let locationRequests = 0;
  const fakeNavigator = { geolocation: { getCurrentPosition: (ok) => {
    locationRequests++;
    ok({ coords: { latitude: 49.8, longitude: 15.5 } });
  } } };
  vm.runInNewContext(homeSource, {
    window: fakeWindow, document: fakeDocument, navigator: fakeNavigator,
    URLSearchParams, console, getSupabaseClient: () => null
  });
  assert.equal(typeof handlers.DOMContentLoaded, 'function');
  handlers.DOMContentLoaded();
  assert.equal(locationRequests, 0, 'page load must not invoke geolocation');
  assert.equal(typeof handlers['button:click'], 'function');
  // Delegate handoff to same fake storage; no need to execute Supabase/map scripts.
  const saved = [];
  fakeWindow.rentuloNearbyLocation = { saveForNextPage: (...args) => { saved.push(args); return true; } };
  handlers['button:click']();
  assert.equal(locationRequests, 1);
  assert.deepEqual(saved, [[49.8, 15.5]]);
  assert.equal(fakeWindow.redirect, 'vysledky.html?okoli=1');
  assert.doesNotMatch(fakeWindow.redirect, /(?:lat|lng)=/i);
});

test('stage3: results consume one-time location; ignore GPS query parameters', () => {
  assert.match(resultsSource, /resultsNearbyLocation\s*=\s*window\.rentuloNearbyLocation\.consumeOnce\(\)/);
  assert.match(resultsSource, /stripLegacyCoordinatesFromUrl\(\)/);
  assert.match(resultsSource, /params\.delete\("lat"\);[\s\S]*?params\.delete\("lng"\);/);
  assert.doesNotMatch(resultsSource, /getResultsParams\(\)\.get\("lat"\)/);
  assert.doesNotMatch(resultsSource, /getResultsParams\(\)\.get\("lng"\)/);
  assert.match(read('vysledky.html'), /<script src="js\/nearby-location\.js"><\/script>[\s\S]*?<script src="js\/results-page\.js"><\/script>/);
});

test('stage3: home uses explicit permission button and avoids reload-loop prompts', () => {
  assert.match(read('index.html'), /id="homeNearbySearchButton"/);
  assert.match(homeSource, /button\.addEventListener\("click", function \(\)/);
  assert.match(homeSource, /getCurrentPosition\(function \(position\)/);
  assert.match(homeSource, /function centerHomeMapOnVisitor\(\)\s*\{\s*\/\/ Do not request visitor position/);
  assert.doesNotMatch(homeSource, /navigator\.permissions\.query/);
  assert.doesNotMatch(homeSource, /searchParams\.set\("lat"/);
  assert.match(read('index.html'), /js\/nearby-location\.js/);
});

test('stage3: privacy text and controls are present in all five languages', () => {
  for (const key of ['home.nearbyPrivacy', 'home.locationDenied', 'home.locationRequesting',
    'home.locationUnavailable', 'home.locationStorageUnavailable', 'privacy.s5p2',
    'privacy.s6p2', 'privacy.s8p1', 'privacy.s10p2', 'privacy.s10p3',
    'privacy.s10p4', 'privacy.s10p6', 'privacy.s11p3']) {
    const occurrences = (i18nSource.match(new RegExp('"' + key.replaceAll('.', '\\.') + '":', 'g')) || []).length;
    assert.equal(occurrences, 5, `${key} must exist exactly once per language`);
  }
  for (const text of ['privacy.s8p1','privacy.s10p2','privacy.s10p3','privacy.s10p4','privacy.s10p6']) {
    assert.match(read('ochrana-osobnich-udaju.html'), new RegExp(`data-i18n="${text.replaceAll('.', '\\.')}"`));
  }
  assert.doesNotMatch(read('ochrana-osobnich-udaju.html'), /souřadnice se mohou stát součástí URL/i);
});

test('stage3: Google Fonts external requests removed from updated pages', () => {
  for (const file of ['index.html','vysledky.html','jak-to-funguje.html','nabidnout.html','edit-nabidka.html']) {
    const html = read(file);
    assert.doesNotMatch(html, /fonts\.(?:googleapis|gstatic)\.com/);
    assert.match(read('css', 'rentulo-theme.css'), /font-family/);
  }
});

test('stage3: DPA status is documented as pending, not falsely confirmed', () => {
  const dossier = read('docs','BOD02_ETAPA3_DODAVATELIA_DPA_DPIA_TEST.md');
  for (const supplier of ['Supabase','Vercel','Stripe','Resend','BulkGate','cron-job.org','OpenStreetMap','jsDelivr']) {
    assert.ok(dossier.includes(supplier), `${supplier} is missing`);
  }
  assert.match(dossier, /NEOVERENÉ/);
  assert.match(dossier, /DPIA/);
  assert.match(dossier, /DPO/);
  const handover = read('docs','BOD02_ETAPA3_WEB_GPS_PRAVNE_TEXTY_TEST.md');
  assert.match(handover, /PROD.*žiadny zásah/);
  assert.match(handover, /Session Storage|Session Storage|sessionStorage/);
});
