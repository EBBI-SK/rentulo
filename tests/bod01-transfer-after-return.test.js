"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const sql = read("supabase/migrations/20261018001000_transfer_only_after_return_TEST.sql");
const pin = read("supabase/functions/confirm-pickup/index.ts");
const transfer = read("supabase/functions/create-owner-transfer/index.ts");
const retryWorker = read("supabase/functions/retry-owner-transfers/index.ts");
const i18n = read("js/i18n.js");

function functionBody(name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} declaration missing`);
  const end = sql.indexOf("\n$function$;", start);
  assert.ok(end > start, `${name} definition missing closure`);
  return sql.slice(start, end);
}

// Need both the backend RPC and trusted Edge Function to prevent early transfer.
test("PIN consumes once but never initiates or claims an owner Stripe transfer", () => {
  assert.match(pin, /admin\.rpc\("confirm_reservation_pickup"/);
  assert.match(pin, /pin_consumed: true/);
  assert.match(pin, /status: "picked_up"/);
  assert.match(pin, /transfer_status: "not_created"/);
  assert.doesNotMatch(pin, /\/functions\/v1\/create-owner-transfer/);
  assert.doesNotMatch(pin, /api\.stripe\.com\/v1\/transfers/);
});

test("trusted transfer Edge only permits returned and paid no-show and rejects picked_up", () => {
  assert.match(transfer, /!\["returned", "no_show"\]\.includes\(reservation\.status\)/);
  assert.doesNotMatch(transfer, /"picked_up", "returned", "no_show"/);
  assert.match(transfer, /payment\.refund_status !== "not_requested"/);
  assert.match(transfer, /admin\.rpc\("claim_stripe_owner_transfer_attempt"/);
  assert.match(transfer, /source_transaction", payment\.stripe_charge_id/);
  assert.match(transfer, /Idempotency-Key.*rentulo-owner-transfer-\$\{payment\.id\}/s);
});

test("TEST guard prevents migration in PROD and existing transfers are untouched", () => {
  assert.match(sql, /https:\/\/vspposovhdgvbeukoivh\.supabase\.co/);
  assert.match(sql, /vault\.decrypted_secrets/);
  // Replaced function BODIES still contain their existing transactional write.
  // There must be no direct data-migration UPDATE outside the definitions.
  const ddlOnly = sql.replace(/create or replace function public\.[\s\S]*?\n\$function\$;/gi, "");
  assert.doesNotMatch(ddlOnly, /update public\.payments/i);
  assert.doesNotMatch(ddlOnly, /update public\.reservations/i);
  assert.doesNotMatch(ddlOnly, /delete from public\.payments/i);
});

test("database claim rejects picked_up but allows returned and no_show without weakening payment guards", () => {
  const src = functionBody("claim_stripe_owner_transfer_attempt");
  assert.match(src, /v_reservation_status not in \('returned', 'no_show'\)/i);
  assert.doesNotMatch(src, /'picked_up'/i);
  assert.match(src, /auth\.role\(\) <> 'service_role'/i);
  assert.match(src, /v_payment\.refund_status <> 'not_requested'/i);
  assert.match(src, /v_payment\.stripe_transfer_id is not null/i);
  assert.match(src, /for update/i);
  assert.match(src, /transfer_attempt_count = p\.transfer_attempt_count \+ 1/i);
});

test("finalizer rejects picked_up and retains exact Stripe transfer reconciliation", () => {
  const src = functionBody("record_stripe_owner_transfer_attempt");
  assert.match(src, /v_reservation\.status not in \('returned', 'no_show'\)/i);
  assert.doesNotMatch(src, /'picked_up'/i);
  assert.match(src, /v_payment\.stripe_transfer_id <> p_stripe_transfer_id/i);
  assert.match(src, /v_payment\.transfer_status <> 'succeeded'/i);
  assert.match(src, /stripe_charge_balance_transaction_id = p_stripe_charge_balance_transaction_id/i);
  assert.match(src, /stripe_transfer_currency = p_transfer_currency/i);
  assert.match(src, /v_payment\.refund_status <> 'not_requested'/i);
  assert.match(src, /transfer_status = 'succeeded'/i);
});

test("five-minute worker only queues returned and no-show payments, not picked_up", () => {
  const src = functionBody("get_due_stripe_owner_transfer_retry_candidates");
  assert.match(src, /r\.status in \('returned', 'no_show'\)/i);
  assert.doesNotMatch(src, /'picked_up'/i);
  assert.match(src, /p\.transfer_status = 'not_created'/i);
  assert.match(src, /p\.transfer_status = 'failed'/i);
  assert.match(src, /p\.transfer_status = 'pending'/i);
  assert.match(src, /p\.refund_status = 'not_requested'/i);
  assert.match(retryWorker, /get_due_stripe_owner_transfer_retry_candidates/);
  assert.match(retryWorker, /\/functions\/v1\/create-owner-transfer/);
});

test("obsolete service-role recorder is disabled; no access for browser clients", () => {
  assert.match(sql, /revoke execute on function public\.record_stripe_owner_transfer\(\s*uuid, uuid, text, integer, text, text, integer, text\s*\) from public, anon, authenticated, service_role;/i);
  assert.match(sql, /revoke all on function public\.claim_stripe_owner_transfer_attempt\(uuid, uuid\)[\s\S]*?from public, anon, authenticated;/i);
  assert.match(sql, /grant execute on function public\.get_due_stripe_owner_transfer_retry_candidates\(integer\)[\s\S]*?to service_role;/i);
});

test("all five languages explain deferred transfer, while no-show remains a separate case", () => {
  for (const key of ["how.ownerStep6Text", "terms.section6.item3", "terms.section8.item1", "offers.note.pickedUp", "offers.note.returned"]) {
    assert.equal((i18n.match(new RegExp(`"${key.replaceAll(".", "\\.")}":`, "g")) || []).length, 5, key);
  }
  assert.doesNotMatch(i18n, /Rentulo výplatu záměrně neodkládá do vrácení věci/);
  assert.doesNotMatch(i18n, /Rentulo výplatu zámerne neodkladá do vrátenia veci/);
  assert.doesNotMatch(i18n, /Rentulo does not deliberately wait for the item to be returned/);
  assert.doesNotMatch(i18n, /Výplata byla uvolněna\. Rentulo předalo Stripe pokyn/);
});

test("late transfer handles Stripe balance-insufficient as retryable without retrying every 4xx", () => {
  assert.match(transfer, /createdTransfer\.error\?\.code === "balance_insufficient"/);
  assert.match(transfer, /isRetryableStripeStatus\(transferResponse\.status\) \|\|/);
  assert.doesNotMatch(transfer, /return await failAttempt\([\s\S]*?true,[\s\S]*?transferResponse\.status\);/);
});

test("checked-in historical no-show settlement policy and Cron schedules are not redefined", () => {
  assert.doesNotMatch(sql, /create or replace function public\.process_due_reservation_no_shows/);
  assert.doesNotMatch(sql, /cron\.schedule/);
  assert.match(sql, /'no_show'/);
});
