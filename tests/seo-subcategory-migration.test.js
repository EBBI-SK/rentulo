const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '..');
const sql = readFileSync(path.join(root, 'supabase/migrations/20261109170000_seo19b2_automatic_subcategories_TEST.sql'), 'utf8');
const taxonomyPromise = import(pathToFileURL(path.join(root, 'api/seo-subcategories.mjs')).href);
const categoriesPromise = import(pathToFileURL(path.join(root, 'api/seo-categories.mjs')).href);
const normalizeDecl = sql.match(/translate\(lower\(coalesce\(p_value, ''\)\), '([^']+)', '([^']+)'\)/);
assert.ok(normalizeDecl, 'SQL transliteration must be explicit and reproducible');
assert.equal(normalizeDecl[1].length, normalizeDecl[2].length);
const substitutions = new Map([...normalizeDecl[1]].map((char, i) => [char, normalizeDecl[2][i]]));
function norm(text) {
  return ` ${(text || '').toLowerCase().replace(/./gu, c => substitutions.get(c) || c)
    .replace(/[^a-z0-9]+/g, ' ').trim()} `;
}
const ruleBody = sql.split('), rules(category, slug, phrase, strong) AS (\n  VALUES\n')[1]?.split('\n), scores AS (')[0];
assert.ok(ruleBody, 'SQL classification rules must be available to inspect');
const rules = [...ruleBody.matchAll(/\('([^']+)', '([^']+)', '([^']+)', (true|false)\)/g)]
  .map(m => ({ category: m[1], slug: m[2], phrase: m[3], strong: m[4] === 'true' }));
assert.ok(rules.length >= 150, 'All five Rentulo language synonym families must be covered');
const manualBody = sql.split('SELECT (p_category, p_slug) IN (\n    VALUES\n')[1]?.split('\n  );')[0];
assert.ok(manualBody);
const validSlugs = [...manualBody.matchAll(/\('([^']+)', '([^']+)'\)/g)].map(x => [x[1], x[2]]);

// Reference interpreter for the *literal SQL rule table*. These tests validate
// the intended mapping and static guards, not an executed PostgreSQL migration.
function classify(category, name, description = '') {
  const title = norm(name), body = norm(description);
  const scores = new Map();
  for (const r of rules.filter(rule => rule.category === category)) {
    if (!scores.has(r.slug)) scores.set(r.slug, { title: 0, description: 0 });
    const score = scores.get(r.slug);
    if (title.includes(` ${r.phrase} `)) score.title++;
    if (r.strong && body.includes(` ${r.phrase} `)) score.description++;
  }
  const winners = [...scores].filter(([, x]) => x.title > 0);
  if (winners.length === 1) return winners[0][0];
  if (winners.length > 1) {
    const tie = winners.filter(([, x]) => x.description > 0);
    return tie.length === 1 ? tie[0][0] : null;
  }
  const desc = [...scores].filter(([, x]) => x.description >= 2);
  return desc.length === 1 ? desc[0][0] : null;
}

test('SQL migration is TEST-only, transactional, validated against existing public view', () => {
  assert.match(sql, /BEGIN;[\s\S]+COMMIT;/);
  assert.match(sql, /s\.name = 'rentulo_project_url'/);
  assert.match(sql, /vspposovhdgvbeukoivh\.supabase\.co/);
  assert.match(sql, /PROD forbidden/);
  assert.match(sql, /information_schema\.columns/);
  assert.match(sql, /'offer_number'/);
  // Actual TEST public_offers columns verified on 2026-11-09; preserve all 15
  // existing columns in the same order before appending subcategory_slug.
  const guard = sql.match(/IF v_columns IS DISTINCT FROM ARRAY\[([\s\S]*?)\]::text\[\]/);
  assert.ok(guard, 'Preflight must validate the exact current TEST view columns');
  const expectedColumns = [...guard[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(expectedColumns, [
    'id', 'owner_id', 'name', 'category', 'description', 'city', 'postal_code',
    'price_per_day', 'status', 'photo_url', 'pickup_mode', 'created_at',
    'updated_at', 'offer_number', 'min_rental_days'
  ]);
  const viewColumns = sql.match(/CREATE OR REPLACE VIEW public\.public_offers[\s\S]*?AS\s+SELECT\s+([\s\S]*?)\s+FROM public\.offers o/);
  assert.ok(viewColumns, 'View must keep its existing columns before the new SEO field');
  assert.match(viewColumns[1], /o\.updated_at, o\.offer_number,\s*o\.min_rental_days,\s*COALESCE\(/);
  assert.doesNotMatch(sql, /UPDATE\s+public\.offers\s+SET/ig);
  assert.match(sql, /GENERATED ALWAYS AS \(public\.seo19b2_classify\(category, name, description\)\) STORED/);
  assert.match(sql, /CREATE OR REPLACE VIEW public\.public_offers[\s\S]*security_invoker = false, security_barrier = true/);
  assert.match(sql, /WHERE o\.status = 'active'::public\.offer_status/);
  assert.match(sql, /GRANT SELECT ON TABLE public\.public_offers TO anon, authenticated/);
});

test('SQL mapping matches the 26 stable JS SEO subcategories exactly', async () => {
  const { SEO_SUBCATEGORIES } = await taxonomyPromise;
  const { SEO_CATEGORIES } = await categoriesPromise;
  const names = Object.fromEntries(SEO_CATEGORIES.map(c => [c.slug, c.name]));
  const expected = SEO_SUBCATEGORIES.map(x => `${names[x.categorySlug]}|${x.slug}`).sort();
  assert.deepEqual(validSlugs.map(x => x.join('|')).sort(), expected);
  const automatic = new Set(rules.map(x => `${x.category}|${x.slug}`));
  assert.deepEqual([...automatic].sort(), expected.filter(x => x !== 'Ostatní|jine'));
  assert.equal(rules.filter(x => x.slug === 'jine').length, 0);
  assert.equal(new Set(rules.map(x => `${x.category}|${x.slug}|${x.phrase}`)).size, rules.length);
  for (const rule of rules) {
    assert.match(rule.phrase, /^[a-z0-9]+(?: [a-z0-9]+)*$/);
    assert.equal(rule.strong, rule.phrase.includes(' '));
  }
});

test('five language families match within the selected main category', () => {
  const examples = [
    ['Stavba', 'Aku vrtačka Bosch 18V', 'vrtacky'],
    ['Stavba', 'Akumulátorová vŕtačka', 'vrtacky'],
    ['Stavba', 'Cordless drill kit', 'vrtacky'],
    ['Stavba', 'Bohrmaschine Bosch', 'vrtacky'],
    ['Stavba', 'Wiertarka Makita', 'vrtacky'],
    ['Zahrada', 'Benzínová sekačka Honda', 'sekacky'],
    ['Zahrada', 'Kosiarka spalinowa', 'sekacky'],
    ['Zahrada', 'Rasenmäher', 'sekacky'],
    ['Zahrada', 'Water pump', 'cerpadla'],
    ['Domácnost', 'Kärcher tepovač koberců', 'uklid'],
    ['Domácnost', 'Odkurzacz Kärcher', 'uklid'],
    ['Domácnost', 'Dampfreiniger', 'uklid'],
    ['Domácnost', 'Coffee machine', 'kuchynske-pristroje'],
    ['Hobby', 'Digitální fotoaparát Canon', 'foto-video'],
    ['Hobby', 'Aparat fotograficzny', 'foto-video'],
    ['Hobby', 'Gitarre Yamaha', 'hudebni-nastroje'],
    ['Hobby', 'Namiot turystyczny', 'kempovani'],
    ['Párty', 'Párty stan 3x6m', 'stany-pristresky'],
    ['Párty', 'Event tent 6x6', 'stany-pristresky'],
    ['Párty', 'Partyzelt', 'stany-pristresky'],
    ['Párty', 'Mikrofón Shure', 'ozvuceni'],
    ['Ostatní', 'Projektor Epson', 'kancelar-prezentace'],
    ['Ostatní', 'Wózek dziecięcy', 'detske-vybaveni'],
    ['Ostatní', 'Sněhová fréza', 'sezonni-vybaveni']
  ];
  for (const [category, title, expected] of examples) {
    assert.equal(classify(category, title), expected, `${category}: ${title}`);
  }
});

test('ambiguous terms stay unclassified and descriptions alone need strong multiple clues', () => {
  for (const [category, title] of [
    ['Stavba', 'Laser'], ['Stavba', 'Pila'], ['Hobby', 'Stan'],
    ['Párty', 'Stan'], ['Ostatní', 'Multifunkční zařízení'],
    ['Hobby', 'Kamera a kytara'], ['Stavba', 'Bike']
  ]) assert.equal(classify(category, title), null, title);
  assert.equal(classify('Stavba', 'Bosch GSR 18V', 'Vrtací kladivo a cordless drill'), 'vrtacky');
  assert.equal(classify('Stavba', 'Bosch GSR 18V', 'Vrtací kladivo'), null);
  assert.equal(classify('Hobby', 'Kamera a kytara', 'Digital camera objektiv, camera lens'), 'foto-video');
  assert.equal(classify('Hobby', 'Kamera a kytara', 'Skvělá věc'), null);
  assert.equal(classify('Hobby', 'Aku vrtačka', ''), null, 'No reclassification outside the selected main category');
  assert.equal(classify('Ostatní', 'Jiné zařízení'), null, 'Jiné is never automatic');
  assert.equal(classify('Stavba', 'Ne-vrtačka'), 'vrtacky', 'Whole word split on punctuation');
  assert.equal(classify('Stavba', 'Nezvrtačka'), null, 'No substring stem matches');
});

test('override is owner-only, audited and invisible to ordinary users', () => {
  assert.match(sql, /CREATE TABLE public\.seo19b2_subcategory_overrides/);
  assert.match(sql, /CREATE TABLE public\.seo19b2_override_events/);
  assert.match(sql, /ALTER TABLE public\.seo19b2_subcategory_overrides ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE public\.seo19b2_override_events ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.seo19b2_subcategory_overrides,[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /PERFORM public\.platform_admin_assert\(p_reason\)/);
  assert.match(sql, /CREATE FUNCTION public\.seo19b2_admin_override\(/);
  assert.match(sql, /CREATE TRIGGER seo19b2_audit_append_only/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.seo19b2_admin_override\(uuid,text,text\)/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.seo19b2_normalize\(text\),[\s\S]*TO anon, authenticated, service_role/);
  assert.match(sql, /COALESCE\(CASE WHEN ov\.category = o\.category THEN ov\.slug END, o\.subcategory_slug\)/);
});
