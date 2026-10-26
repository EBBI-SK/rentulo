// Live production sitemap: five canonical public pages plus active public offers.
// No service-role key, private tables, personal data, or TEST offers are used.
import { readFileSync } from 'node:fs';
import { getOfferSeoConfig } from './offer-page.mjs';

const PUBLIC_PAGES = Object.values(JSON.parse(
  readFileSync(new URL('../scripts/seo-pages.json', import.meta.url), 'utf8')
).public).map(page => page.path);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 500;
const MAX_OFFERS = 49_000; // Leave room for public static pages within sitemap limits.

const escapeXml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
})[character]);

function lastModified(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

export async function listSitemapOffers(config, fetcher = fetch) {
  const offers = [];
  let afterId = '';
  for (;;) {
    const endpoint = new URL('/rest/v1/public_offers', config.supabaseOrigin);
    endpoint.searchParams.set('select', 'id,updated_at');
    endpoint.searchParams.set('status', 'eq.active');
    endpoint.searchParams.set('order', 'id.asc');
    endpoint.searchParams.set('limit', String(PAGE_SIZE));
    if (afterId) endpoint.searchParams.set('id', `gt.${afterId}`);

    const response = await fetcher(endpoint, {
      headers: { apikey: config.publishableKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error('Public offers view is unavailable');
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length > PAGE_SIZE || offers.length + rows.length > MAX_OFFERS) {
      throw new Error('Public offers sitemap pagination limit or response invalid');
    }
    if (!rows.length) return offers;

    for (const row of rows) {
      if (typeof row?.id !== 'string' || !UUID_PATTERN.test(row.id)) {
        throw new Error('Invalid public offer identifier');
      }
      const id = row.id.toLowerCase();
      if (afterId && id <= afterId) {
        throw new Error('Public offers are not strictly ordered');
      }
      offers.push({ id, lastmod: lastModified(row.updated_at) });
      afterId = id;
    }
    if (rows.length < PAGE_SIZE) return offers;
  }
}

export function renderSitemapXml(offers, origin = 'https://rentulo.com') {
  const paths = PUBLIC_PAGES.map(path => ({ url: `${origin}${path}` }));
  for (const offer of offers) {
    if (!UUID_PATTERN.test(offer.id)) throw new Error('Invalid sitemap offer ID');
    paths.push({ url: `${origin}/nabidka/${offer.id.toLowerCase()}`, lastmod: offer.lastmod });
  }
  const items = paths.map(entry =>
    `  <url><loc>${escapeXml(entry.url)}</loc>${entry.lastmod ? `<lastmod>${escapeXml(entry.lastmod)}</lastmod>` : ''}</url>`
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...items,
    '</urlset>',
    ''
  ].join('\n');
}

export default async function handler(req, res) {
  const headOnly = req.method === 'HEAD';
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET' && !headOnly) {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.end('Method not allowed');
    return;
  }

  // TEST must continue returning 404 for /sitemap.xml, just as before 4B.
  if (String(process.env.RENTULO_DEPLOY_TARGET || 'test').trim().toLowerCase() !== 'prod' ||
      /(^|\.)rentulo\.eu$/i.test(String(req.headers?.host || '').split(':')[0])) {
    res.statusCode = 404;
    res.setHeader('X-Robots-Tag', 'noindex');
    res.end(headOnly ? '' : 'Not found');
    return;
  }

  try {
    // Same strictly separated PROD Supabase configuration as offer SEO pages.
    const config = getOfferSeoConfig();
    const offers = await listSitemapOffers(config);
    const xml = renderSitemapXml(offers, config.siteOrigin);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.end(headOnly ? '' : xml);
  } catch (error) {
    console.error('Live public sitemap unavailable:', error?.message || 'unknown error');
    res.statusCode = 503;
    res.setHeader('Retry-After', '60');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.end(headOnly ? '' : 'Sitemap temporarily unavailable');
  }
}
