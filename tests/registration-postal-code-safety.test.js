"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "js", "registration-page.js"), "utf8");
const html = fs.readFileSync(path.join(root, "registrace.html"), "utf8");
const i18n = fs.readFileSync(path.join(root, "js", "i18n.js"), "utf8");

function slice(start, end) {
  const from = source.indexOf(start);
  const until = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && until > from, `Missing registration code: ${start} / ${end}`);
  return source.slice(from, until);
}

function createHarness() {
  const elements = Object.fromEntries(
    ["street", "city", "postalCode", "addressSuggestions"].map(id => [id, {
      value: "",
      innerHTML: "",
      hidden: true,
      attributes: new Map(),
      classList: { remove() {} },
      listeners: {},
      addEventListener(type, fn) { this.listeners[type] = fn; },
      setAttribute(key, value) { this.attributes.set(key, value); },
      removeAttribute(key) { this.attributes.delete(key); }
    }])
  );
  const context = {
    document: { getElementById(id) { return elements[id] || null; }, addEventListener() {} },
    window: { clearTimeout() {}, setTimeout() { return 1; } }
  };
  const code = [
    "let registrationAddressSuggestions = []; let registrationAddressActiveIndex = -1;",
    "let registrationAddressTimer = null; let registrationAddressRequestId = 0; let registrationLastVerifiedAddress = null;",
    'function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }',
    slice("function registrationCloseAddressSuggestions() {", "function registrationRenderAddressSuggestions(items) {"),
    slice("function registrationRenderAddressSuggestions(items) {", "function registrationSetAddressActiveIndex(nextIndex) {"),
    slice("function registrationSelectAddress(index) {", "async function registrationLoadAddressSuggestions("),
    slice("function setupAddressAutocomplete() {", "function resetRegistrationConsentCheckboxes() {"),
    'const ADDRESS_SUGGESTION_MIN_LENGTH = 3; const ADDRESS_SUGGESTION_DELAY_MS = 650;',
    "globalThis.harness = { render: registrationRenderAddressSuggestions, select: registrationSelectAddress, setup: setupAddressAutocomplete, getSuggestions: () => registrationAddressSuggestions, getSelected: () => registrationLastVerifiedAddress };"
  ].join("\n");
  vm.runInNewContext(code, context, { timeout: 2500 });
  return { elements, harness: context.harness };
}

const officialPragueAddress = {
  source: "ruian", verified: true,
  street: "Václavské náměstí 846/1", city: "Praha", postalCode: "110 00",
  label: "Václavské náměstí 846/1, Nové Město, 11000 Praha 1"
};
const unverifiedGeoapify = {
  street: "Václavské náměstí 1", city: "Praha", postalCode: "121 32",
  latitude: 50.081, longitude: 14.426
};

test("registration ignores unverified Geoapify suggestions and their wrong PSČ", () => {
  const { elements, harness } = createHarness();
  harness.render([unverifiedGeoapify]);
  assert.equal(harness.getSuggestions().length, 0);
  assert.equal(elements.addressSuggestions.hidden, true);
  assert.equal(elements.postalCode.value, "");
});

test("official RÚIAN address shows the official PSČ and fills street, city, postcode", () => {
  const { elements, harness } = createHarness();
  harness.render([officialPragueAddress]);
  assert.match(elements.addressSuggestions.innerHTML, /110 00/);
  assert.match(elements.addressSuggestions.innerHTML, /ČÚZK – RÚIAN/);
  harness.select(0);
  assert.equal(elements.street.value, "Václavské náměstí 846/1");
  assert.equal(elements.city.value, "Praha");
  assert.equal(elements.postalCode.value, "110 00");
  assert.equal(harness.getSelected().postalCode, "110 00");
  assert.equal(elements.addressSuggestions.hidden, true);
});

test("registration ignores a forged verified flag without RÚIAN source", () => {
  const { elements, harness } = createHarness();
  harness.render([{ ...unverifiedGeoapify, verified: true }]);
  assert.equal(harness.getSuggestions().length, 0);
  assert.equal(elements.postalCode.value, "");
});

test("registration keeps a user's manually entered PSČ when it matches RÚIAN", () => {
  const { elements, harness } = createHarness();
  elements.postalCode.value = "11000";
  harness.render([officialPragueAddress]);
  assert.equal(harness.getSuggestions().length, 1);
  harness.select(0);
  assert.equal(elements.postalCode.value, "110 00");
});

test("registration does not offer a RÚIAN address with a different entered PSČ", () => {
  const { elements, harness } = createHarness();
  elements.postalCode.value = "12132";
  harness.render([officialPragueAddress]);
  assert.equal(harness.getSuggestions().length, 0);
  assert.equal(elements.postalCode.value, "12132");
});

test("editing a verified street clears its previously auto-filled PSČ", () => {
  const { elements, harness } = createHarness();
  harness.setup();
  harness.render([officialPragueAddress]);
  harness.select(0);
  elements.street.value = "Národní 10";
  elements.street.listeners.input();
  assert.equal(elements.postalCode.value, "");
  assert.equal(harness.getSelected(), null);
});

test("a user-corrected PSČ is not silently removed when changing the street", () => {
  const { elements, harness } = createHarness();
  harness.setup();
  harness.render([officialPragueAddress]);
  harness.select(0);
  elements.postalCode.value = "110 05";
  elements.street.value = "Národní 10";
  elements.street.listeners.input();
  assert.equal(elements.postalCode.value, "110 05");
});

test("registration submits a RÚIAN-only request without changing other address users", () => {
  assert.match(source, /supabaseClient\.functions\.invoke\(\s*"address-suggestions"/);
  assert.match(source, /source: "ruian"/);
  assert.match(source, /postalCodeInput\.value = String\(item\.postalCode\)/);
  assert.match(source, /registrationLastVerifiedAddress/);
});

test("RÚIAN automatic postcode explanatory text is present in all five languages", () => {
  assert.match(html, /id="registrationPostalCodeNote"/);
  assert.match(html, /data-i18n="registration.postalCodeNote"/);
  assert.equal((i18n.match(/"registration\.postalCodeNote":/g) || []).length, 5);
  assert.doesNotMatch(html, /PSČ z mapového návrhu se automaticky nepřebírá/);
  assert.match(source, /registrationIsEmpty\(field\.value\)/);
});
