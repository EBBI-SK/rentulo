import test from 'node:test';
import assert from 'node:assert/strict';
import { renderJsonLd, renderOfferJsonLd, renderCollectionJsonLd } from '../api/seo-structured-data.mjs';
import { getOfferSeoValues, renderOfferSeoHtml } from '../api/offer-page.mjs';
import { renderCategoryHtml } from '../api/category-page.mjs';
import { renderDirectoryHtml } from '../api/offers-directory.mjs';
import { getSeoCategoryBySlug } from '../api/seo-categories.mjs';
import { getSeoSubcategory } from '../api/seo-subcategories.mjs';

const id1 = '00000000-0000-4000-8000-000000000001';
const id2 = '00000000-0000-4000-8000-000000000002';
const config = { target: 'test', siteOrigin: 'https://rentulo.eu', supabaseOrigin: 'https://vspposovhdgvbeukoivh.supabase.co' };
const row = {
  id: id1,
  name: 'Aku vrtačka Bosch 18V',
  category: 'Stavba',
  description: 'Aku vrtačka s nabíječkou.',
  city: 'Zlín',
  price_per_day: 200,
  photo_url: `${config.supabaseOrigin}/storage/v1/object/public/offer-photos/sample/drill.jpg`,
  subcategory_slug: 'vrtacky',
  seo_city_slug: 'zlin',
  owner_id: 'PRIVATE-ID-MUST-NOT-LEAK',
  pickup_address: 'PRIVATE-STREET-MUST-NOT-LEAK'
};
const second = { ...row, id: id2, name: 'Příklepová vrtačka', city: 'Zlín' };
const category = getSeoCategoryBySlug('stavba');
const extract = html => {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, 'Exactly one JSON-LD block');
  return JSON.parse(scripts[0][1]);
};

// Tests never access Supabase or external services.
test('JSON-LD script escapes HTML control characters and script termination', () => {
  const markup = renderJsonLd({ text: '</script><script>alert(1)</script> & <> \u2028 \u2029' });
  assert.equal((markup.match(/<script/g) || []).length, 1);
  assert.equal((markup.match(/<\/script>/g) || []).length, 1);
  assert.ok(!markup.includes('</script><script>'));
  assert.ok(!markup.includes('alert(1)</script>'));
  assert.deepEqual(extract(markup), { text: '</script><script>alert(1)</script> & <> \u2028 \u2029' });
});

test('public detail JSON-LD describes lease rather than a sale', () => {
  const values = getOfferSeoValues(row, row.id, config);
  const data = extract(renderOfferJsonLd(values));
  assert.equal(data[0]['@type'], 'BreadcrumbList');
  assert.deepEqual(data[0].itemListElement.map(x => x.name), ['Rentulo', 'Všechny nabídky', row.name]);
  assert.equal(data[1]['@type'], 'Product');
  assert.equal(data[1].name, row.name);
  assert.equal(data[1].offers.businessFunction, 'http://purl.org/goodrelations/v1#LeaseOut');
  assert.equal(data[1].offers.priceSpecification.price, 200);
  assert.equal(data[1].offers.priceSpecification.priceCurrency, 'CZK');
  assert.equal(data[1].offers.priceSpecification.billingDuration, 'P1D');
  assert.equal(data[1].offers.price, undefined, 'No ambiguous unconditional sale price');
  assert.equal(data[1].image, row.photo_url);
  assert.ok(!JSON.stringify(data).includes('PRIVATE-'));
  assert.equal(data[1].offers.availability, undefined);
  assert.equal(data[1].aggregateRating, undefined);
  assert.equal(data[1].offers.seller, undefined);
});

test('unapproved image never becomes a structured product image', () => {
  const values = getOfferSeoValues({ ...row, photo_url: 'https://untrusted.example/photo.jpg' }, row.id, config);
  const doc = extract(renderOfferJsonLd(values));
  assert.equal(doc[1].image, undefined);
  assert.equal(values.hasOfferPhoto, false);
  assert.equal(values.imageUrl, 'https://rentulo.eu/assets/rentulo-logo-mark.png');
});

test('invalid price is not marked as a product', () => {
  assert.equal(getOfferSeoValues({ ...row, price_per_day: 0 }, row.id, config), null);
  assert.equal(renderOfferJsonLd({ canonicalUrl: `https://rentulo.eu/nabidka/${id1}`, pricePerDay: 0 }), '');
});

test('detail server HTML includes JSON-LD, canonical, and TEST noindex', () => {
  const values = getOfferSeoValues(row, row.id, config);
  const html = renderOfferSeoHtml('<html><head><title>Detail</title></head><body><div id="detailContent"></div></body></html>', values, 'test');
  assert.match(html, /<meta name="robots" content="noindex"/);
  assert.ok(html.includes(`<link rel="canonical" href="${values.canonicalUrl}"`));
  assert.equal(extract(html)[1].offers.priceSpecification.price, 200);
  assert.ok(html.includes('data-server-rendered-offer="true"'));
  assert.ok(!html.includes('PRIVATE-STREET'));
});

