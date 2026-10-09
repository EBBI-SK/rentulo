// Public, server-rendered SEO preview for an active Rentulo offer.
// Uses only the restricted public_offers view and a Supabase publishable key.
import { readFileSync } from 'node:fs';

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
  const price = Number(offer?.price_per_day);
  if (!name || !Number.isSafeInteger(price) || price <= 0) return null;

  const title = `${name.slice(0, 72)}${city ? ` – ${city}` : ''} | Rentulo`;
  const description = `Půjčte si ${name.slice(0, 65)}${city ? ` v lokalitě ${city}` : ''} za ${price.toLocaleString('cs-CZ')} Kč/den. Prohlédněte si nabídku a rezervujte jednoduše na Rentulo.`.slice(0, 200);
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
  return { title, description, canonicalUrl, imageUrl, name };
}

export function renderOfferSeoHtml(html, values, target) {
  if (!/<head(?:\s[^>]*)?>/i.test(html) || !/<\/head>/i.test(html) ||
      !/<title\b[^>]*>[\s\S]*?<\/title>/i.test(html)) {
    throw new Error('Detail template is missing expected HTML structure');
  }
  // Keep the existing client application unchanged, while relative CSS/JS links
  // remain anchored at / when served below /nabidka/<uuid>.
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
    '<meta property="og:locale" content="cs_CZ" />'
  ];
  if (target === 'test') head.unshift('<meta name="robots" content="noindex" />');
  return html
    .replace(/<head(?:\s[^>]*)?>/i, opening => `${opening}\n  <base href="/" />`)
    .replace(/(<title\b[^>]*>)[\s\S]*?(<\/title>)/i,
      (_, opening, closing) => `${opening}${escapeHtml(values.title)}${closing}`)
    .replace(/<\/head>/i, `  ${head.join('\n  ')}\n</head>`);
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
    endpoint.searchParams.set('select', 'id,name,city,price_per_day,photo_url');
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
