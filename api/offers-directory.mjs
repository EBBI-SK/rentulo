// Public, crawlable directory of active offers; no browser JavaScript required.
// Read only the restricted public_offers view with a publishable Supabase key.
import { getOfferSeoConfig, getOfferSeoValues } from './offer-page.mjs';
import { SEO_CATEGORIES, getSeoCategorySlug } from './seo-categories.mjs';
import { renderCollectionJsonLd } from './seo-structured-data.mjs';

const PAGE_SIZE = 20;
const MAX_PAGE = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

function directoryPath(page) {
  return page === 1 ? '/nabidky' : `/nabidky?page=${page}`;
}

export function renderDirectoryHtml(rows, page, hasNext, config) {
  const title = `${page === 1 ? 'Aktuální nabídky věcí k půjčení' : `Nabídky věcí k půjčení – strana ${page}`} | Rentulo`;
  const description = 'Prohlédněte si aktuální nabídky věcí k půjčení od lidí v České republice. Vyberte věc a podívejte se na detail na Rentulu.';
  const canonical = config.siteOrigin + directoryPath(page);
  const structuredItems = [];
  const cards = rows.map(row => {
    if (!UUID_PATTERN.test(String(row?.id || ''))) throw new Error('Invalid public offer identifier');
    const values = getOfferSeoValues(row, row.id, config);
    if (!values) throw new Error('Invalid public offer data');
    const categorySlug = getSeoCategorySlug(values.category);
    const categoryLabel = categorySlug
      ? `<a href="/kategorie/${categorySlug}">${escapeHtml(values.category)}</a>`
      : escapeHtml(values.category);
    structuredItems.push({ name: values.name, url: `${config.siteOrigin}/nabidka/${row.id.toLowerCase()}` });
    return `<article class="offer-card">
      <a class="offer-photo" href="/nabidka/${row.id.toLowerCase()}"><img src="${escapeHtml(values.imageUrl)}" alt="${escapeHtml(values.name)}" loading="lazy"></a>
      <div class="offer-info"><h2><a href="/nabidka/${row.id.toLowerCase()}">${escapeHtml(values.name)}</a></h2>
      <p>${categoryLabel} · ${escapeHtml(values.city || 'Česká republika')}</p>
      <strong>${escapeHtml(values.priceText)} Kč / den</strong></div>
    </article>`;
  }).join('\n');
  const categoryLinks = SEO_CATEGORIES.map(category =>
    `<a href="/kategorie/${category.slug}">${escapeHtml(category.name)}</a>`
  ).join(' ');
  const previous = page > 1 ? `<a href="${directoryPath(page - 1)}" rel="prev">Předchozí stránka</a>` : '';
  const next = hasNext ? `<a href="${directoryPath(page + 1)}" rel="next">Další nabídky</a>` : '';
  const structuredData = renderCollectionJsonLd({
    canonical, title, description, items: structuredItems,
    crumbs: [
      { name: 'Rentulo', url: config.siteOrigin + '/' },
      { name: 'Všechny nabídky', url: canonical }
    ]
  });
  return `<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
${config.target !== 'prod' ? '<meta name="robots" content="noindex">' : ''}
<link rel="icon" href="/assets/rentulo-logo-mark.png" type="image/png">
${structuredData}
<style>
*{box-sizing:border-box}body{margin:0;background:#f6f8f6;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#173c2f}
a{color:#126846}a:hover{text-decoration:underline}.container{max-width:1080px;margin:auto;padding:20px}
header{background:#fff;border-bottom:1px solid #dce7df}header a{display:inline-flex;align-items:center;gap:10px;text-decoration:none;font-weight:800;font-size:22px}
header img{width:38px;height:38px}h1{font-size:clamp(26px,4vw,38px);margin:24px 0 4px}h2{font-size:19px;margin:0 0 5px}
.lead{margin:0 0 28px;color:#4f6158}.offers{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}
.offer-card{min-width:0;background:white;border:1px solid #dce7df;border-radius:15px;overflow:hidden}
.offer-photo{display:block;background:#edf3ef;height:190px}.offer-photo img{width:100%;height:100%;object-fit:contain}
.offer-info{padding:15px}.offer-info h2 a{text-decoration:none}.offer-info p{margin:0 0 12px;color:#586b60}.offer-info strong{color:#116746}
.categories{display:flex;flex-wrap:wrap;gap:9px;margin:0 0 26px}.categories a{padding:7px 12px;background:#fff;border:1px solid #c5dcd0;border-radius:20px;text-decoration:none}
.pagination{display:flex;gap:16px;margin:30px 0}.pagination a{padding:10px 16px;background:white;border:1px solid #c5dcd0;border-radius:9px;text-decoration:none}
.empty{padding:22px;background:white;border:1px solid #dce7df;border-radius:12px}
</style></head><body>
<header><div class="container"><a href="/"><img src="/assets/rentulo-logo-mark.png" alt="">Rentulo</a></div></header>
<main class="container"><a href="/">← Úvodní stránka</a><h1>Aktuální nabídky věcí k půjčení</h1>
<p class="lead">Skutečné nabídky od lidí v České republice${page > 1 ? ` · strana ${page}` : ''}.</p>
<nav class="categories" aria-label="Procházet nabídky podle kategorie">${categoryLinks}</nav>
${cards ? `<section class="offers" aria-label="Aktuální nabídky">${cards}</section>` : '<p class="empty">Zatím nejsou zveřejněny žádné nabídky.</p>'}
<nav class="pagination" aria-label="Stránkování nabídek">${previous}${next}</nav>
</main></body></html>`;
}

