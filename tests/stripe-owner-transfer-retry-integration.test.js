"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const FUNCTION = path.join(
  ROOT,
  "supabase",
  "functions",
  "create-owner-transfer",
  "index.ts"
);
const MIGRATION = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261007140000_integrate_owner_transfer_retry.sql"
);

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function compact(value) {
  return value.replace(/\s+/g, " ").trim();
}

test("retry-aware transfer finalizer is added alongside the legacy recorder for safe rollout", () => {
  const sql = compact(read(MIGRATION));

  assert.match(
    sql,
    /create function public\.record_stripe_owner_transfer_attempt\( p_payment_id uuid, p_reservation_id uuid, p_attempt_count integer,/i
  );
  assert.doesNotMatch(sql, /drop function if exists public\.record_stripe_owner_transfer\(/i);
  assert.match(sql, /p_attempt_count is null or p_attempt_count < 1/i);
  assert.match(sql, /auth\.role\(\) <> 'service_role'/i);
});

test("retry-aware finalizer preserves the existing payment, refund, settlement and Connect safety checks", () => {
  const sql = compact(read(MIGRATION));

  assert.match(sql, /v_payment\.provider <> 'stripe'/i);
  assert.match(sql, /v_payment\.status <> 'paid'/i);
  assert.match(sql, /v_payment\.stripe_payment_intent_status <> 'succeeded'/i);
  assert.match(sql, /v_reservation\.status not in \('picked_up', 'returned'\)/i);
  assert.match(sql, /v_payment\.refund_status <> 'not_requested'/i);
  assert.match(sql, /v_payment\.stripe_refund_amount_minor <> 0/i);
  assert.match(sql, /v_profile\.stripe_connect_status <> 'ready'/i);
  assert.match(sql, /v_profile\.stripe_connect_transfers_enabled is not true/i);
  assert.match(sql, /p_stripe_charge_balance_currency <> p_transfer_currency/i);
  assert.match(
    sql,
    /p_stripe_charge_balance_amount_minor::numeric \* v_payment\.owner_payout::numeric \/ v_payment\.amount_total::numeric/i
  );
  assert.match(
    sql,
    /revoke all on function public\.record_stripe_owner_transfer_attempt[\s\S]*from public, anon, authenticated/i
  );
  assert.match(
    sql,
    /grant execute on function public\.record_stripe_owner_transfer_attempt[\s\S]*to service_role/i
  );
});

test("successful finalization requires the currently pending attempt and uses compare-and-set on update", () => {
  const sql = compact(read(MIGRATION));

  assert.match(
    sql,
    /v_payment\.transfer_status <> 'pending' or v_payment\.transfer_attempt_count <> p_attempt_count/i
  );
  assert.match(sql, /Owner transfer attempt is stale or not pending/i);
  assert.match(
    sql,
    /p\.stripe_transfer_id is null and p\.transfer_status = 'pending' and p\.transfer_attempt_count = p_attempt_count/i
  );
});

test("successful finalization clears retry scheduling and the previous error", () => {
  const sql = compact(read(MIGRATION));

  assert.match(sql, /transfer_status = 'succeeded'/i);
  assert.match(sql, /transfer_next_retry_at = null/i);
  assert.match(sql, /transfer_last_error = null/i);
  assert.match(sql, /transfer_created_at = coalesce\(p\.transfer_created_at, v_now\)/i);
});

test("exactly recorded Stripe transfer remains idempotent without allowing a stale mutation", () => {
  const sql = compact(read(MIGRATION));

  assert.match(sql, /if v_payment\.stripe_transfer_id is not null then/i);
  assert.match(sql, /v_payment\.stripe_transfer_id <> p_stripe_transfer_id/i);
  assert.match(sql, /v_payment\.transfer_status <> 'succeeded'/i);
  assert.match(sql, /return query select v_payment\.id, v_reservation\.id/i);
});

test("create-owner-transfer claims an attempt before any Stripe payout verification request", () => {
  const source = read(FUNCTION);
  const claimIndex = source.indexOf('admin.rpc("claim_stripe_owner_transfer_attempt"');
  const stripeAccountIndex = source.indexOf('`https://api.stripe.com/v1/accounts/${encodeURIComponent(accountId)}`');

  assert.ok(claimIndex >= 0);
  assert.ok(stripeAccountIndex > claimIndex);
  assert.match(source, /claim\.transfer_status !== "pending"/);
  assert.match(source, /Number\.isSafeInteger\(attemptCount\)/);
});

test("claimed failures are recorded through the attempt-bound failure RPC", () => {
  const source = read(FUNCTION);

  assert.match(source, /admin\.rpc\("mark_stripe_owner_transfer_attempt_failed"/);
  assert.match(source, /p_attempt_count: attemptCount/);
  assert.match(source, /p_error: errorMessage/);
  assert.match(source, /p_retryable: retryable/);
  assert.match(source, /15 minute stale-claim timeout/);
});

test("temporary Stripe and network failures are retryable while evidence conflicts fail closed", () => {
  const source = read(FUNCTION);

  assert.match(source, /function isRetryableStripeStatus\(status: number\)/);
  assert.match(source, /status === 408 \|\| status === 425 \|\| status === 429 \|\| status >= 500/);
  assert.match(source, /Stripe connected account request failed: \$\{message\}`,[\s\S]*true,/);
  assert.match(source, /Stripe source charge evidence does not match the Rentulo payment",[\s\S]*false,/);
  assert.match(source, /Multiple Stripe transfers exist for the reservation transfer group",[\s\S]*false,/);
  assert.match(source, /Existing Stripe transfer does not match the expected Rentulo payout evidence",[\s\S]*false,/);
});

test("each real retry gets a fresh idempotency key only after the duplicate-safe Stripe lookup", () => {
  const source = read(FUNCTION);
  const lookupIndex = source.indexOf(
    '`https://api.stripe.com/v1/transfers?${lookupParams.toString()}`'
  );
  const createIndex = source.indexOf('fetch("https://api.stripe.com/v1/transfers", {');

  assert.ok(lookupIndex >= 0);
  assert.ok(createIndex > lookupIndex);
  assert.match(
    source,
    /"Idempotency-Key": `rentulo-owner-transfer-\$\{payment\.id\}-attempt-\$\{attemptCount\}`/
  );
  assert.match(source, /transferMatchesExpected\(existingTransfer, expectedTransfer\)/);
});

test("success finalizer receives the exact attempt count and preserves the settlement evidence", () => {
  const source = read(FUNCTION);

  assert.match(source, /admin\.rpc\("record_stripe_owner_transfer_attempt"/);
  assert.match(source, /p_attempt_count: attemptCount/);
  assert.match(source, /p_stripe_transfer_id: transfer\.id/);
  assert.match(source, /p_transfer_currency: settlementCurrency/);
  assert.match(source, /p_stripe_charge_balance_transaction_id: balanceTransactionId/);
  assert.match(source, /p_stripe_charge_balance_amount_minor: settlementAmountMinor/);
});

test("database-recording failure becomes retryable because the next attempt can recover the Stripe transfer", () => {
  const source = read(FUNCTION);

  assert.match(source, /Owner transfer database recording failed: \$\{recorded\.error\.message\}`/);
  assert.match(
    source,
    /Owner transfer database recording failed:[\s\S]*true,[\s\S]*"Owner transfer could not be recorded"/
  );
  assert.match(source, /the next retry will recover it by/);
  assert.match(source, /transfer_group before any new POST/);
});

test("2B-2 changes payout processing only and still adds no scheduler", () => {
  const sql = read(MIGRATION);
  const source = read(FUNCTION);

  assert.doesNotMatch(sql, /cron\.schedule/i);
  assert.doesNotMatch(sql, /net\.http_post/i);
  assert.doesNotMatch(source, /cron\.schedule/i);
});
