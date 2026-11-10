// SEO 19C/3: accurate public editorial metadata, without modifying user text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEO_CATEGORIES } from '../api/seo-categories.mjs';
import { SEO_SUBCATEGORIES, getSeoSubcategory } from '../api/seo-subcategories.mjs';
import { citySeoDescription, citySeoTitle } from '../api/seo-cities.mjs';
import { getOfferSeoConfig, getOfferSeoValues, renderOfferSeoHtml } from '../api/offer-page.mjs';
import { renderCategoryHtml } from '../api/category-page.mjs';
import { renderDirectoryHtml } from '../api/offers-directory.mjs';

const config = getOfferSeoConfig({});
const id = 'cbf1184a-97fd-4fd1-8b62-e084a4452d28';
const offer = {
  id, name: 'Aku vrtačka Bosch', category: 'Stavba', city: 'Zlín',
  subcategory_slug: 'vrtacky', seo_city_slug: 'zlin', price_per_day: 250,
  description: 'Osobní uživatelský popis bez přepisování.',
  photo_url: `${config.supabaseOrigin}/storage/v1/object/public/offer-photos/photo/test.jpg`
};
const stavba = SEO_CATEGORIES.find(c => c.slug === 'stavba');
const titleOf = html => html.match(/<title>([^<]+)<\/title>/)?.[1];
const metaOf = html => html.match(/<meta name="description" content="([^"]+)"/)?.[1];

test('19C3: all six established category URLs have unique descriptive title and useful copy', () => {
  assert.deepEqual(SEO_CATEGORIES.map(c => c.slug), ['domacnost','zahrada','stavba','hobby','party','ostatni']);
  assert.deepEqual(SEO_CATEGORIES.map(c => c.name), ['Domácnost','Zahrada','Stavba','Hobby','Párty','Ostatní']);
  assert.equal(new Set(SEO_CATEGORIES.map(c => c.seoTitle)).size, 6);
  assert.equal(new Set(SEO_CATEGORIES.map(c => c.description)).size, 6);
  for (const c of SEO_CATEGORIES) {
    assert.match(c.seoTitle, /k půjčení$/);
    assert.ok(c.seoTitle.length >= 24 && c.seoTitle.length <= 65);
    assert.ok(c.description.length >= 95 && c.description.length <= 160);
    const html = renderCategoryHtml(c, [{...offer, category:c.name}], 1, false, config);
    assert.equal(titleOf(html), `${c.seoTitle} | Rentulo`);
    assert.equal(metaOf(html), c.description);
    assert.ok(html.includes(`<h1>${c.name} k půjčení</h1>`), 'Established heading and category must remain');
    assert.ok(html.includes(`<link rel="canonical" href="https://rentulo.eu/kategorie/${c.slug}">`));
    assert.match(html, /<meta name="robots" content="noindex">/);
  }
});

test('19C3: all 26 stable subcategories have editorial, unique SEO titles and descriptions', () => {
  assert.equal(SEO_SUBCATEGORIES.length, 26);
  assert.equal(new Set(SEO_SUBCATEGORIES.map(x => x.seoTitle)).size, 26);
  assert.equal(new Set(SEO_SUBCATEGORIES.map(x => x.description)).size, 26);
  for (const item of SEO_SUBCATEGORIES) {
    assert.equal(getSeoSubcategory(item.categorySlug, item.slug), item);
    assert.match(item.seoTitle, /k půjčení$/);
    assert.ok(item.seoTitle.length <= 60);
    assert.ok(item.description.length >= 85 && item.description.length <= 160);
    const c=SEO_CATEGORIES.find(x => x.slug === item.categorySlug);
    const html=renderCategoryHtml(c,[{...offer,category:c.name,subcategory_slug:item.slug}],1,false,config,item);
    assert.equal(titleOf(html), `${item.seoTitle} | Rentulo`);
    assert.equal(metaOf(html), item.description);
    assert.ok(html.includes(`<h1>${item.name} k půjčení</h1>`));
    assert.ok(html.includes(`<link rel="canonical" href="https://rentulo.eu/kategorie/${c.slug}/${item.slug}">`));
  }
});

