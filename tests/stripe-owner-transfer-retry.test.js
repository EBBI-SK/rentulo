"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const MIGRATION = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261007130000_add_owner_transfer_retry_state.sql"
);

function readMigration() {
  return fs.readFileSync(MIGRATION, "utf8");
}

function compact(value) {
  return value.replace(/\s+/g, " ").trim();
}

test("owner transfer retry state stores attempts, retry time and bounded error text", () => {
  const sql = compact(readMigration());

  assert.match(sql, /add column if not exists transfer_attempt_count integer not null default 0/i);
  assert.match(sql, /add column if not exists transfer_last_attempt_at timestamptz/i);
  assert.match(sql, /add column if not exists transfer_next_retry_at timestamptz/i);
  assert.match(sql, /add column if not exists transfer_last_error text/i);
  assert.match(sql, /check \(transfer_attempt_count >= 0\)/i);
  assert.match(sql, /transfer_attempt_count = 0 and transfer_last_attempt_at is null/i);
  assert.match(sql, /transfer_attempt_count > 0 and transfer_last_attempt_at is not null/i);
  assert.match(sql, /transfer_next_retry_at is null or transfer_status = 'failed'/i);
  assert.match(sql, /char_length\(transfer_last_error\) <= 2000/i);
});

test("retry due index targets only failed untransferred payouts with a scheduled retry", () => {
  const sql = compact(readMigration());

  assert.match(sql, /create index if not exists payments_owner_transfer_retry_due_idx/i);
  assert.match(sql, /on public\.payments \(transfer_next_retry_at, id\)/i);
  assert.match(sql, /where transfer_status = 'failed' and stripe_transfer_id is null and transfer_next_retry_at is not null/i);
});

test("claim RPC is service-role only and locks the payment row", () => {
  const sql = compact(readMigration());

  assert.match(sql, /create or replace function public\.claim_stripe_owner_transfer_attempt\( p_payment_id uuid, p_reservation_id uuid \)/i);
  assert.match(sql, /auth\.role\(\) <> 'service_role'/i);
  assert.match(sql, /from public\.payments p where p\.id = p_payment_id and p\.reservation_id = p_reservation_id for update/i);
  assert.match(sql, /revoke all on function public\.claim_stripe_owner_transfer_attempt\(uuid, uuid\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.claim_stripe_owner_transfer_attempt\(uuid, uuid\) to service_role/i);
});

test("claim RPC accepts only eligible picked-up Stripe payments without refunds or an existing transfer", () => {
  const sql = compact(readMigration());

  assert.match(sql, /v_payment\.stripe_transfer_id is not null/i);
  assert.match(sql, /v_payment\.transfer_status in \('succeeded', 'reversed'\)/i);
  assert.match(sql, /v_payment\.provider <> 'stripe'/i);
  assert.match(sql, /v_payment\.status <> 'paid'/i);
  assert.match(sql, /v_payment\.currency <> 'czk'/i);
  assert.match(sql, /v_payment\.stripe_payment_intent_status <> 'succeeded'/i);
  assert.match(sql, /v_payment\.refund_status <> 'not_requested'/i);
  assert.match(sql, /v_payment\.stripe_refund_amount_minor <> 0/i);
  assert.match(sql, /v_reservation_status not in \('picked_up', 'returned'\)/i);
});

test("claim RPC handles initial, due failed and stale pending attempts but not fresh pending work", () => {
  const sql = compact(readMigration());

  assert.match(sql, /v_payment\.transfer_status = 'not_created'/i);
  assert.match(sql, /v_payment\.transfer_status = 'failed' and v_payment\.transfer_next_retry_at is not null and v_payment\.transfer_next_retry_at <= v_now/i);
  assert.match(sql, /coalesce\(v_payment\.transfer_last_attempt_at, v_payment\.updated_at\)/i);
  assert.match(sql, /v_payment\.transfer_status = 'pending' and v_stale_reference <= v_now - interval '15 minutes'/i);
});

test("claim RPC moves the payout to pending and atomically increments the attempt counter", () => {
  const sql = compact(readMigration());

  assert.match(sql, /transfer_status = 'pending'/i);
  assert.match(sql, /transfer_attempt_count = p\.transfer_attempt_count \+ 1/i);
  assert.match(sql, /transfer_last_attempt_at = v_now/i);
  assert.match(sql, /transfer_next_retry_at = null/i);
  assert.match(sql, /transfer_last_error = null/i);
});

test("failure RPC uses attempt count as a stale-worker compare-and-set boundary", () => {
  const sql = compact(readMigration());

  assert.match(sql, /create or replace function public\.mark_stripe_owner_transfer_attempt_failed/i);
  assert.match(sql, /v_payment\.transfer_status <> 'pending'/i);
  assert.match(sql, /v_payment\.transfer_attempt_count <> p_attempt_count/i);
  assert.match(sql, /Owner transfer attempt is stale or not pending/i);
  assert.match(sql, /p\.transfer_status = 'pending' and p\.transfer_attempt_count = p_attempt_count and p\.stripe_transfer_id is null/i);
});

test("retryable failures use the agreed 5m 15m 1h 6h then 24h backoff", () => {
  const sql = compact(readMigration());

  assert.match(sql, /when p_attempt_count = 1 then interval '5 minutes'/i);
  assert.match(sql, /when p_attempt_count = 2 then interval '15 minutes'/i);
  assert.match(sql, /when p_attempt_count = 3 then interval '1 hour'/i);
  assert.match(sql, /when p_attempt_count = 4 then interval '6 hours'/i);
  assert.match(sql, /else interval '24 hours'/i);
  assert.match(sql, /transfer_status = 'failed'/i);
  assert.match(sql, /transfer_next_retry_at = v_next_retry_at/i);
});

test("permanent failures remain failed without automatic retry and 2B-1 adds no cron or Stripe calls", () => {
  const sql = compact(readMigration());

  assert.match(sql, /else v_next_retry_at := null/i);
  assert.match(sql, /left\([\s\S]*2000[\s\S]*\)/i);
  assert.match(sql, /revoke all on function public\.mark_stripe_owner_transfer_attempt_failed[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.mark_stripe_owner_transfer_attempt_failed[\s\S]*to service_role/i);
  assert.doesNotMatch(sql, /cron\.schedule/i);
  assert.doesNotMatch(sql, /net\.http_post/i);
  assert.doesNotMatch(sql, /api\.stripe\.com/i);
});
