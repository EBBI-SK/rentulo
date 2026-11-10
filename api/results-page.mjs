// SEO 19C/4: render a short public preview directly into the initial TEST HTML.
// The client still owns searching, GPS, availability, translations and all live updates.
// Only the restricted public_offers view and a publishable key are used here.
import { readFileSync } from 'node:fs';
import { getOfferSeoConfig } from './offer-page.mjs';

const PAGE_TEMPLATE = readFileSync(new URL('../vysledky.html', import.meta.url), 'utf8');
const SEO_COPY = JSON.parse(readFileSync(new URL('../scripts/seo-pages.json', import.meta.url), 'utf8'));
const RESULTS_CONTAINER = '<section class="results-list" id="resultsList" aria-live="polite"></section>';
const PREVIEW_COUNT = 4;
const FILTER_KEYS = ['co', 'kde', 'kategorie', 'cena', 'od', 'do', 'okoli', 'lat', 'lng', 'dostupnost'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);

// These are the public fields that can change the rendered card's appearance.
// The client compares the same tuple before retaining the server-rendered images.
export function offerPreviewKey(row) {
  return JSON.stringify([
    String(row?.id || ''), String(row?.name || ''), String(row?.category || ''),
    String(row?.city || '-'), String(Number(row?.price_per_day) || 0),
    String(row?.photo_url || ''), String(row?.owner_id || ''),
    String(row?.updated_at || ''), String(row?.status || '')
  ]);
}

function legacyCategory(value) {
  const aliases = {
    'Dům a zahrada': 'Domácnost', 'Dílna a nářadí': 'Stavba',
    'Stavební technika': 'Stavba', 'Sport a volný čas': 'Hobby',
    'Elektronika': 'Hobby', 'Děti a rodina': 'Hobby',
    'Cestování a kempování': 'Hobby', 'Párty a akce': 'Párty',
    'Auto a doprava': 'Ostatní'
  };
  return aliases[value] || value || 'Ostatní';
}

function isSafePublicOfferPhoto(raw, config) {
  if (!raw) return true;
  try {
    const url = new URL(raw);
    const prefix = '/storage/v1/object/public/offer-photos/';
    return url.protocol === 'https:' && url.origin === config.supabaseOrigin &&
      url.pathname.startsWith(prefix) && url.pathname.length > prefix.length &&
      !url.search && !url.hash && !url.username && !url.password;
  } catch { return false; }
}

