'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function source(name) { return fs.readFileSync(path.join(root, name), 'utf8'); }
function loadScript(name, context) {
  context.window = context.window || {};
  context.document = context.document || { addEventListener() {} };
  vm.createContext(context);
  vm.runInContext(source(name), context, { filename: name });
  return context;
}

test('creating an active listing without a photo is stopped before upload/INSERT', async () => {
  let inserts = 0;
  const elements = {
    toolPhotoStatus: { dataset: {}, textContent: '', className: '' },
    offerFormMessage: { dataset: {}, textContent: '', className: '', scrollIntoView() {} }
  };
  const context = loadScript('js/offer-form-page.js', {
    document: { addEventListener() {}, getElementById(id) { return elements[id] || null; } },
    getSupabaseClient() { return { from() { inserts++; return {}; } }; },
    console, window: {}
  });
  context.validateOfferForm = () => true;
  await context.saveOffer('active');
  assert.equal(inserts, 0);
  assert.match(elements.offerFormMessage.textContent, /alespoň jednu fotografii/);
  assert.equal(elements.toolPhotoStatus.className, 'photo-upload-status error');
});

test('the same empty-photo form can still be saved as a draft', async () => {
  const inserted = [];
  const client = { from(table) {
    assert.equal(table, 'offers');
    return { insert(payload) { inserted.push(payload); return { select() { return { async single() { return { error: null }; } }; } }; } };
  } };
  const context = loadScript('js/offer-form-page.js', {
    document: { addEventListener() {}, getElementById() { return null; } },
    getSupabaseClient() { return client; },
    async getCurrentSupabaseUser() { return { id: 'owner-1' }; },
    getPickupAddress() { return { street: 'A', city: 'Praha', postalCode: '11000' }; },
    async geocodePickupAddress() { return null; },
    async uploadOfferPhoto() { return { url: null, path: '' }; },
    createSupabaseOfferObject(status, user, photoUrl) { return { status, owner_id: user.id, photo_url: photoUrl }; },
    sessionStorage: { setItem() {} },
    console, window: { location: { href: '' } }
  });
  context.validateOfferForm = () => true;
  context.getPickupAddress = () => ({ street: 'A', city: 'Praha', postalCode: '11000' });
  context.geocodePickupAddress = async () => null;
  context.uploadOfferPhoto = async () => ({ url: null, path: '' });
  context.createSupabaseOfferObject = (status, user, photoUrl) => ({ status, owner_id: user.id, photo_url: photoUrl });
  await context.saveOffer('draft');
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].status, 'draft');
  assert.equal(inserted[0].photo_url, null);
  assert.equal(context.window.location.href, 'moje-nabidky.html');
});


test('a processed photo allows normal active publication', async () => {
  const inserted = [];
  const client = { from(table) {
    assert.equal(table, 'offers');
    return { insert(payload) { inserted.push(payload); return { select() { return { async single() { return { error: null }; } }; } }; } };
  } };
  const ctx = loadScript('js/offer-form-page.js', {
    document: { addEventListener() {}, getElementById() { return null; } },
    getSupabaseClient() { return client; },
    async getCurrentSupabaseUser() { return { id: 'owner-1' }; },
    sessionStorage: { setItem() {} },
    console, window: { location: { href: '' } }
  });
  ctx.validateOfferForm = () => true;
  ctx.getPickupAddress = () => ({ city: 'Praha' });
  ctx.geocodePickupAddress = async () => null;
  ctx.uploadOfferPhoto = async () => ({ url: 'https://example.test/storage/v1/object/public/offer-photos/owner-1/offer.jpg', path: 'owner-1/offer.jpg' });
  ctx.createSupabaseOfferObject = (status, user, url) => ({ status, owner_id: user.id, photo_url: url });
  vm.runInContext('offerPhotoDataUrl = "data:image/jpeg;base64,/9j/4AAQ";', ctx);
  await ctx.saveOffer('active');
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].status, 'active');
  assert.match(inserted[0].photo_url, /offer-photos\/owner-1\/offer\.jpg$/);
});

test('owner can publish a draft when an uploaded photo is present', async () => {
  let writes = 0;
  const ctx = loadScript('js/offers-page.js', {
    console,
    document: { addEventListener() {}, getElementById() { return null; } },
    getSupabaseClient() { return { from(table) {
      assert.equal(table, 'offers');
      return { update(payload) {
        assert.equal(payload.status, 'active');
        return { async eq() { writes++; return { error: null }; } };
      } };
    } }; },
    window: {}
  });
  ctx.initializeOwnerOffersPage = async () => {};
  vm.runInContext('ownerOffers = [{id:"draft-2", status:"draft", photoUrl:"https://example.test/photo.jpg"}];', ctx);
  await ctx.publishOffer('draft-2');
  assert.equal(writes, 1);
});

