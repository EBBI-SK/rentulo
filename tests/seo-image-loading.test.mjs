import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getOfferSeoConfig, getOfferSeoValues, renderOfferPublicContent } from '../api/offer-page.mjs';
import { renderCategoryHtml } from '../api/category-page.mjs';
import { renderDirectoryHtml } from '../api/offers-directory.mjs';
import { SEO_CATEGORIES } from '../api/seo-categories.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = getOfferSeoConfig({});
const image = `${cfg.supabaseOrigin}/storage/v1/object/public/offer-photos/photo/test.jpg`;
const category = SEO_CATEGORIES.find(entry => entry.slug === 'stavba');
const offer = index => ({
  id: `cbf1184a-97fd-4fd1-8b62-${String(index + 1).padStart(12, '0')}`,
  name: `Aku vrtačka Bosch ${index + 1}`,
  category: 'Stavba', city: 'Zlín', price_per_day: 250, photo_url: image
});

const listCards = html => [...html.matchAll(/<article class="offer-card">([\s\S]*?)<\/article>/g)].map(match => match[1]);
const cardImg = card => card.match(/<img\b[^>]*>/)?.[0] || '';
const htmlAttribute = (html, name) => html.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

for (const [name, render] of [
  ['directory', rows => renderDirectoryHtml(rows, 1, false, cfg)],
  ['category', rows => renderCategoryHtml(category, rows, 1, false, cfg)]
]) {
  test(`19C2: ${name} first public image eager/high, remaining images lazy`, () => {
    const cards = listCards(render([offer(0), offer(1), offer(2)]));
    assert.equal(cards.length, 3);
    assert.equal(htmlAttribute(cardImg(cards[0]), 'loading'), 'eager');
    assert.equal(htmlAttribute(cardImg(cards[0]), 'fetchpriority'), 'high');
    for (const card of cards.slice(1)) {
      assert.equal(htmlAttribute(cardImg(card), 'loading'), 'lazy');
      assert.doesNotMatch(cardImg(card), /fetchpriority="high"/);
    }
    for (const card of cards) {
      assert.equal(htmlAttribute(cardImg(card), 'decoding'), 'async');
      assert.match(card, /alt="Aku vrtačka Bosch/);
    }
  });

  test(`19C2: ${name} does not prioritize logo fallback or empty listing`, () => {
    const fallback = {...offer(0), photo_url: 'https://untrusted.example/other.jpg'};
    const cards = listCards(render([fallback, offer(1)]));
    assert.equal(htmlAttribute(cardImg(cards[0]), 'loading'), 'eager');
    assert.doesNotMatch(cardImg(cards[0]), /fetchpriority="high"/);
    assert.equal(htmlAttribute(cardImg(cards[1]), 'loading'), 'lazy');
    assert.equal(listCards(render([])).length, 0);
  });

  test(`19C2: ${name} has fixed photo frame before the image loads`, () => {
    assert.match(render([offer(0)]), /\.offer-photo\{[^}]*height:190px\}/);
    assert.match(render([offer(0)]), /\.offer-photo img\{[^}]*display:block;[^}]*width:100%;height:100%;object-fit:contain/);
  });
}

test('19C2: server-rendered detail photo loads eagerly and with high priority', () => {
  const values = getOfferSeoValues(offer(0), offer(0).id, cfg);
  const html = renderOfferPublicContent(values);
  const img = html.match(/<img\b[^>]*>/)?.[0] || '';
  assert.equal(htmlAttribute(img, 'loading'), 'eager');
  assert.equal(htmlAttribute(img, 'decoding'), 'async');
  assert.equal(htmlAttribute(img, 'fetchpriority'), 'high');
  assert.equal(htmlAttribute(img, 'src'), image);
  assert.match(html, /alt="Aku vrtačka Bosch 1"/);
});

test('19C2: fallback logo is not a high-priority detail image', () => {
  const fallback = {...offer(0), photo_url: 'https://untrusted.example/other.jpg'};
  const values = getOfferSeoValues(fallback, fallback.id, cfg);
  const img = renderOfferPublicContent(values).match(/<img\b[^>]*>/)?.[0] || '';
  assert.equal(htmlAttribute(img, 'loading'), 'eager');
  assert.doesNotMatch(img, /fetchpriority="high"/);
  assert.match(img, /rentulo-logo-mark\.png/);
});