test('production detail does not inherit TEST noindex', () => {
  const values = getOfferSeoValues(row, row.id, { ...config, siteOrigin: 'https://rentulo.com' });
  const html = renderOfferSeoHtml('<html><head><title>Detail</title></head><body></body></html>', values, 'prod');
  assert.ok(!html.includes('<meta name="robots" content="noindex"'));
  assert.equal(extract(html)[1].url, `https://rentulo.com/nabidka/${id1}`);
});

test('category page exposes real, ordered ItemList only', () => {
  const html = renderCategoryHtml(category, [row, second], 1, false, config);
  const [crumb, page] = extract(html);
  assert.equal(page['@type'], 'CollectionPage');
  assert.equal(page.mainEntity.numberOfItems, 2);
  assert.equal(page.mainEntity.itemListElement[0].position, 1);
  assert.equal(page.mainEntity.itemListElement[1].url, `https://rentulo.eu/nabidka/${id2}`);
  assert.equal(crumb.itemListElement.at(-1).item, 'https://rentulo.eu/kategorie/stavba');
  assert.ok(!html.includes('PRIVATE-ID'));
  assert.ok(!html.includes('PRIVATE-STREET'));
  assert.match(html, /<meta name="robots" content="noindex"/);
});

test('subcategory keeps its own breadcrumb and canonical', () => {
  const sub = getSeoSubcategory('stavba', 'vrtacky');
  const html = renderCategoryHtml(category, [row], 1, false, config, sub);
  const [crumb, page] = extract(html);
  assert.equal(crumb.itemListElement.at(-1).name, 'Vrtačky a šroubováky');
  assert.equal(page.url, 'https://rentulo.eu/kategorie/stavba/vrtacky');
  assert.equal(page.mainEntity.numberOfItems, 1);
});

test('city keeps original city URL and matching ItemList', () => {
  const html = renderCategoryHtml(category, [row], 1, false, config, null, { slug: 'zlin', name: 'Zlín' });
  const [crumb, page] = extract(html);
  assert.equal(crumb.itemListElement.at(-1).name, 'Zlín');
  assert.equal(page.url, 'https://rentulo.eu/kategorie/stavba/mesto/zlin');
  assert.equal(page.mainEntity.numberOfItems, 1);
});

test('pagination creates stable unique canonical and same matching item listing', () => {
  const html = renderCategoryHtml(category, [row], 2, true, config);
  const [, page] = extract(html);
  assert.equal(page.url, 'https://rentulo.eu/kategorie/stavba?page=2');
  assert.ok(html.includes('rel="prev"'));
});

test('empty category does not fabricate any ItemList', () => {
  const html = renderCategoryHtml(category, [], 1, false, config);
  const [, page] = extract(html);
  assert.equal(page.mainEntity, undefined);
  assert.ok(html.includes('name="robots" content="noindex"'));
});

test('directory includes CollectionPage, real ItemList and own crumbs', () => {
  const html = renderDirectoryHtml([row, second], 1, false, config);
  const [crumb, page] = extract(html);
  assert.equal(crumb.itemListElement.at(-1).item, 'https://rentulo.eu/nabidky');
  assert.equal(page.mainEntity.numberOfItems, 2);
  assert.equal(page.mainEntity.itemListElement[0].name, row.name);
  assert.equal(page.mainEntity.itemListElement[1].position, 2);
  assert.ok(!html.includes('PRIVATE-'));
});

test('empty directory includes no made-up items', () => {
  const [, page] = extract(renderDirectoryHtml([], 1, false, config));
  assert.equal(page.mainEntity, undefined);
});

test('directory page 2 contains matching page=2 canonical', () => {
  const [, page] = extract(renderDirectoryHtml([row], 2, false, config));
  assert.equal(page.url, 'https://rentulo.eu/nabidky?page=2');
});

test('invalid public offer data is still rejected in category and directory', () => {
  assert.throws(() => renderDirectoryHtml([{ ...row, id: 'INVALID' }], 1, false, config), /Invalid public offer identifier/);
  assert.throws(() => renderCategoryHtml(category, [{ ...row, category: 'Párty' }], 1, false, config), /Invalid public category offer data/);
});

test('JSON-LD is omitted from invalid status HTML by existing handlers (static contract)', async () => {
  const fs = await import('node:fs');
  const offer = fs.readFileSync(new URL('../api/offer-page.mjs', import.meta.url), 'utf8');
  assert.match(offer, /sendHtml\(res, 404, unavailableHtml\(\), headOnly\)/);
  const categoryCode = fs.readFileSync(new URL('../api/category-page.mjs', import.meta.url), 'utf8');
  assert.match(categoryCode, /send\(res, 503, unavailable\(\), headOnly\)/);
});