function send(res, status, html, headOnly) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  if (status !== 200) res.setHeader('X-Robots-Tag', 'noindex');
  res.end(headOnly ? '' : html);
}

function unavailable() {
  return '<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Nabídky nejsou dostupné | Rentulo</title></head><body><h1>Nabídky nejsou dostupné</h1><a href="/">Rentulo</a></body></html>';
}

export default async function handler(req, res) {
  const headOnly = req.method === 'HEAD';
  if (req.method !== 'GET' && !headOnly) {
    res.setHeader('Allow', 'GET, HEAD');
    send(res, 405, unavailable(), false);
    return;
  }
  const rawPage = req.query?.page ?? new URL(req.url || '/nabidky', 'https://rentulo.example').searchParams.get('page');
  const page = rawPage == null ? 1 : Number(rawPage);
  if (rawPage != null && (typeof rawPage !== 'string' || !/^[1-9][0-9]*$/.test(rawPage))) {
    send(res, 404, unavailable(), headOnly);
    return;
  }
  if (!Number.isSafeInteger(page) || page > MAX_PAGE) {
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
    endpoint.searchParams.set('select', 'id,name,category,city,price_per_day,photo_url');
    endpoint.searchParams.set('status', 'eq.active');
    endpoint.searchParams.set('order', 'id.asc');
    endpoint.searchParams.set('limit', String(PAGE_SIZE + 1));
    endpoint.searchParams.set('offset', String((page - 1) * PAGE_SIZE));
    const upstream = await fetch(endpoint, {
      headers: { apikey: config.publishableKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    if (!upstream.ok) throw new Error('Public offers view returned an error');
    const data = await upstream.json();
    if (!Array.isArray(data) || data.length > PAGE_SIZE + 1) throw new Error('Invalid public offers response');
    if (page > 1 && !data.length) {
      send(res, 404, unavailable(), headOnly);
      return;
    }
    if (config.target !== 'prod') res.setHeader('X-Robots-Tag', 'noindex');
    send(res, 200, renderDirectoryHtml(data.slice(0, PAGE_SIZE), page, data.length > PAGE_SIZE && page < MAX_PAGE, config), headOnly);
  } catch (error) {
    console.error('Public offers directory unavailable:', error?.message || 'unknown error');
    res.setHeader('Retry-After', '60');
    send(res, 503, unavailable(), headOnly);
  }
}
