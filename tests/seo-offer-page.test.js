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
const offer = { id: offerId, name: 'Aku vrtačka Bosch', category: 'Dílna a nářadí', description: 'Aku vrtačka v dobrém stavu s nabíječkou.', city: 'Praha', price_per_day: 250, photo_url: publicImage };
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

test('SEO route remains dedicated; legacy HTML template and conditional redirects coexist', () => {
  const vercel = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.deepEqual(vercel.rewrites.find(rule => rule.source === '/nabidka/:id'), { source: '/nabidka/:id', destination: '/api/offer-page?id=:id' });
  assert.ok(vercel.functions['api/offer-page.mjs'].includeFiles.includes('detail.html'));
  assert.ok(vercel.functions['api/offer-page.mjs'].includeFiles.includes('js/supabase-config.js'));
  assert.equal(vercel.redirects.filter(rule => rule.source === '/detail.html').length, 2);
});

test('legacy offer detail keeps relative navigation at the site root after SEO URL replacement', () => {
  const template = readFileSync(path.join(root, 'detail.html'), 'utf8');
  const head = template.match(/<head(?:\s[^>]*)?>([\s\S]*?)<\/head>/i)?.[1];
  assert.ok(head, 'Detail template must have a head');
  const baseTags = [...head.matchAll(/<base\b[^>]*>/gi)];
  assert.equal(baseTags.length, 1, 'Detail template must define exactly one base');
  const rootHref = baseTags[0][0].match(/\bhref=["']([^"']+)["']/i)?.[1];
  assert.equal(rootHref, '/', 'All relative links must resolve from the site root');
  assert.ok(head.indexOf('<base') < head.indexOf('href="assets/rentulo-logo-mark.png"'),
    'Base must appear before relative assets');

  const menu = readFileSync(path.join(root, 'js/navigation.js'), 'utf8');
  const nestedDetailUrl = `https://rentulo.eu/nabidka/${offerId}`;
  const documentBase = new URL(rootHref, nestedDetailUrl);
  const pages = [
    'historie.html', 'moje-nabidky.html', 'moje-rezervace.html',
    'nastaveni.html', 'kontakt.html', 'jak-to-funguje.html',
    'prihlaseni.html', 'registrace.html', 'vysledky.html'
  ];
  for (const page of pages) {
    if (page === 'prihlaseni.html') {
      assert.ok(menu.includes('href="${loginHref}"'), 'Detail login must preserve the offer return destination');
      assert.match(menu, /: "prihlaseni\.html";/, 'Other pages retain the default login destination');
    } else {
      assert.ok(menu.includes(`href="${page}"`), `Missing shared menu route ${page}`);
    }
    assert.equal(new URL(page, documentBase).href, `https://rentulo.eu/${page}`);
  }
  for (const asset of ['assets/rentulo-logo-mark.png', 'js/navigation.js', 'css/rentulo-theme.css']) {
    assert.equal(new URL(asset, documentBase).pathname, `/${asset}`);
  }
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
  assert.equal((res.body.match(/<base\b/gi) || []).length, 1, 'SEO detail must not duplicate the base');
  assert.match(res.body, /<meta name="robots" content="noindex" \/>/);
  assert.ok(res.body.includes(`rel="canonical" href="https://rentulo.eu/nabidka/${offerId}"`));
  assert.ok(res.body.includes('property="og:title" content="Aku vrtačka Bosch k půjčení – Praha | Rentulo"'));
  assert.ok(res.body.includes(`property="og:image" content="${publicImage}"`));
  assert.ok(res.body.includes('Cena půjčení 250 Kč/den'));
  // These elements must be present in the initial HTTP HTML, without JS.
  const publicBody = res.body.slice(res.body.indexOf('<body'));
  assert.match(publicBody, /<div id="detailContent" data-server-rendered-offer="true">/);
  assert.match(publicBody, /<h1>Aku vrtačka Bosch<\/h1>/);
  assert.match(publicBody, /<div class="category-line">Dílna a nářadí<\/div>/);
  assert.match(publicBody, /<p class="description">Aku vrtačka v dobrém stavu s nabíječkou\.<\/p>/);
  assert.match(publicBody, /<p>Praha<\/p>/);
  assert.match(publicBody, /<div class="price">250<\/div>/);
  assert.ok(publicBody.includes(`<img src="${publicImage}" alt="Aku vrtačka Bosch"`));
  assert.match(seen.url, /\/rest\/v1\/public_offers\?/);
  const search = new URL(seen.url);
  assert.equal(search.searchParams.get('select'), 'id,name,category,description,city,price_per_day,photo_url');
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
  assert.equal((html.match(/<base\b/gi) || []).length, 1, 'Minimal template also needs one root base');
  assert.ok(html.includes(`rel="canonical" href="https://rentulo.com/nabidka/${offerId}"`));
  assert.doesNotMatch(html, /name="robots" content="noindex"/);
  assert.ok(html.includes('https://rentulo.com/assets/rentulo-logo-mark.png'));
});

