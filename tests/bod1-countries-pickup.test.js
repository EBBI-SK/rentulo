"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(read("js/country-address.js"), ctx);
const countries = ctx.window.rentuloCountries;

test("residence offers a broad country list; pickup market remains independent", () => {
  for (const code of ["CZ", "SK", "PL", "AT", "DE", "HU", "US", "GB", "UA", "XK"]) {
    assert.equal(countries.validCountry(code), code);
  }
  assert.equal(countries.validCountry("XX"), "");
  assert.equal(countries.validCountry(""), "");
  assert.match(read("registrace.html"), /id="countryCode"/);
  assert.match(read("nastaveni.html"), /id="profileCountryCode"/);
  assert.match(read("nabidnout.html"), /data-i18n="offer.pickupCountryShort"/);
  assert.match(read("edit-nabidka.html"), /data-i18n="offer.pickupCountryNote"/);
  for (const html of ["nabidnout.html", "edit-nabidka.html"]) {
    assert.doesNotMatch(read(html), /id="pickupCountryCode"/);
  }
});

test("residence postal code validation follows selected country", () => {
  const examples = [
    ["CZ", "11000", "110 00"], ["SK", "91701", "917 01"],
    ["PL", "30-001", "30-001"], ["DE", "10115", "10115"],
    ["AT", "1010", "1010"], ["HU", "1051", "1051"],
    ["GB", "SW1A 1AA", "SW1A 1AA"], ["US", "10001", "10001"],
    ["AE", "", ""]
  ];
  for (const [country, raw, expected] of examples) {
    assert.equal(countries.normalizePostal(country, raw), expected);
  }
  assert.equal(countries.normalizePostal("PL", "110 00"), "11-000");
  assert.equal(countries.normalizePostal("DE", "110 00"), null);
  assert.equal(countries.normalizePostal("SK", ""), null);
  assert.equal(countries.normalizePostal("CZ", "91701"), "917 01"); // Format is not a country test.
});

test("signup and settings persist residence, offers persist CZ pickup and CZK", () => {
  assert.match(read("js/registration-page.js"), /country_code: countryCode/);
  assert.match(read("js/settings-page.js"), /country_code: countryCode/);
  for (const page of ["js/offer-form-page.js", "js/edit-offer.js"]) {
    const source = read(page);
    assert.match(source, /pickup_country_code: pickupAddress.countryCode/);
    assert.match(source, /currency_code: "CZK"/);
    assert.match(source, /countryCode: "CZ"/);
    assert.match(source, /offer.profilePickupOutsideCz/);
    assert.match(source, /PICKUP_GEOCODING_UNAVAILABLE/);
  }
  for (const key of ["country.choose", "country.residenceLabel", "country.required",
    "country.invalidPostalCode", "offer.pickupCountryNote", "offer.profilePickupOutsideCz", "offer.pickupOutsideCz",
    "offer.pickupCountryShort", "offer.pickupEnterCzAddress"]) {
    assert.equal((read("js/i18n.js").match(new RegExp('"' + key.replace(/\./g, "\\.") + '":', "g")) || []).length, 5);
  }
});

test("market migration refuses PROD, preserves old unknown residence and blocks non-CZ active pickups", () => {
  const migration = read("supabase/migrations/20261029120000_bod1_country_ready_pickup_market.sql");
  assert.match(migration, /rentulo_project_url/);
  assert.match(migration, /TEST-only/);
  assert.match(migration, /country_code text/);
  assert.match(migration, /pickup_country_code text not null default 'CZ'/);
  assert.match(migration, /currency_code text not null default 'CZK'/);
  assert.match(migration, /offers_czech_market_only_check/);
  assert.match(migration, /not valid;/);
  assert.match(migration, /guard_offer_profile_pickup_country/);
  assert.match(migration, /scrub_deactivated_residence_country/);
  assert.doesNotMatch(migration, /alter table public\.(payments|reservations)/i);
  assert.doesNotMatch(migration, /update public\.offers/i);
});

