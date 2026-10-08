"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const migration = read("supabase/migrations/20261008100000_guard_account_deactivation_financials.sql");
const edge = read("supabase/functions/account-deactivation/index.ts");
const frontend = read("js/settings-page.js");
const translations = read("js/i18n.js");

const [eligibility, finalizer = ""] = migration.split(
  "create or replace function public.finalize_account_deactivation(target_user_id uuid)"
);

function assertFinancialPredicates(sql) {
  assert.match(sql, /from public\.owner_cancellation_debts d[\s\S]*?d\.owner_id\s*=\s*\w+[\s\S]*?d\.status = 'open'/);
  assert.match(sql, /from public\.reservation_cancellations c[\s\S]*?c\.cancellation_kind = 'paid_refund'/);
  assert.match(sql, /r\.owner_id = \w+ or r\.renter_id = \w+/);
  assert.match(sql, /c\.financials_finalized_at is null[\s\S]*?p\.refund_status is distinct from 'succeeded'/);
  assert.match(sql, /from public\.payments p[\s\S]*?p\.owner_id = \w+/);
  assert.match(sql, /'returned'::public\.reservation_status/);
  assert.match(sql, /p\.transfer_status is distinct from 'succeeded'/);
  assert.match(sql, /'pending'::public\.reservation_status/);
  assert.match(sql, /'approved'::public\.reservation_status/);
  assert.match(sql, /'paid'::public\.reservation_status/);
  assert.match(sql, /'picked_up'::public\.reservation_status/);
}

test("new read-only eligibility RPC exposes precise financial blocker counts without altering the old RPC signature", () => {
  assert.match(eligibility, /create function public\.get_my_account_deactivation_status_v2\(\)/);
  assert.doesNotMatch(eligibility, /drop function public\.get_my_account_deactivation_status\(\)/);
  for (const field of ["blocking_reservations_count", "open_owner_debts_count", "unfinished_refunds_count", "unresolved_owner_transfers_count"]) {
    assert.match(eligibility, new RegExp(field + " bigint"));
  }
  assert.match(eligibility, /v_account_status = 'active'[\s\S]*?v_reservations = 0[\s\S]*?v_debts = 0[\s\S]*?v_refunds = 0[\s\S]*?v_transfers = 0/);
  assert.match(eligibility, /set search_path = ''/);
  assert.match(migration, /revoke all on function public\.get_my_account_deactivation_status_v2\(\)[\s\S]*?from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.get_my_account_deactivation_status_v2\(\)[\s\S]*?to authenticated/);
});

test("eligibility and finalizer enforce matching reservation, debt, refund, and transfer conditions", () => {
  assertFinancialPredicates(eligibility);
  assertFinancialPredicates(finalizer);
  assert.match(finalizer, /pg_advisory_xact_lock\(860808, hashtext\(target_user_id::text\)\)/);
  assert.match(finalizer, /where p\.id = target_user_id\s+for update/);
  assert.match(finalizer, /if v_account_status = 'deactivated' then[\s\S]*?return query/);
  assert.match(finalizer, /Account has unresolved financial obligations/);
  assert.match(finalizer, /Account has active reservations/);
  assert.match(migration, /grant execute on function public\.finalize_account_deactivation\(uuid\)\s+to service_role/);
});

test("Edge Function rejects financial blockers with 409 and rechecks concurrent finalizer rejections", () => {
  assert.match(edge, /"get_my_account_deactivation_status_v2"/);
  assert.match(edge, /status\.blocking_reservations_count > 0[\s\S]*?financialBlockResponse\(status\)/);
  assert.match(edge, /code: "ACCOUNT_HAS_FINANCIAL_OBLIGATIONS"/);
  assert.match(edge, /open_owner_debts_count: status\.open_owner_debts_count/);
  assert.match(edge, /unfinished_refunds_count: status\.unfinished_refunds_count/);
  assert.match(edge, /unresolved_owner_transfers_count: status\.unresolved_owner_transfers_count/);
  assert.match(edge, /Account has unresolved financial obligations[\s\S]*?userClient\.rpc\("get_my_account_deactivation_status_v2"\)/);
  assert.match(edge, /function financialBlockResponse\([\s\S]*?\}, 409\)/);
  assert.match(edge, /status\.account_status !== "active" && status\.account_status !== "deactivated"/);
  assert.match(edge, /admin\.auth\.admin\.deleteUser\(actor\.id, true\)/);
});

test("settings UI shows financial blockers and restores the initial check button after server rejection", () => {
  assert.match(frontend, /client\.rpc\("get_my_account_deactivation_status_v2"\)/);
  assert.match(frontend, /showFinancialCancellationBlock\(message, status\)/);
  assert.match(frontend, /code === "ACCOUNT_HAS_FINANCIAL_OBLIGATIONS"[\s\S]*?resetAccountCancellationAfterBlock\(\)/);
  assert.match(frontend, /checkButton\.hidden = false/);
  for (const placeholder of ["{debts}", "{refunds}", "{transfers}"]) {
    assert.match(frontend, new RegExp(placeholder.replace(/[{}]/g, "\\$&")));
  }
  for (const key of ["settings.cancelAccountFinancialBlocked", "settings.cancelAccountFinancialBlockedGeneric"]) {
    assert.equal(translations.split('"' + key + '":').length - 1, 5, `${key} must be localized in five languages`);
  }
});
