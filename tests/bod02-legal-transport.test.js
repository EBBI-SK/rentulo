"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const languages = ["cs", "sk", "en", "de", "pl"];
const transport = read("js/offer-policy.js");
const sql = read("supabase/migrations/20261018110000_bod02_v1_transport_rule_TEST.sql");
const createHtml = read("nabidnout.html");
const editHtml = read("edit-nabidka.html");
const create = read("js/offer-form-page.js");
const edit = read("js/edit-offer.js");

function policy() {
  const context = vm.createContext({ window: {} });
  vm.runInContext(transport, context);
  return context.window.rentuloOfferPolicy;
}

function dictionary() {
  const context = vm.createContext({ window: {}, document: { documentElement: { lang: "cs" }, addEventListener() {} } });
  vm.runInContext(read("js/i18n.js"), context);
  return context.window.rentuloTranslate;
}

test("transport screening blocks explicit vehicle titles in Czech, Slovak and English", () => {
  const p = policy();
  for (const name of [
    "Osobni auto", "Motorove vozidlo", "Motocykl Honda", "Jizdni kolo Giant", "Jízdní kolo",
    "Elektrokoloběžka", "Bicykel Kellys", "Bicycle for rent", "Scooter Vespa",
    "Loď", "Člun", "Kajak", "Kayak", "Fahrrad", "Samochód", "Rower", "Přívěsný vozík", "Karavan"
  ]) {
    assert.equal(p.isTransportOffer(name, "Ostatní"), true, name);
  }
  assert.equal(p.isTransportOffer("Vrtacka", "Auto a doprava"), true);
  assert.equal(p.isTransportOffer("Vrtacka", "Dopravní prostředky"), true);
});

test("transport screening does not block unrelated ordinary rental items", () => {
  const p = policy();
  for (const name of ["Aku vrtacka", "Motorova pila", "Cyklisticka prilba", "Kocarek", "Reproduktor", "Stresni box", "Vysavac"]) {
    assert.equal(p.isTransportOffer(name, "Hobby"), false, name);
  }
});

test("create and edit flows both require affirmative statement before upload or mutation", () => {
  for (const [html, source, checkbox] of [
    [createHtml, create, "offerTransportConfirmation"],
    [editHtml, edit, "editTransportConfirmation"]
  ]) {
    assert.match(html, new RegExp(`id="${checkbox}"[^>]*required`));
    assert.doesNotMatch(html, /id="transportPolicyNote"|data-i18n="offer\.transportRule"/);
    assert.doesNotMatch(html, /aria-describedby="transportPolicyNote"/);
    assert.match(html, /data-i18n="offer\.transportConfirmation"/);
    assert.ok(html.indexOf('src="js/offer-policy.js"') < html.indexOf('src="js/' + (checkbox === "offerTransportConfirmation" ? "offer-form-page.js" : "edit-offer.js") + '"'));
    assert.match(source, new RegExp(`getElementById\\("${checkbox}"\\)`));
    assert.match(source, /rentuloOfferPolicy\.isTransportOffer/);
    assert.match(source, /transportAttestation\.checked/);
    assert.match(source, /offer\.transportNotAllowed/);
    assert.match(source, /offer\.transportMustConfirm/);
  }
  assert.ok(create.indexOf("transportAttestation.checked") < create.indexOf("uploadOfferPhoto(supabaseClient"));
  assert.ok(edit.indexOf("transportAttestation.checked") < edit.indexOf("const uploadedPhoto = await uploadEditedOfferPhoto(supabaseClient"));
});

