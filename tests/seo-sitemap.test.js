const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

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

test('PROD no longer emits a static sitemap that could mask the live rewrite', () => {
  buildAndCheck(prodEnvironment, output => {
    assert.equal(existsSync(path.join(output, 'sitemap.xml')), false);
    const robots = readFileSync(path.join(output, 'robots.txt'), 'utf8');
    assert.match(robots, /Sitemap: https:\/\/rentulo\.com\/sitemap\.xml/);
  });
  const sitemapRewrite = vercel.rewrites.find(rule => rule.source === '/sitemap.xml');
  assert.deepEqual(sitemapRewrite, { source: '/sitemap.xml', destination: '/api/sitemap' });
  assert.ok(vercel.functions['api/sitemap.mjs'].includeFiles.includes('scripts/seo-pages.json'));
  assert.ok(vercel.functions['api/sitemap.mjs'].includeFiles.includes('js/supabase-config.js'));
  assert.ok(vercel.rewrites.some(rule => rule.source === '/nabidka/:id'));
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

// The live function is tested locally with a mocked Supabase public view.
// No private credentials or production database connection is required.
const sitemapModulePromise = import(pathToFileURL(path.join(root, 'api/sitemap.mjs')).href);
const exampleId = '11637b8e-fe0c-4c66-b441-e9bc5789ab9e';
const secondId = 'ec70cc29-317e-4014-a25e-3ae4d0e6a922';

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { this.body = body; }
  };
}

async function withProdEnv(env, work) {
  const keys = ['RENTULO_DEPLOY_TARGET', 'RENTULO_SUPABASE_URL', 'RENTULO_SUPABASE_PUBLISHABLE_KEY'];
  const old = Object.fromEntries(keys.map(name => [name, process.env[name]]));
  for (const name of keys) delete process.env[name];
  Object.assign(process.env, env);
  try { return await work(); }
  finally {
    for (const name of keys) {
      if (old[name] === undefined) delete process.env[name];
      else process.env[name] = old[name];
    }
  }
}

async function callSitemap({ env = {}, rows = [], method = 'GET', host = 'rentulo.eu', status = 200 } = {}) {
  const { default: handler } = await sitemapModulePromise;
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return { ok: status === 200, async json() { return rows; } };
  };
  const res = mockRes();
  try {
    await withProdEnv(env, () => handler({ method, headers: { host } }, res));
    return { res, calls };
  } finally { global.fetch = previousFetch; }
}

test('live sitemap remains 404/noindex on TEST and never queries offers', async () => {
  const { res, calls } = await callSitemap();
  assert.equal(res.statusCode, 404);
  assert.equal(res.headers['x-robots-tag'], 'noindex');
  assert.equal(res.headers['cache-control'], 'private, no-store');
  assert.equal(calls.length, 0);
});

