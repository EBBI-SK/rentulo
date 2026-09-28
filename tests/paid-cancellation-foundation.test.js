"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MIGRATION_PATH = path.join(
  PROJECT_ROOT,
  "supabase",
  "migrations",
  "20260928143000_add_paid_cancellation_foundation.sql"
);

function compactSql(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

function readMigration() {
  return fs.readFileSync(MIGRATION_PATH, "utf8");
}

test("paid cancellation stores the agreed refund policy and exact financial snapshots", () => {
  const sql = compactSql(readMigration());

  for (const column of [
    "cancellation_kind",
    "refund_policy",
    "payment_amount_minor",
    "refund_amount_minor",
    "external_cost_amount_minor",
    "currency",
    "financials_finalized_at"
  ]) {
    assert.match(
      sql,
      new RegExp("add column if not exists " + column + "\\b", "i")
    );
  }

  assert.match(sql, /'renter_external_cost_deducted'/i);
  assert.match(sql, /'owner_full_refund_owner_cost'/i);
  assert.match(
    sql,
    /refund_policy = 'renter_external_cost_deducted' and refund_amount_minor \+ external_cost_amount_minor = payment_amount_minor/i
  );
  assert.match(
    sql,
    /refund_policy = 'owner_full_refund_owner_cost' and refund_amount_minor = payment_amount_minor/i
  );
});

test("cancellation cost evidence preserves provider-native amount, currency and exchange rate", () => {
  const sql = compactSql(readMigration());

  assert.match(sql, /add column if not exists provider_amount_minor integer/i);
  assert.match(sql, /add column if not exists provider_currency text/i);
  assert.match(sql, /add column if not exists provider_exchange_rate numeric/i);
  assert.match(sql, /provider_amount_minor is null or provider_amount_minor > 0/i);
  assert.match(sql, /provider_currency is null or provider_currency ~ '\^\[a-z\]\{3\}\$'/i);
  assert.match(sql, /provider_exchange_rate is null or provider_exchange_rate > 0/i);
});

test("owner cancellation debt is backend-only and becomes due exactly seven days after issue", () => {
  const sql = compactSql(readMigration());

  assert.match(sql, /create table if not exists public\.owner_cancellation_debts/i);
  assert.match(sql, /cancellation_id uuid not null unique references public\.reservation_cancellations\(id\)/i);
  assert.match(sql, /owner_id uuid not null references public\.profiles\(id\)/i);
  assert.match(sql, /amount_minor integer not null check \(amount_minor > 0\)/i);
  assert.match(sql, /status text not null default 'open' check \(status in \('open', 'paid', 'waived'\)\)/i);
  assert.match(sql, /due_at timestamptz not null default \(now\(\) \+ interval '7 days'\)/i);
  assert.match(sql, /check \(due_at = issued_at \+ interval '7 days'\)/i);
  assert.match(sql, /alter table public\.owner_cancellation_debts enable row level security/i);
  assert.match(sql, /revoke all on table public\.owner_cancellation_debts from public, anon, authenticated/i);
  assert.match(sql, /grant all on table public\.owner_cancellation_debts to service_role/i);
});

test("paid cancellation transition is trusted-backend only and preserves ordinary transitions", () => {
  const sql = compactSql(readMigration());

  assert.match(
    sql,
    /auth\.role\(\) = 'service_role' and current_setting\('app\.paid_cancellation_authorized', true\) = 'on' and old\.status = 'paid' and new\.status = 'cancelled'/i
  );
  assert.match(
    sql,
    /auth\.uid\(\) = old\.owner_id and old\.status = 'approved'/i
  );
  assert.match(
    sql,
    /auth\.uid\(\) = old\.renter_id and old\.status in \('pending', 'approved'\)/i
  );
  assert.match(sql, /old\.status = 'picked_up' and new\.status = 'returned'/i);
  assert.match(sql, /app\.stripe_payment_authorized/i);
  assert.match(sql, /app\.pickup_pin_authorized/i);
});

test("begin paid cancellation locks state, enforces six hours and validates the actor", () => {
  const sql = compactSql(readMigration());

  assert.match(sql, /create or replace function public\.begin_paid_reservation_cancellation/i);
  assert.match(sql, /if auth\.role\(\) <> 'service_role' then raise exception 'Service role is required'/i);
  assert.match(sql, /p_cancelled_by_role not in \('renter', 'owner'\)/i);
  assert.match(sql, /from public\.reservations r where r\.id = p_reservation_id for update/i);
  assert.match(sql, /from public\.payments p[\s\S]*limit 1 for update/i);
  assert.match(sql, /v_reservation\.status <> 'paid'/i);
  assert.match(
    sql,
    /p_cancelled_by_role = 'renter' and p_cancelled_by_user_id <> v_reservation\.renter_id/i
  );
  assert.match(
    sql,
    /p_cancelled_by_role = 'owner' and p_cancelled_by_user_id <> v_reservation\.owner_id/i
  );
  assert.match(
    sql,
    /\(\(v_reservation\.start_date \+ v_reservation\.pickup_time\) at time zone 'Europe\/Prague'\) - interval '6 hours'/i
  );
  assert.match(sql, /if v_now >= v_cutoff then raise exception 'Reservation can no longer be cancelled within 6 hours of pickup'/i);
});

test("begin paid cancellation blocks transfers, marks refund pending and is retry-safe", () => {
  const sql = compactSql(readMigration());

  assert.match(sql, /v_payment\.refund_status <> 'not_requested'/i);
  assert.match(sql, /v_payment\.stripe_refund_amount_minor <> 0/i);
  assert.match(sql, /v_payment\.stripe_refund_id is not null/i);
  assert.match(sql, /v_payment\.transfer_status <> 'not_created'/i);
  assert.match(sql, /v_payment\.stripe_transfer_id is not null/i);
  assert.match(sql, /refund_status = 'pending'/i);
  assert.match(sql, /refund_requested_at = coalesce\(p\.refund_requested_at, v_now\)/i);
  assert.match(sql, /perform set_config\('app\.paid_cancellation_authorized', 'on', true\)/i);
  assert.match(sql, /status = 'cancelled'/i);
  assert.match(
    sql,
    /v_existing\.cancellation_kind = 'paid_refund'[\s\S]*v_payment\.refund_status in \('pending', 'requires_action', 'succeeded', 'failed'\)/i
  );
});

test("paid cancellation RPC is callable only by service role", () => {
  const sql = compactSql(readMigration());

  assert.match(
    sql,
    /revoke all on function public\.begin_paid_reservation_cancellation\(uuid, text, uuid\) from public, anon, authenticated/i
  );
  assert.match(
    sql,
    /grant execute on function public\.begin_paid_reservation_cancellation\(uuid, text, uuid\) to service_role/i
  );
});
