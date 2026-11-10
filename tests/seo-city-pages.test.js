const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// JSON-LD is the only permitted script on server-rendered SEO collection pages.
// Still reject executable scripts and any unescaped markup inside structured data.
function assertOnlySafeJsonLd(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1, 'Exactly one JSON-LD script is expected');
  assert.match(scripts[0][0], /^<script type="application\/ld\+json">/);
  assert.doesNotMatch(scripts[0][1], /[<>]/, 'JSON-LD must escape HTML delimiters');
  assert.doesNotThrow(() => JSON.parse(scripts[0][1]), 'JSON-LD must be valid JSON');
  assert.doesNotMatch(html.replace(scripts[0][0], ''), /<\/?script\b/i);
}

const root = path.join(__dirname, '..');
const cityPagePromise = import(pathToFileURL(path.join(root, 'api/city-page.mjs')).href);
const cityDefinitionsPromise = import(pathToFileURL(path.join(root, 'api/seo-cities.mjs')).href);
const catDefinitionsPromise = import(pathToFileURL(path.join(root, 'api/seo-categories.mjs')).href);
const categoryPagePromise = import(pathToFileURL(path.join(root, 'api/category-page.mjs')).href);
const prodEnv = {
  RENTULO_DEPLOY_TARGET: 'prod',
  RENTULO_SUPABASE_URL: 'https://tfvgxrdjrpicgtvovehl.supabase.co',
  RENTULO_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'SeoProdKey'.repeat(5)}`
};
const offerId = 'cbf1184a-97fd-4fd1-8b62-e084a4452d28';
const example = {
  id: offerId, name: 'Aku vrta\u010dka Bosch', category: 'Stavba',
  city: 'Zl\u00edn', seo_city_slug: 'zlin', subcategory_slug: 'vrtacky', price_per_day: 350,
  photo_url: 'https://vspposovhdgvbeukoivh.supabase.co/storage/v1/object/public/offer-photos/a.jpg'
};
function mockRes() {
  return { statusCode: 200, headers: {}, body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.body = value; }
  };
}
async function request(rows = [example], options = {}) {
  const previousFetch = global.fetch;
  const names = ['RENTULO_DEPLOY_TARGET', 'RENTULO_SUPABASE_URL', 'RENTULO_SUPABASE_PUBLISHABLE_KEY'];
  const previousEnv = Object.fromEntries(names.map(name => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  Object.assign(process.env, options.env || {});
  const categorySlug = options.category ?? 'stavba';
  const citySlug = options.citySlug ?? 'zlin';
  const params = options.query || { slug: categorySlug, city: citySlug };
  const res = mockRes();
  let calls = 0, upstream;
  global.fetch = async url => {
    calls++;
    upstream = String(url);
    return { ok: !options.failure, async json() { return rows; } };
  };
  try {
    const { default: handler } = await cityPagePromise;
    await handler({ method: options.method || 'GET', query: params,
      url: `/kategorie/${categorySlug}/mesto/${citySlug}${options.urlSuffix || ''}`,
      headers: { host: options.host || (options.env ? 'rentulo.com' : 'rentulo.eu') }
    }, res);
    return { res, calls, upstream };
  } finally {
    global.fetch = previousFetch;
    for (const name of names) {
      if (previousEnv[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnv[name];
    }
  }
}

test('city slugs are predictable for Czech place names and reject junk', async () => {
  const { getSeoCitySlug, isSeoCitySlug } = await cityDefinitionsPromise;
  const places = [
    ['Zl\u00edn', 'zlin'], ['Uhersk\u00e9 Hradi\u0161t\u011b', 'uherske-hradiste'],
    ['\u010cesk\u00e9 Bud\u011bjovice', 'ceske-budejovice'],
    ['\u017d\u010f\u00e1r nad S\u00e1zavou', 'zdar-nad-sazavou'],
    ['\u00dast\u00ed nad Labem', 'usti-nad-labem'],
    ['\u0158\u00ed\u010dany', 'ricany'], ['Praha 10', 'praha-10'],
    ['  Hradec    Kr\u00e1lov\u00e9 ', 'hradec-kralove'], ['Brno', 'brno'], ['Zli\u0301n', 'zlin']
  ];
  for (const [input, expected] of places) {
    assert.equal(getSeoCitySlug(input), expected, input);
    assert.equal(isSeoCitySlug(expected), true);
  }
  for (const input of ['', null, undefined, 'C', 'CZ', 'Test', 'Online',
    '<script>alert(1)</script>', 'Praha/secret', 'https://evil.example', 'A'.repeat(81),
    '999', 'Zl\u00edn?foo=bar']) assert.equal(getSeoCitySlug(input), null, String(input));
  for (const input of ['ZLIN', 'zlin/', '../zlin', 'a--b', 'zlin?x=1', '1brno']) {
    assert.equal(isSeoCitySlug(input), false, input);
  }
});

test('new city route precedes the existing subcategory and category routes', () => {
  const vercel = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const city = vercel.rewrites.find(rule => rule.source === '/kategorie/:slug/mesto/:city');
  assert.deepEqual(city, { source: '/kategorie/:slug/mesto/:city',
    destination: '/api/city-page?slug=:slug&city=:city' });
  const index = vercel.rewrites.indexOf(city);
  assert.ok(index >= 0);
  assert.ok(index < vercel.rewrites.findIndex(rule => rule.source === '/kategorie/:slug/:subslug'));
  assert.ok(index < vercel.rewrites.findIndex(rule => rule.source === '/kategorie/:slug'));
  assert.deepEqual(vercel.functions['api/city-page.mjs'], { includeFiles: '{detail.html,js/supabase-config.js}' });
  for (const headerRule of vercel.headers.filter(rule => rule.headers.some(header => header.key === 'X-Robots-Tag'))) {
    assert.equal(headerRule.headers.find(header => header.key === 'X-Robots-Tag').value, 'noindex');
  }
});

test('six real category+city routes use both exact public filters and original photos', async () => {
  const { SEO_CATEGORIES } = await catDefinitionsPromise;
  for (const category of SEO_CATEGORIES) {
    const row = { ...example, category: category.name };
    const { res, calls, upstream } = await request([row], { category: category.slug });
    assert.equal(res.statusCode, 200, category.slug);
    assert.equal(calls, 1);
    const url = new URL(upstream);
    assert.equal(url.origin, 'https://vspposovhdgvbeukoivh.supabase.co');
    assert.equal(url.pathname, '/rest/v1/public_offers');
    assert.equal(url.searchParams.get('status'), 'eq.active');
    assert.equal(url.searchParams.get('category'), `eq.${category.name}`);
    assert.equal(url.searchParams.get('seo_city_slug'), 'eq.zlin');
    assert.equal(url.searchParams.get('select'), 'id,name,category,city,price_per_day,photo_url,subcategory_slug,seo_city_slug');
    assert.match(res.body, new RegExp(`https://rentulo.eu/kategorie/${category.slug}/mesto/zlin`));
    assert.match(res.body, /<h1>[^<]+Zl\u00edn<\/h1>/);
    assert.match(res.body, /href="\/nabidka\/cbf1184a-97fd-4fd1-8b62-e084a4452d28"/);
    assert.match(res.body, /\/storage\/v1\/object\/public\/offer-photos\/a.jpg/);
    assertOnlySafeJsonLd(res.body);
  }
});

