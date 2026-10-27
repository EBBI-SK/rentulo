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
      setAttribute(key, value) { this.attributes.set(key, value); },
      removeAttribute(key) { this.attributes.delete(key); }
    }])
  );
  const context = {
    document: { getElementById(id) { return elements[id] || null; } },
    window: { clearTimeout() {} }
  };
  const code = [
    "let registrationAddressSuggestions = []; let registrationAddressActiveIndex = -1;",
    "let registrationAddressTimer = null; let registrationAddressRequestId = 0;",
    'function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }',
    slice("function registrationCloseAddressSuggestions() {", "function registrationRenderAddressSuggestions(items) {"),
    slice("function registrationRenderAddressSuggestions(items) {", "function registrationSetAddressActiveIndex(nextIndex) {"),
    slice("function registrationSelectAddress(index) {", "async function registrationLoadAddressSuggestions("),
    "globalThis.harness = { render: registrationRenderAddressSuggestions, select: registrationSelectAddress, getSuggestions: () => registrationAddressSuggestions };"
  ].join("\n");
  vm.runInNewContext(code, context, { timeout: 2500 });
  return { elements, harness: context.harness };
}

const wrongPragueAddress = {
  street: "Václavské náměstí 1", city: "Praha", postalCode: "121 32",
  latitude: 50.081, longitude: 14.426
};

const matchingPragueAddress = {
  ...wrongPragueAddress, postalCode: "110 00"
};

test("registration never copies Geoapify's unverified PSČ into an empty field", () => {
  const { elements, harness } = createHarness();
  harness.render([wrongPragueAddress]);
  assert.ok(elements.addressSuggestions.innerHTML.includes("Praha"));
  assert.ok(!elements.addressSuggestions.innerHTML.includes("121 32"));
  harness.select(0);
  assert.equal(elements.street.value, "Václavské náměstí 1");
  assert.equal(elements.city.value, "Praha");
  assert.equal(elements.postalCode.value, "");
  assert.equal(elements.addressSuggestions.hidden, true);
});

test("registration preserves a postcode independently entered by the user", () => {
  const { elements, harness } = createHarness();
  elements.postalCode.value = "110 00";
  harness.render([matchingPragueAddress]);
  harness.select(0);
  assert.equal(elements.postalCode.value, "110 00");
});

test("registration excludes map suggestions with a different postcode if PSČ was entered", () => {
  const { elements, harness } = createHarness();
  elements.postalCode.value = "110 00";
  harness.render([wrongPragueAddress, matchingPragueAddress]);
  assert.equal(harness.getSuggestions().length, 1);
  assert.equal(harness.getSuggestions()[0].postalCode, "110 00");
  harness.select(0);
  assert.equal(elements.postalCode.value, "110 00");
});

test("when no result matches entered postcode, registration refuses to offer a mismatched selection", () => {
  const { elements, harness } = createHarness();
  elements.postalCode.value = "11000";
  harness.render([wrongPragueAddress]);
  assert.equal(harness.getSuggestions().length, 0);
  assert.equal(elements.addressSuggestions.hidden, true);
  assert.equal(elements.postalCode.value, "11000");
});

test("postcode must be entered by the user and the warning is available in all five languages", () => {
  assert.match(html, /id="registrationPostalCodeNote"/);
  assert.match(html, /aria-describedby="registrationError registrationPostalCodeNote"/);
  assert.match(html, /data-i18n="registration.postalCodeNote"/);
  assert.equal((i18n.match(/"registration\.postalCodeNote":/g) || []).length, 5);
  assert.match(source, /registrationIsEmpty\(field\.value\)/);
  assert.doesNotMatch(source, /postalCodeInput\.value\s*=\s*String\(item\.postalCode/);
});
