// Crawlable, server-rendered landing pages for the six real public V1 categories.
// Read only the restricted public_offers view using a Supabase publishable key.
import { getOfferSeoConfig, getOfferSeoValues } from './offer-page.mjs';
import { SEO_CATEGORIES, getSeoCategoryBySlug } from './seo-categories.mjs';
import { getSeoSubcategory } from './seo-subcategories.mjs';
import { getSeoCitySlug, citySeoTitle, citySeoDescription } from './seo-cities.mjs';
import { renderCollectionJsonLd } from './seo-structured-data.mjs';

const PAGE_SIZE = 20;
const MAX_PAGE = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

const categoryPath = (category, page, subcategory = null, city = null) =>
  `/kategorie/${category.slug}${city ? `/mesto/${city.slug}` : subcategory ? `/${subcategory.slug}` : ''}${page > 1 ? `?page=${page}` : ''}`;

export function renderCategoryHtml(category, rows, page, hasNext, config, subcategory = null, city = null) {
  const baseTitle = city ? citySeoTitle(category, city.name) : `${subcategory ? subcategory.name : category.name} k půjčení`;
  const title = `${baseTitle}${page > 1 ? ` – strana ${page}` : ''} | Rentulo`;
  const canonical = config.siteOrigin + categoryPath(category, page, subcategory, city);
  const description = city ? citySeoDescription(category, city.name) : subcategory ? subcategory.description : category.description;
  const noOffers = rows.length === 0;
  const structuredItems = [];
  const cards = rows.map(row => {
    if (!UUID_PATTERN.test(String(row?.id || '')) || row?.category !== category.name ||
        (subcategory && row?.subcategory_slug !== subcategory.slug) ||
        (city && (row?.seo_city_slug !== city.slug || getSeoCitySlug(row?.city) !== city.slug))) {
      throw new Error('Invalid public category offer data');
    }
    const values = getOfferSeoValues(row, row.id, config);
    if (!values) throw new Error('Invalid public offer values');
    const offerUrl = `/nabidka/${row.id.toLowerCase()}`;
    structuredItems.push({ name: values.name, url: config.siteOrigin + offerUrl });
    return `<article class="offer-card">
      <a class="offer-photo" href="${offerUrl}"><img src="${escapeHtml(values.imageUrl)}" alt="${escapeHtml(values.name)}" loading="lazy" decoding="async"></a>
      <div class="offer-info"><h2><a href="${offerUrl}">${escapeHtml(values.name)}</a></h2>
      <p>${escapeHtml(values.city || 'Česká republika')}</p>
      <strong>${escapeHtml(values.priceText)} Kč / den</strong></div>
    </article>`;
  }).join('\n');
  const categoryLinks = SEO_CATEGORIES.map(item =>
    `<a href="/kategorie/${item.slug}"${item.slug === category.slug ? ' aria-current="page"' : ''}>${escapeHtml(item.name)}</a>`
  ).join(' ');
  // Only link to subcategories represented by genuine, currently visible offers.
  // Later pages and sitemap expose further matches without empty SEO links.
  const linkedSubcategories = subcategory ? [] : [...new Set(rows.map(row => row?.subcategory_slug))]
    .map(slug => getSeoSubcategory(category.slug, slug)).filter(Boolean);
  const subcategoryLinks = subcategory
    ? `<nav class="subcategories" aria-label="Zpět na kategorii"><a href="/kategorie/${category.slug}">← ${escapeHtml(category.name)}</a></nav>`
    : linkedSubcategories.length
      ? `<nav class="subcategories" aria-label="Podkategorie s nabídkami">${linkedSubcategories.map(item =>
          `<a href="/kategorie/${category.slug}/${item.slug}">${escapeHtml(item.name)}</a>`).join(' ')}</nav>`
      : '';
  // Every city link comes from a currently visible public, active offer.
  const linkedCities = new Map();
  if (!city) for (const row of rows) {
    const slug = getSeoCitySlug(row?.city);
    if (slug && !linkedCities.has(slug)) linkedCities.set(slug, row.city.trim());
  }
  const cityLinks = city
    ? `<nav class="cities" aria-label="Zpět na kategorii"><a href="/kategorie/${category.slug}">← ${escapeHtml(category.name)}</a></nav>`
    : linkedCities.size
      ? `<nav class="cities" aria-label="Nabídky v městech">${[...linkedCities].map(([slug, cityName]) =>
          `<a href="/kategorie/${category.slug}/mesto/${slug}">${escapeHtml(cityName)}</a>`).join(' ')}</nav>`
      : '';
  const previous = page > 1 ? `<a href="${categoryPath(category, page - 1, subcategory, city)}" rel="prev">Předchozí stránka</a>` : '';
  const next = hasNext ? `<a href="${categoryPath(category, page + 1, subcategory, city)}" rel="next">Další nabídky</a>` : '';
  const crumbs = [
    { name: 'Rentulo', url: config.siteOrigin + '/' },
    { name: 'Všechny nabídky', url: config.siteOrigin + '/nabidky' },
    { name: category.name, url: config.siteOrigin + `/kategorie/${category.slug}` }
  ];
  if (subcategory) crumbs.push({ name: subcategory.name, url: config.siteOrigin + `/kategorie/${category.slug}/${subcategory.slug}` });
  if (city) crumbs.push({ name: city.name, url: config.siteOrigin + `/kategorie/${category.slug}/mesto/${city.slug}` });
  const structuredData = renderCollectionJsonLd({ canonical, title, description, items: structuredItems, crumbs });
  return `<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
${config.target !== 'prod' || noOffers ? '<meta name="robots" content="noindex">' : ''}
<link rel="icon" href="/assets/rentulo-logo-mark.png" type="image/png">
${structuredData}
<style>
*{box-sizing:border-box}body{margin:0;background:#f6f8f6;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#173c2f}
a{color:#126846}a:hover{text-decoration:underline}.container{max-width:1080px;margin:auto;padding:20px}
header{background:#fff;border-bottom:1px solid #dce7df}header a{display:inline-flex;align-items:center;gap:10px;text-decoration:none;font-weight:800;font-size:22px}
header img{width:38px;height:38px}h1{font-size:clamp(26px,4vw,38px);margin:24px 0 4px}h2{font-size:19px;margin:0 0 5px}
.lead{margin:0 0 20px;color:#4f6158}.categories{display:flex;flex-wrap:wrap;gap:9px;margin:0 0 26px}
.categories a{padding:7px 12px;background:#fff;border:1px solid #c5dcd0;border-radius:20px;text-decoration:none}
.categories a[aria-current="page"]{background:#126846;color:#fff;border-color:#126846}
.subcategories,.cities{display:flex;flex-wrap:wrap;gap:9px;margin:0 0 22px}.subcategories a,.cities a{padding:7px 12px;background:#e4f3e9;border-radius:20px;text-decoration:none}
.offers{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}
.offer-card{min-width:0;background:white;border:1px solid #dce7df;border-radius:15px;overflow:hidden}
.offer-photo{display:block;background:#edf3ef;height:190px}.offer-photo img{width:100%;height:100%;object-fit:contain}
.offer-info{padding:15px}.offer-info h2 a{text-decoration:none}.offer-info p{margin:0 0 12px;color:#586b60}.offer-info strong{color:#116746}
.pagination{display:flex;gap:16px;margin:30px 0}.pagination a{padding:10px 16px;background:white;border:1px solid #c5dcd0;border-radius:9px;text-decoration:none}
.empty{padding:22px;background:white;border:1px solid #dce7df;border-radius:12px}
</style></head><body>
<header><div class="container"><a href="/"><img src="/assets/rentulo-logo-mark.png" alt="">Rentulo</a></div></header>
<main class="container"><a href="/nabidky">← Všechny nabídky</a><h1>${escapeHtml(baseTitle)}</h1>
<p class="lead">${escapeHtml(description)}${page > 1 ? ` · strana ${page}` : ''}</p>
<nav class="categories" aria-label="Kategorie nabídek">${categoryLinks}</nav>
${subcategoryLinks}
${cityLinks}
${cards ? `<section class="offers" aria-label="Aktuální nabídky: ${escapeHtml(baseTitle)}">${cards}</section>` : '<p class="empty">V této kategorii zatím nejsou zveřejněny žádné nabídky. Prohlédněte si <a href="/nabidky">všechny nabídky</a>.</p>'}
<nav class="pagination" aria-label="Stránkování kategorie">${previous}${next}</nav>
</main></body></html>`;
}