function publicPhotoMarkup(row, config, isFirst) {
  const name = String(row.name || 'Věc');
  const raw = String(row.photo_url || '');
  let image = '';
  if (raw) {
    try {
      const url = new URL(raw);
      const prefix = '/storage/v1/object/public/offer-photos/';
      if (url.protocol === 'https:' && url.origin === config.supabaseOrigin &&
          url.pathname.startsWith(prefix) && url.pathname.length > prefix.length &&
          !url.search && !url.hash && !url.username && !url.password) {
        const base = raw.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
        const small = `${base}?width=320&quality=75`;
        const large = `${base}?width=640&quality=75`;
        image = `<img src="${escapeHtml(small)}" ` +
          `srcset="${escapeHtml(small)} 320w, ${escapeHtml(large)} 640w" ` +
          `sizes="(max-width: 430px) calc(100vw - 58px), (max-width: 760px) calc(100vw - 62px), (min-width: 1101px) 140px, 154px" ` +
          `data-original-photo="${escapeHtml(raw)}" alt="${escapeHtml(name)}" ` +
          `${isFirst ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
      }
    } catch { /* An invalid or non-public URL never enters the server HTML. */ }
  }
  return image
    ? `<div class="result-image">${image}</div>`
    : `<div class="result-image"><div class="result-image-icon"></div><span>${escapeHtml(name)}</span></div>`;
}

export function renderServerOfferCard(row, index, config) {
  const id = String(row?.id || '');
  const price = Number(row?.price_per_day);
  if (!UUID.test(id) || row?.status !== 'active' || !String(row.name || '').trim() ||
      !Number.isFinite(price) || price <= 0 ||
      !isSafePublicOfferPhoto(String(row.photo_url || ''), config)) return '';
  const name = String(row.name);
  const city = String(row.city || '-');
  const category = legacyCategory(String(row.category || ''));
  const ownerId = String(row.owner_id || '');
  return `<article class="result-card" data-server-offer-key="${escapeHtml(offerPreviewKey(row))}">
    ${publicPhotoMarkup(row, config, index === 0)}
    <div class="result-main">
      <div class="result-heading"><div><h2 class="result-title">${escapeHtml(name)}</h2><p class="result-meta">${escapeHtml(category)}</p></div></div>
      <div class="result-info">
        <div class="result-info-box"><span>Cena za den</span><strong>${escapeHtml(price.toLocaleString('cs-CZ'))} Kč</strong></div>
        <div class="result-info-box"><span>Město</span><strong>${escapeHtml(city)}</strong></div>
        <div class="result-info-box"><span>Hodnocení majitele</span><strong data-owner-rating-id="${escapeHtml(ownerId)}">Zatím bez hodnocení</strong></div>
      </div>
      <div class="result-actions"><a class="result-button" href="/nabidka/${encodeURIComponent(id)}">Zobrazit detail</a></div>
    </div>
  </article>`;
}

// A single unfiltered page is safe to pre-render. For searches, dates and GPS,
// the existing client applies the authoritative filtering and sorting; never
// show unrelated offers before those user-specific constraints are applied.
export function canRenderInitialOffers(requestUrl) {
  const url = new URL(requestUrl, 'https://rentulo.eu');
  return !FILTER_KEYS.some(key => url.searchParams.has(key));
}

export function renderServerResultsHtml(rows, config) {
  if (!PAGE_TEMPLATE.includes(RESULTS_CONTAINER) ||
      !/<title>[^<]*<\/title>/.test(PAGE_TEMPLATE) ||
      !PAGE_TEMPLATE.includes('</head>') || !PAGE_TEMPLATE.includes('</body>')) {
    throw new Error('Unexpected results page template');
  }
  const title = 'Výsledky vyhledávání věcí k půjčení | Rentulo';
  const description = SEO_COPY.private['vysledky.html'].cs;
  let html = PAGE_TEMPLATE.replace(/<title>[^<]*<\/title>/,
    `<title>${escapeHtml(title)}</title>`);
  html = html.replace('<head>', `<head>\n  <link rel="preconnect" href="${escapeHtml(config.supabaseOrigin)}" crossorigin />`);
  html = html.replace('</head>',
    `  <meta name="robots" content="noindex" />\n` +
    `  <meta name="description" content="${escapeHtml(description)}" />\n</head>`);
  html = html.replace('</body>', '  <script src="js/seo.js"></script>\n</body>');
  if (Array.isArray(rows) && rows.length > 0) {
    const cards = rows.slice(0, PREVIEW_COUNT).map((row, index) =>
      renderServerOfferCard(row, index, config));
    if (cards.every(Boolean)) {
      html = html.replace(RESULTS_CONTAINER,
        `<section class="results-list" id="resultsList" aria-live="polite" data-server-preview="1">${cards.join('')}</section>`);
    }
  }
  return html;
}

function sendHtml(res, html, headOnly) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Never cache private/session-specific results or recently deactivated offers.
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.end(headOnly ? '' : html);
}

export default async function handler(req, res) {
  const isHead = req.method === 'HEAD';
  if (req.method !== 'GET' && !isHead) {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.end('');
    return;
  }
  let config;
  try {
    config = getOfferSeoConfig();
  } catch (error) {
    console.error('Results SSR environment unavailable:', error?.message || 'unknown error');
    res.statusCode = 503;
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.end('');
    return;
  }
  const host = String(req.headers?.host || '').split(':')[0].toLowerCase();
  if (config.target !== 'test' || /(^|\.)rentulo\.com$/.test(host)) {
    res.statusCode = 404;
    res.setHeader('X-Robots-Tag', 'noindex');
    res.end('');
    return;
  }
  if (isHead || !canRenderInitialOffers(req.url || '/vysledky.html')) {
    res.setHeader('X-Rentulo-SSR', 'client-filtered');
    sendHtml(res, renderServerResultsHtml([], config), isHead);
    return;
  }
  try {
    const endpoint = new URL('/rest/v1/public_offers', config.supabaseOrigin);
    endpoint.searchParams.set('select', 'id,owner_id,name,category,city,price_per_day,status,photo_url,created_at,updated_at');
    endpoint.searchParams.set('status', 'eq.active');
    endpoint.searchParams.set('order', 'created_at.desc');
    endpoint.searchParams.set('limit', String(PREVIEW_COUNT));
    const upstream = await fetch(endpoint, {
      headers: { apikey: config.publishableKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(2000), cache: 'no-store'
    });
    if (!upstream.ok) throw new Error('Could not load public offers');
    const rows = await upstream.json();
    if (!Array.isArray(rows) || rows.length > PREVIEW_COUNT) throw new Error('Unexpected public offers response');
    res.setHeader('X-Rentulo-SSR', rows.length ? 'rendered' : 'no-offers');
    sendHtml(res, renderServerResultsHtml(rows, config), false);
  } catch (error) {
    // The existing browser-side loading remains fully functional on an upstream outage.
    console.warn('Results SSR preview unavailable:', error?.message || 'unknown error');
    res.setHeader('X-Rentulo-SSR', 'fallback');
    sendHtml(res, renderServerResultsHtml([], config), false);
  }
}
