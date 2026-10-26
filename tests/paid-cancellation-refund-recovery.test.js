"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(
  path.join(PROJECT_ROOT, "supabase/functions/cancel-paid-reservation/index.ts"), "utf8"
);
const originalMigration = fs.readFileSync(
  path.join(PROJECT_ROOT, "supabase/migrations/20260928160000_add_paid_cancellation_refund_backend.sql"), "utf8"
);
const patchMigration = fs.readFileSync(
  path.join(PROJECT_ROOT, "supabase/migrations/20261014120000_fix_paid_cancellation_refund_finalization.sql"), "utf8"
);
const validatorModule = import(pathToFileURL(path.join(
  PROJECT_ROOT, "supabase/functions/_shared/paid-cancellation-refund-recovery.mjs"
)).href);

const expected = Object.freeze({
  cancellationId: "cancellation-1",
  paymentId: "payment-1",
  reservationId: "reservation-1",
  actorRole: "owner",
  paymentIntentId: "pi_test1",
  chargeId: "ch_test1",
  amountMinor: 25000,
});
const validRefund = Object.freeze({
  id: "re_test1",
  object: "refund",
  amount: 25000,
  charge: "ch_test1",
  currency: "czk",
  payment_intent: "pi_test1",
  status: "succeeded",
  metadata: {
    cancellation_id: "cancellation-1",
    payment_id: "payment-1",
    reservation_id: "reservation-1",
    cancelled_by_role: "owner",
  },
});
function list(refunds, hasMore = false) {
  return { object: "list", data: refunds, has_more: hasMore };
}
async function validate(refunds, overrides = {}) {
  const { validateExistingCancellationRefundList } = await validatorModule;
  return validateExistingCancellationRefundList(refunds, { ...expected, ...overrides });
}

test("recovery accepts only one fully-matching, already-issued owner refund", async () => {
  const result = await validate(list([validRefund]));
  assert.equal(result.error, null);
  assert.strictEqual(result.refund, validRefund);
});

test("existing cancellation without any Stripe refund fails closed and never guesses one", async () => {
  const result = await validate(list([]));
  assert.equal(result.refund, null);
  assert.equal(result.error, "refund_not_found");
});

test("more than one refund on the same charge blocks automatic recovery", async () => {
  const result = await validate(list([validRefund, { ...validRefund, id: "re_test2" }]));
  assert.equal(result.refund, null);
  assert.equal(result.error, "multiple_refunds");
});

test("incomplete, paginated or malformed Stripe responses must fail closed", async () => {
  for (const response of [
    null, {}, { object: "list", data: [] }, list([validRefund], true),
    { object: "object", data: [validRefund], has_more: false },
    { object: "list", data: null, has_more: false },
  ]) {
    assert.equal((await validate(response)).refund, null);
  }
});

test("recovery checks reservation, payment, cancellation and actor metadata", async () => {
  for (const [key, value] of [
    ["cancellation_id", "other-cancellation"],
    ["payment_id", "other-payment"],
    ["reservation_id", "other-reservation"],
    ["cancelled_by_role", "renter"],
  ]) {
    const result = await validate(list([{
      ...validRefund, metadata: { ...validRefund.metadata, [key]: value },
    }]));
    assert.equal(result.refund, null, `${key} must not match a foreign refund`);
    assert.equal(result.error, "refund_evidence_mismatch");
  }
  assert.equal((await validate(list([{ ...validRefund, metadata: null }]))).refund, null);
});

test("recovery checks original charge, intent, currency, amount, ID and status", async () => {
  const mismatches = [
    { charge: "ch_other" }, { payment_intent: "pi_other" },
    { currency: "eur" }, { amount: 24999 }, { amount: "25000" },
    { id: "not-a-refund" }, { object: "charge" }, { status: "unknown" },
  ];
  for (const mismatch of mismatches) {
    const result = await validate(list([{ ...validRefund, ...mismatch }]));
    assert.equal(result.refund, null, JSON.stringify(mismatch));
    assert.equal(result.error, "refund_evidence_mismatch");
  }
});

test("pending provider status is recoverable but is not mislabeled as succeeded", async () => {
  const pending = { ...validRefund, status: "pending" };
  const result = await validate(list([pending]));
  assert.strictEqual(result.refund, pending);
  assert.equal(result.refund.status, "pending");
});

test("previously-started cancellations fetch Stripe refunds, never POST a new one", () => {
  const byIdBranch = SRC.indexOf("if (context.stripe_refund_id) {");
  const existingBranch = SRC.indexOf("} else if (context.cancellation_id) {", byIdBranch);
  const newCancellationBranch = SRC.indexOf("} else {\n    const refundParams", existingBranch);
  const postRefund = SRC.indexOf('method: "POST",', newCancellationBranch);
  assert.ok(byIdBranch >= 0 && existingBranch > byIdBranch);
  assert.ok(newCancellationBranch > existingBranch && postRefund > newCancellationBranch);
  assert.match(SRC.slice(existingBranch, newCancellationBranch), /\/v1\/refunds\?charge=/);
  assert.match(SRC.slice(existingBranch, newCancellationBranch), /validateExistingCancellationRefundList/);
  assert.doesNotMatch(SRC.slice(existingBranch, newCancellationBranch), /method: "POST"|Idempotency-Key/);
  assert.match(SRC.slice(newCancellationBranch), /rentulo-paid-cancellation-\$\{cancellationId\}/);
  assert.match(SRC, /admin\.rpc\("finalize_paid_reservation_cancellation_refund"/);
});

test("new SQL migration makes one surgical ON CONFLICT change, preserving financial guards and grants", () => {
  const extractFunction = sql => sql.slice(
    sql.indexOf("create or replace function public.finalize_paid_reservation_cancellation_refund("),
    sql.lastIndexOf("\ncommit;")
  ).trim();
  const source = extractFunction(originalMigration);
  const oldTarget = "on conflict (cancellation_id) do nothing;";
  const newTarget = "on conflict on constraint owner_cancellation_debts_cancellation_id_key do nothing;";
  assert.equal(source.split(oldTarget).length, 2);
  assert.equal(extractFunction(patchMigration), source.replace(oldTarget, newTarget));
  assert.match(patchMigration, /auth\.role\(\) <> 'service_role'/);
  assert.match(patchMigration, /v_now \+ interval '7 days'/);
  assert.match(patchMigration, /grant execute on function public\.finalize_paid_reservation_cancellation_refund/);
  assert.doesNotMatch(patchMigration, /^\s*on conflict \(cancellation_id\)/im);
});
