import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(process.argv[2] || join(root, 'dist'));
if (output === root || output === '/' || output === resolve(root, '..')) {
  throw new Error('Refusing to overwrite the source directory');
}

const sourceConfig = readFileSync(join(root, 'js/supabase-config.js'), 'utf8');
function readSourceConstant(name) {
  const match = sourceConfig.match(new RegExp(`^const ${name} = ("[^"\\n]*");$`, 'm'));
  if (!match) throw new Error(`Missing source configuration: ${name}`);
  return JSON.parse(match[1]);
}
function replaceConstant(source, name, value) {
  const expression = new RegExp(`^const ${name} = ("[^"\\n]*");$`, 'gm');
  if ([...source.matchAll(expression)].length !== 1) {
    throw new Error(`Cannot safely configure: ${name}`);
  }
  return source.replace(expression, `const ${name} = ${JSON.stringify(value)};`);
}

const target = (process.env.RENTULO_DEPLOY_TARGET || 'test').trim().toLowerCase();
if (!['test', 'prod'].includes(target)) throw new Error('Invalid RENTULO_DEPLOY_TARGET');

const testUrl = readSourceConstant('SUPABASE_URL');
const testKey = readSourceConstant('SUPABASE_PUBLISHABLE_KEY');
const configuredUrl = process.env.RENTULO_SUPABASE_URL?.trim();
const configuredKey = process.env.RENTULO_SUPABASE_PUBLISHABLE_KEY?.trim();

if (Boolean(configuredUrl) !== Boolean(configuredKey)) {
  throw new Error('Set both RENTULO_SUPABASE_URL and RENTULO_SUPABASE_PUBLISHABLE_KEY');
}
if (target === 'prod' && (!configuredUrl || !configuredKey)) {
  throw new Error('PROD build stopped: required Supabase configuration is missing');
}

const ref = target === 'prod' ? 'tfvgxrdjrpicgtvovehl' : 'vspposovhdgvbeukoivh';
const rawUrl = configuredUrl || testUrl;
let parsed;
try { parsed = new URL(rawUrl); } catch {
  throw new Error('Invalid Supabase URL');
}
if (
  parsed.protocol !== 'https:' || parsed.hostname !== `${ref}.supabase.co` ||
  parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash ||
  (parsed.pathname !== '/' && parsed.pathname !== '')
) {
  throw new Error(`Supabase URL does not belong to the selected ${target.toUpperCase()} project`);
}
const key = configuredKey || testKey;
if (!/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(key)) {
  throw new Error('Only a Supabase publishable key may be exposed in the browser');
}
if (target === 'prod' && key === testKey) {
  throw new Error('PROD must not use the TEST publishable key');
}

let builtConfig = replaceConstant(sourceConfig, 'SUPABASE_URL', `${parsed.origin}/`);
builtConfig = replaceConstant(builtConfig, 'SUPABASE_PUBLISHABLE_KEY', key);
builtConfig = replaceConstant(builtConfig, 'RENTULO_DEPLOY_TARGET', target);

// SEO is generated at build time so crawlers and social previews see the CZ fallback
// without executing JavaScript. Localized metadata updates in the browser only.
const seoPages = JSON.parse(readFileSync(join(root, 'scripts/seo-pages.json'), 'utf8'));
const seoLanguages = ['cs', 'sk', 'en', 'de', 'pl'];
const htmlFiles = readdirSync(root).filter(name => name.endsWith('.html'));
const catalogFiles = [...Object.keys(seoPages.public), ...Object.keys(seoPages.private)];
if (catalogFiles.length !== htmlFiles.length ||
    new Set(catalogFiles).size !== catalogFiles.length ||
    htmlFiles.some(file => !catalogFiles.includes(file))) {
  throw new Error('SEO catalog must classify every HTML page exactly once');
}
for (const [filename, entry] of Object.entries(seoPages.public)) {
  if (entry.path !== (filename === 'index.html' ? '/' : `/${filename}`)) {
    throw new Error(`Invalid canonical path for ${filename}`);
  }
  for (const language of seoLanguages) {
    if (!entry.translations[language]?.title || !entry.translations[language]?.description) {
      throw new Error(`Missing ${language} SEO metadata for ${filename}`);
    }
  }
}
for (const [filename, entry] of Object.entries(seoPages.private)) {
  for (const language of seoLanguages) {
    if (!entry[language]) throw new Error(`Missing ${language} description for ${filename}`);
  }
}
const seoBaseUrl = target === 'prod' ? 'https://rentulo.com' : 'https://rentulo.eu';
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