test("create validation blocks vehicles before any attempted upload", () => {
  const start = create.indexOf("function validateOfferForm() {");
  const end = create.indexOf("function dataUrlToBlob(", start);
  assert.ok(start >= 0 && end > start);
  const inputs = {
    toolName: "Jízdní kolo", toolCategory: "Hobby", toolPrice: "250", toolDescription: "Zachovalé",
    pickupUseCustom: { checked: false }, offerTransportConfirmation: { checked: true }
  };
  const messages = [];
  const marked = [];
  const get = (id) => {
    const value = inputs[id];
    return typeof value === "string" ? value : "";
  };
  const context = vm.createContext({
    window: { rentuloOfferPolicy: policy() },
    document: { getElementById(id) { return inputs[id] || null; } },
    getInputValue: get,
    clearOfferFormErrors() {}, hideOfferFormMessage() {},
    markOfferFormError(id) { marked.push(id); },
    parseMoneyValue: Number,
    MINIMUM_OFFER_PRICE_CZK: 100,
    getPickupAddress() { return { street: "A 1", city: "Praha", postalCode: "110 00" }; },
    showOfferTranslatedFormMessage(key) { messages.push(key); }
  });
  vm.runInContext(create.slice(start, end) + "this.validate = validateOfferForm;", context);
  assert.equal(context.validate(), false);
  assert.deepEqual(messages, ["offer.transportNotAllowed"]);
  assert.ok(marked.includes("toolName"));

  inputs.toolName = "Aku vrtačka";
  inputs.offerTransportConfirmation.checked = false;
  messages.length = 0;
  assert.equal(context.validate(), false);
  assert.deepEqual(messages, ["offer.transportMustConfirm"]);

  inputs.offerTransportConfirmation.checked = true;
  messages.length = 0;
  assert.equal(context.validate(), true);
  assert.deepEqual(messages, []);
});

test("TEST-only SQL trigger rejects direct API writes, including status-only updates", () => {
  assert.match(sql, /rentulo_project_url/);
  assert.match(sql, /vspposovhdgvbeukoivh\.supabase\.co/);
  assert.match(sql, /security invoker\s+set search_path to ''/i);
  assert.match(sql, /before insert or update on public\.offers/i);
  assert.match(sql, /new\.category/);
  assert.match(sql, /new\.name/);
  assert.match(sql, /RENTULO_V1_TRANSPORT_NOT_ALLOWED/);
  assert.match(sql, /revoke all on function public\.enforce_v1_transport_offer_policy\(\)/i);
  assert.doesNotMatch(sql, /\b(delete from|truncate|update public\.offers|set\s+status\s*=)\b/i);
});

