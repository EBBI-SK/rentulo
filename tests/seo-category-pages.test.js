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
const categoryModule = import(pathToFileURL(path.join(root, 'api/category-page.mjs')).href);
const categoryDefinitions = import(pathToFileURL(path.join(root, 'api/seo-categories.mjs')).href);
const id = 'cbf1184a-97fd-4fd1-8b62-e084a4452d28';
const makeId = n => `cbf1184a-97fd-4fd1-8b62-${String(n).padStart(12, '0')}`;
const original = {
  id, name: 'Aku vrtačka Bosch', category: 'Stavba', city: 'Zlín', price_per_day: 350,
  photo_url: 'https://vspposovhdgvbeukoivh.supabase.co/storage/v1/object/public/offer-photos/test/photo.jpg'
};
const prodEnv = {
  RENTULO_DEPLOY_TARGET: 'prod',
  RENTULO_SUPABASE_URL: 'https://tfvgxrdjrpicgtvovehl.supabase.co',
  RENTULO_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'SeoProdKey'.repeat(5)}`
};
function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.body = value; }
  };
}
async function request(rows = [original], options = {}) {
  const previousFetch = global.fetch;
  const names = ['RENTULO_DEPLOY_TARGET', 'RENTULO_SUPABASE_URL', 'RENTULO_SUPABASE_PUBLISHABLE_KEY'];
  const originalEnv = Object.fromEntries(names.map(key => [key, process.env[key]]));
  for (const key of names) delete process.env[key];
  Object.assign(process.env, options.env || {});
  let upstreamUrl;
  let fetchCount = 0;
  global.fetch = async (url) => {
    fetchCount++;
    upstreamUrl = String(url);
    return { ok: options.failure !== true, async json() { return rows; } };
  };
  const res = mockRes();
  try {
    const { default: handler } = await categoryModule;
    const slug = options.slug ?? 'stavba';
    const query = options.query || { slug };
    await handler({
      method: options.method || 'GET', query,
      url: `/kategorie/${slug}${options.urlSuffix || ''}`,
      headers: { host: options.host || (options.env ? 'rentulo.com' : 'rentulo.eu') }
    }, res);
    return { res, upstreamUrl, fetchCount };
  } finally {
    global.fetch = previousFetch;
    for (const key of names) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
}

test('exactly the six real V1 category names have stable ASCII URL slugs', async () => {
  const { SEO_CATEGORIES, getSeoCategoryBySlug, getSeoCategorySlug } = await categoryDefinitions;
  assert.deepEqual(SEO_CATEGORIES.map(x => x.slug), ['domacnost', 'zahrada', 'stavba', 'hobby', 'party', 'ostatni']);
  assert.deepEqual(SEO_CATEGORIES.map(x => x.name), ['Domácnost', 'Zahrada', 'Stavba', 'Hobby', 'Párty', 'Ostatní']);
  for (const item of SEO_CATEGORIES) {
    assert.equal(getSeoCategoryBySlug(item.slug), item);
    assert.equal(getSeoCategorySlug(item.name), item.slug);
  }
  for (const missing of ['vrtacky', 'stavba-a-dilna', 'undefined', '../admin', 'Štavba']) {
    assert.equal(getSeoCategoryBySlug(missing), null);
  }
  assert.equal(getSeoCategorySlug('Dílna a nářadí'), null);
});

test('all six category URLs respond with their own title and exact category filter', async () => {
  const { SEO_CATEGORIES } = await categoryDefinitions;
  for (const category of SEO_CATEGORIES) {
    const { res, upstreamUrl } = await request([{ ...original, category: category.name }], { slug: category.slug });
    assert.equal(res.statusCode, 200, category.slug);
    assert.ok(res.body.includes(`<h1>${category.name} k půjčení</h1>`));
    assert.ok(res.body.includes(`https://rentulo.eu/kategorie/${category.slug}`));
    assert.equal(new URL(upstreamUrl).searchParams.get('category'), `eq.${category.name}`);
  }
});

