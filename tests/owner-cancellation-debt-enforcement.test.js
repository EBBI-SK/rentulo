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
  "20261007100000_block_overdue_owner_debt_approvals.sql"
);
const PAGE_JS_PATH = path.join(PROJECT_ROOT, "js", "offers-page.js");
const PAGE_CSS_PATH = path.join(PROJECT_ROOT, "css", "my-offers-flow.css");
const I18N_PATH = path.join(PROJECT_ROOT, "js", "i18n.js");

const migration = fs.readFileSync(MIGRATION_PATH, "utf8");
const pageSource = fs.readFileSync(PAGE_JS_PATH, "utf8");
const css = fs.readFileSync(PAGE_CSS_PATH, "utf8");
const i18n = fs.readFileSync(I18N_PATH, "utf8");

function compact(value) {
  return value.replace(/\s+/g, " ").trim();
}

const compactMigration = compact(migration);

test("overdue open owner debt blocks only pending to approved at the database guard", () => {
  assert.match(
    compactMigration,
    /old\.status = 'pending' and new\.status = 'approved' and exists \( select 1 from public\.owner_cancellation_debts d[\s\S]*?d\.owner_id = auth\.uid\(\)[\s\S]*?d\.status = 'open'[\s\S]*?d\.due_at <= now\(\)/i
  );
  assert.match(migration, /OWNER_OVERDUE_CANCELLATION_DEBT/);
  assert.match(
    compactMigration,
    /old\.status = 'pending' and new\.status in \('approved', 'rejected'\)/i
  );
});

test("debt enforcement preserves trusted payment pickup paid-cancellation and six-hour cancellation guards", () => {
  assert.match(migration, /app\.stripe_payment_authorized/);
  assert.match(migration, /app\.pickup_pin_authorized/);
  assert.match(migration, /app\.paid_cancellation_authorized/);
  assert.match(migration, /interval '6 hours'/);
  assert.match(migration, /old\.status = 'picked_up' and new\.status = 'returned'/);
  assert.match(migration, /app\.test_payment_authorized/);
});

test("overdue debt is detected client-side only for UX while database remains authoritative", () => {
  assert.match(pageSource, /function isOwnerDebtOverdue\(debt\)/);
  assert.match(pageSource, /debt\.status !== "open"/);
  assert.match(pageSource, /dueAtMs <= Date\.now\(\)/);
  assert.match(pageSource, /function hasOverdueOwnerDebt\(\)/);
  assert.match(pageSource, /disabled aria-disabled="true"/);
  assert.match(pageSource, /OWNER_OVERDUE_CANCELLATION_DEBT/);
  assert.match(pageSource, /offers\.debt\.approvalBlocked/);
});

test("overdue owner debt has a visible warning and overdue status", () => {
  assert.match(pageSource, /offers\.debt\.overdueWarning/);
  assert.match(pageSource, /offers\.debt\.statusOverdue/);
  assert.match(css, /\.owner-debt-overdue-warning/);
  assert.match(css, /\.owner-debt-row\.is-overdue/);
  assert.match(css, /\.owner-debt-status\.is-overdue/);
});

test("overdue debt copy exists in all five supported languages", () => {
  [
    "offers.debt.statusOverdue",
    "offers.debt.overdueWarning",
    "offers.debt.approvalBlocked"
  ].forEach((key) => {
    const count = (i18n.match(new RegExp(`"${key.replaceAll(".", "\\.")}"`, "g")) || []).length;
    assert.equal(count, 5, `${key} should exist once for each supported language`);
  });
});

test("status guard remains inaccessible directly to browser roles", () => {
  assert.match(
    compactMigration,
    /revoke all on function public\.protect_reservation_status_transition\(\) from public, anon, authenticated/i
  );
});
