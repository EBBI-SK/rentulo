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
const modulePromise = import(pathToFileURL(path.join(root, 'api/subcategory-page.mjs')).href);
const definitionsPromise = import(pathToFileURL(path.join(root, 'api/seo-subcategories.mjs')).href);
const categoriesPromise = import(pathToFileURL(path.join(root, 'api/seo-categories.mjs')).href);
const sitemapPromise = import(pathToFileURL(path.join(root, 'api/sitemap.mjs')).href);
const id = 'cbf1184a-97fd-4fd1-8b62-e084a4452d28';
const example = {
  id, name: 'Aku vrtačka Bosch 18V', category: 'Stavba', subcategory_slug: 'vrtacky',
  city: 'Zlín', price_per_day: 350,
  photo_url: 'https://vspposovhdgvbeukoivh.supabase.co/storage/v1/object/public/offer-photos/a.jpg'
};
const prodEnv = {
  RENTULO_DEPLOY_TARGET: 'prod',
  RENTULO_SUPABASE_URL: 'https://tfvgxrdjrpicgtvovehl.supabase.co',
  RENTULO_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'SeoProdKey'.repeat(5)}`
};
function resMock() {
  return { statusCode: 200, headers: {}, body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.body = value; } };
}
async function request(rows = [example], options = {}) {
  const prevFetch = global.fetch;
  const envKeys = ['RENTULO_DEPLOY_TARGET', 'RENTULO_SUPABASE_URL', 'RENTULO_SUPABASE_PUBLISHABLE_KEY'];
  const prevEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  Object.assign(process.env, options.env || {});
  const [cat, sub] = [options.cat ?? 'stavba', options.sub ?? 'vrtacky'];
  const params = options.query || { slug: cat, subslug: sub };
  let upstream, count = 0;
  global.fetch = async url => {
    count++;
    upstream = String(url);
    return { ok: options.failure !== true, async json() { return rows; } };
  };
  const res = resMock();
  try {
    const { default: handler } = await modulePromise;
    await handler({ method: options.method || 'GET', query: params,
      url: `/kategorie/${cat}/${sub}${options.urlSuffix || ''}`,
      headers: { host: options.host || (options.env ? 'rentulo.com' : 'rentulo.eu') }
    }, res);
    return { res, count, upstream };
  } finally {
    global.fetch = prevFetch;
    for (const key of envKeys) {
      if (prevEnv[key] === undefined) delete process.env[key];
      else process.env[key] = prevEnv[key];
    }
  }
}

test('26 stable subcategories across the six real V1 categories; Jiné is manual-only', async () => {
  const { SEO_SUBCATEGORIES, getSeoSubcategory, getSeoSubcategories } = await definitionsPromise;
  const { SEO_CATEGORIES } = await categoriesPromise;
  assert.equal(SEO_SUBCATEGORIES.length, 26);
  const counts = Object.fromEntries(SEO_CATEGORIES.map(category => [category.slug, getSeoSubcategories(category.slug).length]));
  assert.deepEqual(counts, { domacnost: 4, zahrada: 4, stavba: 5, hobby: 4, party: 5, ostatni: 4 });
  const seen = new Set();
  for (const definition of SEO_SUBCATEGORIES) {
    const path = `${definition.categorySlug}/${definition.slug}`;
    assert.match(path, /^[a-z-]+\/[a-z-]+$/);
    assert.ok(!seen.has(path), path);
    seen.add(path);
    assert.equal(getSeoSubcategory(definition.categorySlug, definition.slug), definition);
    assert.match(definition.description, /k půjčení na Rentulu/);
  }
  for (const item of ['unknown', 'vrtacky/../../settings']) assert.equal(getSeoSubcategory('stavba', item), null);
  assert.equal(getSeoSubcategory('hobby', 'vrtacky'), null);
  assert.equal(getSeoSubcategory(null, 'vrtacky'), null);
});

test('subcategories are dedicated server routes with publicly safe functions', () => {
  const vercel = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const sub = vercel.rewrites.find(rule => rule.source === '/kategorie/:slug/:subslug');
  assert.deepEqual(sub, { source: '/kategorie/:slug/:subslug', destination: '/api/subcategory-page?slug=:slug&subslug=:subslug' });
  const cat = vercel.rewrites.findIndex(rule => rule.source === '/kategorie/:slug');
  assert.ok(vercel.rewrites.indexOf(sub) < cat);
  assert.deepEqual(vercel.functions['api/subcategory-page.mjs'], { includeFiles: '{detail.html,js/supabase-config.js}' });
  const page = readFileSync(path.join(root, 'nabidnout.html'), 'utf8');
  assert.ok(!/id="toolSubcategory"/.test(page), 'No new user-facing input');
  for (const header of vercel.headers.filter(rule => rule.headers.some(header => header.key === 'X-Robots-Tag'))) {
    assert.equal(header.headers.find(header => header.key === 'X-Robots-Tag').value, 'noindex');
  }
});

test('all 26 route slugs are accepted under their exact real parent and use filtered public offers', async () => {
  const { SEO_SUBCATEGORIES } = await definitionsPromise;
  const { getSeoCategoryBySlug } = await categoriesPromise;
  for (const sub of SEO_SUBCATEGORIES) {
    const parent = getSeoCategoryBySlug(sub.categorySlug);
    const offer = { ...example, category: parent.name, subcategory_slug: sub.slug };
    const { res, upstream } = await request([offer], { cat: sub.categorySlug, sub: sub.slug });
    assert.equal(res.statusCode, 200, `${sub.categorySlug}/${sub.slug}`);
    assert.match(res.body, new RegExp(`rel="canonical" href="https://rentulo.eu/kategorie/${sub.categorySlug}/${sub.slug}"`));
    assert.ok(res.body.includes(`<h1>${sub.name} k půjčení</h1>`));
    assert.equal(new URL(upstream).searchParams.get('category'), `eq.${parent.name}`);
    assert.equal(new URL(upstream).searchParams.get('subcategory_slug'), `eq.${sub.slug}`);
    assert.equal(new URL(upstream).searchParams.get('status'), 'eq.active');
    assert.equal(new URL(upstream).searchParams.get('select'), 'id,name,category,city,price_per_day,photo_url,subcategory_slug');
    assertOnlySafeJsonLd(res.body);
  }
});

test('active TEST listings render with correct title, canonical, internal links and global noindex', async () => {
  const { res, upstream } = await request();
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-robots-tag'], 'noindex');
  assert.match(res.body, /Aku vrtačka Bosch 18V/);
  assert.match(res.body, /<h1>Vrtačky a šroubováky k půjčení<\/h1>/);
  assert.match(res.body, /<meta name="description" content="Vrtačky a šroubováky k půjčení/);
  assert.match(res.body, /href="\/kategorie\/stavba"/);
  assert.match(res.body, /href="\/nabidka\/cbf1184a-97fd-4fd1-8b62-e084a4452d28"/);
  assert.match(res.body, /https:\/\/rentulo.eu\/kategorie\/stavba\/vrtacky/);
  assert.match(upstream, /vspposovhdgvbeukoivh\.supabase\.co/);
  assertOnlySafeJsonLd(res.body);
});

test('populated PROD uses only production config and relies on global prelaunch noindex', async () => {
  const row = { ...example, photo_url: 'https://tfvgxrdjrpicgtvovehl.supabase.co/storage/v1/object/public/offer-photos/a.jpg' };
  const { res, upstream } = await request([row], { env: prodEnv });
  assert.equal(res.statusCode, 200);
  assert.match(upstream, /tfvgxrdjrpicgtvovehl\.supabase\.co/);
  assert.match(res.body, /https:\/\/rentulo.com\/kategorie\/stavba\/vrtacky/);
  assert.doesNotMatch(res.body, /name="robots" content="noindex"/);
});

test('empty categories remain noindex, and missing later pages return HTTP 404', async () => {
  for (const env of [{}, prodEnv]) {
    const t = await request([], { ...(Object.keys(env).length ? { env } : {}) });
    assert.equal(t.res.statusCode, 200);
    assert.equal(t.res.headers['x-robots-tag'], 'noindex');
    assert.match(t.res.body, /<meta name="robots" content="noindex"/);
    assert.doesNotMatch(t.res.body, /<article class="offer-card">/);
  }
  const r = await request([], { query: { slug: 'stavba', subslug: 'vrtacky', page: '2' } });
  assert.equal(r.res.statusCode, 404);
  assert.equal(r.res.headers['x-robots-tag'], 'noindex');
});

test('pagination provides stable canonical and hrefs without duplicate pages', async () => {
  const firstRows = Array.from({ length: 21 }, (_, i) => ({ ...example, id: `cbf1184a-97fd-4fd1-8b62-${String(i + 1).padStart(12, '0')}` }));
  const page1 = await request(firstRows);
  assert.equal((page1.res.body.match(/<article class="offer-card">/g) || []).length, 20);
  assert.match(page1.res.body, /href="\/kategorie\/stavba\/vrtacky\?page=2" rel="next"/);
  const page2 = await request([firstRows[20]], { query: { slug: 'stavba', subslug: 'vrtacky', page: '2' } });
  assert.equal(page2.res.statusCode, 200);
  assert.match(page2.res.body, /href="\/kategorie\/stavba\/vrtacky" rel="prev"/);
  assert.match(page2.res.body, /rel="canonical" href="https:\/\/rentulo.eu\/kategorie\/stavba\/vrtacky\?page=2"/);
  assert.equal(new URL(page2.upstream).searchParams.get('offset'), '20');
});

test('invalid cross-category slugs and malformed pages fail closed before fetching Supabase', async () => {
  for (const [cat, sub] of [ ['stavba', 'foto-video'], ['unknown', 'vrtacky'], ['STAVBA', 'vrtacky'], ['stavba', '../admin'], ['stavba', '<script>'] ]) {
    const { res, count } = await request([example], { cat, sub });
    assert.equal(res.statusCode, 404);
    assert.equal(count, 0);
  }
  for (const page of ['0', '00', '-1', '1.5', '501', 'abc']) {
    const { res, count } = await request([example], { query: { slug: 'stavba', subslug: 'vrtacky', page } });
    assert.equal(res.statusCode, 404, page);
    assert.equal(count, 0);
  }
});

test('never expose personal data or forged slugs; errors are 503/noindex', async () => {
  const bad = {
    ...example, name: '<script>alert(1)</script>', pickup_phone: '+420123987456',
    pickup_street: 'SECRET_STREET', email: 'secret@example.com', pin: '665577',
    photo_url: 'https://evil.example/file.jpg'
  };
  const { res } = await request([bad]);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(res.body, /<script>|evil\.example|SECRET_STREET|665577|secret@example\.com|\+420123987456/);
  const mismatch = await request([{ ...example, subcategory_slug: 'pily-brusky' }]);
  assert.equal(mismatch.res.statusCode, 503);
  assert.equal(mismatch.res.headers['x-robots-tag'], 'noindex');
  const failed = await request([example], { failure: true });
  assert.equal(failed.res.statusCode, 503);
  assert.equal(failed.res.headers['retry-after'], '60');
});

test('HEAD returns no body, POST rejected, wrong domain blocked before DB access', async () => {
  const head = await request([example], { method: 'HEAD' });
  assert.equal(head.res.statusCode, 200);
  assert.equal(head.res.body, '');
  const post = await request([example], { method: 'POST' });
  assert.equal(post.res.statusCode, 405);
  assert.equal(post.count, 0);
  const wrong = await request([example], { host: 'rentulo.com' });
  assert.equal(wrong.res.statusCode, 404);
  assert.equal(wrong.count, 0);
});

test('main category pages only link to subcategories present among their actual offers', async () => {
  const { renderCategoryHtml } = await import(pathToFileURL(path.join(root, 'api/category-page.mjs')).href);
  const { getSeoCategoryBySlug } = await categoriesPromise;
  const parent = getSeoCategoryBySlug('stavba');
  const config = { target: 'test', siteOrigin: 'https://rentulo.eu', supabaseOrigin: 'https://vspposovhdgvbeukoivh.supabase.co' };
  const html = renderCategoryHtml(parent, [example], 1, false, config);
  assert.match(html, /href="\/kategorie\/stavba\/vrtacky"/);
  assert.doesNotMatch(html, /href="\/kategorie\/stavba\/pily-brusky"/);
  const without = renderCategoryHtml(parent, [{ ...example, subcategory_slug: null }], 1, false, config);
  assert.doesNotMatch(without, /href="\/kategorie\/stavba\/vrtacky"/);
});

test('sitemap only adds subcategories backed by public active offers', async () => {
  const { renderSitemapXml } = await sitemapPromise;
  const xml = renderSitemapXml([
    { id, lastmod: '2026-11-09', categorySlug: 'stavba', subcategorySlug: 'vrtacky' },
    { id: '11111111-1111-4111-8111-111111111111', categorySlug: 'stavba', subcategorySlug: 'vrtacky' },
    { id: '22222222-2222-4222-8222-222222222222', categorySlug: 'hobby', subcategorySlug: null }
  ]);
  assert.equal((xml.match(/<loc>https:\/\/rentulo.com\/kategorie\/stavba\/vrtacky<\/loc>/g) || []).length, 1);
  assert.doesNotMatch(xml, /\/kategorie\/stavba\/pily-brusky|\/kategorie\/ostatni\/jine/);
  assert.match(xml, /<loc>https:\/\/rentulo.com\/kategorie\/hobby<\/loc>/);
});