test('owner cannot publish photo-less draft or reactivate photo-less hidden offer', async () => {
  let writes = 0;
  const elements = { accountMessage: { innerHTML: '', classList: { toggle() {}, add() {} } } };
  const context = loadScript('js/offers-page.js', {
    console,
    document: { addEventListener() {}, getElementById(id) { return elements[id] || null; } },
    getSupabaseClient() { return { from() { writes++; throw Error('unexpected database call'); } }; },
    escapeHtml(value) { return String(value); },
    window: {}
  });
  vm.runInContext('ownerOffers = [{id: "draft-1", status: "draft", photoUrl: ""}, {id: "hidden-1", status: "hidden", photoUrl: "  "}];', context);
  await context.publishOffer('draft-1');
  await context.changeOfferVisibility('hidden-1', 'active');
  assert.equal(writes, 0);
  assert.match(elements.accountMessage.innerHTML, /alespoň jednu fotografii/);
});

test('editing an active offer cannot remove its last photo', async () => {
  const events = {};
  const ui = {
    '#save-edit-button': { addEventListener(type, listener) { events[type] = listener; }, disabled: false, textContent: '' },
    '#edit-name': { value: 'Vrtačka' },
    '#edit-category': { selectedIndex: 1, value: 'Stavba' },
    '#editPickupUseCustom': { checked: false },
    '#edit-pickup-street': { value: '' },
    '#edit-city': { value: '' },
    '#edit-postal-code': { value: '' },
    '#edit-pickup-note': { value: '' },
    '#edit-price': { value: '150' },
    '#edit-min-rental-days': { value: '1' },
    '#edit-description': { value: 'Funkční vrtačka' },
    '#editPhotoStatus': { dataset: {}, setAttribute() {}, removeAttribute() {}, textContent: '' },
    '.site-message': { dataset: {}, textContent: '', className: '' }
  };
  let writes = 0;
  const context = loadScript('js/edit-offer.js', {
    console, window: { rentuloOfferPolicy: { isTransportOffer() { return false; } } },
    document: {
      addEventListener() {}, querySelector(selector) { return ui[selector] || null; },
      querySelectorAll() { return []; },
      getElementById(id) { return id === 'editTransportConfirmation' ? { checked: true } : null; }
    },
    getSupabaseClient() { return { from() { writes++; throw Error('unexpected database call'); } }; },
    async getCurrentSupabaseUser() { return { id: 'owner-1' }; },
    formatRentuloCzechPostalCode() { return '11000'; },
    setTimeout() {}
  });
  vm.runInContext(`editCurrentOffer = {id:'offer-1',owner_id:'owner-1',status:'active',price_per_day:150};
     editOwnerProfile = {countryCode:'CZ',street:'Hlavní',city:'Praha',postalCode:'11000'};
     editOfferPhotoDataUrl = '';`, context);
  context.setupEditOfferSave();
  await events.click();
  assert.equal(writes, 0);
  assert.match(ui['.site-message'].textContent, /alespoň jednu fotografii/);
  assert.equal(ui['#editPhotoStatus'].className, 'photo-upload-status error');
});

test('both UI entrypoints and all five language variants describe the requirement', () => {
  const html = source('nabidnout.html');
  assert.match(html, /data-i18n="offer\.photoPublishRule"/);
  assert.doesNotMatch(html, /Fotka\s*\(nepovinná\)/);
  const i18n = source('js/i18n.js');
  for (const key of ['offer.photoPublishRule','offer.photoRequired','editOffer.photoRequired','offers.photoRequiredBeforePublish']) {
    assert.equal(i18n.split(`"${key}":`).length - 1, 5, key);
  }
});

test('database guards every active INSERT/UPDATE while leaving drafts and hidden offers free', () => {
  const sql = source('supabase/migrations/20261029171000_require_photo_for_active_offers.sql');
  assert.match(sql, /ADD CONSTRAINT offers_require_photo_when_active/);
  assert.match(sql, /status <> 'active'::public\.offer_status/);
  assert.match(sql, /nullif\(btrim\(photo_url\), ''\) IS NOT NULL/);
  assert.match(sql, /IF EXISTS \(/); // Do not silently break migration when legacy active rows lack photos.
});
