// SEO 19B/2: public, server-rendered SEO subcategory landing pages.
// Reads only the restricted public_offers view, never private offer/reservation data.
import { getOfferSeoConfig } from './offer-page.mjs';
import { getSeoCategoryBySlug } from './seo-categories.mjs';
import { getSeoSubcategory } from './seo-subcategories.mjs';
import { renderCategoryHtml } from './category-page.mjs';

const PAGE_SIZE = 20;
const MAX_PAGE = 500;
function unavailable() {
  return '<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Podkategorie není dostupná | Rentulo</title></head><body><h1>Podkategorie není dostupná</h1><a href="/nabidky">Všechny nabídky</a></body></html>';
}
function send(res, status, html, headOnly, noindex = false) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  if (status !== 200 || noindex) res.setHeader('X-Robots-Tag', 'noindex');
  res.end(headOnly ? '' : html);
}

export default async function handler(req, res) {
  const headOnly = req.method === 'HEAD';
  if (req.method !== 'GET' && !headOnly) {
    res.setHeader('Allow', 'GET, HEAD');
    send(res, 405, unavailable(), false);
    return;
  }
  const requestUrl = new URL(req.url || '/kategorie/', 'https://rentulo.example');
  const matched = requestUrl.pathname.match(/^\/kategorie\/([a-z]+)\/([a-z-]+)\/?$/);
  const categorySlug = typeof req.query?.slug === 'string' ? req.query.slug : matched?.[1];
  const subcategorySlug = typeof req.query?.subslug === 'string' ? req.query.subslug : matched?.[2];
  const category = getSeoCategoryBySlug(categorySlug);
  const subcategory = getSeoSubcategory(categorySlug, subcategorySlug);
  const rawPage = req.query?.page ?? requestUrl.searchParams.get('page');
  const page = rawPage == null ? 1 : Number(rawPage);
  if (!category || !subcategory ||
      (rawPage != null && (typeof rawPage !== 'string' || !/^[1-9][0-9]*$/.test(rawPage))) ||
      !Number.isSafeInteger(page) || page > MAX_PAGE) {
    send(res, 404, unavailable(), headOnly);
    return;
  }

  try {
    const config = getOfferSeoConfig();
    const host = String(req.headers?.host || '').split(':')[0].toLowerCase();
    if ((config.target === 'test' && /(^|\.)rentulo\.com$/.test(host)) ||
        (config.target === 'prod' && /(^|\.)rentulo\.eu$/.test(host))) {
      send(res, 404, unavailable(), headOnly);
      return;
    }
    const endpoint = new URL('/rest/v1/public_offers', config.supabaseOrigin);
    endpoint.searchParams.set('select', 'id,name,category,city,price_per_day,photo_url,subcategory_slug');
    endpoint.searchParams.set('status', 'eq.active');
    endpoint.searchParams.set('category', `eq.${category.name}`);
    endpoint.searchParams.set('subcategory_slug', `eq.${subcategory.slug}`);
    endpoint.searchParams.set('order', 'id.asc');
    endpoint.searchParams.set('limit', String(PAGE_SIZE + 1));
    endpoint.searchParams.set('offset', String((page - 1) * PAGE_SIZE));
    const upstream = await fetch(endpoint, {
      headers: { apikey: config.publishableKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    if (!upstream.ok) throw new Error('Public subcategory view returned an error');
    const rows = await upstream.json();
    if (!Array.isArray(rows) || rows.length > PAGE_SIZE + 1) throw new Error('Invalid public subcategory response');
    if (page > 1 && rows.length === 0) {
      send(res, 404, unavailable(), headOnly);
      return;
    }
    const visibleRows = rows.slice(0, PAGE_SIZE);
    send(res, 200, renderCategoryHtml(category, visibleRows, page,
      rows.length > PAGE_SIZE && page < MAX_PAGE, config, subcategory),
    headOnly, config.target !== 'prod' || visibleRows.length === 0);
  } catch (error) {
    console.error('Public subcategory SEO rendering unavailable:', error?.message || 'unknown error');
    res.setHeader('Retry-After', '60');
    send(res, 503, unavailable(), headOnly);
  }
}
