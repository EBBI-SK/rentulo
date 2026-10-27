"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const utils = read("js/utils.js");
const script = utils.slice(utils.indexOf("function formatRentuloCzechPostalCode("));
const ctx = vm.createContext({});
vm.runInContext(script, ctx);
const normalize = ctx.formatRentuloCzechPostalCode;

test("shared Czech postcode check accepts five digits or canonical spaced form", () => {
  for (const value of ["11000", "110 00", " 110 00 ", "60200", "602 00"]) {
    assert.equal(normalize(value), value.startsWith("602") ? "602 00" : "110 00", value);
  }
});

test("shared Czech postcode check rejects missing, foreign, partial and malformed values", () => {
  for (const value of ["", "110", "11 000", "110 0", "110-00", "110 000", "1234a", "30-001", null, undefined, "123 4a", "12345extra"]) {
    assert.equal(normalize(value), null, String(value));
  }
});

test("registration uses manual address and validates PSČ before Supabase signup", () => {
  const page = read("js/registration-page.js");
  const html = read("registrace.html");
  assert.match(page, /const normalizedPostalCode = formatRentuloCzechPostalCode\(postalCodeInput.value\)/);
  assert.ok(page.indexOf("const normalizedPostalCode =") < page.indexOf("auth.signUp("));
  assert.match(page, /postalCodeInput.value = normalizedPostalCode/);
  assert.doesNotMatch(page, /address-suggestions|RÚIAN|registrationLoadAddressSuggestions|AddressAutocomplete/);
  assert.doesNotMatch(html, /address-suggestions|aria-autocomplete|role="combobox"|RÚIAN/);
  assert.match(html, /id="postalCode"[\s\S]*?inputmode="numeric"[\s\S]*?maxlength="6"/);
});

test("all four V1 address forms use three manual fields and shared Czech PSČ format", () => {
  const config = [
    ["registrace.html", ["street", "city", "postalCode"]],
    ["nabidnout.html", ["pickupStreet", "pickupCity", "pickupPostalCode"]],
    ["edit-nabidka.html", ["edit-pickup-street", "edit-city", "edit-postal-code"]],
    ["nastaveni.html", ["profileStreet", "profileCity", "profilePostalCode"]]
  ];
  for (const [file, ids] of config) {
    const html = read(file);
    for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `${file}: ${id}`);
    assert.doesNotMatch(html, /aria-autocomplete|address-suggestions|role="combobox"/);
  }
  for (const file of ["js/registration-page.js", "js/offer-form-page.js", "js/edit-offer.js", "js/settings-page.js"]) {
    assert.match(read(file), /formatRentuloCzechPostalCode\(/, file);
  }
});

test("manual postal-code validation text is present in all five supported languages", () => {
  const i18n = read("js/i18n.js");
  assert.equal((i18n.match(/"address\.invalidPostalCode":/g) || []).length, 5);
  assert.doesNotMatch(i18n, /"registration\.postalCodeNote"/);
});
