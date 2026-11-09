// Public, server-rendered SEO preview for an active Rentulo offer.
// Uses only the restricted public_offers view and a Supabase publishable key.
import { readFileSync } from 'node:fs';
import { renderOfferJsonLd } from './seo-structured-data.mjs';

const DETAIL_TEMPLATE = readFileSync(new URL('../detail.html', import.meta.url), 'utf8');
const SOURCE_CONFIG = readFileSync(new URL('../js/supabase-config.js', import.meta.url), 'utf8');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECTS = Object.freeze({
  test: 'vspposovhdgvbeukoivh',
  prod: 'tfvgxrdjrpicgtvovehl'
});

const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

function safePublicText(value, maxLength) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

// Cut at a word boundary when possible; never take private contact or booking
// fields into SEO metadata. Public user descriptions remain on the detail only.
function clipSeoWords(text, maxLength) {
  if (text.length <= maxLength) return text;
  const fragment = text.slice(0, maxLength);
  const lastSpace = fragment.lastIndexOf(' ');
  return (lastSpace >= maxLength * 0.55 ? fragment.slice(0, lastSpace) : fragment)
    .replace(/[\s,.;:–-]+$/u, '');
}

function readSourceConstant(name) {
  const match = SOURCE_CONFIG.match(new RegExp(`^const ${name} = ("[^"\\n]*");$`, 'm'));
  if (!match) throw new Error(`Missing public TEST configuration: ${name}`);
  return JSON.parse(match[1]);
}

