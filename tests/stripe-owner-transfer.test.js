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
  "20260928090000_support_settlement_currency_owner_transfers.sql"
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

test("owner transfer revalidates the exact Stripe charge and its settlement transaction", () => {
  const source = readFunction();

  assert.match(source, /https:\/\/api\.stripe\.com\/v1\/charges\//);
  assert.match(source, /charge\.paid !== true/);
  assert.match(source, /charge\.captured !== true/);
  assert.match(source, /charge\.refunded === true/);
  assert.match(source, /charge\.currency !== "czk"/);
  assert.match(source, /chargePaymentIntentId !== payment\.stripe_payment_intent_id/);
  assert.match(source, /Number\(charge\.amount\) !== Number\(payment\.stripe_amount_total_minor\)/);
  assert.match(source, /balanceTransactionId = objectId\(charge\.balance_transaction\)/);
  assert.match(source, /https:\/\/api\.stripe\.com\/v1\/balance_transactions\//);
  assert.match(source, /balance\.id !== balanceTransactionId/);
  assert.match(source, /balanceSourceId !== payment\.stripe_charge_id/);
  assert.match(source, /balance\.type !== "charge"/);
});

test("Stripe transfer uses settlement currency, destination, source transaction, transfer group and stable idempotency", () => {
  const source = readFunction();

  assert.match(source, /https:\/\/api\.stripe\.com\/v1\/transfers/);
  assert.match(source, /params\.set\("amount", String\(transferAmountMinor\)\)/);
  assert.match(source, /params\.set\("currency", settlementCurrency\)/);
  assert.doesNotMatch(source, /params\.set\("currency", "czk"\)/);
  assert.match(source, /params\.set\("destination", accountId\)/);
  assert.match(source, /params\.set\("source_transaction", payment\.stripe_charge_id\)/);
  assert.match(source, /params\.set\("transfer_group", transferGroup\)/);
  assert.match(source, /metadata\[payment_id\]/);
  assert.match(source, /metadata\[reservation_id\]/);
  assert.match(source, /Idempotency-Key.*rentulo-owner-transfer-\$\{payment\.id\}/s);
});

test("owner transfer recovers an existing Stripe transfer before attempting a new payout", () => {
  const source = readFunction();
  const lookupIndex = source.indexOf(
    '`https://api.stripe.com/v1/transfers?${lookupParams.toString()}`'
  );
  const createIndex = source.indexOf('fetch("https://api.stripe.com/v1/transfers", {');

  assert.ok(lookupIndex >= 0);
  assert.ok(createIndex > lookupIndex);
  assert.match(source, /lookupParams\.set\("transfer_group", transferGroup\)/);
  assert.match(source, /lookupParams\.set\("limit", "2"\)/);
  assert.match(source, /if \(!transfer\) \{/);
});

test("recovered Stripe transfer must match the exact payout evidence and Rentulo metadata", () => {
  const source = readFunction();

  assert.match(source, /function transferMatchesExpected\(/);
  assert.match(source, /Number\(transfer\.amount\) === expected\.amountMinor/);
  assert.match(source, /transfer\.currency === expected\.currency/);
  assert.match(source, /objectId\(transfer\.destination\) === expected\.destinationId/);
  assert.match(source, /objectId\(transfer\.source_transaction\) === expected\.sourceTransactionId/);
  assert.match(source, /transfer\.transfer_group === expected\.transferGroup/);
  assert.match(source, /transfer\.metadata\?\.payment_id === expected\.paymentId/);
  assert.match(source, /transfer\.metadata\?\.reservation_id === expected\.reservationId/);
  assert.match(source, /transfer\.metadata\?\.owner_id === expected\.ownerId/);
  assert.match(source, /transferMatchesExpected\(existingTransfer, expectedTransfer\)/);
  assert.match(source, /transferMatchesExpected\(createdTransfer, expectedTransfer\)/);
});

test("owner transfer lookup fails closed on Stripe errors, ambiguity or mismatched evidence", () => {
  const source = readFunction();

  assert.match(source, /!lookupResponse\.ok \|\| lookup\.object !== "list" \|\| !Array\.isArray\(lookup\.data\)/);
  assert.match(source, /Existing owner transfer could not be verified/);
  assert.match(source, /lookup\.has_more === true \|\| lookup\.data\.length > 1/);
  assert.match(source, /Existing transfer state is inconsistent/);
  assert.match(source, /if \(!transferMatchesExpected\(existingTransfer, expectedTransfer\)\)/);
});

test("matching Stripe transfer is recorded without creating a duplicate payout", () => {
  const source = readFunction();

  assert.match(source, /transfer = existingTransfer/);
  assert.match(source, /recoveredExistingTransfer = true/);
  assert.match(source, /admin\.rpc\("record_stripe_owner_transfer_attempt"/);
  assert.match(source, /p_stripe_transfer_id: transfer\.id/);
  assert.match(source, /existing: recoveredExistingTransfer/);
});

test("owner payout is converted proportionally from CZK into the Stripe settlement currency", () => {
  const source = readFunction();

  assert.match(source, /calculateTransferAmountMinor\(/);
  assert.match(source, /BigInt\(settlementAmountMinor\) \* BigInt\(ownerPayout\)/);
  assert.match(source, /const rounded = \(numerator \+ denominator \/ 2n\) \/ denominator/);
  assert.match(source, /settlementAmountMinor,[\s\S]*Number\(payment\.owner_payout\),[\s\S]*Number\(payment\.amount_total\)/);
  assert.match(source, /transfer\.currency === expected\.currency/);
});

test("successful transfer recording persists settlement and transfer currencies", () => {
  const source = readFunction();

  assert.match(source, /p_transfer_currency: settlementCurrency/);
  assert.match(source, /p_stripe_charge_balance_transaction_id: balanceTransactionId/);
  assert.match(source, /p_stripe_charge_balance_amount_minor: settlementAmountMinor/);
  assert.match(source, /p_stripe_charge_balance_currency: settlementCurrency/);
  assert.match(source, /currency: settlementCurrency/);
});

test("database recorder validates settlement ratio, currencies, pickup/refunds and idempotency", () => {
  const sql = compact(readMigration());

  assert.match(sql, /add column if not exists stripe_charge_balance_amount_minor integer/i);
  assert.match(sql, /add column if not exists stripe_charge_balance_currency text/i);
  assert.match(sql, /add column if not exists stripe_transfer_currency text/i);
  assert.match(sql, /create function public\.record_stripe_owner_transfer\(/i);
  assert.match(sql, /auth\.role\(\) <> 'service_role'/i);
  assert.match(sql, /v_reservation\.status not in \('picked_up', 'returned'\)/i);
  assert.match(sql, /v_payment\.refund_status <> 'not_requested'/i);
  assert.match(sql, /v_payment\.stripe_refund_amount_minor <> 0/i);
  assert.match(sql, /v_profile\.stripe_connect_status <> 'ready'/i);
  assert.match(sql, /v_profile\.stripe_connect_transfers_enabled is not true/i);
  assert.match(sql, /p_stripe_charge_balance_currency <> p_transfer_currency/i);
  assert.match(sql, /p_stripe_charge_balance_amount_minor::numeric \* v_payment\.owner_payout::numeric \/ v_payment\.amount_total::numeric/i);
  assert.match(sql, /if v_payment\.stripe_transfer_id is not null then/i);
  assert.match(sql, /stripe_charge_balance_transaction_id = p_stripe_charge_balance_transaction_id/i);
  assert.match(sql, /stripe_charge_balance_amount_minor = p_stripe_charge_balance_amount_minor/i);
  assert.match(sql, /stripe_charge_balance_currency = p_stripe_charge_balance_currency/i);
  assert.match(sql, /stripe_transfer_amount_minor = p_transfer_amount_minor/i);
  assert.match(sql, /stripe_transfer_currency = p_transfer_currency/i);
  assert.match(sql, /transfer_status = 'succeeded'/i);
  assert.match(sql, /revoke all on function public\.record_stripe_owner_transfer[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.record_stripe_owner_transfer[\s\S]*to service_role/i);
});
