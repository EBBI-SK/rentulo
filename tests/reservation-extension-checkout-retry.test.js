"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const sql = read("supabase/migrations/20261030150000_extension_checkout_retry_TEST.sql");
const recoverySql = read("supabase/migrations/20261030153000_extension_checkout_missing_session_recovery_TEST.sql");
const helperSource = read("supabase/functions/_shared/extension-checkout-recovery.mjs");
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
  assert.match(checkout, /resolveExtensionStripeEnvironment/);
  assert.match(checkout, /prepare_reservation_extension_checkout_attempt/);
  assert.match(checkout, /attempt\.checkout_expires_at/);
  assert.match(checkout, /attempt\.offer_name/);
  assert.match(checkout, /attempt\.customer_email/);
  assert.match(checkout, /"Idempotency-Key": extensionCheckoutIdempotencyKey\(attempt\.attempt_id\)/);
  assert.match(checkout, /buildExtensionCheckoutParams/);
  assert.match(helperSource, /payment_intent_data\[metadata\]\[extension_id\]/);
  assert.match(helperSource, /metadata\[checkout_attempt_id\]/);
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
  assert.match(worker, /resolveExtensionStripeEnvironment/);
  assert.match(worker, /checkoutSessionIdMatchesMode/);
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


const attemptId = "abcdef01-2345-4cde-8abc-abcdef012345";
const created = 1793360000;
const expiry = created + 23 * 3600;
const recoveryExpected = {
  ...expected, attemptId, expiresAtUnix: expiry, createdAfterUnix: created - 2,
};
const recoveredSession = {
  ...unpaid, metadata: { ...unpaid.metadata, checkout_attempt_id: attemptId },
  livemode: false, created: created + 120, expires_at: expiry,
};

function mockStripePages(pages) {
  let cursor = 0;
  const requests = [];
  const requester = async (url, options) => {
    requests.push({ url, authorization: options.headers.Authorization });
    const page = pages[cursor++];
    if (page instanceof Error) throw page;
    if (typeof page === "number") return new Response("server error", { status: page });
    return Response.json(page);
  };
  return { requester, requests };
}

test("one immutable POST body and idempotency key are shared by renter and recovery", async () => {
  const { buildExtensionCheckoutParams: build, extensionCheckoutIdempotencyKey: key } = await helpers;
  const args = {
    attemptId, checkoutExpiresAt: new Date(expiry * 1000).toISOString(),
    locale: "cs", offerName: "Vrtačka", customerEmail: "buyer@example.test",
    siteUrl: "https://rentulo.eu", extensionId: id, reservationId: reservation,
    previousEndDate: "2026-10-30", newEndDate: "2026-10-31", amountMinor: 15000,
  };
  const params1 = build(args);
  const params2 = build({ ...args });
  assert.equal(params1.toString(), params2.toString());
  assert.equal(params1.get("metadata[checkout_attempt_id]"), attemptId);
  assert.equal(params1.get("payment_intent_data[metadata][checkout_attempt_id]"), attemptId);
  assert.equal(params1.get("expires_at"), String(expiry));
  assert.equal(params1.get("line_items[0][price_data][unit_amount]"), "15000");
  assert.equal(key(attemptId), key(attemptId));
  assert.notEqual(key(attemptId), key(id));
});

test("idempotency key is never replayed after its safe age or close to expiry", async () => {
  const { mayRetrySameCheckoutAttempt: retry } = await helpers;
  const first = created * 1000;
  const deadline = expiry * 1000;
  assert.equal(retry(first, deadline, first + 5 * 60 * 1000), true);
  assert.equal(retry(first, deadline, first + 21 * 3600 * 1000), true);
  assert.equal(retry(first, deadline, first + 22 * 3600 * 1000), false);
  assert.equal(retry(first, deadline, deadline - 30 * 60 * 1000), false);
  assert.equal(retry(first, deadline, first - 1000), false);
});

