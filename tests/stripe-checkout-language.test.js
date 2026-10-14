"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const modulePath = pathToFileURL(path.join(root, "supabase/functions/_shared/stripe-checkout-language.mjs")).href;
const reservationBackend = read("supabase/functions/create-checkout-session/index.ts");
const debtBackend = read("supabase/functions/create-owner-debt-checkout/index.ts");
const reservationFrontend = read("js/reservations-page.js");
const debtFrontend = read("js/offers-page.js");
const migration = read("supabase/migrations/20261014110000_pin_stripe_checkout_locale.sql");

const cases = [
  ["cs", "Rentulo – Úhrada nákladů storna"],
  ["sk", "Rentulo – Úhrada nákladov storna"],
  ["en", "Rentulo – Payment of cancellation costs"],
  ["de", "Rentulo – Zahlung der Stornokosten"],
  ["pl", "Rentulo – Opłata za koszty anulowania"],
];

test("all five Rentulo languages map to real supported Stripe locales and translated debt titles", async () => {
  const api = await import(modulePath);
  assert.deepEqual(api.RENTULO_STRIPE_LOCALES, cases.map(([language]) => language));
  for (const [language, title] of cases) {
    assert.equal(api.normalizeStripeCheckoutLocale(language), language);
    assert.equal(api.ownerDebtCheckoutProductName(language), title);
  }
});

test("invalid, empty, encoded and forged locales fall back to Czech", async () => {
  const api = await import(modulePath);
  for (const value of [null, undefined, {}, [], 42, "", "sk-SK", "AUTO", "auto", "fr", "cs,sk", "__proto__"]) {
    assert.equal(api.normalizeStripeCheckoutLocale(value), "cs");
    assert.equal(api.ownerDebtCheckoutProductName(value), cases[0][1]);
  }
  assert.equal(api.LEGACY_OWNER_DEBT_PRODUCT_NAME, "Rentulo - uhrada nakladu storna");
});

test("both browser flows send the current Rentulo language but not any monetary fields", () => {
  assert.match(reservationFrontend, /"create-checkout-session"[\s\S]*?reservation_id: reservationId,\s*locale: typeof window\.getRentuloLanguage/);
  assert.match(debtFrontend, /"create-owner-debt-checkout"[\s\S]*?debt_id: debtId,\s*locale: typeof window\.getRentuloLanguage/);
  assert.doesNotMatch(reservationFrontend, /reservation_id: reservationId,\s*(?:amount|currency|price):/);
  assert.doesNotMatch(debtFrontend, /debt_id: debtId,\s*(?:amount|currency|price):/);
});

test("database restricts stored locale to the allowlist and preserves old request parameters", () => {
  assert.match(migration, /alter table public\.payments[\s\S]*?add column if not exists stripe_checkout_locale text/i);
  assert.match(migration, /payments_stripe_checkout_locale_check[\s\S]*?'cs', 'sk', 'en', 'de', 'pl'/i);
  assert.match(migration, /update public\.payments\s+set stripe_checkout_locale = 'cs'\s+where status = 'pending' and stripe_checkout_locale is null/i);
  assert.match(migration, /owner_cancellation_debts_stripe_checkout_locale_check[\s\S]*?'cs', 'sk', 'en', 'de', 'pl', 'legacy'/i);
  assert.match(migration, /update public\.owner_cancellation_debts\s+set stripe_checkout_locale = 'legacy'\s+where stripe_checkout_locale is null/i);
  assert.doesNotMatch(migration, /grant.*to authenticated/gi);
});

test("reservation pins locale atomically before checkout claim and all Stripe POSTs", () => {
  assert.match(reservationBackend, /normalizeStripeCheckoutLocale\(payload\.locale\)/);
  assert.match(reservationBackend, /\.update\(\{ stripe_checkout_locale: requestedLocale \}\)[\s\S]*?\.eq\("payer_id", actor\.id\)[\s\S]*?\.eq\("status", "pending"\)[\s\S]*?\.is\("stripe_checkout_locale", null\)/);
  assert.match(reservationBackend, /existingLocale\.data\.stripe_checkout_locale/);
  assert.ok(reservationBackend.indexOf('const localePin = await admin') < reservationBackend.indexOf('"mark_reservation_checkout_started"'));
  assert.match(reservationBackend, /checkoutParams\.set\("locale", checkoutLocale\)/);
  assert.match(reservationBackend, /let checkoutIdempotencyKey = `rentulo-checkout-\$\{payment\.id\}`/);
  assert.match(reservationBackend, /previous\.status === "open" && previous\.url && previous\.payment_status === "unpaid"/);
});

test("owner debt locale is pinned, legacy sessions are untouched, and existing open sessions are reused", () => {
  assert.match(debtBackend, /normalizeStripeCheckoutLocale\(payload\.locale\)/);
  assert.match(debtBackend, /\.update\(\{ stripe_checkout_locale: requestedLocale \}\)[\s\S]*?\.eq\("owner_id", actor\.id\)[\s\S]*?\.eq\("status", "open"\)[\s\S]*?\.is\("stripe_checkout_locale", null\)/);
  assert.match(debtBackend, /if \(checkoutLocale !== "legacy"\) \{\s*checkoutParams\.set\("locale", checkoutLocale\)/);
  assert.match(debtBackend, /checkoutLocale === "legacy"\s*\? LEGACY_OWNER_DEBT_PRODUCT_NAME/);
  assert.match(debtBackend, /previous\.amount_total !== amountMinor/);
  assert.match(debtBackend, /previous\.metadata\?\.owner_cancellation_debt_id !== debt\.id/);
  assert.match(debtBackend, /previous\.status === "open" && previous\.url && previous\.payment_status === "unpaid"/);
  assert.match(debtBackend, /previous\.status !== "expired"/);
  assert.match(debtBackend, /rentulo-owner-debt-checkout-\$\{debt\.id\}-after-\$\{previousSessionId\}/);
  assert.match(debtBackend, /"Idempotency-Key": checkoutIdempotencyKey/);
  assert.ok(debtBackend.indexOf('const localePin = await admin') < debtBackend.indexOf('const previousResponse = await fetch('));
});