test('new category route and function have isolated configuration without changing the existing pages', () => {
  const vercel = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.deepEqual(vercel.rewrites.find(item => item.source === '/kategorie/:slug'), {
    source: '/kategorie/:slug', destination: '/api/category-page?slug=:slug'
  });
  assert.ok(vercel.functions['api/category-page.mjs'].includeFiles.includes('js/supabase-config.js'));
  assert.ok(vercel.functions['api/category-page.mjs'].includeFiles.includes('detail.html'));
  assert.ok(vercel.rewrites.some(item => item.source === '/nabidka/:id'));
  assert.ok(vercel.rewrites.some(item => item.source === '/nabidky'));
  const home = readFileSync(path.join(root, 'js/home-page.js'), 'utf8');
  assert.match(home, /function setupCategorySearch\(\)/);
  assert.match(home, /window\.location\.href = queryString \? "vysledky\.html\?"/);
});

test('category HTML lists real filtered offers without JS and links to all categories', async () => {
  const { res, upstreamUrl } = await request();
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-robots-tag'], 'noindex');
  assert.match(res.body, /<h1>Stavba k půjčení<\/h1>/);
  assert.match(res.body, /<h2><a href="\/nabidka\/cbf1184a-97fd-4fd1-8b62-e084a4452d28">Aku vrtačka Bosch<\/a><\/h2>/);
  assert.match(res.body, /Zlín/);
  assert.match(res.body, /350 Kč \/ den/);
  assert.match(res.body, /rel="canonical" href="https:\/\/rentulo.eu\/kategorie\/stavba"/);
  assert.match(res.body, /name="description" content="Prohlédněte si vybavení na stavbu/);
  assert.equal((res.body.match(/<a href="\/kategorie\/(?:domacnost|zahrada|stavba|hobby|party|ostatni)"/g) || []).length, 6);
  assertOnlySafeJsonLd(res.body);
  const u = new URL(upstreamUrl);
  assert.equal(u.origin, 'https://vspposovhdgvbeukoivh.supabase.co');
  assert.equal(u.pathname, '/rest/v1/public_offers');
  assert.equal(u.searchParams.get('select'), 'id,name,category,city,price_per_day,photo_url,subcategory_slug');
  assert.equal(u.searchParams.get('status'), 'eq.active');
  assert.equal(u.searchParams.get('category'), 'eq.Stavba');
  assert.equal(u.searchParams.get('limit'), '21');
  assert.equal(u.searchParams.get('offset'), '0');
});

test('empty TEST and PROD categories are useful but always noindex', async () => {
  const t = await request([]);
  assert.equal(t.res.statusCode, 200);
  assert.equal(t.res.headers['x-robots-tag'], 'noindex');
  assert.match(t.res.body, /zatím nejsou zveřejněny žádné nabídky/);
  assert.match(t.res.body, /name="robots" content="noindex"/);
  assert.doesNotMatch(t.res.body, /<article class="offer-card">/);
  const p = await request([], { env: prodEnv });
  assert.equal(p.res.statusCode, 200);
  assert.equal(p.res.headers['x-robots-tag'], 'noindex');
  assert.match(p.res.body, /name="robots" content="noindex"/);
  assert.match(p.res.body, /https:\/\/rentulo.com\/kategorie\/stavba/);
  assert.match(p.upstreamUrl, /tfvgxrdjrpicgtvovehl\.supabase\.co/);
});

test('populated PROD category uses production-only URL and can be indexed after explicit public launch', async () => {
  const p = await request([{ ...original, photo_url: 'https://tfvgxrdjrpicgtvovehl.supabase.co/storage/v1/object/public/offer-photos/prod.jpg' }], { env: prodEnv });
  assert.equal(p.res.statusCode, 200);
  assert.equal(p.res.headers['x-robots-tag'], undefined); // Global prelaunch Vercel headers still enforce noindex.
  assert.doesNotMatch(p.res.body, /name="robots" content="noindex"/);
  assert.match(p.res.body, /rel="canonical" href="https:\/\/rentulo.com\/kategorie\/stavba"/);
  assert.ok(p.upstreamUrl.includes('tfvgxrdjrpicgtvovehl'));
});

test('page 2 uses stable canonical and crawlable previous/next navigation', async () => {
  const twentyOne = Array.from({ length: 21 }, (_, i) => ({ ...original, id: makeId(i + 1) }));
  const first = await request(twentyOne);
  assert.equal((first.res.body.match(/<article class="offer-card">/g) || []).length, 20);
  assert.match(first.res.body, /href="\/kategorie\/stavba\?page=2" rel="next"/);
  const second = await request([twentyOne[20]], { query: { slug: 'stavba', page: '2' } });
  assert.equal(second.res.statusCode, 200);
  assert.match(second.res.body, /href="\/kategorie\/stavba" rel="prev"/);
  assert.match(second.res.body, /rel="canonical" href="https:\/\/rentulo.eu\/kategorie\/stavba\?page=2"/);
  assert.equal(new URL(second.upstreamUrl).searchParams.get('offset'), '20');
  assert.doesNotMatch(second.res.body, /rel="next"/);
});

test('invalid category slug, invalid pages and missing later pages return 404/noindex without leaks', async () => {
  for (const slug of ['vrtačky', 'unknown', 'STAVBA', '../admin', 'script']) {
    const r = await request([original], { slug });
    assert.equal(r.res.statusCode, 404, slug);
    assert.equal(r.res.headers['x-robots-tag'], 'noindex');
    assert.equal(r.fetchCount, 0);
  }
  for (const page of ['0', '00', '-1', '2.3', '501', 'a']) {
    const r = await request([original], { query: { slug: 'stavba', page } });
    assert.equal(r.res.statusCode, 404, page);
    assert.equal(r.fetchCount, 0);
  }
  const afterEnd = await request([], { query: { slug: 'stavba', page: '2' } });
  assert.equal(afterEnd.res.statusCode, 404);
  assert.equal(afterEnd.res.headers['x-robots-tag'], 'noindex');
});

test('private fields and unapproved images never enter the public category HTML', async () => {
  const malicious = {
    ...original, name: '<script>alert(1)</script>', city: '<Zlín>', pickup_phone: '+420123987456',
    pickup_street: 'Do not show', pin: '556677', email: 'private@example.com',
    photo_url: 'https://evil.example/image.jpg'
  };
  const { res } = await request([malicious]);
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<script>|evil\.example|Do not show|556677|private@example\.com|\+420123987456/);
  assert.match(res.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(res.body, /rentulo.eu\/assets\/rentulo-logo-mark.png/);
  const mismatch = await request([{ ...original, category: 'Hobby' }]);
  assert.equal(mismatch.res.statusCode, 503);
  assert.equal(mismatch.res.headers['x-robots-tag'], 'noindex');
  assert.doesNotMatch(mismatch.res.body, /Aku vrtačka/);
});

test('database failure is 503/noindex, and wrong custom domain is rejected before DB access', async () => {
  const failed = await request([original], { failure: true });
  assert.equal(failed.res.statusCode, 503);
  assert.equal(failed.res.headers['retry-after'], '60');
  assert.equal(failed.res.headers['x-robots-tag'], 'noindex');
  const wrong = await request([original], { host: 'rentulo.com' });
  assert.equal(wrong.res.statusCode, 404);
  assert.equal(wrong.fetchCount, 0);
});

test('HEAD returns headers without HTML and unsupported methods are rejected before queries', async () => {
  const head = await request([original], { method: 'HEAD' });
  assert.equal(head.res.statusCode, 200);
  assert.equal(head.res.body, '');
  const post = await request([original], { method: 'POST' });
  assert.equal(post.res.statusCode, 405);
  assert.equal(post.res.headers.allow, 'GET, HEAD');
  assert.equal(post.fetchCount, 0);
});
