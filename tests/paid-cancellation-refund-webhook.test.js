"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const WEBHOOK_PATH = path.join(
  PROJECT_ROOT,
  "supabase",
  "functions",
  "stripe-webhook",
  "index.ts"
);
const MIGRATION_PATH = path.join(
  PROJECT_ROOT,
  "supabase",
  "migrations",
  "20260928170000_add_paid_cancellation_refund_webhook.sql"
);

function readWebhook() {
  return fs.readFileSync(WEBHOOK_PATH, "utf8");
}

function compactSql() {
  return fs.readFileSync(MIGRATION_PATH, "utf8").replace(/\s+/g, " ").trim();
}

test("Stripe webhook handles the three refund lifecycle events before generic ignore", () => {
  const source = readWebhook();

  assert.match(source, /eventType === "refund\.created"/);
  assert.match(source, /eventType === "refund\.updated"/);
  assert.match(source, /eventType === "refund\.failed"/);
  assert.match(source, /handlePaidCancellationRefundEvent\(admin, event, object\)/);

  const refundDispatchIndex = source.indexOf('eventType === "refund.created"');
  const genericIgnoreIndex = source.indexOf('eventType !== "payment_intent.succeeded"');
  assert.ok(
    refundDispatchIndex >= 0 && genericIgnoreIndex > refundDispatchIndex,
    "Refund events must be dispatched before the generic ignored-event branch"
  );
});

test("refund webhook requires Rentulo metadata and validates the signed refund object", () => {
  const source = readWebhook();

  assert.match(source, /metadata\.payment_id/);
  assert.match(source, /metadata\.reservation_id/);
  assert.match(source, /metadata\.cancellation_id/);
  assert.match(source, /objectType !== "refund"/);
  assert.match(source, /refundAmountMinor === null \|\| refundAmountMinor <= 0/);
  assert.match(source, /currency !== "czk"/);
  assert.match(source, /!chargeId/);
  assert.match(source, /eventType === "refund\.failed" && refundStatus !== "failed"/);
  assert.match(source, /Missing or invalid Rentulo refund metadata/);
});

test("refund webhook delegates persistence to one service-role RPC and finalizes the event log", () => {
  const source = readWebhook();

  assert.match(source, /admin\.rpc\("record_paid_cancellation_refund_webhook"/);
  assert.match(source, /p_payment_id:\s*paymentId/);
  assert.match(source, /p_reservation_id:\s*reservationId/);
  assert.match(source, /p_cancellation_id:\s*cancellationId/);
  assert.match(source, /p_stripe_refund_id:\s*refundId/);
  assert.match(source, /p_stripe_refund_status:\s*refundStatus/);
  assert.match(source, /p_refund_amount_minor:\s*refundAmountMinor/);
  assert.match(source, /p_stripe_refund_balance_transaction_id:\s*refundBalanceTransactionId/);
  assert.match(source, /processingStatus:\s*"processed"|updateEventStatus\(admin, stripeEventId, "processed"/);
});

test("refund webhook RPC revalidates cancellation, payment, charge, amount and transfer state", () => {
  const sql = compactSql();

  assert.match(sql, /create or replace function public\.record_paid_cancellation_refund_webhook\(/i);
  assert.match(sql, /auth\.role\(\) <> 'service_role'/i);
  assert.match(sql, /v_cancellation\.cancellation_kind <> 'paid_refund'/i);
  assert.match(sql, /v_cancellation\.payment_id <> v_payment\.id/i);
  assert.match(sql, /v_cancellation\.reservation_id <> v_reservation\.id/i);
  assert.match(sql, /v_payment\.stripe_charge_id <> p_stripe_charge_id/i);
  assert.match(sql, /v_cancellation\.refund_amount_minor is not null and v_cancellation\.refund_amount_minor <> p_refund_amount_minor/i);
  assert.match(sql, /v_payment\.stripe_refund_id is not null and v_payment\.stripe_refund_id <> p_stripe_refund_id/i);
  assert.match(sql, /v_payment\.transfer_status <> 'not_created'/i);
  assert.match(sql, /v_payment\.stripe_transfer_id is not null/i);
});

test("refund webhook RPC records succeeded time and never regresses terminal provider state", () => {
  const sql = compactSql();

  assert.match(sql, /v_current_status in \('succeeded', 'failed', 'canceled'\)/i);
  assert.match(sql, /v_current_status = 'requires_action' and p_stripe_refund_status = 'pending'/i);
  assert.match(sql, /refund_status = p_stripe_refund_status/i);
  assert.match(sql, /when p_stripe_refund_status = 'succeeded' then coalesce\(p\.refunded_at, v_event_at\)/i);
  assert.match(sql, /stripe_refund_balance_transaction_id = case/i);
  assert.match(sql, /v_stale/i);
});

test("refund webhook database writer remains service-role only", () => {
  const sql = compactSql();

  assert.match(
    sql,
    /revoke all on function public\.record_paid_cancellation_refund_webhook\([\s\S]*?\) from public, anon, authenticated/i
  );
  assert.match(
    sql,
    /grant execute on function public\.record_paid_cancellation_refund_webhook\([\s\S]*?\) to service_role/i
  );
});
