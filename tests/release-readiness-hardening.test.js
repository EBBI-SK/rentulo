"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const migration = read("supabase/migrations/20261011103000_guard_pickup_and_remove_test_payment.sql");
const pickupDayMigration = read("supabase/migrations/20261011170000_limit_pickup_pin_to_pickup_day.sql");
const lookup = read("supabase/functions/resolve-pickup-pin/index.ts");
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

test("database authorizes PIN pickup only on the scheduled Europe/Prague date", () => {
  const pickupStart = pickupDayMigration.indexOf("-- Trusted pickup PIN confirmation");
  const pickupEnd = pickupDayMigration.indexOf("-- Trusted paid cancellation", pickupStart);
  assert.ok(pickupStart >= 0 && pickupEnd > pickupStart);
  const guard = pickupDayMigration.slice(pickupStart, pickupEnd);
  assert.match(guard, /auth\.role\(\) = 'service_role'/);
  assert.match(guard, /old\.status = 'paid'[\s\S]*?new\.status = 'picked_up'/);
  assert.match(guard, /old\.start_date is distinct from \(now\(\) at time zone 'Europe\/Prague'\)::date/);
  assert.match(guard, /message = 'PICKUP_WRONG_DAY'/);
  assert.match(guard, /return new;/);
  assert.doesNotMatch(guard, /old\.pickup_time|old\.end_date|PICKUP_NOT_STARTED/);
  assert.doesNotMatch(pickupDayMigration, /truncate|delete\s+from\s+public\.reservations/i);

  // All non-pickup transition rules must remain byte-for-byte identical.
  const marker = "-- Trusted paid cancellation";
  const afterPickup = (sql) => sql.slice(sql.indexOf(marker), sql.lastIndexOf("$function$;"));
  assert.equal(afterPickup(pickupDayMigration), afterPickup(migration));
});

test("Prague calendar-day boundaries work across midnight, winter and DST changes", () => {
  const start = lookup.indexOf("function pickupDateInPrague(");
  const end = lookup.indexOf("function firstRow", start);
  assert.ok(start >= 0 && end > start);
  const js = lookup.slice(start, end).trim()
    .replace("at: Date", "at")
    .replace("): string", ")");
  const toDate = vm.runInNewContext(`(${js})`, { Intl });
  for (const [utc, expectedDay] of [
    ["2026-10-19T21:59:59.999Z", "2026-10-19"],
    ["2026-10-19T22:00:00.000Z", "2026-10-20"],
    ["2026-10-20T21:59:59.999Z", "2026-10-20"],
    ["2026-10-20T22:00:00.000Z", "2026-10-21"],
    ["2026-12-31T22:59:59.999Z", "2026-12-31"],
    ["2026-12-31T23:00:00.000Z", "2027-01-01"],
    ["2026-03-28T23:00:00.000Z", "2026-03-29"],
    ["2026-03-29T21:59:59.999Z", "2026-03-29"],
    ["2026-03-29T22:00:00.000Z", "2026-03-30"],
    ["2026-10-24T22:00:00.000Z", "2026-10-25"],
    ["2026-10-25T22:59:59.999Z", "2026-10-25"],
    ["2026-10-25T23:00:00.000Z", "2026-10-26"],
  ]) {
    assert.equal(toDate(new Date(utc)), expectedDay, utc);
  }
});

test("owner lookup verifies only paid reservations scheduled for the current Prague day", () => {
  assert.match(lookup, /\.eq\("owner_id", actor\.id\)/);
  assert.match(lookup, /\.eq\("status", "paid"\)/);
  assert.match(lookup, /\.select\("id, renter_id, owner_id, status, start_date"\)/);
  assert.match(lookup, /const pickupDay = pickupDateInPrague\(new Date\(\)\)/);
  assert.match(lookup, /reservation\.start_date === pickupDay/);
  assert.match(lookup, /if \(matchedOutsidePickupDay\) \{[\s\S]*?code: "pickup_wrong_day"/);
  assert.ok(
    lookup.indexOf("if (matchedOutsidePickupDay)") < lookup.indexOf('admin.rpc("register_failed_owner_pickup_pin"'),
    "A correct PIN entered on the wrong day must not consume invalid PIN attempts"
  );
  assert.match(lookup, /reservation_id: matches\[0\], status: "verified"/);
});

test("wrong-day pickup cannot initiate a Stripe transfer, even through a direct RPC call", () => {
  const guard = edge.indexOf('admin.rpc("confirm_reservation_pickup"');
  const payout = edge.indexOf('/functions/v1/create-owner-transfer');
  assert.ok(guard >= 0 && payout > guard);
  assert.match(edge.slice(guard, payout), /pickupResult\.error/);
  assert.match(edge.slice(guard, payout), /message\.includes\("PICKUP_WRONG_DAY"\)/);
  assert.match(edge.slice(guard, payout), /code: "pickup_wrong_day"/);
  assert.match(edge.slice(guard, payout), /return jsonResponse\(/);
  assert.match(pickupDayMigration, /app\.pickup_pin_authorized/);
});

test("owner sees a helpful wrong-day PIN message in all five languages", () => {
  assert.equal((pickup.match(/wrongDay: "/g) || []).length, 5);
  assert.match(pickup, /data\.code === "pickup_wrong_day"/);
  assert.match(pickup, /elements\.feedback\.textContent = text\("wrongDay"\)/);
  assert.match(pickup, /setOwnerMessage\(text\("wrongDay"\), "error"\)/);
  assert.match(pickup, /wrongDay: "PIN lze pou/);
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
