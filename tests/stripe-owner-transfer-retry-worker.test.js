"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const WORKER = path.join(
  ROOT,
  "supabase",
  "functions",
  "retry-owner-transfers",
  "index.ts"
);
const MIGRATION = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261007150000_schedule_owner_transfer_retries.sql"
);

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function compact(value) {
  return value.replace(/\s+/g, " ").trim();
}

test("owner transfer retry worker is internal-only and verifies a dedicated Vault Cron secret", () => {
  const worker = read(WORKER);

  assert.match(worker, /req\.headers\.get\("x-rentulo-cron-secret"\)/);
  assert.match(worker, /\.rpc\(\s*"verify_owner_transfer_retry_cron_secret"/);
  assert.match(worker, /cronAuthorized !== true/);
  assert.match(worker, /return jsonResponse\(\{ error: "Unauthorized" \}, 401\)/);
  assert.doesNotMatch(worker, /Access-Control-Allow-Origin/);
});

test("retry worker reads candidates only through the service-role retry RPC", () => {
  const worker = read(WORKER);

  assert.match(worker, /\.rpc\(\s*"get_due_stripe_owner_transfer_retry_candidates"/);
  assert.match(worker, /\{ p_limit: limit \}/);
  assert.match(worker, /let limit = 10/);
  assert.match(worker, /requestedLimit >= 1 && requestedLimit <= 50/);
});

test("retry worker delegates all payout state and Stripe work to create-owner-transfer", () => {
  const worker = read(WORKER);

  assert.match(worker, /\/functions\/v1\/create-owner-transfer/);
  assert.match(worker, /Authorization: `Bearer \$\{serviceRoleKey\}`/);
  assert.match(worker, /apikey: serviceRoleKey/);
  assert.match(worker, /reservation_id: candidate\.reservation_id/);
  assert.doesNotMatch(worker, /api\.stripe\.com/);
  assert.doesNotMatch(worker, /\.from\("payments"\).*\.update/s);
});

test("retry worker uses bounded concurrency and a timeout for child payout calls", () => {
  const worker = read(WORKER);

  assert.match(worker, /function processWithConcurrency/);
  assert.match(worker, /processWithConcurrency\(candidates, 5/);
  assert.match(worker, /AbortSignal\.timeout\(25_000\)/);
});

test("retry worker treats a concurrent fresh claim as skipped rather than a payout failure", () => {
  const worker = read(WORKER);

  assert.match(worker, /transferResponse\.status === 409/);
  assert.match(worker, /Owner transfer is not ready for processing/);
  assert.match(worker, /result\.skipped \+= 1/);
});

test("candidate RPC is service-role only and validates its batch limit", () => {
  const sql = compact(read(MIGRATION));

  assert.match(sql, /create or replace function public\.get_due_stripe_owner_transfer_retry_candidates\( p_limit integer default 10 \)/i);
  assert.match(sql, /auth\.role\(\) <> 'service_role'/i);
  assert.match(sql, /p_limit < 1 or p_limit > 50/i);
  assert.match(sql, /revoke all on function public\.get_due_stripe_owner_transfer_retry_candidates\(integer\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.get_due_stripe_owner_transfer_retry_candidates\(integer\) to service_role/i);
});

test("candidate RPC covers never-started, due failed and stale pending owner transfers", () => {
  const sql = compact(read(MIGRATION));

  assert.match(sql, /p\.transfer_status = 'not_created'/i);
  assert.match(sql, /p\.transfer_status = 'failed' and p\.transfer_next_retry_at is not null and p\.transfer_next_retry_at <= v_now/i);
  assert.match(sql, /p\.transfer_status = 'pending' and coalesce\(p\.transfer_last_attempt_at, p\.updated_at\) <= v_now - interval '15 minutes'/i);
});

test("candidate RPC excludes transferred, refunded or non-picked-up payments", () => {
  const sql = compact(read(MIGRATION));

  assert.match(sql, /p\.stripe_transfer_id is null/i);
  assert.match(sql, /p\.provider = 'stripe'/i);
  assert.match(sql, /p\.status = 'paid'/i);
  assert.match(sql, /p\.stripe_payment_intent_status = 'succeeded'/i);
  assert.match(sql, /p\.refund_status = 'not_requested'/i);
  assert.match(sql, /p\.stripe_refund_amount_minor = 0/i);
  assert.match(sql, /r\.status in \('picked_up', 'returned'\)/i);
});

test("candidate RPC rechecks parties and payment snapshots before scheduling a payout call", () => {
  const sql = compact(read(MIGRATION));

  assert.match(sql, /p\.owner_id = r\.owner_id/i);
  assert.match(sql, /p\.payer_id = r\.renter_id/i);
  assert.match(sql, /p\.amount_total = r\.total_price/i);
  assert.match(sql, /p\.platform_fee_amount = r\.platform_fee_amount/i);
  assert.match(sql, /p\.owner_payout = r\.owner_payout/i);
  assert.match(sql, /p\.platform_fee_amount \+ p\.owner_payout = p\.amount_total/i);
  assert.match(sql, /p\.stripe_amount_total_minor = p\.amount_total \* 100/i);
});

test("retry Cron uses a dedicated generated Vault secret and no service-role key", () => {
  const sql = read(MIGRATION);

  assert.match(sql, /rentulo_owner_transfer_retry_cron_secret/);
  assert.match(sql, /replace\(gen_random_uuid\(\)::text, '-', ''\)/i);
  assert.match(sql, /vault\.decrypted_secrets/i);
  assert.doesNotMatch(sql, /service[_-]?role[_-]?key\s*[:=]/i);
});

test("retry Cron secret verifier is service-role only", () => {
  const sql = compact(read(MIGRATION));

  assert.match(sql, /create or replace function public\.verify_owner_transfer_retry_cron_secret/i);
  assert.match(sql, /length\(p_secret\) >= 64/i);
  assert.match(sql, /revoke all on function public\.verify_owner_transfer_retry_cron_secret\(text\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.verify_owner_transfer_retry_cron_secret\(text\) to service_role/i);
});

test("owner transfer retry Cron runs every five minutes with a small batch", () => {
  const sql = read(MIGRATION);

  assert.match(sql, /rentulo-retry-owner-transfers-every-5-minutes/);
  assert.match(sql, /'\*\/5 \* \* \* \*'/);
  assert.match(sql, /functions\/v1\/retry-owner-transfers/);
  assert.match(sql, /'x-rentulo-cron-secret', cfg\.cron_secret/);
  assert.match(sql, /jsonb_build_object\('limit', 10\)/);
  assert.match(sql, /timeout_milliseconds := 60000/);
});

test("retry Cron remains inert unless the shared environment project URL is configured", () => {
  const sql = read(MIGRATION);

  assert.match(sql, /'UNCONFIGURED'[\s\S]*'rentulo_project_url'/i);
  assert.ok(
    sql.includes("where cfg.project_url ~ '^https://[a-z0-9-]+[.]supabase[.]co/?$'"),
  );
  assert.match(sql, /length\(cfg\.cron_secret\) >= 64/i);
});
