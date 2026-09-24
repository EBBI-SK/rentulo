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
  "20260924090000_add_stripe_payment_foundation.sql"
);

function compactSql(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

function readMigration() {
  return fs.readFileSync(MIGRATION_PATH, "utf8");
}

function tableDefinition(sql, tableName) {
  const pattern = new RegExp(
    "create\\s+table\\s+if\\s+not\\s+exists\\s+public\\." +
      tableName +
      "\\s*\\(([\\s\\S]*?)\\n\\);",
    "i"
  );
  const match = sql.match(pattern);
  assert.ok(match, "Missing table definition for public." + tableName);
  return compactSql(match[1]);
}

test("Stripe payment foundation stores provider identifiers and exact minor-unit amounts", () => {
  const sql = compactSql(readMigration());

  for (const column of [
    "currency",
    "stripe_amount_total_minor",
    "stripe_payment_intent_id",
    "stripe_payment_intent_status",
    "stripe_charge_id",
    "stripe_charge_balance_transaction_id",
    "stripe_fee_amount_minor",
    "stripe_transfer_id",
    "stripe_transfer_amount_minor",
    "transfer_status",
    "transfer_created_at",
    "stripe_refund_id",
    "stripe_refund_balance_transaction_id",
    "stripe_refund_amount_minor",
    "refund_status",
    "refund_requested_at",
    "refunded_at",
    "updated_at"
  ]) {
    assert.match(sql, new RegExp("add column if not exists " + column + "\\b", "i"));
  }

  assert.match(sql, /check\s*\(\s*currency\s*=\s*'czk'\s*\)/i);

  for (const stripeColumn of [
    "stripe_payment_intent_id",
    "stripe_charge_id",
    "stripe_transfer_id",
    "stripe_refund_id"
  ]) {
    assert.match(
      sql,
      new RegExp(
        "create unique index if not exists [^ ]+ on public\\.payments \\(" +
          stripeColumn +
          "\\) where " +
          stripeColumn +
          " is not null",
        "i"
      )
    );
  }
});

test("Stripe webhook log has an idempotent event key and processing state", () => {
  const sql = readMigration();
  const table = tableDefinition(sql, "stripe_webhook_events");

  assert.match(table, /stripe_event_id text not null unique/i);
  assert.match(table, /event_type text not null/i);
  assert.match(table, /livemode boolean not null/i);
  assert.match(
    table,
    /processing_status text not null default 'received' check \(processing_status in \('received', 'processing', 'processed', 'ignored', 'failed'\)\)/i
  );
  assert.match(table, /attempt_count integer not null default 0 check \(attempt_count >= 0\)/i);
  assert.match(table, /payment_id uuid references public\.payments\(id\) on delete set null/i);
  assert.match(table, /reservation_id uuid references public\.reservations\(id\) on delete set null/i);
});

test("Cancellation audit records who cancelled and itemizes only actual external costs", () => {
  const sql = readMigration();
  const cancellation = tableDefinition(sql, "reservation_cancellations");
  const costs = tableDefinition(sql, "reservation_cancellation_cost_items");

  assert.match(cancellation, /reservation_id uuid not null unique references public\.reservations\(id\)/i);
  assert.match(cancellation, /payment_id uuid references public\.payments\(id\)/i);
  assert.match(
    cancellation,
    /cancelled_by_role text not null check \(cancelled_by_role in \('renter', 'owner', 'rentulo'\)\)/i
  );
  assert.match(cancellation, /cancelled_by_user_id uuid references public\.profiles\(id\)/i);
  assert.match(cancellation, /cancelled_at timestamptz not null default now\(\)/i);

  assert.match(costs, /external_cost_key text not null unique/i);
  assert.match(costs, /source_reference_id text not null/i);
  assert.match(costs, /amount_minor integer not null check \(amount_minor > 0\)/i);
  assert.match(costs, /currency text not null default 'czk' check \(currency = 'czk'\)/i);
  assert.match(costs, /charged_to text not null check \(charged_to in \('renter', 'owner', 'rentulo'\)\)/i);
  assert.match(costs, /'stripe_processing_fee'/i);
  assert.match(costs, /'stripe_refund_fee'/i);
  assert.match(costs, /'sms'/i);
  assert.match(costs, /'email'/i);
  assert.match(costs, /'other_external'/i);
  assert.doesNotMatch(costs, /platform_fee/i, "Platform fee must never be a cancellation-cost item");
});

test("Stripe financial tables are backend-only and the legacy browser payment insert path is removed", () => {
  const sql = compactSql(readMigration());

  assert.match(sql, /drop trigger if exists prepare_payment_before_insert on public\.payments/i);
  assert.match(sql, /drop function if exists public\.prepare_payment_insert\(\)/i);
  assert.match(sql, /drop policy if exists payments_insert_as_payer on public\.payments/i);
  assert.match(sql, /drop policy if exists payments_select_related on public\.payments/i);

  for (const table of [
    "payments",
    "stripe_webhook_events",
    "reservation_cancellations",
    "reservation_cancellation_cost_items"
  ]) {
    assert.match(
      sql,
      new RegExp(
        "revoke all on table public\\." + table + " from public, anon, authenticated",
        "i"
      )
    );
    assert.match(
      sql,
      new RegExp("grant all on table public\\." + table + " to service_role", "i")
    );
  }

  for (const table of [
    "stripe_webhook_events",
    "reservation_cancellations",
    "reservation_cancellation_cost_items"
  ]) {
    assert.match(
      sql,
      new RegExp("alter table public\\." + table + " enable row level security", "i")
    );
  }
});
