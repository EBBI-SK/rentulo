"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_PATH = path.join(PROJECT_ROOT, "moje-nabidky.html");
const PAGE_JS_PATH = path.join(PROJECT_ROOT, "js", "offers-page.js");
const PAGE_CSS_PATH = path.join(PROJECT_ROOT, "css", "my-offers-flow.css");
const I18N_PATH = path.join(PROJECT_ROOT, "js", "i18n.js");
const MIGRATION_PATH = path.join(
  PROJECT_ROOT,
  "supabase",
  "migrations",
  "20261007080000_expose_owner_debts_to_owner.sql"
);

const html = fs.readFileSync(PAGE_PATH, "utf8");
const pageSource = fs.readFileSync(PAGE_JS_PATH, "utf8");
const css = fs.readFileSync(PAGE_CSS_PATH, "utf8");
const i18n = fs.readFileSync(I18N_PATH, "utf8");
const migration = fs.readFileSync(MIGRATION_PATH, "utf8");

function compact(value) {
  return value.replace(/\s+/g, " ").trim();
}

const compactMigration = compact(migration);

test("owner debt UI uses a narrow authenticated RPC instead of exposing the debt table", () => {
  assert.match(
    compactMigration,
    /create or replace function public\.get_my_owner_cancellation_debts\(\)/i
  );
  assert.match(compactMigration, /security definer/i);
  assert.match(compactMigration, /where d\.owner_id = auth\.uid\(\)/i);
  assert.match(
    compactMigration,
    /revoke all on function public\.get_my_owner_cancellation_debts\(\) from public, anon/i
  );
  assert.match(
    compactMigration,
    /grant execute on function public\.get_my_owner_cancellation_debts\(\) to authenticated/i
  );
  assert.doesNotMatch(migration, /grant\s+select.*owner_cancellation_debts.*authenticated/i);
});

test("My listings contains a dedicated owner debt section and responsive debt styling", () => {
  assert.match(html, /id="ownerDebtsSection"/);
  assert.match(css, /\.owner-debts-section/);
  assert.match(css, /\.owner-debt-row/);
  assert.match(css, /\.owner-debt-pay/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*\.owner-debt-row/);
});

test("owner debt rows load from the trusted RPC and display exact backend amount and due date", () => {
  assert.match(pageSource, /\.rpc\("get_my_owner_cancellation_debts"\)/);
  assert.match(pageSource, /amountMinor: Number\(row\.amount_minor\)/);
  assert.match(pageSource, /currency: String\(row\.currency/);
  assert.match(pageSource, /dueAt: row\.due_at/);
  assert.match(pageSource, /formatOwnerDebtMoney\(debt\.amountMinor, debt\.currency\)/);
  assert.match(pageSource, /formatOffersDateTime\(debt\.dueAt\)/);
  assert.match(pageSource, /minor \/ 100/);
});

test("only open owner debts render the Stripe payment button", () => {
  assert.match(pageSource, /const payAction = debt\.status === "open"/);
  assert.match(pageSource, /data-offers-action="pay-owner-debt"/);
  assert.match(pageSource, /data-debt-id="\$\{escapeHtml\(debt\.id\)\}"/);
  assert.match(pageSource, /status === "paid"/);
  assert.match(pageSource, /status === "waived"/);
});

test("owner debt payment starts the dedicated Checkout with debt id only", () => {
  assert.match(
    pageSource,
    /functions\.invoke\(\s*"create-owner-debt-checkout"[\s\S]*?body:\s*\{\s*debt_id:\s*debtId\s*\}/
  );
  assert.doesNotMatch(
    pageSource,
    /create-owner-debt-checkout[\s\S]{0,250}?(?:amount_minor|currency|owner_id)\s*:/i
  );
  assert.match(pageSource, /window\.location\.href = checkoutUrl/);
  assert.match(pageSource, /params\.get\("debt_payment"\)/);
  assert.match(pageSource, /params\.delete\("debt_payment"\)/);
});

test("owner debt UI copy exists in all five supported languages", () => {
  [
    "offers.debt.heading",
    "offers.debt.description",
    "offers.debt.amount",
    "offers.debt.due",
    "offers.debt.status",
    "offers.debt.statusOpen",
    "offers.debt.statusPaid",
    "offers.debt.statusWaived",
    "offers.debt.pay",
    "offers.debt.paymentError",
    "offers.debt.paymentSuccessTitle",
    "offers.debt.paymentCancelledTitle"
  ].forEach((key) => {
    const count = (i18n.match(new RegExp(`"${key.replaceAll(".", "\\.")}"`, "g")) || []).length;
    assert.equal(count, 5, `${key} should exist once for each supported language`);
  });
});
