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
  "create-owner-transfer",
  "index.ts"
);
const MIGRATION_PATH = path.join(
  PROJECT_ROOT,
  "supabase",
  "migrations",
  "20260926090000_add_stripe_owner_transfer_foundation.sql"
);

function readFunction() {
  return fs.readFileSync(FUNCTION_PATH, "utf8");
}

function readMigration() {
  return fs.readFileSync(MIGRATION_PATH, "utf8");
}

function compact(value) {
  return value.replace(/\s+/g, " ").trim();
}

test("owner transfer endpoint is internal-only and not callable with a normal user JWT", () => {
  const source = readFunction();

  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /timingSafeTextEqual\(accessToken, serviceRoleKey\)/);
  assert.doesNotMatch(source, /auth\.getUser/);
  assert.doesNotMatch(source, /Access-Control-Allow-Origin/);
});

test("owner transfer validates paid pickup state, Connect readiness and refund state", () => {
  const source = readFunction();

  assert.match(source, /payment\.status !== "paid"/);
  assert.match(source, /\["picked_up", "returned"\]\.includes\(reservation\.status\)/);
  assert.match(source, /stripe_connect_status !== "ready"/);
  assert.match(source, /stripe_connect_transfers_enabled !== true/);
  assert.match(source, /account\.capabilities\?\.transfers !== "active"/);
  assert.match(source, /account\.payouts_enabled !== true/);
  assert.match(source, /payment\.refund_status !== "not_requested"/);
  assert.match(source, /stripe_refund_amount_minor\) !== 0/);
});

test("owner transfer revalidates the exact Stripe charge before moving money", () => {
  const source = readFunction();

  assert.match(source, /https:\/\/api\.stripe\.com\/v1\/charges\//);
  assert.match(source, /charge\.paid !== true/);
  assert.match(source, /charge\.captured !== true/);
  assert.match(source, /charge\.refunded === true/);
  assert.match(source, /charge\.currency !== "czk"/);
  assert.match(source, /chargePaymentIntentId !== payment\.stripe_payment_intent_id/);
  assert.match(source, /Number\(charge\.amount\) !== Number\(payment\.stripe_amount_total_minor\)/);
});

test("Stripe transfer uses destination, source transaction, transfer group and stable idempotency", () => {
  const source = readFunction();

  assert.match(source, /https:\/\/api\.stripe\.com\/v1\/transfers/);
  assert.match(source, /params\.set\("amount", String\(transferAmountMinor\)\)/);
  assert.match(source, /params\.set\("currency", "czk"\)/);
  assert.match(source, /params\.set\("destination", accountId\)/);
  assert.match(source, /params\.set\("source_transaction", payment\.stripe_charge_id\)/);
  assert.match(source, /params\.set\("transfer_group", transferGroup\)/);
  assert.match(source, /metadata\[payment_id\]/);
  assert.match(source, /metadata\[reservation_id\]/);
  assert.match(source, /Idempotency-Key.*rentulo-owner-transfer-\$\{payment\.id\}/s);
});

test("owner transfer sends exactly the persisted owner payout in minor units", () => {
  const source = readFunction();

  assert.match(source, /const transferAmountMinor = Number\(payment\.owner_payout\) \* 100/);
  assert.match(source, /Number\(payment\.platform_fee_amount\) \+ Number\(payment\.owner_payout\) !== Number\(payment\.amount_total\)/);
  assert.match(source, /transferAmountMinor > Number\(payment\.stripe_amount_total_minor\)/);
});

test("database recorder is service-role only, validates pickup/refunds and is idempotent", () => {
  const sql = compact(readMigration());

  assert.match(sql, /create or replace function public\.record_stripe_owner_transfer\(/i);
  assert.match(sql, /auth\.role\(\) <> 'service_role'/i);
  assert.match(sql, /v_reservation\.status not in \('picked_up', 'returned'\)/i);
  assert.match(sql, /v_payment\.refund_status <> 'not_requested'/i);
  assert.match(sql, /v_payment\.stripe_refund_amount_minor <> 0/i);
  assert.match(sql, /v_profile\.stripe_connect_status <> 'ready'/i);
  assert.match(sql, /v_profile\.stripe_connect_transfers_enabled is not true/i);
  assert.match(sql, /if v_payment\.stripe_transfer_id is not null then/i);
  assert.match(sql, /transfer_status = 'succeeded'/i);
  assert.match(sql, /stripe_transfer_amount_minor = p_transfer_amount_minor/i);
  assert.match(sql, /revoke all on function public\.record_stripe_owner_transfer[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.record_stripe_owner_transfer[\s\S]*to service_role/i);
});