test('TEST has canonical, accurate description, category breadcrumbs and noindex', async () => {
  const { res } = await request();
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-robots-tag'], 'noindex');
  assert.equal(res.headers['cache-control'], 'private, no-store');
  assert.match(res.body, /<h1>Nářadí a stavební vybavení k půjčení – Zlín<\/h1>/);
  assert.match(res.body, /<meta name="description" content="Nářadí a stavební vybavení k půjčení – Zlín/);
  assert.match(res.body, /<link rel="canonical" href="https:\/\/rentulo.eu\/kategorie\/stavba\/mesto\/zlin"/);
  assert.match(res.body, /href="\/kategorie\/stavba"/);
  assert.match(res.body, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(res.body, /\b(M\u011bsto nen\u00ed dostupn\u00e9)\b/);
});

test('PROD render requires independent credentials and correct production canonical', async () => {
  const row = { ...example, photo_url: 'https://tfvgxrdjrpicgtvovehl.supabase.co/storage/v1/object/public/offer-photos/a.jpg' };
  const { res, upstream } = await request([row], { env: prodEnv });
  assert.equal(res.statusCode, 200);
  assert.match(upstream, /tfvgxrdjrpicgtvovehl\.supabase\.co/);
  assert.match(res.body, /https:\/\/rentulo.com\/kategorie\/stavba\/mesto\/zlin/);
  assert.doesNotMatch(res.body, /<meta name="robots" content="noindex">/);
  const noCredentials = await request([row], { env: { RENTULO_DEPLOY_TARGET: 'prod' } });
  assert.equal(noCredentials.res.statusCode, 503);
  assert.equal(noCredentials.calls, 0);
});

test('empty city combinations do not publish fabricated pages or SEO links', async () => {
  for (const env of [{}, prodEnv]) {
    const result = await request([], { ...(Object.keys(env).length ? { env } : {}) });
    assert.equal(result.res.statusCode, 404);
    assert.equal(result.res.headers['x-robots-tag'], 'noindex');
    assert.doesNotMatch(result.res.body, /<article class="offer-card">/);
  }
  const { renderCategoryHtml } = await categoryPagePromise;
  const { getSeoCategoryBySlug } = await catDefinitionsPromise;
  const config = { target: 'test', siteOrigin: 'https://rentulo.eu', supabaseOrigin: 'https://vspposovhdgvbeukoivh.supabase.co' };
  const cat = getSeoCategoryBySlug('stavba');
  assert.doesNotMatch(renderCategoryHtml(cat, [], 1, false, config), /\/mesto\//);
  const populated = renderCategoryHtml(cat, [{ ...example }, { ...example, id: '00000000-0000-4000-8000-000000000001' }], 1, false, config);
  assert.equal((populated.match(/href="\/kategorie\/stavba\/mesto\/zlin"/g) || []).length, 1);
  assert.doesNotMatch(populated, /\/mesto\/praha/);
});

test('pagination keeps city-specific canonical and links', async () => {
  const rows = Array.from({ length: 21 }, (_, i) => ({ ...example,
    id: `cbf1184a-97fd-4fd1-8b62-${String(i + 1).padStart(12, '0')}` }));
  const first = await request(rows);
  assert.equal((first.res.body.match(/<article class="offer-card">/g) || []).length, 20);
  assert.match(first.res.body, /href="\/kategorie\/stavba\/mesto\/zlin\?page=2" rel="next"/);
  const second = await request([rows[20]], { query: { slug: 'stavba', city: 'zlin', page: '2' } });
  assert.equal(second.res.statusCode, 200);
  assert.match(second.res.body, /href="\/kategorie\/stavba\/mesto\/zlin" rel="prev"/);
  assert.match(second.res.body, /rel="canonical" href="https:\/\/rentulo.eu\/kategorie\/stavba\/mesto\/zlin\?page=2"/);
  const later = await request([], { query: { slug: 'stavba', city: 'zlin', page: '2' } });
  assert.equal(later.res.statusCode, 404);
});

test('invalid category/city and malformed pages are rejected before DB calls', async () => {
  for (const [category, citySlug] of [['unknown', 'zlin'], ['stavba', '../admin'],
    ['STAVBA', 'zlin'], ['stavba', '1'], ['stavba', '<script>'], ['stavba', 'cz'],
    ['hobby', 'zlin?foo']]) {
    const result = await request([example], { category, citySlug });
    assert.equal(result.res.statusCode, 404, `${category}/${citySlug}`);
    assert.equal(result.calls, 0);
  }
  for (const page of ['0', '00', '1.1', '-2', '501', '1e4', 'null']) {
    const result = await request([example], { query: { slug: 'stavba', city: 'zlin', page } });
    assert.equal(result.res.statusCode, 404, page);
    assert.equal(result.calls, 0);
  }
});

test('city mismatch or upstream failure returns 503/noindex, never wrong-city offers', async () => {
  const mismatch = await request([{ ...example, city: 'Praha' }]);
  assert.equal(mismatch.res.statusCode, 503);
  assert.equal(mismatch.res.headers['x-robots-tag'], 'noindex');
  const mismatchSlug = await request([{ ...example, seo_city_slug: 'praha' }]);
  assert.equal(mismatchSlug.res.statusCode, 503);
  const failure = await request([example], { failure: true });
  assert.equal(failure.res.statusCode, 503);
  assert.equal(failure.res.headers['retry-after'], '60');
});

test('personal data and HTML injection never appear in city landings', async () => {
  const malicious = { ...example, name: '<script>alert(1)</script>',
    owner_email: 'secret@example.com', pin: '123456', pickup_address: 'SECRET STREET',
    photo_url: 'https://evil.example/pic.jpg' };
  const { res } = await request([malicious]);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(res.body, /<script>|secret@example\.com|123456|SECRET STREET|evil\.example/);
});

test('HEAD has no body, unsupported method and wrong host never query Supabase', async () => {
  const head = await request([example], { method: 'HEAD' });
  assert.equal(head.res.statusCode, 200);
  assert.equal(head.res.body, '');
  const post = await request([example], { method: 'POST' });
  assert.equal(post.res.statusCode, 405);
  assert.equal(post.res.headers.allow, 'GET, HEAD');
  assert.equal(post.calls, 0);
  const wrongHost = await request([example], { host: 'rentulo.com' });
  assert.equal(wrongHost.res.statusCode, 404);
  assert.equal(wrongHost.calls, 0);
});

test('live sitemap lists a city combo only when a true public active offer backs it', async () => {
  const { renderSitemapXml, listSitemapOffers } = await import(pathToFileURL(path.join(root, 'api/sitemap.mjs')).href);
  const config = { supabaseOrigin: 'https://vspposovhdgvbeukoivh.supabase.co', publishableKey: 'sb_publishable_dummyKey1234567890' };
  const offers = await listSitemapOffers(config, async () => ({ ok: true, async json() { return [
    { id: offerId, category: 'Stavba', city: 'Zl\u00edn', seo_city_slug: 'zlin', subcategory_slug: 'vrtacky' },
    { id: 'ec70cc29-317e-4014-a25e-3ae4d0e6a922', category: 'Stavba', city: 'Zl\u00edn', seo_city_slug: 'zlin' },
    { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', category: 'Hobby', city: 'Brno', seo_city_slug: 'brno' }
  ]; } }));
  const xml = renderSitemapXml(offers);
  assert.equal((xml.match(/<loc>https:\/\/rentulo.com\/kategorie\/stavba\/mesto\/zlin<\/loc>/g) || []).length, 1);
  assert.equal((xml.match(/<loc>https:\/\/rentulo.com\/kategorie\/hobby\/mesto\/brno<\/loc>/g) || []).length, 1);
  assert.doesNotMatch(xml, /\/mesto\/praha|\/mesto\/uherske-hradiste|rentulo\.eu/);
  assert.match(xml, /<loc>https:\/\/rentulo.com\/kategorie\/stavba\/vrtacky<\/loc>/);
});
