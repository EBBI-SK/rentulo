const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const offerId = 'cbf1184a-97fd-4fd1-8b62-e084a4452d28';
const pageModulePromise = import(pathToFileURL(path.join(root, 'api/offer-page.mjs')).href);
const publicImage = 'https://vspposovhdgvbeukoivh.supabase.co/storage/v1/object/public/offer-photos/user/test-offer.jpg';
const offer = { id: offerId, name: 'Aku vrtačka Bosch', city: 'Praha', price_per_day: 250, photo_url: publicImage };
const testOrigin = 'https://vspposovhdgvbeukoivh.supabase.co';

function responseMock() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    end(value) { this.body = value; }
  };
}

function testEnvironment(work) {
  const names = ['RENTULO_DEPLOY_TARGET', 'RENTULO_SUPABASE_URL', 'RENTULO_SUPABASE_PUBLISHABLE_KEY'];
  const backup = Object.fromEntries(names.map(name => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  const restore = () => { for (const name of names) { if (backup[name] === undefined) delete process.env[name]; else process.env[name] = backup[name]; } };
  return Promise.resolve().then(work).finally(restore);
}

async function renderRequest(row, { method = 'GET', id = offerId, host = 'rentulo.eu', upstreamStatus = 200 } = {}) {
  const oldFetch = global.fetch;
  let seen = null;
  global.fetch = async (url, options) => {
    seen = { url: String(url), options };
    return { ok: upstreamStatus === 200, status: upstreamStatus, async json() { return row === null ? [] : [row]; } };
  };
  const res = responseMock();
  try {
    const { default: handler } = await pageModulePromise;
    await handler({ method, query: { id }, url: `/api/offer-page?id=${id}`, headers: { host } }, res);
    return { res, seen };
  } finally { global.fetch = oldFetch; }
}

test('SEO route is a dedicated server function; legacy HTML path stays untouched', () => {
  const vercel = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.deepEqual(vercel.rewrites.find(rule => rule.source === '/nabidka/:id'), { source: '/nabidka/:id', destination: '/api/offer-page?id=:id' });
  assert.ok(vercel.functions['api/offer-page.mjs'].includeFiles.includes('detail.html'));
  assert.ok(vercel.functions['api/offer-page.mjs'].includeFiles.includes('js/supabase-config.js'));
  assert.equal(vercel.redirects.some(rule => rule.source === '/detail.html'), false);
});

test('TEST uses only TEST Supabase; PROD requires separate configured publishable credentials', async () => {
  const { getOfferSeoConfig } = await pageModulePromise;
  const config = getOfferSeoConfig({});
  assert.equal(config.target, 'test');
  assert.equal(config.siteOrigin, 'https://rentulo.eu');
  assert.equal(config.supabaseOrigin, testOrigin);
  assert.throws(() => getOfferSeoConfig({ RENTULO_DEPLOY_TARGET: 'prod' }), /PROD public Supabase configuration/);
  assert.throws(() => getOfferSeoConfig({ RENTULO_DEPLOY_TARGET: 'test', RENTULO_SUPABASE_URL: 'https://tfvgxrdjrpicgtvovehl.supabase.co', RENTULO_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_TestOtherProject123456789' }), /does not belong/);
  assert.throws(() => getOfferSeoConfig({ RENTULO_DEPLOY_TARGET: 'other' }), /Invalid Rentulo deployment target/);
});

test('active public offer responds with unique canonical, description, original photo and noindex on TEST', async () => testEnvironment(async () => {
  const { res, seen } = await renderRequest(offer);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-robots-tag'], 'noindex');
  assert.equal(res.headers['cache-control'], 'private, no-store');
  assert.match(res.body, /<base href="\/" \/>/);
  assert.match(res.body, /<meta name="robots" content="noindex" \/>/);
  assert.ok(res.body.includes(`rel="canonical" href="https://rentulo.eu/nabidka/${offerId}"`));
  assert.ok(res.body.includes('property="og:title" content="Aku vrtačka Bosch – Praha | Rentulo"'));
  assert.ok(res.body.includes(`property="og:image" content="${publicImage}"`));
  assert.ok(res.body.includes('za 250 Kč/den'));
  assert.match(seen.url, /\/rest\/v1\/public_offers\?/);
  const search = new URL(seen.url);
  assert.equal(search.searchParams.get('select'), 'id,name,city,price_per_day,photo_url');
  assert.equal(search.searchParams.get('id'), `eq.${offerId}`);
  assert.ok(seen.options.headers.apikey.startsWith('sb_publishable_'));
  assert.equal(seen.options.headers.Authorization, undefined);
}));

test('PROD URL and metadata can be rendered without TEST noindex', async () => {
  const { getOfferSeoConfig, getOfferSeoValues, renderOfferSeoHtml } = await pageModulePromise;
  const config = getOfferSeoConfig({
    RENTULO_DEPLOY_TARGET: 'prod',
    RENTULO_SUPABASE_URL: 'https://tfvgxrdjrpicgtvovehl.supabase.co',
    RENTULO_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' + 'ProductionPublicKey'.repeat(3)
  });
  const values = getOfferSeoValues(offer, offerId, config);
  const html = renderOfferSeoHtml('<html><head><title>Detail</title></head><body></body></html>', values, 'prod');
  assert.ok(html.includes(`rel="canonical" href="https://rentulo.com/nabidka/${offerId}"`));
  assert.doesNotMatch(html, /name="robots" content="noindex"/);
  assert.ok(html.includes('https://rentulo.com/assets/rentulo-logo-mark.png'));
});

test('script injection is HTML-escaped and personal reservation data is never included', async () => testEnvironment(async () => {
  const malicious = { ...offer, name: 'Vrtačka <script>alert(1)</script> & "Akce"', city: '<Praha>', pickup_street: 'Private street 77', pickup_phone: '+420000000000', email: 'private@example.com', pin: '123456', photo_url: 'https://evil.example/bad.jpg' };
  const { res } = await renderRequest(malicious);
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<script>alert\(1\)<\/script>|Private street|private@example\.com|\+420000000000|123456|evil\.example/);
  assert.match(res.body, /Vrtačka &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;Akce&quot;/);
  assert.match(res.body, /rentulo\.eu\/assets\/rentulo-logo-mark\.png/);
}));

test('unpublished, removed or invalid offer returns 404/noindex rather than a public SEO page', async () => testEnvironment(async () => {
  const notFound = await renderRequest(null);
  assert.equal(notFound.res.statusCode, 404);
  assert.equal(notFound.res.headers['x-robots-tag'], 'noindex');
  assert.doesNotMatch(notFound.res.body, /rel="canonical"/);
  const invalid = await renderRequest(offer, { id: 'not-a-uuid' });
  assert.equal(invalid.res.statusCode, 404);
  assert.equal(invalid.seen, null);
}));

test('failed public view never exposes offers, returns 503 and noindex', async () => testEnvironment(async () => {
  const { res } = await renderRequest(offer, { upstreamStatus: 500 });
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers['x-robots-tag'], 'noindex');
  assert.equal(res.headers['retry-after'], '60');
  assert.doesNotMatch(res.body, /canonical|Aku vrtačka/);
}));

test('HEAD request returns headers and no HTML body', async () => testEnvironment(async () => {
  const { res } = await renderRequest(offer, { method: 'HEAD' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, '');
}));

test('new offer links and legacy login return URLs coexist', () => {
  const detail = readFileSync(path.join(root, 'js/detail-page.js'), 'utf8');
  const results = readFileSync(path.join(root, 'js/results-page.js'), 'utf8');
  assert.match(detail, /getOfferIdFromUrl\(\)/);
  assert.match(detail, /\/nabidka\\\/\(/);
  assert.match(detail, /getOfferLoginReturnTo\(\)/);
  assert.match(detail, /showCanonicalOfferUrl\(offer\)/);
  assert.match(detail, /window\.history\.replaceState/);
  assert.match(detail, /"detail\.html\?id=" \+ encodeURIComponent\(offerId\)/);
  assert.match(results, /href="\/nabidka\/\$\{encodeURIComponent\(offerId\)\}"/);
  assert.match(detail, /cs:.*Rentulo|const descriptions = \{/);
  for (const code of ['cs','sk','en','de','pl']) assert.match(detail, new RegExp(`\\b${code}: \\x60`));
});


test('legacy and SEO offer URLs resolve safely and copying the URL uses the canonical route', () => {
  const code = readFileSync(path.join(root, 'js/detail-page.js'), 'utf8');
  const stateChanges = [];
  const context = {
    URLSearchParams,
    document: { addEventListener() {} },
    location: {
      protocol: 'https:',
      pathname: '/detail.html',
      search: `?id=${offerId}`
    },
    history: { state: null, replaceState(...args) { stateChanges.push(args); } }
  };
  context.window = context;
  vm.runInNewContext(code, context);
  assert.equal(context.getOfferIdFromUrl(), offerId);
  assert.equal(context.getOfferLoginReturnTo(), `detail.html?id=${offerId}`);
  context.showCanonicalOfferUrl({ id: offerId });
  assert.equal(stateChanges.length, 1);
  assert.equal(stateChanges[0][2], `/nabidka/${offerId}`);
  context.location.pathname = `/nabidka/${offerId}`;
  context.location.search = '?id=00000000-0000-0000-0000-000000000000';
  assert.equal(context.getOfferIdFromUrl(), offerId);
  assert.equal(context.getOfferLoginReturnTo(), `detail.html?id=${offerId}`);
  context.showCanonicalOfferUrl({ id: offerId });
  assert.equal(stateChanges.length, 1, 'Already canonical URL must not change');
  context.location.pathname = '/detail.html';
  context.location.search = '?id=invalid';
  context.showCanonicalOfferUrl({ id: 'invalid' });
  assert.equal(stateChanges.length, 1, 'Invalid IDs must never enter history');
});
