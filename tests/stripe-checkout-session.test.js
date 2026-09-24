"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const FUNCTION_PATH = path.join(
  PROJECT_ROOT,
  "supabase",
  "functions",
  "create-checkout-session",
  "index.ts"
);
const SOURCE = fs.readFileSync(FUNCTION_PATH, "utf8");

function compact(source) {
  return source.replace(/\s+/g, " ").trim();
}

const COMPACT_SOURCE = compact(SOURCE);

test("Stripe Checkout authenticates the renter and only accepts approved reservations", () => {
  assert.match(SOURCE, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(SOURCE, /STRIPE_SECRET_KEY/);
  assert.match(SOURCE, /SITE_URL/);
  assert.match(SOURCE, /getUser\(accessToken\)/);
  assert.match(SOURCE, /actor\.id !== reservation\.renter_id/);
  assert.match(SOURCE, /reservation\.status !== "approved"/);
  assert.match(SOURCE, /let payload: \{ reservation_id\?: string \}/);
  assert.doesNotMatch(
    SOURCE,
    /payload\.(?:amount|amount_total|total_price|platform_fee_amount|owner_payout|currency)/i
  );
});

test("Stripe Checkout derives the exact CZK amount from the reservation snapshot", () => {
  assert.match(
    COMPACT_SOURCE,
    /select\( "id, owner_id, renter_id, offer_name, start_date, end_date, total_price, platform_fee_amount, owner_payout, status", \)/
  );
  assert.match(SOURCE, /const totalPrice = Number\(reservation\.total_price\);/);
  assert.match(SOURCE, /const platformFeeAmount = Number\(reservation\.platform_fee_amount\);/);
  assert.match(SOURCE, /const ownerPayout = Number\(reservation\.owner_payout\);/);
  assert.match(SOURCE, /platformFeeAmount \+ ownerPayout !== totalPrice/);
  assert.match(SOURCE, /const stripeAmountTotalMinor = totalPrice \* 100;/);
  assert.match(SOURCE, /"line_items\[0\]\[price_data\]\[currency\]", "czk"/);
  assert.match(SOURCE, /"line_items\[0\]\[price_data\]\[unit_amount\]"/);
  assert.match(SOURCE, /String\(stripeAmountTotalMinor\)/);
});

test("Stripe Checkout creates one backend payment row and keeps transfers deferred", () => {
  assert.match(SOURCE, /\.from\("payments"\)/);
  assert.match(SOURCE, /reservation_id: reservation\.id/);
  assert.match(SOURCE, /payer_id: actor\.id/);
  assert.match(SOURCE, /owner_id: reservation\.owner_id/);
  assert.match(SOURCE, /amount_total: totalPrice/);
  assert.match(SOURCE, /platform_fee_amount: platformFeeAmount/);
  assert.match(SOURCE, /owner_payout: ownerPayout/);
  assert.match(SOURCE, /provider: "stripe"/);
  assert.match(SOURCE, /status: "pending"/);
  assert.match(SOURCE, /currency: "czk"/);
  assert.match(SOURCE, /stripe_amount_total_minor: stripeAmountTotalMinor/);
  assert.match(SOURCE, /insertResult\.error\.code !== "23505"/);
  assert.doesNotMatch(SOURCE, /application_fee_amount/i);
  assert.doesNotMatch(SOURCE, /transfer_data\[/i);
  assert.match(SOURCE, /"payment_intent_data\[transfer_group\]"/);
});

test("Stripe Checkout correlates Checkout and PaymentIntent objects with internal IDs", () => {
  assert.match(SOURCE, /"metadata\[reservation_id\]", reservation\.id/);
  assert.match(SOURCE, /"metadata\[payment_id\]", payment\.id/);
  assert.match(SOURCE, /"payment_intent_data\[metadata\]\[reservation_id\]", reservation\.id/);
  assert.match(SOURCE, /"payment_intent_data\[metadata\]\[payment_id\]", payment\.id/);
  assert.match(SOURCE, /"Idempotency-Key": `rentulo-checkout-\$\{payment\.id\}`/);
  assert.match(SOURCE, /provider_payment_id: checkoutSession\.id/);
  assert.match(SOURCE, /paymentUpdate\.stripe_payment_intent_id = intentId/);
});

test("Stripe Checkout returns only the hosted Checkout URL and does not mark the reservation paid", () => {
  assert.match(SOURCE, /return jsonResponse\(\{ url: checkoutSession\.url \}\);/);
  assert.match(SOURCE, /moje-rezervace\.html\?payment=success/);
  assert.match(SOURCE, /moje-rezervace\.html\?payment=cancelled/);
  assert.doesNotMatch(SOURCE, /\.from\("reservations"\)\s*\.update\(/);
  assert.doesNotMatch(SOURCE, /status:\s*"paid"/);
  assert.doesNotMatch(SOURCE, /contact_visible\s*:/);
});
