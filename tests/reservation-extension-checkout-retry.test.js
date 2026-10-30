"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const sql = read("supabase/migrations/20261030150000_extension_checkout_retry_TEST.sql");
const checkout = read("supabase/functions/create-extension-checkout/index.ts");
const worker = read("supabase/functions/retry-owner-transfers/index.ts");
const page = read("js/reservations-page.js");
const ui = read("js/reservation-extension-ui.js");
const helpers = import("../supabase/functions/_shared/extension-checkout-recovery.mjs");

const id = "01234567-89ab-4def-8abc-0123456789ab";
const reservation = "12345678-abcd-4eaf-8abc-0123456789ab";
const expected = { sessionId: "cs_test_A1", amountMinor: 15000,
  extensionId: id, reservationId: reservation };
const unpaid = {
  id: expected.sessionId, mode: "payment", currency: "czk", amount_total: expected.amountMinor,
  client_reference_id: id, status: "open", payment_status: "unpaid",
  url: "https://checkout.stripe.com/c/pay/cs_test_A1",
  metadata: { payment_kind: "reservation_extension", extension_id: id, reservation_id: reservation },
};

test("open Checkout is reused; only same verified expired/unpaid Session can rotate", async () => {
  const { classifyExtensionCheckoutSession: classify } = await helpers;
  assert.equal(classify(unpaid, expected), "reuse");
  assert.equal(classify({ ...unpaid, status: "expired", url: null }, expected), "verified_expired");
  assert.equal(classify({ ...unpaid, status: "expired", payment_status: "paid" }, expected), "processing");
  assert.equal(classify({ ...unpaid, status: "complete", payment_status: "paid" }, expected), "processing");
  assert.equal(classify({ ...unpaid, status: "open", payment_status: "unpaid", url: "http://evil.example" }, expected), "processing");
  assert.equal(classify({ ...unpaid, amount_total: 15100, status: "expired" }, expected), "invalid");
  assert.equal(classify({ ...unpaid, metadata: { ...unpaid.metadata, reservation_id: id }, status: "expired" }, expected), "invalid");
  assert.equal(classify({ ...unpaid, id: "cs_test_other", status: "expired" }, expected), "invalid");
});

test("ambiguous Stripe creation errors never permit idempotency rotation", async () => {
  const { isDefiniteCheckoutCreationRejection: definite } = await helpers;
  assert.equal(definite(400, { type: "invalid_request_error" }), true);
  assert.equal(definite(400, { type: "invalid_request_error", code: "idempotency_key_in_use" }), false);
  assert.equal(definite(400, { type: "idempotency_error" }), false);
  assert.equal(definite(409, { type: "invalid_request_error" }), false);
  assert.equal(definite(429, { type: "invalid_request_error" }), false);
  assert.equal(definite(500, { type: "api_error" }), false);
  assert.equal(definite(502, null), false);
});

test("migration guards TEST and serializes attempt preparation/record/reconciliation", () => {
  assert.match(sql, /rentulo_project_url[\s\S]*?vspposovhdgvbeukoivh\.supabase\.co/);
  assert.match(sql, /create table public\.reservation_extension_checkout_attempts/);
  assert.match(sql, /create unique index reservation_extension_one_active_checkout_attempt[\s\S]*?where state in \('creating','created'\)/);
  assert.match(sql, /alter table public\.reservation_extension_checkout_attempts enable row level security/);
  assert.match(sql, /revoke all on public\.reservation_extension_checkout_attempts from public, anon, authenticated/);
  assert.match(sql, /prepare_reservation_extension_checkout_attempt[\s\S]*?for update/);
  assert.match(sql, /v_expiry := least\(v_e\.payment_deadline_at,clock_timestamp\(\)\+interval '23 hours'\)/);
  assert.match(sql, /record_reservation_extension_checkout_attempt[\s\S]*?v_a\.checkout_expires_at<>p_expires_at/);
  assert.match(sql, /record_reservation_extension_checkout_attempt[\s\S]*?update public\.reservation_extension_checkout_attempts[\s\S]*?update public\.reservation_extensions/);
  assert.match(sql, /fail_reservation_extension_checkout_attempt[\s\S]*?v_a\.state<>'creating'/);
  assert.match(sql, /expire_reservation_extension_checkout[\s\S]*?v_e\.stripe_checkout_session_id<>p_session_id/);
  assert.match(sql, /v_e\.payment_deadline_at>clock_timestamp\(\)\+interval '31 minutes'/);
  assert.match(sql, /set checkout_started_at=null,stripe_checkout_session_id=null,[\s\S]*?stripe_checkout_expires_at=null/);
  assert.match(sql, /set status='expired'/);
  assert.doesNotMatch(sql, /update\s+public\.payments|drop table|drop trigger/i);
});

test("Stripe POST uses persisted immutable attempt parameters and stores before redirect", () => {
  assert.match(checkout, /Extension checkout is TEST-only/);
  assert.match(checkout, /prepare_reservation_extension_checkout_attempt/);
  assert.match(checkout, /attempt\.checkout_expires_at/);
  assert.match(checkout, /attempt\.offer_name/);
  assert.match(checkout, /attempt\.customer_email/);
  assert.match(checkout, /Idempotency-Key": `rentulo-extension-checkout-\$\{attempt\.attempt_id\}`/);
  assert.match(checkout, /payment_intent_data\[metadata\]\[extension_id\]/);
  assert.match(checkout, /record_reservation_extension_checkout_attempt/);
  assert.match(checkout, /if \(record\.error \|\| record\.data !== true\)/);
  assert.match(checkout, /return json\(\{ url: session\.url \}\)/);
  assert.match(checkout, /isDefiniteCheckoutCreationRejection/);
  assert.match(checkout, /fail_reservation_extension_checkout_attempt/);
  assert.match(checkout, /classifyExtensionCheckoutSession/);
});

test("worker reconciles only verified unpaid expiry and protects Stripe Connect flow", () => {
  assert.match(worker, /session\.status !== "expired" \|\| session\.payment_status !== "unpaid"/);
  assert.match(worker, /expire_reservation_extension_checkout/);
  assert.match(worker, /checkoutSummary\.reconciled/);
  assert.match(worker, /get_due_reservation_extension_transfers/);
  assert.match(worker, /create-extension-transfer/);
  assert.match(worker, /supabaseUrl !== "https:\/\/vspposovhdgvbeukoivh\.supabase\.co"/);
});

test("renter sees distinct localized busy/retry/deadline notices", () => {
  assert.match(page, /error\.context\.json\(\)/);
  assert.match(page, /code === "checkout_busy" \? "paymentBusy"/);
  assert.match(page, /code === "checkout_retry" \? "checkoutRetry"/);
  assert.match(page, /code === "payment_deadline" \? "deadlineElapsed"/);
  assert.match(page, /data-reservations-action="pay-extension"/);
  assert.equal((ui.match(/checkoutRetry:/g) || []).length, 5);
  assert.equal((ui.match(/deadlineElapsed:/g) || []).length, 5);
});
