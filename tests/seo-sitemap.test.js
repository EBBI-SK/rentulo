const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

const root = path.join(__dirname, '..');
const buildScript = path.join(root, 'scripts/build-site.mjs');
const catalog = JSON.parse(readFileSync(path.join(root, 'scripts/seo-pages.json'), 'utf8'));
const vercel = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const fakeProdKey = `sb_publishable_${'SeoProdKey'.repeat(5)}`;

function buildAndCheck(environment, verify) {
  const output = mkdtempSync(path.join(os.tmpdir(), 'rentulo-sitemap-'));
  const env = { ...process.env };
  delete env.RENTULO_DEPLOY_TARGET;
  delete env.RENTULO_SUPABASE_URL;
  delete env.RENTULO_SUPABASE_PUBLISHABLE_KEY;
  try {
    const build = spawnSync(process.execPath, [buildScript, output], {
      cwd: root,
      env: { ...env, ...environment },
      encoding: 'utf8'
    });
    assert.equal(build.status, 0, build.stderr);
    verify(output);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

const prodEnvironment = {
  RENTULO_DEPLOY_TARGET: 'prod',
  RENTULO_SUPABASE_URL: 'https://tfvgxrdjrpicgtvovehl.supabase.co',
  RENTULO_SUPABASE_PUBLISHABLE_KEY: fakeProdKey
};

test('TEST robots.txt permits crawling so the global noindex response header can be read', () => {
  buildAndCheck({ RENTULO_DEPLOY_TARGET: 'test' }, output => {
    const robots = readFileSync(path.join(output, 'robots.txt'), 'utf8');
    assert.equal(robots, 'User-agent: *\nAllow: /\n');
    assert.doesNotMatch(robots, /(?:^|\n)Disallow\s*:/i);
    assert.doesNotMatch(robots, /(?:^|\n)Sitemap\s*:/i);
    assert.equal(existsSync(path.join(output, 'sitemap.xml')), false);
  });
});

test('default build remains TEST and does not expose a sitemap', () => {
  buildAndCheck({}, output => {
    assert.equal(readFileSync(path.join(output, 'robots.txt'), 'utf8'), 'User-agent: *\nAllow: /\n');
    assert.equal(existsSync(path.join(output, 'sitemap.xml')), false);
  });
});

test('PROD robots.txt references only the future production sitemap', () => {
  buildAndCheck(prodEnvironment, output => {
    const robots = readFileSync(path.join(output, 'robots.txt'), 'utf8');
    assert.equal(robots, 'User-agent: *\nAllow: /\n\nSitemap: https://rentulo.com/sitemap.xml\n');
    assert.doesNotMatch(robots, /rentulo\.eu|Disallow\s*:/i);
  });
});

test('PROD sitemap is valid UTF-8 XML with the exact public canonical URLs', () => {
  buildAndCheck(prodEnvironment, output => {
    const sitemap = readFileSync(path.join(output, 'sitemap.xml'), 'utf8');
    assert.ok(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'));
    assert.ok(sitemap.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
    assert.ok(sitemap.trimEnd().endsWith('</urlset>'));
    const locations = [...sitemap.matchAll(/<url><loc>([^<>]+)<\/loc><\/url>/g)].map(match => match[1]);
    const expected = Object.values(catalog.public).map(page => `https://rentulo.com${page.path}`);
    assert.equal(locations.length, expected.length);
    assert.deepEqual([...locations].sort(), [...expected].sort());
    assert.equal(new Set(locations).size, locations.length);
    assert.ok(locations.every(url => url.startsWith('https://rentulo.com/')));
    assert.doesNotMatch(sitemap, /rentulo\.eu|<lastmod>|<changefreq>|<priority>|<xhtml:link|\?id=/);
    for (const filename of Object.keys(catalog.private)) {
      assert.ok(!locations.some(url => url.endsWith(`/${filename}`)), `Private page in sitemap: ${filename}`);
    }
    for (const location of locations) {
      const filename = location === 'https://rentulo.com/' ? 'index.html' : location.split('/').pop();
      const html = readFileSync(path.join(output, filename), 'utf8');
      assert.ok(html.includes(`rel="canonical" href="${location}"`), `Missing canonical for ${location}`);
      assert.ok(!html.includes('name="robots" content="noindex"'), `Public page is noindex: ${location}`);
    }
  });
});

test('prelaunch TEST, PROD and preview hosts still have X-Robots-Tag noindex', () => {
  const rules = vercel.headers.filter(rule =>
    rule.headers.some(header => header.key.toLowerCase() === 'x-robots-tag')
  );
  assert.equal(rules.length, 3);
  for (const host of ['rentulo.eu', 'rentulo.com', 'rentulo.vercel.app', 'rentulo-prod.vercel.app']) {
    const matching = rules.filter(rule => {
      const ruleCondition = rule.has?.[0] || rule.missing?.[0];
      const matches = new RegExp(ruleCondition.value.re).test(host);
      return rule.has ? matches : !matches;
    });
    assert.equal(matching.length, 1, `Expected one noindex rule for ${host}`);
    assert.equal(matching[0].headers.find(h => h.key === 'X-Robots-Tag').value, 'noindex');
  }
});
