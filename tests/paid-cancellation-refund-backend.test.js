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
  "cancel-paid-reservation",
  "index.ts"
);
const MIGRATION_PATH = path.join(
  PROJECT_ROOT,
  "supabase",
  "migrations",
  "20260928160000_add_paid_cancellation_refund_backend.sql"
);

function readFunction() {
  return fs.readFileSync(FUNCTION_PATH, "utf8");
}

function compactSql() {
  return fs.readFileSync(MIGRATION_PATH, "utf8").replace(/\s+/g, " ").trim();
}

test("paid cancellation endpoint authenticates the actor and exposes preview plus confirm only", () => {
  const source = readFunction();

  assert.match(source, /req\.method === "OPTIONS"/);
  assert.match(source, /userClient\.auth\.getUser\(accessToken\)/);
  assert.match(source, /action !== "preview" && action !== "confirm"/);
  assert.match(source, /get_paid_reservation_cancellation_context/);
  assert.match(source, /p_actor_user_id:\s*actor\.id/);
});

test("preview reads the exact Stripe charge and settlement fee without mutating cancellation state", () => {
  const source = readFunction();

  assert.match(source, /https:\/\/api\.stripe\.com\/v1\/charges\//);
  assert.match(source, /https:\/\/api\.stripe\.com\/v1\/balance_transactions\//);
  assert.match(source, /balance\.fee/);
  assert.match(source, /balance\.exchange_rate/);
  assert.match(source, /if \(action === "preview"\) \{[\s\S]*return jsonResponse\(publicQuote\(context, quote\)\);/);
});

test("actual Stripe fee is converted proportionally from settlement currency into exact CZK minor units", () => {
  const source = readFunction();

  assert.match(source, /BigInt\(providerFeeMinor\) \* BigInt\(paymentAmountMinor\)/);
  assert.match(source, /BigInt\(settlementAmountMinor\)/);
  assert.match(source, /\(numerator \+ denominator \/ 2n\) \/ denominator/);
  assert.match(source, /actorRole === "renter"[\s\S]*paymentAmountMinor - externalCostAmountMinor[\s\S]*: paymentAmountMinor/);
});

test("confirm starts the trusted cancellation then creates one idempotent Stripe refund", () => {
  const source = readFunction();

  assert.match(source, /begin_paid_reservation_cancellation/);
  assert.match(source, /https:\/\/api\.stripe\.com\/v1\/refunds/);
  assert.match(source, /refundParams\.set\("amount", String\(quote\.refundAmountMinor\)\)/);
  assert.match(source, /Idempotency-Key": `rentulo-paid-cancellation-\$\{cancellationId\}`/);
  assert.match(source, /metadata\[cancellation_id\]/);
});

test("confirm retry reuses an existing Stripe refund and finalized cancellation", () => {
  const source = readFunction();

  assert.match(source, /context\.cancellation_financials_finalized_at[\s\S]*context\.stripe_refund_id/);
  assert.match(source, /existing:\s*true/);
  assert.match(source, /https:\/\/api\.stripe\.com\/v1\/refunds\/\$\{encodeURIComponent\(context\.stripe_refund_id\)\}/);
});

test("database quote context keeps the exact six-hour rule for new cancellations but permits safe retries", () => {
  const sql = compactSql();

  assert.match(sql, /create or replace function public\.get_paid_reservation_cancellation_context/i);
  assert.match(sql, /auth\.role\(\) <> 'service_role'/i);
  assert.match(sql, /p_actor_user_id = v_reservation\.renter_id then 'renter'/i);
  assert.match(sql, /p_actor_user_id = v_reservation\.owner_id then 'owner'/i);
  assert.match(sql, /interval '6 hours'/i);
  assert.match(sql, /if now\(\) >= v_cutoff then raise exception 'Reservation can no longer be cancelled within 6 hours of pickup'/i);
  assert.match(sql, /v_cancellation\.cancellation_kind <> 'paid_refund'/i);
  assert.match(sql, /v_reservation\.status <> 'cancelled'/i);
});

test("refund finalizer revalidates policy, Stripe evidence and blocks any owner transfer", () => {
  const sql = compactSql();

  assert.match(sql, /create or replace function public\.finalize_paid_reservation_cancellation_refund/i);
  assert.match(sql, /v_payment\.transfer_status <> 'not_created'/i);
  assert.match(sql, /v_payment\.stripe_transfer_id is not null/i);
  assert.match(sql, /round\( p_external_cost_provider_amount_minor::numeric \* v_cancellation\.payment_amount_minor::numeric \/ p_charge_balance_amount_minor::numeric \)::integer/i);
  assert.match(sql, /refund_policy = 'renter_external_cost_deducted'[\s\S]*p_refund_amount_minor \+ p_external_cost_amount_minor/i);
  assert.match(sql, /refund_policy = 'owner_full_refund_owner_cost'[\s\S]*p_refund_amount_minor <> v_cancellation\.payment_amount_minor/i);
});

test("accepted refund stores exact cost evidence and gives owner debt exactly seven days", () => {
  const sql = compactSql();

  assert.match(sql, /'stripe_processing_fee'/i);
  assert.match(sql, /provider_amount_minor/i);
  assert.match(sql, /provider_currency/i);
  assert.match(sql, /provider_exchange_rate/i);
  assert.match(sql, /v_charged_to := case when v_cancellation\.refund_policy = 'renter_external_cost_deducted' then 'renter' else 'owner' end/i);
  assert.match(sql, /v_cancellation\.refund_policy = 'owner_full_refund_owner_cost' and p_external_cost_amount_minor > 0/i);
  assert.match(sql, /v_now \+ interval '7 days'/i);
  assert.match(sql, /on conflict \(cancellation_id\) do nothing/i);
});

test("failed or canceled provider refund is recorded without finalizing cancellation financials", () => {
  const sql = compactSql();
  const source = readFunction();

  assert.match(sql, /v_is_accepted_refund := p_stripe_refund_status in \( 'pending', 'requires_action', 'succeeded' \)/i);
  assert.match(sql, /if v_is_accepted_refund then[\s\S]*financials_finalized_at = coalesce/i);
  assert.match(source, /refundStatus === "failed" \|\| refundStatus === "canceled"/);
  assert.match(source, /Stripe refund did not complete/);
});

test("new database functions remain service-role only", () => {
  const sql = compactSql();

  assert.match(sql, /revoke all on function public\.get_paid_reservation_cancellation_context\(uuid, uuid\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.get_paid_reservation_cancellation_context\(uuid, uuid\) to service_role/i);
  assert.match(sql, /revoke all on function public\.finalize_paid_reservation_cancellation_refund\([\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.finalize_paid_reservation_cancellation_refund\([\s\S]*to service_role/i);
});
