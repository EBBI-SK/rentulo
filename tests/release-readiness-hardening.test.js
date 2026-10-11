"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const migration = read("supabase/migrations/20261011103000_guard_pickup_and_remove_test_payment.sql");
const edge = read("supabase/functions/confirm-pickup/index.ts");
const pickup = read("js/pickup-security.js");
const detail = read("js/detail-page.js");
const html = read("detail.html");
const checkout = read("supabase/functions/create-checkout-session/index.ts");
const ci = read(".github/workflows/ci.yml");

function isolateFunction(source, name, followingMarker, mocks = {}) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(followingMarker, start);
  assert.ok(start > -1 && end > start, `Function ${name} should exist`);
  const code = source.slice(start, end).trim();
  return vm.runInNewContext(`(${code})`, mocks);
}

test("database rejects early pickup using Europe/Prague local date and time", () => {
  assert.match(migration, /old\.start_date\s*\+\s*old\.pickup_time/);
  assert.match(migration, /now\(\)\s*<\s*\(\(old\.start_date \+ old\.pickup_time\) at time zone 'Europe\/Prague'\)/);
  assert.match(migration, /old\.start_date is null/);
  assert.match(migration, /old\.pickup_time is null/);
  assert.match(migration, /message = 'PICKUP_NOT_STARTED'/);
  assert.match(migration, /old\.status = 'paid'[\s\S]*?new\.status = 'picked_up'[\s\S]*?PICKUP_NOT_STARTED[\s\S]*?return new;/);
  assert.match(migration, /auth\.role\(\) = 'service_role'/);
});

test("early pickup can never initiate Stripe transfer", () => {
  const guard = edge.indexOf('admin.rpc("confirm_reservation_pickup"');
  const payout = edge.indexOf('/functions/v1/create-owner-transfer');
  assert.ok(guard >= 0 && payout > guard);
  assert.match(edge.slice(guard, payout), /pickupResult\.error/);
  assert.match(edge.slice(guard, payout), /message\.includes\("PICKUP_NOT_STARTED"\)/);
  assert.match(edge, /code: "pickup_not_started"/);
  assert.match(edge.slice(guard, payout), /return jsonResponse\(/);
});

test("owner sees a helpful early-pickup message in all five languages", () => {
  assert.equal((pickup.match(/tooEarly: "/g) || []).length, 5);
  assert.match(pickup, /data\.code === "pickup_not_started"/);
  assert.match(pickup, /setOwnerMessage\(text\("tooEarly"\), "error"\)/);
});

test("legacy browser fake-payment shortcut is removed without deleting test bookings", () => {
  assert.match(migration, /drop function if exists public\.mark_my_reservation_paid_test\(uuid\)/i);
  assert.match(migration, /revoke all on table public\.test_payment_users from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /truncate|delete\s+from\s+public\.reservations|delete\s+from\s+public\.test_payment_users/i);
  const latestGuard = migration.slice(migration.indexOf('create or replace function public.protect_reservation_status_transition()'));
  assert.doesNotMatch(latestGuard, /app\.test_payment_authorized|from public\.test_payment_users/i);
  assert.match(latestGuard, /app\.stripe_payment_authorized/);
  assert.match(latestGuard, /app\.paid_cancellation_authorized/);
  assert.match(latestGuard, /OWNER_OVERDUE_CANCELLATION_DEBT/);
});

test("public offer detail visibly displays the daily price while keeping login a requirement", () => {
  const render = isolateFunction(detail, "renderSidebarMessage", "function renderUnavailableSidebar", {
    escapeHtml: (s) => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;"),
    formatDetailNumber: (value) => String(value),
    detailTranslate: (key) => ({ "detail.currencyPerDay": "Kč / den" }[key] || key),
  });
  const panel = render("", "Přihlaste se", "Před rezervací se přihlaste.", "prihlaseni.html", "Přihlásit se", 250);
  assert.match(panel, /<div class="price">250<\/div>/);
  assert.match(panel, /Kč \/ den/);
  assert.match(panel, /Přihlaste se/);
  assert.match(panel, /href="prihlaseni\.html"/);
  assert.match(detail, /if \(!currentUser\)/);
  assert.match(detail, /setupBookingForm\(offer\)/);
});

test("offers without photos show a compact translated label and a recognizable icon", () => {
  const render = isolateFunction(detail, "renderDetailImage", "function isOfferDraft", {
    getOfferName: (offer) => offer.name || "Nabídka",
    getOfferPhoto: (offer) => offer.photo || "",
    escapeHtml: (value) => String(value ?? "").replaceAll("<", "&lt;"),
    detailTranslate: (key) => ({ "offer.noPhoto": "Bez fotky" }[key] || key),
  });
  const missing = render({ name: "Test" });
  assert.match(missing, /image-box no-photo/);
  assert.match(missing, /<svg/);
  assert.match(missing, /Bez fotky/);
  const photo = render({ name: "Vrtačka", photo: "photo.jpg" });
  assert.match(photo, /image-box has-photo/);
  assert.doesNotMatch(photo, /no-photo/);
  assert.match(html, /\.image-box\.no-photo \{\s*height: 150px !important;/);
  const i18n = read("js/i18n.js");
  assert.equal((i18n.match(/"offer\.noPhoto":/g) || []).length, 5);
});

test("Stripe Checkout explicitly uses Czech instead of browser-inferred Slovak", () => {
  assert.match(checkout, /checkoutParams\.set\("mode", "payment"\);\s*checkoutParams\.set\("locale", "cs"\);/);
  assert.match(checkout, /"line_items\[0\]\[price_data\]\[currency\]", "czk"/);
});

test("checkout reuses old unpaid sessions and safely replaces only expired ones", () => {
  assert.match(checkout, /const previousSessionId = String\(payment\.provider_payment_id \|\| ""\)/);
  assert.match(checkout, /previous\.amount_total !== stripeAmountTotalMinor/);
  assert.match(checkout, /previous\.metadata\?\.reservation_id !== reservation\.id/);
  assert.match(checkout, /previous\.metadata\?\.payment_id !== payment\.id/);
  assert.match(checkout, /previous\.status === "open" && previous\.url && previous\.payment_status === "unpaid"/);
  assert.match(checkout, /previous\.status !== "expired"/);
  assert.match(checkout, /rentulo-checkout-\$\{payment\.id\}-after-\$\{previousSessionId\}/);
  assert.match(checkout, /"Idempotency-Key": checkoutIdempotencyKey/);
});

test("CI checks both main and production, executes TEST build and Deno typechecks", () => {
  assert.match(ci, /push:[\s\S]*?branches:\s*- main\s*- production/);
  assert.match(ci, /pull_request:[\s\S]*?branches:\s*- main\s*- production/);
  assert.match(ci, /run: npm test/);
  assert.match(ci, /RENTULO_DEPLOY_TARGET=test npm run build/);
  assert.match(ci, /denoland\/setup-deno@v2/);
  assert.match(ci, /deno check "\$\{functions\[@\]\}"/);
});