function withSeoMetadata(filename, html) {
  const publicPage = seoPages.public[filename];
  const privatePage = seoPages.private[filename];
  if (!/<\/head>/i.test(html) || !/<\/body>/i.test(html) ||
      !/<title\b[^>]*>[\s\S]*?<\/title>/i.test(html) ||
      !/<script\b[^>]*src=["']js\/i18n\.js["']/i.test(html)) {
    throw new Error(`Missing expected HTML structure in ${filename}`);
  }
  if (/<meta\b[^>]*(?:name=["'](?:description|robots)["']|property=["']og:)/i.test(html) ||
      /<link\b[^>]*rel=["']canonical["']/i.test(html)) {
    throw new Error(`Unexpected existing SEO metadata in ${filename}`);
  }

  // The results page fetches offers and their photos from Supabase at startup.
  // Build the hint for the selected environment so TEST and PROD never preconnect
  // to each other's Supabase project.
  if (filename === 'vysledky.html') {
    html = html.replace(/<head>/i,
      `<head>\n  <link rel="preconnect" href="${escapeHtml(parsed.origin)}" crossorigin />`);
  }

  const meta = [];
  if (publicPage) {
    const content = publicPage.translations.cs;
    const canonicalUrl = `${seoBaseUrl}${publicPage.path}`;
    const imageUrl = `${seoBaseUrl}/assets/rentulo-logo-mark.png`;
    html = html.replace(/(<title\b[^>]*>)[\s\S]*?(<\/title>)/i,
      (_, opening, closing) => `${opening}${escapeHtml(content.title)}${closing}`);
    meta.push(`<meta name="description" content="${escapeHtml(content.description)}" />`);
    meta.push(`<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`);
    meta.push('<meta property="og:type" content="website" />');
    meta.push('<meta property="og:site_name" content="Rentulo" />');
    meta.push(`<meta property="og:title" content="${escapeHtml(content.title)}" />`);
    meta.push(`<meta property="og:description" content="${escapeHtml(content.description)}" />`);
    meta.push(`<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />`);
    meta.push(`<meta property="og:image" content="${escapeHtml(imageUrl)}" />`);
    meta.push('<meta property="og:image:alt" content="Rentulo" />');
    meta.push('<meta property="og:locale" content="cs_CZ" />');
  } else {
    meta.push('<meta name="robots" content="noindex" />');
    meta.push(`<meta name="description" content="${escapeHtml(privatePage.cs)}" />`);
  }
  return html
    .replace(/<\/head>/i, `  ${meta.join('\n  ')}\n</head>`)
    .replace(/<\/body>/i, '  <script src="js/seo.js"></script>\n</body>');
}

// Build static assets only. Never publish database migrations, tests, sources or secrets.
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const filename of htmlFiles) {
  // Vercel gives existing static files precedence over ordinary rewrites.
  // For TEST and PROD, results are served by the Vercel SSR function;
  // keep the original source HTML as its template for the server runtime.
  if (filename === 'vysledky.html') continue;
  const html = readFileSync(join(root, filename), 'utf8');
  writeFileSync(join(output, filename), withSeoMetadata(filename, html), 'utf8');
}
for (const directory of ['css', 'js', 'assets']) {
  cpSync(join(root, directory), join(output, directory), { recursive: true });
}
writeFileSync(join(output, 'js/supabase-config.js'), builtConfig, 'utf8');
// Keep the full i18n.js dictionary as the audited source (and for source-level tests).
// Deliver only the Czech fallback at startup, then load a selected language on demand.
const i18nSource = readFileSync(join(root, 'js/i18n.js'), 'utf8');
const dictionaryMatch = i18nSource.match(/  const translations = (\{[\s\S]*?\n  \});/);
if (!dictionaryMatch || i18nSource.match(/const translations =/g)?.length !== 1) {
  throw new Error('Unable to safely extract the original Rentulo translations');
}
const dictionaries = runInNewContext(`(${dictionaryMatch[1]})`, Object.create(null), { timeout: 1000 });
const supportedLanguages = ['cs', 'sk', 'en', 'de', 'pl'];
const keys = Object.keys(dictionaries.cs || {});
if (keys.length < 1000 || Object.keys(dictionaries).length !== supportedLanguages.length ||
    supportedLanguages.some(language => {
      const dictionary = dictionaries[language];
      return !dictionary || Object.keys(dictionary).length < keys.length ||
        keys.some(key => typeof dictionary[key] !== 'string');
    })) {
  throw new Error('The Rentulo translation catalog is incomplete');
}
const i18nRuntime = readFileSync(join(root, 'scripts/i18n-runtime.js'), 'utf8');
if (i18nRuntime.split('__RENTULO_CS_DICTIONARY__').length !== 2) {
  throw new Error('Missing i18n runtime dictionary placeholder');
}
writeFileSync(join(output, 'js/i18n.js'),
  i18nRuntime.replace('__RENTULO_CS_DICTIONARY__', JSON.stringify(dictionaries.cs)), 'utf8');
for (const language of supportedLanguages.filter(language => language !== 'cs')) {
  writeFileSync(join(output, `js/i18n-${language}.js`),
    `window.rentuloRegisterTranslations(${JSON.stringify(language)}, ${JSON.stringify(dictionaries[language])});\n`,
    'utf8');
}

const seoRuntime = readFileSync(join(root, 'scripts/seo-runtime.js'), 'utf8');
writeFileSync(join(output, 'js/seo.js'),
  `const RENTULO_SEO_DATA = ${JSON.stringify(seoPages)};\n${seoRuntime}`, 'utf8');
// Crawl access must stay open on TEST so bots can read X-Robots-Tag: noindex.
// Sitemap requests are served dynamically on PROD and return 404 on TEST.
const robotsLines = ['User-agent: *', 'Allow: /'];
if (target === 'prod') {
  robotsLines.push('', `Sitemap: ${seoBaseUrl}/sitemap.xml`);
}
writeFileSync(join(output, 'robots.txt'), `${robotsLines.join('\n')}\n`, 'utf8');

// No static sitemap.xml: Vercel routes it to the live public sitemap function.
// This avoids serving stale offers or letting a static file mask the rewrite.

console.log(`Rentulo ${target.toUpperCase()} static build completed (${parsed.hostname})`);