test('script injection is HTML-escaped and personal reservation data is never included', async () => testEnvironment(async () => {
  const malicious = { ...offer, name: 'Vrtačka <script>alert(1)</script> & "Akce"', city: '<Praha>', category: '<img src=x onerror=alert(7)>', description: '<svg onload=alert(8)>', pickup_street: 'Private street 77', pickup_phone: '+420000000000', email: 'private@example.com', pin: '123456', photo_url: 'https://evil.example/bad.jpg' };
  const { res } = await renderRequest(malicious);
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<script>alert\(1\)<\/script>|Private street|private@example\.com|\+420000000000|123456|evil\.example/);
  assert.match(res.body, /Vrtačka &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;Akce&quot;/);
  assert.match(res.body, /&lt;img src=x onerror=alert\(7\)&gt;/);
  assert.match(res.body, /&lt;svg onload=alert\(8\)&gt;/);
  assert.doesNotMatch(res.body, /<img src=x onerror=alert\(7\)>|<svg onload=alert\(8\)>/);
  assert.match(res.body, /rentulo\.eu\/assets\/rentulo-logo-mark\.png/);
}));

test('missing optional description still renders a useful public detail', async () => testEnvironment(async () => {
  const { res } = await renderRequest({ ...offer, description: '', category: null });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<h1>Aku vrtačka Bosch<\/h1>/);
  assert.match(res.body, /<div class="category-line">Ostatní<\/div>/);
  assert.doesNotMatch(res.body, /<p class="description">/);
}));

test('client preserves initial server offer and metadata during initial load', () => {
  const code = readFileSync(path.join(root, 'js/detail-page.js'), 'utf8');
  assert.match(code, /const hasServerOffer = document\.getElementById\("detailContent"\)\?\.dataset\.serverRenderedOffer === "true"/);
  assert.match(code, /if \(!hasServerOffer\) document\.title =/);
  assert.match(code, /if \(!hasServerOffer\) renderLoading\(\)/);
});

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
  assert.match(detail, /return "detail\.html\?" \+ params\.toString\(\)/);
  assert.match(results, /getResultOfferDetailLink\(offerId\)/);
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


// This tests the vercel.json matching contract; actual CDN redirect behavior
// still requires one authorized preview check because Vercel SSO protects TEST.
function simulatedVercelRedirect(href) {
  const rules = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8')).redirects;
  const from = new URL(href);
  for (const rule of rules) {
    if (rule.source !== from.pathname) continue;
    const params = {};
    let matched = true;
    for (const condition of rule.has || []) {
      if (condition.type !== 'query') { matched = false; break; }
      const value = from.searchParams.get(condition.key);
      const result = value == null ? null : new RegExp('^(?:' + condition.value + ')$').exec(value);
      if (!result) { matched = false; break; }
      Object.assign(params, result.groups || {});
    }
    if (!matched) continue;
    const target = rule.destination.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (segment, name) => {
      assert.ok(Object.hasOwn(params, name), `Missing Vercel named capture ${name}`);
      return encodeURIComponent(params[name]);
    });
    return { status: rule.permanent ? 308 : 307, location: new URL(target, from).href };
  }
  return null;
}

