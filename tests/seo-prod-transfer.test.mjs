import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import handler, { renderServerResultsHtml } from '../api/results-page.mjs';
import { getOfferSeoConfig } from '../api/offer-page.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const prodHost = 'tfvgxrdjrpicgtvovehl.supabase.co';
const testHost = 'vspposovhdgvbeukoivh.supabase.co';
const prodKey = 'sb_publishable_' + 'SafeFakeProdOnly_'.repeat(3);
const env = { RENTULO_DEPLOY_TARGET: 'prod', RENTULO_SUPABASE_URL: `https://${prodHost}`,
  RENTULO_SUPABASE_PUBLISHABLE_KEY: prodKey };
const config = getOfferSeoConfig(env);
function result() {
  return { statusCode: 200, headers: {}, body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(content) { this.body = content; } };
}
const row = {
  id: 'e0aa1a00-0000-4000-8000-000000000001',
  owner_id: 'e0aa1a00-0000-4000-8000-000000000002',
  name: 'Vrtačka', category: 'Stavba', city: 'Zlín', price_per_day: 150,
  status: 'active', created_at: '2026-11-10T06:00:00Z', updated_at: '2026-11-10T06:00:00Z',
  photo_url: `https://${prodHost}/storage/v1/object/public/offer-photos/vrta.jpg`
};
async function mockRequest(method, host, url, rows = [row]) {
  const priorFetch = global.fetch;
  const oldEnv = {
    RENTULO_DEPLOY_TARGET: process.env.RENTULO_DEPLOY_TARGET,
    RENTULO_SUPABASE_URL: process.env.RENTULO_SUPABASE_URL,
    RENTULO_SUPABASE_PUBLISHABLE_KEY: process.env.RENTULO_SUPABASE_PUBLISHABLE_KEY
  };
  Object.assign(process.env, env);
  const calls = [];
  global.fetch = async (target, opts) => {
    calls.push({ target: String(target), opts });
    return { ok: true, json: async () => rows };
  };
  const res = result();
  try {
    await handler({ method, url, headers: { host } }, res);
  } finally {
    global.fetch = priorFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  return { res, calls };
}

test('PROD SEO uses isolated publishable Supabase settings without TEST cross-contamination', () => {
  assert.equal(config.target, 'prod');
  assert.equal(config.siteOrigin, 'https://rentulo.com');
  assert.equal(config.supabaseOrigin, `https://${prodHost}`);
  assert.throws(() => getOfferSeoConfig({ ...env,
    RENTULO_SUPABASE_URL: `https://${testHost}` }), /does not belong/);
  assert.throws(() => getOfferSeoConfig({ ...env,
    RENTULO_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_SuperPrivateNotAllowed' }), /publishable/);
});

test('PROD SSR produces public offer photos directly in HTML, with noindex before launch', async () => {
  const { res, calls } = await mockRequest('GET', 'rentulo.com', '/vysledky.html');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-robots-tag'], 'noindex');
  assert.equal(res.headers['cache-control'], 'private, no-store');
  assert.equal(res.headers['x-rentulo-ssr'], 'rendered');
  assert.equal(calls.length, 1);
  assert.match(calls[0].target, new RegExp(`^https://${prodHost}/rest/v1/public_offers\\?`));
  assert.equal(calls[0].opts.headers.apikey, prodKey);
  assert.match(res.body, /data-server-preview="1"/);
  assert.match(res.body, /render\/image\/public\/offer-photos\/vrta.jpg\?width=320&amp;quality=75/);
  assert.match(res.body, /fetchpriority="high"/);
  assert.match(res.body, /<meta name="robots" content="noindex"/);
  assert.doesNotMatch(res.body, new RegExp(testHost));
  assert.doesNotMatch(res.body, /sb_secret_|service_role/);
});

test('Cross-domain, user-filtered and HEAD requests never pre-render unrequested offers', async () => {
  const cross = await mockRequest('GET', 'rentulo.eu', '/vysledky.html');
  assert.equal(cross.res.statusCode, 404);
  assert.equal(cross.calls.length, 0);
  const filtered = await mockRequest('GET', 'rentulo.com', '/vysledky.html?co=vrta%C4%8Dka');
  assert.equal(filtered.res.statusCode, 200);
  assert.equal(filtered.calls.length, 0);
  assert.doesNotMatch(filtered.res.body, /data-server-preview/);
  const head = await mockRequest('HEAD', 'rentulo.com', '/vysledky.html');
  assert.equal(head.res.statusCode, 200);
  assert.equal(head.calls.length, 0);
  assert.equal(head.res.body, '');
});

test('Prelaunch Vercel rule keeps both custom domains and previews noindex', () => {
  const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
  assert.ok(vercel.rewrites.some(x => x.source === '/vysledky.html' &&
    x.destination === '/api/results-page'));
  assert.ok(vercel.rewrites.some(x => x.source === '/kategorie/:slug'));
  assert.ok(vercel.rewrites.some(x => x.source === '/kategorie/:slug/mesto/:city'));
  const noindex = vercel.headers.filter(rule => rule.headers.some(h => h.key === 'X-Robots-Tag'));
  assert.equal(noindex.length, 3);
  for (const rule of noindex) {
    assert.equal(rule.headers.find(h => h.key === 'X-Robots-Tag').value, 'noindex');
  }
  assert.match(readFileSync(join(root, 'index.html'), 'utf8'), /Prohlédnout nabídky/);
});

test('Production SQL is guarded, manual-only and not included in Supabase auto migrations', () => {
  const base = join(root, 'supabase/prod-release-20261110-seo/migrations');
  for (const filename of [
    '20261110110000_seo19b2_automatic_subcategories_PROD.sql',
    '20261110120000_seo19b3_category_cities_PROD.sql'
  ]) {
    const sql = readFileSync(join(base, filename), 'utf8');
    assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
    assert.match(sql, new RegExp(prodHost.replaceAll('.', '\\.')));
    assert.doesNotMatch(sql, /https:\/\/vspposovhdgvbeukoivh\.supabase\.co/);
    assert.match(sql, /vault\.decrypted_secrets/);
    assert.match(sql, /information_schema\.columns/);
    assert.doesNotMatch(sql, /\bUPDATE\s+public\.offers\s+SET\b/i);
  }
});