test('live PROD sitemap contains only the five public canonical paths and active offers', async () => {
  const { res, calls } = await callSitemap({
    env: prodEnvironment,
    host: 'rentulo.com',
    rows: [
      { id: exampleId, updated_at: '2026-10-08T13:01:00Z' },
      { id: secondId, updated_at: '2026-10-09T09:00:00Z' }
    ]
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/xml; charset=utf-8');
  assert.ok(res.body.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(res.body.includes('<lastmod>2026-10-08</lastmod>'));
  const expected = [
    ...Object.values(catalog.public).map(page => `https://rentulo.com${page.path}`),
    `https://rentulo.com/nabidka/${exampleId}`,
    `https://rentulo.com/nabidka/${secondId}`
  ];
  const found = [...res.body.matchAll(/<loc>([^<>]+)<\/loc>/g)].map(match => match[1]);
  assert.deepEqual(found, expected);
  assert.doesNotMatch(res.body, /rentulo\.eu|detail\.html|moje-nabidky|moje-rezervace|prihlaseni|<changefreq>|<priority>|<xhtml:link|\?id=/);
  assert.equal(calls.length, 1);
  const request = new URL(calls[0].url);
  assert.equal(request.origin, 'https://tfvgxrdjrpicgtvovehl.supabase.co');
  assert.equal(request.pathname, '/rest/v1/public_offers');
  assert.equal(request.searchParams.get('select'), 'id,updated_at');
  assert.equal(request.searchParams.get('status'), 'eq.active');
  assert.equal(request.searchParams.get('order'), 'id.asc');
  assert.equal(request.searchParams.get('limit'), '500');
  assert.ok(calls[0].options.headers.apikey.startsWith('sb_publishable_'));
  assert.equal(calls[0].options.headers.Authorization, undefined);
});

test('production never queries TEST Supabase and requires explicitly provided PROD credentials', async () => {
  const wrong = await callSitemap({ env: { RENTULO_DEPLOY_TARGET: 'prod' }, host: 'rentulo.com' });
  assert.equal(wrong.res.statusCode, 503);
  assert.equal(wrong.calls.length, 0);
  assert.equal(wrong.res.headers['x-robots-tag'], 'noindex');
  assert.equal(wrong.res.headers['retry-after'], '60');
  const wrongHost = await callSitemap({ env: prodEnvironment, host: 'rentulo.eu' });
  assert.equal(wrongHost.res.statusCode, 404);
  assert.equal(wrongHost.calls.length, 0);
});

test('temporary upstream failures never publish an incomplete sitemap', async () => {
  const { res } = await callSitemap({ env: prodEnvironment, host: 'rentulo.com', status: 500 });
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers['x-robots-tag'], 'noindex');
  assert.ok(!String(res.body).includes('<urlset'));
});

test('HEAD returns 200 headers but no XML body; unsupported methods do not query Supabase', async () => {
  const head = await callSitemap({ env: prodEnvironment, host: 'rentulo.com', method: 'HEAD' });
  assert.equal(head.res.statusCode, 200);
  assert.equal(head.res.body, '');
  assert.equal(head.res.headers['content-type'], 'application/xml; charset=utf-8');
  const method = await callSitemap({ method: 'POST' });
  assert.equal(method.res.statusCode, 405);
  assert.equal(method.res.headers.allow, 'GET, HEAD');
  assert.equal(method.calls.length, 0);
});

test('live sitemap paginates the public view without duplicates', async () => {
  const { listSitemapOffers } = await sitemapModulePromise;
  const rows = Array.from({ length: 501 }, (_, n) => ({
    id: '00000000-0000-4000-8000-' + n.toString(16).padStart(12, '0'),
    updated_at: n === 500 ? 'invalid' : '2026-10-08T00:00:00Z'
  }));
  const urls = [];
  const result = await listSitemapOffers({
    supabaseOrigin: 'https://tfvgxrdjrpicgtvovehl.supabase.co',
    publishableKey: prodEnvironment.RENTULO_SUPABASE_PUBLISHABLE_KEY
  }, async url => {
    const parsed = new URL(url);
    urls.push(parsed);
    return { ok: true, async json() { return urls.length === 1 ? rows.slice(0, 500) : rows.slice(500); } };
  });
  assert.equal(result.length, 501);
  assert.equal(urls.length, 2);
  assert.equal(urls[1].searchParams.get('id'), `gt.${rows[499].id}`);
  assert.equal(result[0].lastmod, '2026-10-08');
  assert.equal(result[500].lastmod, '');
});

test('invalid, duplicate or unsorted public IDs fail closed', async () => {
  const { listSitemapOffers, renderSitemapXml } = await sitemapModulePromise;
  const config = { supabaseOrigin: 'https://tfvgxrdjrpicgtvovehl.supabase.co', publishableKey: 'sb_publishable_ValidDummyKey123456789' };
  await assert.rejects(listSitemapOffers(config, async () => ({ ok: true, async json() { return [{ id: 'nope' }]; } })), /Invalid public offer/);
  await assert.rejects(listSitemapOffers(config, async () => ({ ok: true, async json() { return [{ id: secondId }, { id: exampleId }]; } })), /not strictly ordered/);
  assert.throws(() => renderSitemapXml([{ id: '<script>' }]), /Invalid sitemap offer ID/);
});
