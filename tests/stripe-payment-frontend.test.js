"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const RESERVATIONS_PAGE_PATH = path.join(
  PROJECT_ROOT,
  "js",
  "reservations-page.js"
);

function readReservationsPage() {
  return fs.readFileSync(RESERVATIONS_PAGE_PATH, "utf8");
}

test("reservation payment starts Stripe Checkout for the selected reservation", () => {
  const source = readReservationsPage();

  assert.match(
    source,
    /\.functions\.invoke\(\s*["']create-checkout-session["'][\s\S]*?reservation_id:\s*reservationId/
  );
  assert.match(
    source,
    /const checkoutUrl = data && typeof data\.url === ["']string["'][\s\S]*?data\.url\.trim\(\)/
  );
  assert.match(source, /window\.location\.href\s*=\s*checkoutUrl/);
});

test("reservation payment no longer marks the reservation paid from the browser", () => {
  const source = readReservationsPage();

  assert.doesNotMatch(source, /mark_my_reservation_paid_test/);
  assert.doesNotMatch(
    source,
    /sendReservationEmailSafely\(\s*reservationId\s*,\s*["']paid["']\s*\)/
  );
});

test("Stripe Checkout creation failures do not redirect the renter", () => {
  const source = readReservationsPage();

  assert.match(source, /if \(error\) \{[\s\S]*?reservations\.error\.payment[\s\S]*?return;/);
  assert.match(source, /if \(!checkoutUrl\) \{[\s\S]*?reservations\.error\.payment[\s\S]*?return;/);
});