test("all BOD02 legal disclosures exist in five languages without fallback to other locale", () => {
  const source = read("js/i18n.js");
  const translate = dictionary();
  const terms = read("obchodni-podminky.html");
  const privacy = read("ochrana-osobnich-udaju.html");
  const other = read("kontakt.html") + read("registrace.html");
  const keys = [
    "offer.transportConfirmation", "offer.transportNotAllowed", "offer.transportMustConfirm",
    "detail.privateListingNote", "detail.reportOffer", "contact.reportTitle", "contact.reportText",
    "terms.section3.item3", "terms.section4.item5", "terms.section4.item6", "terms.section6.item6",
    "terms.section9.item3", "terms.section12.item4", "terms.section12.item5", "terms.section14.item3",
    "privacy.s2li11", "privacy.s10p6", "privacy.s11p3", "registration.termsVersionNote"
  ];
  for (const key of keys) {
    assert.equal((source.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":', "g")) || []).length, 5, key);
    for (const language of languages) {
      assert.notEqual(translate(key, language), key, `${key}:${language}`);
      assert.ok(translate(key, language).length > 17, `${key}:${language}`);
    }
  }
  for (const key of keys.filter(key => key.startsWith("terms.") || key.startsWith("privacy."))) {
    const fallback = translate(key, "cs");
    assert.ok((key.startsWith("terms.") ? terms : privacy).includes(fallback), key + " Czech HTML fallback");
  }
  for (const key of ["contact.reportTitle", "contact.reportText", "registration.termsVersionNote"]) {
    assert.ok(other.includes(translate(key, "cs")), key);
  }
});

test("V1 public legal copy stays clear without mentioning future V2 availability", () => {
  const translate = dictionary();
  const terms = read("obchodni-podminky.html");
  for (const html of [createHtml, editHtml]) {
    assert.doesNotMatch(html, /transportPolicyNote|offer\.transportRule|\bV2\b/i);
    assert.match(html, /data-i18n="offer\.transportConfirmation"/);
  }
  assert.doesNotMatch(terms, /\bV2\b/i);
  assert.match(terms, /data-i18n="terms\.section4\.item5"/);
  for (const language of languages) {
    const translated = translate("terms.section4.item5", language);
    assert.doesNotMatch(translated, /\bV2\b/i, language);
    assert.ok(translated.length > 40, language);
  }
  assert.doesNotMatch(read("js/i18n.js"), /"offer\.transportRule":/);
});

test("private-party disclosure remains in the terms while visitors can report a listing", () => {
  const detail = read("js/detail-page.js");
  const terms = read("obchodni-podminky.html");
  assert.doesNotMatch(detail, /detail\.privateListingNote/);
  assert.match(terms, /data-i18n="terms\.section3\.item2"/);
  assert.match(terms, /data-i18n="terms\.section3\.item3"/);
  assert.match(detail, /!isOwner \? `<p/);
  assert.match(detail, /detail\.reportOffer/);
  assert.match(detail, /mailto:rentulo@rentulo\.com/);
  assert.match(detail, /offer\.offerNumber \|\| offer\.id/);
});

test("registration captures exact displayed TEST legal version and locale", () => {
  const registration = read("js/registration-page.js");
  assert.match(registration, /terms_version:\s*"1\.0-test-2026-10-20"/);
  assert.match(registration, /privacy_notice_version:\s*"1\.0-test-2026-10-20"/);
  assert.match(registration, /terms_language:\s*preferredLanguage/);
  assert.match(registration, /terms_accepted_at:\s*now/);
  assert.match(registration, /private_individual_confirmed:\s*true/);
});


test("Rentulo V1 legal notices consistently use the first document version 1.0", () => {
  const translate = dictionary();
  const keys = [
    "terms.eyebrow", "terms.section15.item3",
    "privacy.eyebrow", "privacy.s13p2",
    "registration.termsVersionNote"
  ];
  for (const language of languages) {
    for (const key of keys) {
      const message = translate(key, language);
      assert.match(message, /\b1\.0\b/, `${language}: ${key}`);
      assert.doesNotMatch(message, /\b1\.1\b/, `${language}: ${key}`);
    }
  }
  for (const page of ["obchodni-podminky.html", "ochrana-osobnich-udaju.html", "registrace.html"]) {
    assert.match(read(page), /verz[ei] 1\.0/);
    assert.doesNotMatch(read(page), /\b1\.1\b/, page);
  }
  const registration = read("js/registration-page.js");
  assert.match(registration, /terms_version:\s*"1\.0-test-2026-10-20"/);
  assert.match(registration, /privacy_notice_version:\s*"1\.0-test-2026-10-20"/);
});

test("listing price labels show Czech crowns in all five languages", () => {
  const translate = dictionary();
  const expected = {
    cs: "Cena za den (Kč)",
    sk: "Cena za deň (Kč)",
    en: "Price per day (CZK)",
    de: "Preis pro Tag (CZK)",
    pl: "Cena za dzień (Kč)"
  };
  assert.match(createHtml, /<label for="toolPrice" data-i18n="offer\.priceLabel">Cena za den \(Kč\)<\/label>/);
  assert.match(editHtml, /<label for="edit-price" data-i18n="editOffer\.pricePerDay">Cena za den \(Kč\)<\/label>/);
  for (const language of languages) {
    assert.equal(translate("offer.priceLabel", language), expected[language]);
    assert.equal(translate("editOffer.pricePerDay", language), expected[language]);
  }
});