test('homepage /index.html redirects to the canonical root on TEST and PROD', () => {
  for (const origin of ['https://rentulo.eu', 'https://rentulo.com']) {
    assert.deepEqual(simulatedVercelRedirect(origin + '/index.html'), {
      status: 308, location: origin + '/'
    });
    assert.equal(simulatedVercelRedirect(origin + '/'), null);
  }
});

test('legacy offer URL redirects to its canonical detail with both booking dates intact', () => {
  const source = `https://rentulo.eu/detail.html?id=${offerId}&od=2026-12-10&do=2026-12-12`;
  assert.deepEqual(simulatedVercelRedirect(source), {
    status: 308,
    location: `https://rentulo.eu/nabidka/${offerId}?od=2026-12-10&do=2026-12-12`
  });
  assert.equal(simulatedVercelRedirect(source.replace('rentulo.eu', 'rentulo.com')).location,
    `https://rentulo.com/nabidka/${offerId}?od=2026-12-10&do=2026-12-12`);
});

test('legacy offer link without a full valid date pair retains the offer ID', () => {
  const withoutDates = `https://rentulo.eu/detail.html?id=${offerId}`;
  assert.equal(simulatedVercelRedirect(withoutDates).location, `https://rentulo.eu/nabidka/${offerId}`);
  assert.equal(simulatedVercelRedirect(withoutDates + '&od=2026-12-10').location,
    `https://rentulo.eu/nabidka/${offerId}`);
  assert.equal(simulatedVercelRedirect(withoutDates + '&od=invalid&do=2026-12-12').location,
    `https://rentulo.eu/nabidka/${offerId}`);
});

test('missing or malformed legacy offer ID does not trigger a broad redirect', () => {
  for (const value of [
    'https://rentulo.eu/detail.html',
    'https://rentulo.eu/detail.html?id=invalid',
    'https://rentulo.eu/detail.html?id=00000000-0000-0000-0000-0000000000000',
    `https://rentulo.eu/edit-nabidka.html?id=${offerId}`,
    `https://rentulo.eu/prihlaseni.html?returnTo=detail.html%3Fid%3D${offerId}`
  ]) assert.equal(simulatedVercelRedirect(value), null, value);
});

test('login return-to still validates legacy offer ID and dates before server redirect', () => {
  const login = readFileSync(path.join(root, 'js/login-page.js'), 'utf8');
  const context = {
    URL, URLSearchParams,
    document: { addEventListener() {} },
    window: { location: { origin: 'https://rentulo.eu', search: '' } }
  };
  vm.runInNewContext(login, context);
  const target = `detail.html?id=${offerId}&od=2026-12-10&do=2026-12-12`;
  context.window.location.search = '?returnTo=' + encodeURIComponent(target);
  assert.equal(context.loginGetSafeReturnTo(), target);
  const redirected = simulatedVercelRedirect('https://rentulo.eu/' + target);
  assert.equal(redirected.location, `https://rentulo.eu/nabidka/${offerId}?od=2026-12-10&do=2026-12-12`);
  context.window.location.search = '?returnTo=' + encodeURIComponent('https://evil.example/detail.html?id=' + offerId);
  assert.equal(context.loginGetSafeReturnTo(), '');
});

test('SEO redirects leave current production controls and canonical routes untouched', () => {
  const vercel = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.deepEqual(vercel.rewrites.find(x => x.source === '/nabidka/:id'), {
    source: '/nabidka/:id', destination: '/api/offer-page?id=:id'
  });
  assert.ok(vercel.redirects.some(x => x.source === '/muj-ucet' && x.destination === '/'));
  assert.ok(vercel.headers.some(x => x.has?.some(h => h.type === 'host' &&
    String(h.value?.re || '').includes('rentulo') && String(h.value?.re || '').includes('com')) &&
    x.headers?.some(h => h.key === 'X-Robots-Tag' && h.value === 'noindex')));
  assert.equal(simulatedVercelRedirect('https://rentulo.eu/nabidka/' + offerId), null);
});