test('19C3: real category+city pages use the exact Czech city and vary with city and category', () => {
  const city1='Zlín',city2='Uherské Hradiště';
  const descriptions=new Set();
  for (const category of SEO_CATEGORIES) for (const city of [city1,city2]) {
    const title=citySeoTitle(category,city);
    const description=citySeoDescription(category,city);
    assert.ok(title.includes(city));
    assert.ok(description.includes(city));
    assert.ok(description.includes('Kč')===false);
    assert.ok(description.length<=160);
    descriptions.add(description);
    const html=renderCategoryHtml(category,[{...offer,category:category.name,city,seo_city_slug:city === city1 ? 'zlin':'uherske-hradiste'}],1,false,config,null,{
      name:city,slug:city === city1 ? 'zlin':'uherske-hradiste'
    });
    assert.equal(titleOf(html), `${title} | Rentulo`);
    assert.equal(metaOf(html), description);
    assert.match(html, /<meta name="robots" content="noindex">/);
  }
  assert.equal(descriptions.size, SEO_CATEGORIES.length * 2);
});

test('19C3: offer metadata describes renting with real city, category and daily CZK price', () => {
  const values = getOfferSeoValues(offer,id,config);
  assert.equal(values.title, 'Aku vrtačka Bosch k půjčení – Zlín | Rentulo');
  assert.match(values.description, /Aku vrtačka Bosch – Zlín/);
  assert.match(values.description, /Cena půjčení 250 Kč\/den/);
  assert.match(values.description, /Kategorie Stavba/);
  assert.ok(!values.description.includes(offer.description), 'Never duplicate arbitrary user description in metadata');
  assert.equal(values.name, offer.name);
  assert.equal(values.offerDescription, offer.description, 'Do not rewrite user text');
  assert.equal(values.canonicalUrl, `https://rentulo.eu/nabidka/${id}`);
  const html=renderOfferSeoHtml('<html><head><title>Detail</title></head><body><div id="detailContent"></div></body></html>',values,'test');
  assert.ok(html.includes(`<title>${values.title}</title>`));
  assert.ok(html.includes(`<meta name="description" content="${values.description}"`));
  assert.ok(html.includes(`<p class="description">${offer.description}</p>`));
  assert.match(html, /<meta name="robots" content="noindex"/);
  assert.match(html, /application\/ld\+json/);
});

test('19C3: a name already containing k půjčení is not doubled and long names are clipped', () => {
  const already=getOfferSeoValues({...offer,name:'Aku vrtačka k půjčení'},id,config);
  assert.equal(already.title,'Aku vrtačka k půjčení – Zlín | Rentulo');
  const long=getOfferSeoValues({...offer,name:'Dlouhé jméno výrobku '.repeat(10),city:'Uherské Hradiště'},id,config);
  assert.ok(long.title.length<=78);
  assert.ok(!long.title.includes('  '));
  assert.ok(!long.title.includes('..'));
  assert.equal(long.name.length,100);
});

test('19C3: user or reservation secrets never enter metadata and HTML escapes unsafe characters', () => {
  const value=getOfferSeoValues({...offer,name:'Vrtačka "nová" <script>alert(1)</script>', city:'<Zlín>',
    pickup_phone:'+42000000123',pickup_street:'SECRET_1',pin:'111222',email:'secret@example.com'},id,config);
  const html=renderOfferSeoHtml('<html><head><title>Detail</title></head><body><div id="detailContent"></div></body></html>',value,'test');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&quot;nová&quot;'));
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>|SECRET_1|111222|secret@example.com|\+42000000123/);
});

test('19C3: directory metadata describes real public catalog and paginated URL', () => {
  const first=renderDirectoryHtml([offer],1,true,config);
  const second=renderDirectoryHtml([offer],2,false,config);
  assert.notEqual(titleOf(first),titleOf(second));
  assert.notEqual(metaOf(first),metaOf(second));
  assert.match(metaOf(first), /ceny za den a města vyzvednutí/);
  assert.match(metaOf(second), /strana 2/);
  assert.match(second,/rel="canonical" href="https:\/\/rentulo\.eu\/nabidky\?page=2"/);
  assert.match(first,/<meta name="robots" content="noindex">/);
});

test('19C3: empty category and invalid private data remain protected in TEST/PROD page generation', () => {
  const empty=renderCategoryHtml(stavba,[],1,false,config);
  assert.match(empty, /name="robots" content="noindex"/);
  const prodConfig={...config,target:'prod',siteOrigin:'https://rentulo.com'};
  const prodFull=renderCategoryHtml(stavba,[offer],1,false,prodConfig);
  assert.doesNotMatch(prodFull, /name="robots" content="noindex"/);
  assert.match(prodFull, /rel="canonical" href="https:\/\/rentulo\.com\/kategorie\/stavba"/);
  const prodEmpty=renderCategoryHtml(stavba,[],1,false,prodConfig);
  assert.match(prodEmpty, /name="robots" content="noindex"/);
});