test("Stripe evidence requires exact attempt, amount, expiry, dates and TEST account", async () => {
  const { classifyRecoveredCheckoutSession: classify } = await helpers;
  assert.equal(classify(recoveredSession, recoveryExpected), "reuse");
  assert.equal(classify({ ...recoveredSession, status: "expired", payment_status: "unpaid" }, recoveryExpected), "verified_expired");
  assert.equal(classify({ ...recoveredSession, status: "complete", payment_status: "paid" }, recoveryExpected), "processing");
  assert.equal(classify({ ...recoveredSession, status: "complete", payment_status: "unpaid" }, recoveryExpected), "processing");
  assert.equal(classify({ ...recoveredSession, livemode: true }, recoveryExpected), "invalid");
  assert.equal(classify({ ...recoveredSession, amount_total: 9999 }, recoveryExpected), "invalid");
  assert.equal(classify({ ...recoveredSession, expires_at: expiry + 1 }, recoveryExpected), "invalid");
  assert.equal(classify({ ...recoveredSession, created: created - 600 }, recoveryExpected), "invalid");
  assert.equal(classify({ ...recoveredSession, metadata: { ...recoveredSession.metadata, checkout_attempt_id: id } }, recoveryExpected), "invalid");
  assert.equal(classify({ ...recoveredSession, status: "open", url: null }, recoveryExpected), "invalid");
});

test("read-only Stripe search recovers exactly one unpaid expired session across pages", async () => {
  const { findRecoveredCheckoutSession: find } = await helpers;
  const expired = { ...recoveredSession, status: "expired", url: null };
  const fake = mockStripePages([
    { data: [{ ...recoveredSession, id: "cs_test_unrelated", metadata: { ...recoveredSession.metadata, checkout_attempt_id: id } }], has_more: true },
    { data: [expired], has_more: false },
  ]);
  const result = await find("sk_test_dummy", recoveryExpected, fake.requester);
  assert.equal(result.status, "matched");
  assert.equal(result.state, "verified_expired");
  assert.equal(result.session.id, recoveredSession.id);
  assert.equal(fake.requests.length, 2);
  assert.match(fake.requests[1].url, /starting_after=cs_test_unrelated/);
  assert.equal(fake.requests[1].authorization, "Bearer sk_test_dummy");
});

test("incomplete listing, duplicate Sessions and Stripe outage never authorize release", async () => {
  const { findRecoveredCheckoutSession: find } = await helpers;
  const incomplete = mockStripePages([{ data: [recoveredSession], has_more: true }, 500]);
  assert.equal((await find("sk_test_dummy", recoveryExpected, incomplete.requester)).status, "incomplete");
  const two = mockStripePages([{ data: [recoveredSession, { ...recoveredSession, id: "cs_test_another" }], has_more: false }]);
  assert.equal((await find("sk_test_dummy", recoveryExpected, two.requester)).status, "ambiguous");
  const missing = mockStripePages([{ data: [], has_more: false }]);
  assert.equal((await find("sk_test_dummy", recoveryExpected, missing.requester)).status, "none");
  const failed = mockStripePages([new Error("network lost")]);
  assert.equal((await find("sk_test_dummy", recoveryExpected, failed.requester)).status, "incomplete");
});