test("create offer pickup selector uses profile only for a complete Czech address", async () => {
  const html = read("nabidnout.html");
  assert.match(html, /id="pickupProfileAddressNotice" data-i18n="offer.pickupEnterCzAddress" hidden/);
  assert.match(html, /id="pickupCustomToggle" hidden/);
  assert.match(html, /class="pickup-country-label"/);
  assert.match(html, /data-i18n="offer.pickupCountryShort"/);
  assert.doesNotMatch(html, /data-i18n="offer.pickupDescription"/);
  assert.doesNotMatch(html, /data-i18n="offer.pickupCountryNote"/);
  assert.match(html, /\.pickup-options-body\s*>\s*\[hidden\]\s*\{\s*display:\s*none\s*!important/);

  const source = read("js/offer-form-page.js");
  const start = source.indexOf("async function fillProfileAddressAsDefault(");
  const end = source.indexOf("function parseMoneyValue(", start);
  assert.ok(start >= 0 && end > start);
  assert.match(source, /function refreshOfferDynamicTranslations\(\)\s*\{\s*renderProfilePickupAddress\(\)/);

  async function setup(profile, error = null) {
    const classes = new Set();
    const elements = {
      profilePickupSummary: { hidden: true },
      profilePickupAddress: { textContent: "" },
      pickupUseCustom: { checked: false },
      pickupCustomToggle: { hidden: true },
      pickupCustomFields: {
        classList: {
          toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }
        }
      },
      pickupProfileAddressNotice: {
        hidden: true, textContent: "", attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; }
      }
    };
    const context = vm.createContext({
      offerOwnerProfile: { phone: "", street: "", city: "", postalCode: "", countryCode: "" },
      document: { getElementById: id => elements[id] || null },
      formatRentuloCzechPostalCode(value) {
        const match = String(value || "").trim().match(/^(\d{3}) ?(\d{2})$/);
        return match ? match[1] + " " + match[2] : null;
      },
      offerTranslate(key, fallback) { return `[${key}] ${fallback}`; },
      getSupabaseClient() {
        return { from() { return { select() { return { eq() { return { async maybeSingle() {
          return { data: profile, error };
        } }; } }; } }; } };
      }
    });
    vm.runInContext(source.slice(start, end), context);
    await context.fillProfileAddressAsDefault({ id: "test-user" });
    return { elements, classes, context };
  }

  const cz = await setup({ street: "Zahradnická 5", city: "Brno", postal_code: "602 00", country_code: "CZ" });
  assert.equal(cz.elements.pickupUseCustom.checked, false);
  assert.equal(cz.elements.pickupCustomToggle.hidden, false);
  assert.equal(cz.elements.pickupCustomFields.classList !== null && cz.classes.has("is-visible"), false);
  assert.equal(cz.elements.profilePickupSummary.hidden, false);
  assert.equal(cz.elements.pickupProfileAddressNotice.hidden, true);
  cz.elements.pickupUseCustom.checked = true;
  cz.context.renderProfilePickupAddress();
  assert.equal(cz.classes.has("is-visible"), true);
  assert.equal(cz.elements.profilePickupSummary.hidden, true);
  assert.equal(cz.elements.pickupProfileAddressNotice.hidden, false);
  cz.elements.pickupUseCustom.checked = false;
  cz.context.renderProfilePickupAddress();
  assert.equal(cz.classes.has("is-visible"), false);
  assert.equal(cz.elements.pickupProfileAddressNotice.hidden, true);

  for (const [label, profile] of [
    ["foreign", { street: "Hlboká 24", city: "Trnava", postal_code: "917 01", country_code: "SK" }],
    ["legacy", { street: "Kvetná 1", city: "Trnava", postal_code: "917 01", country_code: null }],
    ["incomplete", { street: "", city: "Praha", postal_code: "110 00", country_code: "CZ" }],
    ["invalid postcode", { street: "Ulice 1", city: "Praha", postal_code: "1100", country_code: "CZ" }]
  ]) {
    const result = await setup(profile);
    assert.equal(result.elements.pickupCustomToggle.hidden, true, `${label} toggle hidden`);
    assert.equal(result.elements.pickupUseCustom.checked, true, `${label} custom mode`);
    assert.equal(result.classes.has("is-visible"), true, `${label} fields visible`);
    assert.equal(result.elements.profilePickupSummary.hidden, true, `${label} profile hidden`);
    assert.equal(result.elements.pickupProfileAddressNotice.hidden, false, `${label} simple instruction visible`);
  }

  const failedLoad = await setup(null, new Error("network"));
  assert.equal(failedLoad.elements.pickupCustomToggle.hidden, true);
  assert.equal(failedLoad.classes.has("is-visible"), true);
});
