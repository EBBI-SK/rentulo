const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const sql = readFileSync(path.join(root, 'supabase/migrations/20261109183000_seo19b3_category_cities_TEST.sql'), 'utf8');
const citiesPromise = import(pathToFileURL(path.join(root, 'api/seo-cities.mjs')).href);
const vercel = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));

test('19B3 SQL is TEST-only, atomic and checks all 16 existing columns', () => {
  assert.match(sql, /^-- RENTULO SEO 19B\/3 \/ TEST ONLY/);
  assert.match(sql, /\bBEGIN;[\s\S]*\bCOMMIT;\s*$/);
  assert.match(sql, /vault\.decrypted_secrets/);
  assert.match(sql, /rentulo_project_url/);
  assert.match(sql, /vspposovhdgvbeukoivh\.supabase\.co/);
  assert.match(sql, /PROD forbidden/);
  assert.match(sql, /'security_invoker=false'/);
  assert.match(sql, /'security_barrier=true'/);
  const columns = sql.match(/IF v_columns IS DISTINCT FROM ARRAY\[([\s\S]*?)\]::text\[\]/);
  assert.ok(columns);
  assert.deepEqual([...columns[1].matchAll(/'([^']+)'/g)].map(m => m[1]), [
    'id','owner_id','name','category','description','city','postal_code',
    'price_per_day','status','photo_url','pickup_mode','created_at',
    'updated_at','offer_number','min_rental_days','subcategory_slug'
  ]);
  assert.match(sql, /to_regclass\('public\.seo19b2_subcategory_overrides'\)/);
  assert.match(sql, /is_generated = 'ALWAYS'/);
  assert.doesNotMatch(sql, /UPDATE\s+public\.offers\s+SET/i);
});

test('generated city slug is immutable, indexable and never user-writeable', () => {
  assert.match(sql, /CREATE FUNCTION public\.seo19b3_city_slug\(p_city text\)[\s\S]*?IMMUTABLE/);
  assert.match(sql, /ADD COLUMN seo_city_slug text\s+GENERATED ALWAYS AS \(public\.seo19b3_city_slug\(city\)\) STORED;/);
  assert.match(sql, /CREATE INDEX seo19b3_public_category_city_slug_id_idx\s+ON public\.offers \(category, seo_city_slug, id\)/);
  assert.match(sql, /WHERE status = 'active'::public\.offer_status/);
  assert.match(sql, /CREATE OR REPLACE VIEW public\.public_offers[\s\S]*?security_invoker = false, security_barrier = true/);
  assert.match(sql, /o\.min_rental_days,\s*COALESCE\(CASE WHEN ov\.category = o\.category THEN ov\.slug END, o\.subcategory_slug\)\s*AS subcategory_slug,\s*o\.seo_city_slug AS seo_city_slug/);
  assert.match(sql, /LEFT JOIN public\.seo19b2_subcategory_overrides ov ON ov\.offer_id = o\.id/);
  assert.match(sql, /WHERE o\.status = 'active'::public\.offer_status/);
  assert.match(sql, /GRANT SELECT ON TABLE public\.public_offers TO anon, authenticated/);
  assert.doesNotMatch(sql, /\bservice_role\s*=/i);
});

test('JS and literal SQL transliteration agree on Czech city names', async () => {
  const { getSeoCitySlug } = await citiesPromise;
  const match = sql.match(/translate\(replace\(lower\(normalize\(value, NFC\)\), '\u00df', 'ss'\), '([^']+)', '([^']+)'\)/);
  assert.ok(match, 'The exact transliteration table must be visible for static inspection');
  assert.equal(match[1].length, match[2].length);
  const transliteration = Object.fromEntries([...match[1]].map((c, i) => [c, match[2][i]]));
  for (const city of ['Praha', 'Zl\u00edn', 'Uhersk\u00e9 Hradi\u0161t\u011b', '\u010cesk\u00e9 Bud\u011bjovice',
    'Hradec Kr\u00e1lov\u00e9', '\u017d\u010f\u00e1r nad S\u00e1zavou', '\u00dast\u00ed nad Labem', 'D\u011b\u010d\u00edn',
    '\u0158\u00ed\u010dany', 'Ostrava', 'Praha 10', 'Mlad\u00e1 Boleslav', 'Zli\u0301n']) {
    const candidate = city.normalize('NFC').toLowerCase().replace(/\u00df/g, 'ss').replace(/./gu, x => transliteration[x] || x)
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    assert.equal(getSeoCitySlug(city), candidate, city);
  }
});

test('city URL does not shadow stable subcategories or change noindex hosts', () => {
  const city = vercel.rewrites.find(r => r.source === '/kategorie/:slug/mesto/:city');
  assert.ok(city);
  assert.equal(city.destination, '/api/city-page?slug=:slug&city=:city');
  assert.ok(vercel.rewrites.indexOf(city) < vercel.rewrites.findIndex(r => r.source === '/kategorie/:slug/:subslug'));
  assert.ok(vercel.rewrites.some(r => r.source === '/kategorie/:slug'));
  assert.ok(vercel.rewrites.some(r => r.source === '/nabidky'));
  assert.deepEqual(vercel.functions['api/city-page.mjs'], { includeFiles: '{detail.html,js/supabase-config.js}' });
  const rules = vercel.headers.filter(r => r.headers.some(h => h.key === 'X-Robots-Tag'));
  assert.equal(rules.length, 3);
  for (const rule of rules) assert.equal(rule.headers.find(h => h.key === 'X-Robots-Tag').value, 'noindex');
});