function clientFunction(source, signature, followingSignature, sandbox) {
  const start = source.indexOf(signature);
  const end = source.indexOf(followingSignature, start + signature.length);
  assert.ok(start >= 0 && end > start, `Could not isolate function: ${signature}`);
  const section = source.slice(start, end);
  const functionName = signature.match(/function\s+([A-Za-z0-9_]+)/)?.[1];
  return vm.runInNewContext(`${section}\n${functionName}`, sandbox);
}
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

test('19C2: client detail keeps high priority after live data replaces server markup', () => {
  const source = readFileSync(path.join(root, 'js/detail-page.js'), 'utf8');
  const fn = clientFunction(source, 'function renderDetailImage(offer) {', 'function isOfferDraft(offer)', {
    getOfferPhoto: row => row.photo_url,
    getOfferName: row => row.name,
    escapeHtml: escape
  });
  const html = fn({photo_url: image, name: 'Aku vrtačka'});
  const img = html.match(/<img\b[^>]*>/)?.[0] || '';
  assert.equal(htmlAttribute(img, 'loading'), 'eager');
  assert.equal(htmlAttribute(img, 'fetchpriority'), 'high');
  assert.equal(htmlAttribute(img, 'decoding'), 'async');
});

test('19C2: client search images lazy-load except first visible card', () => {
  const source = readFileSync(path.join(root, 'js/results-page.js'), 'utf8');
  const fn = clientFunction(source, 'function renderResultImage(offer, prioritized = false) {', 'function getEmptyResultsContent(type)', {
    getOfferPhoto: row => row.photo_url,
    getOfferName: row => row.name,
    escapeHtml: escape
  });
  const first = fn({photo_url: image, name: 'Aku vrtačka'}, true);
  const later = fn({photo_url: image, name: 'Aku vrtačka'}, false);
  const without = fn({photo_url: '', name: 'Aku vrtačka'}, true);
  const firstImg = first.match(/<img\b[^>]*>/)?.[0] || '';
  const laterImg = later.match(/<img\b[^>]*>/)?.[0] || '';
  assert.equal(htmlAttribute(firstImg, 'loading'), 'eager');
  assert.equal(htmlAttribute(firstImg, 'fetchpriority'), 'high');
  assert.equal(htmlAttribute(firstImg, 'decoding'), 'async');
  assert.equal(htmlAttribute(laterImg, 'loading'), 'lazy');
  assert.doesNotMatch(laterImg, /fetchpriority="high"/);
  assert.doesNotMatch(without, /<img\b/);
  assert.match(source, /function renderOfferCard\(offer, index\)/);
  assert.match(source, /renderResultImage\(offer, index === 0\)/);
  assert.match(source, /sortedOffers\.map\(renderOfferCard\)/);
});

test('19C2: mobile result cards retain aspect ratio and desktop fixed image box', () => {
  const css = readFileSync(path.join(root, 'vysledky.html'), 'utf8');
  assert.match(css, /\.result-image\s*\{[^}]*width:\s*154px;[^}]*height:\s*154px;/);
  assert.match(css, /\.result-image\s*\{[^}]*height:\s*auto;[^}]*aspect-ratio:\s*16\s*\/\s*9;/);
  const detail = readFileSync(path.join(root, 'detail.html'), 'utf8');
  assert.match(detail, /\.image-box\s*\{[^}]*height:\s*220px;/);
});

test('19C2: uploading compression, source URLs and SEO metadata are not changed', () => {
  const newOffer = readFileSync(path.join(root, 'js/offer-form-page.js'), 'utf8');
  const editOffer = readFileSync(path.join(root, 'js/edit-offer.js'), 'utf8');
  assert.match(newOffer, /const maxSize = 900;/);
  assert.match(newOffer, /canvas\.toDataURL\("image\/jpeg", 0\.78\)/);
  assert.match(editOffer, /const maxSize = 900;/);
  assert.match(editOffer, /canvas\.toDataURL\("image\/jpeg", 0\.78\)/);
  const publicOffer = readFileSync(path.join(root, 'api/offer-page.mjs'), 'utf8');
  assert.match(publicOffer, /property="og:image"/);
  assert.match(publicOffer, /rel="canonical"/);
  assert.match(publicOffer, /storage\/v1\/object\/public\/offer-photos\//);
});
