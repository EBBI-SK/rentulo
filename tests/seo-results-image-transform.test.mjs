import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root, 'js/results-page.js'), 'utf8');
const publicPhoto = 'https://vspposovhdgvbeukoivh.supabase.co/storage/v1/object/public/offer-photos/owner/photo%201.jpg';
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

function isolateFunction(name, nextName, bindings = {}) {
  const begin = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, begin + name.length);
  assert.ok(begin !== -1 && end > begin, `${name} must be present`);
  return vm.runInNewContext(`${source.slice(begin, end)}\n${name}`, bindings);
}

const render = isolateFunction('renderResultImage', 'restoreOriginalResultPhoto', {
  getOfferPhoto: (offer) => offer.photo_url,
  getOfferName: (offer) => offer.name,
  escapeHtml
});
const fallback = isolateFunction('restoreOriginalResultPhoto', 'getEmptyResultsContent');
const attribute = (html, name) => html.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const img = (html) => html.match(/<img\b[^>]*>/)?.[0] || '';

function card(photo, prioritized = false) {
  return img(render({ photo_url: photo, name: 'Vrtačka <aku>' }, prioritized));
}

test('19C4: public offer photos use responsive Supabase Pro 320/640 variants', () => {
  const html = card(publicPhoto, true);
  const renderBase = publicPhoto.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
  assert.equal(attribute(html, 'src'), `${renderBase}?width=320&amp;quality=75`);
  assert.equal(attribute(html, 'srcset'), `${renderBase}?width=320&amp;quality=75 320w, ${renderBase}?width=640&amp;quality=75 640w`);
  assert.match(attribute(html, 'sizes'), /max-width: 760px/);
  assert.match(attribute(html, 'sizes'), /140px, 154px/);
  assert.equal(attribute(html, 'data-original-photo'), publicPhoto);
  assert.equal(attribute(html, 'loading'), 'eager');
  assert.equal(attribute(html, 'fetchpriority'), 'high');
  assert.equal(attribute(html, 'decoding'), 'async');
  assert.equal(attribute(html, 'alt'), 'Vrtačka &lt;aku&gt;');
});

test('19C4: later result photographs stay lazy without high fetch priority', () => {
  const html = card(publicPhoto, false);
  assert.equal(attribute(html, 'loading'), 'lazy');
  assert.equal(attribute(html, 'fetchpriority'), undefined);
  assert.ok(attribute(html, 'srcset'));
});

test('19C4: external, data, signed, other-bucket and query-bearing URLs remain unchanged', () => {
  const sources = [
    'https://some-cdn.example/drill.jpg',
    'data:image/jpeg;base64,aGVsbG8=',
    'https://vspposovhdgvbeukoivh.supabase.co/storage/v1/object/sign/offer-photos/foo.jpg?token=secret',
    'https://vspposovhdgvbeukoivh.supabase.co/storage/v1/render/image/public/offer-photos/foo.jpg?width=200',
    'https://vspposovhdgvbeukoivh.supabase.co/storage/v1/object/public/other-bucket/foo.jpg',
    publicPhoto + '?download=1',
    publicPhoto + '?cache=abc'
  ];
  for (const original of sources) {
    const html = card(original, true);
    assert.equal(attribute(html, 'src'), escapeHtml(original), original);
    assert.equal(attribute(html, 'srcset'), undefined, original);
    assert.equal(attribute(html, 'data-original-photo'), undefined, original);
  }
});

test('19C4: no-photo fallback and image source escaping still work', () => {
  assert.doesNotMatch(render({photo_url: '', name: 'Věc <x>'}), /<img\b/);
  assert.match(render({photo_url: '', name: 'Věc <x>'}), /Věc &lt;x&gt;/);
  const url = 'https://cdn.example/photo.jpg?x=1&y=2';
  assert.equal(attribute(card(url), 'src'), 'https://cdn.example/photo.jpg?x=1&amp;y=2');
});

test('19C4: failed transform restores the original URL once, without an error retry loop', () => {
  const values = new Map([
    ['data-original-photo', publicPhoto],
    ['srcset', 'optimized-srcset'],
    ['sizes', 'some-sizes']
  ]);
  const element = {
    tagName: 'IMG',
    src: 'optimized',
    getAttribute(name) { return values.get(name) ?? null; },
    removeAttribute(name) { values.delete(name); }
  };
  fallback({target: element});
  assert.equal(element.src, publicPhoto);
  assert.equal(values.has('data-original-photo'), false);
  assert.equal(values.has('srcset'), false);
  assert.equal(values.has('sizes'), false);
  element.src = 'manually-overwritten';
  fallback({target: element});
  assert.equal(element.src, 'manually-overwritten', 'Fallback is attempted only once');
  fallback({target: {tagName: 'DIV', getAttribute() { throw new Error('should not inspect other elements'); }}});
  assert.match(source, /document\.addEventListener\("error", restoreOriginalResultPhoto, true\)/,
    'Listen in capture phase because image load errors do not bubble');
});