function unavailable() {
  return '<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Kategorie není dostupná | Rentulo</title></head><body><h1>Kategorie není dostupná</h1><a href="/nabidky">Všechny nabídky</a></body></html>';
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
  const slug = typeof req.query?.slug === 'string'
    ? req.query.slug
    : requestUrl.pathname.match(/^\/kategorie\/([a-z]+)\/?$/)?.[1];
  const category = getSeoCategoryBySlug(slug);
  const rawPage = req.query?.page ?? requestUrl.searchParams.get('page');
  const page = rawPage == null ? 1 : Number(rawPage);
  if (!category || (rawPage != null && (typeof rawPage !== 'string' || !/^[1-9][0-9]*$/.test(rawPage))) ||
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
    endpoint.searchParams.set('order', 'id.asc');
    endpoint.searchParams.set('limit', String(PAGE_SIZE + 1));
    endpoint.searchParams.set('offset', String((page - 1) * PAGE_SIZE));
    const upstream = await fetch(endpoint, {
      headers: { apikey: config.publishableKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    if (!upstream.ok) throw new Error('Public category view returned an error');
    const rows = await upstream.json();
    if (!Array.isArray(rows) || rows.length > PAGE_SIZE + 1) throw new Error('Invalid public category response');
    if (page > 1 && rows.length === 0) {
      send(res, 404, unavailable(), headOnly);
      return;
    }
    const visibleRows = rows.slice(0, PAGE_SIZE);
    const noindex = config.target !== 'prod' || visibleRows.length === 0;
    send(res, 200, renderCategoryHtml(category, visibleRows, page, rows.length > PAGE_SIZE && page < MAX_PAGE, config), headOnly, noindex);
  } catch (error) {
    console.error('Public category SEO rendering unavailable:', error?.message || 'unknown error');
    res.setHeader('Retry-After', '60');
    send(res, 503, unavailable(), headOnly);
  }
}
