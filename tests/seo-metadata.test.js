const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, mkdtempSync, rmSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const root = path.join(__dirname, '..');
const catalog = JSON.parse(readFileSync(path.join(root, 'scripts/seo-pages.json'), 'utf8'));
function build(env, check) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rentulo-seo-'));
  try {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/build-site.mjs'), dir], {
      cwd: root, encoding: 'utf8', env: {...process.env,...env}
    });
    assert.equal(result.status, 0, result.stderr);
    check(name => readFileSync(path.join(dir, name), 'utf8'));
  } finally { rmSync(dir, {recursive:true, force:true}); }
}
test('SEO covers all HTML pages and five translations', () => {
  const pages = readdirSync(root).filter(name => name.endsWith('.html')).sort();
  assert.deepEqual([...Object.keys(catalog.public),...Object.keys(catalog.private)].sort(), pages);
  for (const page of Object.values(catalog.public))
    for (const lang of ['cs','sk','en','de','pl']) {
      assert.ok(page.translations[lang]?.title);
      assert.ok(page.translations[lang]?.description);
    }
});
test('TEST has pre-rendered canonical and Open Graph on public pages only', () => build({}, get => {
  for (const [name,page] of Object.entries(catalog.public)) {
    const html=get(name);
    assert.ok(html.includes('rel="canonical" href="https://rentulo.eu'+page.path+'"'));
    assert.ok(html.includes('property="og:url" content="https://rentulo.eu'+page.path+'"'));
    assert.ok(html.includes('name="description"'));
    assert.ok(html.includes('src="js/seo.js"'));
  }
  for (const name of Object.keys(catalog.private)) {
    const html=get(name);
    assert.ok(html.includes('name="robots" content="noindex"'));
    assert.ok(!html.includes('rel="canonical"'));
    assert.ok(!html.includes('property="og:url"'));
  }
}));
test('PROD canonicals are prepared for rentulo.com but noindex remains on private pages', () =>
  build({ RENTULO_DEPLOY_TARGET:'prod',
    RENTULO_SUPABASE_URL:'https://tfvgxrdjrpicgtvovehl.supabase.co',
    RENTULO_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_'+'ProdSeoKey'.repeat(5) }, get => {
    for (const [name,page] of Object.entries(catalog.public))
      assert.ok(get(name).includes('rel="canonical" href="https://rentulo.com'+page.path+'"'));
    assert.ok(get('detail.html').includes('name="robots" content="noindex"'));
  }));