export function getOfferSeoConfig(env = process.env) {
  const target = String(env.RENTULO_DEPLOY_TARGET || 'test').trim().toLowerCase();
  if (!Object.hasOwn(PROJECTS, target)) throw new Error('Invalid Rentulo deployment target');

  const configuredUrl = String(env.RENTULO_SUPABASE_URL || '').trim();
  const configuredKey = String(env.RENTULO_SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (Boolean(configuredUrl) !== Boolean(configuredKey)) {
    throw new Error('Supabase public URL and publishable key must both be set');
  }
  if (target === 'prod' && (!configuredUrl || !configuredKey)) {
    throw new Error('PROD public Supabase configuration is missing');
  }

  const parsed = new URL(configuredUrl || readSourceConstant('SUPABASE_URL'));
  const key = configuredKey || readSourceConstant('SUPABASE_PUBLISHABLE_KEY');
  if (parsed.protocol !== 'https:' || parsed.hostname !== `${PROJECTS[target]}.supabase.co` ||
      parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash ||
      !['', '/'].includes(parsed.pathname)) {
    throw new Error('Supabase URL does not belong to the selected environment');
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(key)) {
    throw new Error('A Supabase publishable key is required');
  }
  if (target === 'prod' && key === readSourceConstant('SUPABASE_PUBLISHABLE_KEY')) {
    throw new Error('PROD cannot use the TEST publishable key');
  }
  return {
    target,
    supabaseOrigin: parsed.origin,
    publishableKey: key,
    siteOrigin: target === 'prod' ? 'https://rentulo.com' : 'https://rentulo.eu'
  };
}

export function getOfferSeoValues(offer, id, config) {
  const name = safePublicText(offer?.name, 100);
  const city = safePublicText(offer?.city, 40);
  const category = safePublicText(offer?.category, 80) || 'Ostatn\u00ed';
  const offerDescription = safePublicText(offer?.description, 6000);
  const price = Number(offer?.price_per_day);
  if (!name || !Number.isSafeInteger(price) || price <= 0) return null;

  // A lease listing, not an e-shop sale: use the real public name, city and
  // day rate. Avoid duplicating "k půjčení" when it is in the user's name.
  const rentalSuffix = /(?:^|\s)k\s+půjčení(?:$|[\s.,!])/iu.test(name) ? '' : ' k půjčení';
  const placeSuffix = city ? ` – ${city}` : '';
  const brandSuffix = ' | Rentulo';
  const titleName = clipSeoWords(name, Math.max(18, 74 - rentalSuffix.length - placeSuffix.length - brandSuffix.length));
  const title = `${titleName}${rentalSuffix}${placeSuffix}${brandSuffix}`;
  const descriptionName = clipSeoWords(name, 55);
  const descriptionCategory = clipSeoWords(category, 35);
  const description = `${descriptionName}${city ? ` – ${city}` : ''}. Cena půjčení ${price.toLocaleString('cs-CZ')} Kč/den. Kategorie ${descriptionCategory}. Podrobnosti veřejné nabídky na Rentulu.`;
  const canonicalUrl = `${config.siteOrigin}/nabidka/${id.toLowerCase()}`;
  const fallbackImage = `${config.siteOrigin}/assets/rentulo-logo-mark.png`;
  let imageUrl = fallbackImage;

  if (typeof offer.photo_url === 'string') {
    try {
      const photo = new URL(offer.photo_url);
      if (photo.protocol === 'https:' && photo.origin === config.supabaseOrigin &&
          photo.pathname.startsWith('/storage/v1/object/public/offer-photos/') &&
          photo.pathname.length > '/storage/v1/object/public/offer-photos/'.length &&
          !photo.username && !photo.password && !photo.hash && !photo.search) {
        imageUrl = photo.href;
      }
    } catch { /* Invalid image URLs use the Rentulo logo instead. */ }
  }
  return {
    title, description, canonicalUrl, imageUrl, name, city, category,
    offerDescription, priceText: price.toLocaleString('cs-CZ'),
    pricePerDay: price, hasOfferPhoto: imageUrl !== fallbackImage
  };
}

// Initial public offer content is visible without executing browser JavaScript.
// Do not render private pickup details, owner contacts, PINs, or availability claims.
export function renderOfferPublicContent(values) {
  return `
        <div class="detail-layout">
          <section class="detail-main-card">
            <div class="detail-hero">
              <div class="image-box has-photo">
                <img src="${escapeHtml(values.imageUrl)}" alt="${escapeHtml(values.name)}" loading="eager" decoding="async"${values.hasOfferPhoto ? ' fetchpriority="high"' : ''} />
              </div>
              <div class="detail-hero-copy">
                <h1>${escapeHtml(values.name)}</h1>
                <div class="category-line">${escapeHtml(values.category)}</div>
              </div>
            </div>
            <div class="detail-content">
              ${values.offerDescription ? `<section class="description-section">
                <h2>Popis věci</h2>
                <p class="description">${escapeHtml(values.offerDescription)}</p>
              </section>` : ''}
              <div class="info-grid">
                <div class="section">
                  <h2>Místo vyzvednutí</h2>
                  <p>${escapeHtml(values.city || '-')}</p>
                </div>
              </div>
            </div>
          </section>
          <aside class="sidebar">
            <div class="price">${escapeHtml(values.priceText)}</div>
            <div class="price-small">Kč / den</div>
            <noscript><p>Pro rezervaci povolte JavaScript.</p></noscript>
          </aside>
        </div>`;
}

export function renderOfferSeoHtml(html, values, target) {
  if (!/<head(?:\s[^>]*)?>/i.test(html) || !/<\/head>/i.test(html) ||
      !/<title\b[^>]*>[\s\S]*?<\/title>/i.test(html)) {
    throw new Error('Detail template is missing expected HTML structure');
  }
  // Legacy detail.html already declares the root base for canonical URL changes.
  // Inject it only for minimal templates without one, never twice.
  const head = [
    `<meta name="description" content="${escapeHtml(values.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(values.canonicalUrl)}" />`,
    '<meta property="og:type" content="product" />',
    '<meta property="og:site_name" content="Rentulo" />',
    `<meta property="og:title" content="${escapeHtml(values.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(values.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(values.canonicalUrl)}" />`,
    `<meta property="og:image" content="${escapeHtml(values.imageUrl)}" />`,
    `<meta property="og:image:alt" content="${escapeHtml(values.name)}" />`,
    '<meta property="og:locale" content="cs_CZ" />',
    renderOfferJsonLd(values)
  ];
  if (target === 'test') head.unshift('<meta name="robots" content="noindex" />');
  const htmlWithRootBase = /<base\b[^>]*href=["']\/["'][^>]*>/i.test(html)
    ? html
    : html.replace(/<head(?:\s[^>]*)?>/i, opening => `${opening}\n  <base href="/" />`);
  return htmlWithRootBase
    .replace(/(<title\b[^>]*>)[\s\S]*?(<\/title>)/i,
      (_, opening, closing) => `${opening}${escapeHtml(values.title)}${closing}`)
    .replace(/<\/head>/i, `  ${head.join('\n  ')}\n</head>`)
    .replace('<div id="detailContent"></div>',
      `<div id="detailContent" data-server-rendered-offer="true">${renderOfferPublicContent(values)}</div>`);
}

function sendHtml(res, status, html, headOnly = false) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  if (status !== 200) res.setHeader('X-Robots-Tag', 'noindex');
  res.end(headOnly ? '' : html);
}

function unavailableHtml() {
  return '<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Nabídka není dostupná | Rentulo</title></head><body><h1>Nabídka není dostupná</h1><a href="/">Rentulo</a></body></html>';
}

export default async function handler(req, res) {
  const headOnly = req.method === 'HEAD';
  if (req.method !== 'GET' && !headOnly) {
    res.setHeader('Allow', 'GET, HEAD');
    sendHtml(res, 405, unavailableHtml());
    return;
  }
  const id = typeof req.query?.id === 'string'
    ? req.query.id
    : new URL(req.url || '/', 'https://rentulo.example').searchParams.get('id');
  if (!id || !UUID_PATTERN.test(id)) {
    sendHtml(res, 404, unavailableHtml(), headOnly);
    return;
  }

  try {
    const config = getOfferSeoConfig();
    const host = String(req.headers?.host || '').split(':')[0].toLowerCase();
    if ((config.target === 'test' && /(^|\.)rentulo\.com$/.test(host)) ||
        (config.target === 'prod' && /(^|\.)rentulo\.eu$/.test(host))) {
      sendHtml(res, 404, unavailableHtml(), headOnly);
      return;
    }

    const endpoint = new URL('/rest/v1/public_offers', config.supabaseOrigin);
    endpoint.searchParams.set('select', 'id,name,category,description,city,price_per_day,photo_url');
    endpoint.searchParams.set('id', `eq.${id}`);
    endpoint.searchParams.set('limit', '1');

    const upstream = await fetch(endpoint, {
      headers: { apikey: config.publishableKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    if (!upstream.ok) throw new Error('Public offers view returned an error');
    const offers = await upstream.json();
    const offer = Array.isArray(offers) ? offers[0] : null;
    const values = offer ? getOfferSeoValues(offer, id, config) : null;
    if (!values) {
      sendHtml(res, 404, unavailableHtml(), headOnly);
      return;
    }
    if (config.target !== 'prod') res.setHeader('X-Robots-Tag', 'noindex');
    sendHtml(res, 200, renderOfferSeoHtml(DETAIL_TEMPLATE, values, config.target), headOnly);
  } catch (error) {
    console.error('Public offer SEO rendering unavailable:', error?.message || 'unknown error');
    res.setHeader('Retry-After', '60');
    sendHtml(res, 503, unavailableHtml(), headOnly);
  }
}