test("TEST-only migration preserves unknown-payment hold and accepts positively recovered past expiry", () => {
  assert.match(recoverySql, /rentulo_project_url[\s\S]*vspposovhdgvbeukoivh\.supabase\.co/);
  assert.match(recoverySql, /recovery_review_required_at timestamptz/);
  assert.match(recoverySql, /a\.state='creating'[\s\S]*a\.stripe_checkout_session_id is null/);
  assert.match(recoverySql, /public\.get_unrecorded_extension_checkout_recovery_candidates/);
  assert.match(recoverySql, /public\.record_reservation_extension_checkout_attempt/);
  assert.doesNotMatch(recoverySql, /p_expires_at\s*<=\s*clock_timestamp/);
  assert.match(recoverySql, /public\.flag_unrecorded_extension_checkout_for_review/);
  assert.doesNotMatch(recoverySql, /set status='expired'|set checkout_started_at=null|drop table|update public\.payments/i);
  assert.match(worker, /mayRetrySameCheckoutAttempt/);
  assert.match(worker, /findRecoveredCheckoutSession/);
  assert.match(worker, /flag_unrecorded_extension_checkout_for_review/);
  assert.match(worker, /if \(verified\)/);
  assert.match(worker, /liveMode: environment\.liveMode/);
});


test("exact TEST/LIVE project and key pairing fails closed on a mismatch", async () => {
  const { resolveExtensionStripeEnvironment: resolve, checkoutSessionIdMatchesMode: idMatches,
    classifyRecoveredCheckoutSession: recovered, classifyExtensionCheckoutSession: classify } = await helpers;
  const testConfig = { supabaseUrl: "https://vspposovhdgvbeukoivh.supabase.co",
    siteUrl: "https://rentulo.eu", stripeKey: "sk_test_example" };
  const liveConfig = { supabaseUrl: "https://tfvgxrdjrpicgtvovehl.supabase.co",
    siteUrl: "https://rentulo.com", stripeKey: "sk_live_example" };
  assert.equal(resolve(testConfig).liveMode, false);
  assert.equal(resolve(liveConfig).liveMode, true);
  assert.equal(resolve({ ...testConfig, stripeKey: liveConfig.stripeKey }), null);
  assert.equal(resolve({ ...liveConfig, stripeKey: testConfig.stripeKey }), null);
  assert.equal(resolve({ ...liveConfig, siteUrl: testConfig.siteUrl }), null);
  assert.equal(resolve({ ...testConfig, siteUrl: liveConfig.siteUrl }), null);
  assert.equal(resolve({ ...liveConfig, supabaseUrl: "https://unknown.supabase.co" }), null);
  assert.equal(resolve({ ...liveConfig, stripeKey: "" }), null);
  assert.equal(idMatches("cs_live_A1", true), true);
  assert.equal(idMatches("cs_test_A1", true), false);
  assert.equal(idMatches("cs_test_A1", false), true);
  assert.equal(idMatches("cs_live_A1", false), false);
  assert.equal(classify({ ...unpaid, livemode: false }, { ...expected, liveMode: false }), "reuse");
  assert.equal(classify({ ...unpaid, livemode: true }, { ...expected, liveMode: false }), "invalid");
  assert.equal(classify({ ...unpaid, id: "cs_live_A1", livemode: true },
    { ...expected, sessionId: "cs_live_A1", liveMode: true }), "reuse");
  assert.equal(recovered({ ...recoveredSession, id: "cs_live_A1", livemode: true },
    { ...recoveryExpected, liveMode: true }), "reuse");
  assert.equal(recovered({ ...recoveredSession, livemode: false },
    { ...recoveryExpected, liveMode: true }), "invalid");
});

test("PROD edge rollout retains service-role authorization and guards Stripe transfer evidence", () => {
  const payouts = read("supabase/functions/create-extension-transfer/index.ts");
  assert.match(checkout, /environment\.liveMode/);
  assert.match(checkout, /checkoutSessionIdMatchesMode/);
  assert.match(worker, /session\.livemode !== environment\.liveMode/);
  assert.match(worker, /extension_settlement: "disabled_environment_mismatch"/);
  assert.match(payouts, /safeEqual\(token, key\)/);
  assert.match(payouts, /charge\.body\.livemode !== environment\.liveMode/);
  assert.match(payouts, /t\.livemode === environment\.liveMode/);
  assert.match(payouts, /Idempotency-Key.*rentulo-extension-transfer-\$\{extensionId\}/s);
});
