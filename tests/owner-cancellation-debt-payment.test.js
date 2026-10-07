"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const CHECKOUT_PATH = path.join(
  PROJECT_ROOT,
  "supabase",
  "functions",
  "create-owner-debt-checkout",
  "index.ts"
);
const WEBHOOK_PATH = path.join(
  PROJECT_ROOT,
  "supabase",
  "functions",
  "stripe-webhook",
  "index.ts"
);
const MIGRATION_PATH = path.join(
  PROJECT_ROOT,
  "supabase",
  "migrations",
  "20261007070000_add_owner_debt_payment_checkout.sql"
);

const checkoutSource = fs.readFileSync(CHECKOUT_PATH, "utf8");
const webhookSource = fs.readFileSync(WEBHOOK_PATH, "utf8");
const migrationSource = fs.readFileSync(MIGRATION_PATH, "utf8");

function compact(value) {
  return value.replace(/\s+/g, " ").trim();
}

const compactMigration = compact(migrationSource);

test("owner debt payment foundation stores Stripe checkout identifiers without exposing the debt table", () => {
  assert.match(migrationSource, /alter table public\.owner_cancellation_debts/i);
  assert.match(migrationSource, /add column if not exists stripe_checkout_session_id text/i);
  assert.match(migrationSource, /add column if not exists stripe_payment_intent_id text/i);
  assert.match(migrationSource, /add column if not exists stripe_payment_intent_status text/i);
  assert.match(migrationSource, /add column if not exists payment_requested_at timestamptz/i);
  assert.match(migrationSource, /owner_cancellation_debts_stripe_checkout_session_unique/i);
  assert.match(migrationSource, /owner_cancellation_debts_stripe_payment_intent_unique/i);
  assert.doesNotMatch(
    migrationSource,
    /grant\s+(?:select|insert|update|delete|all).*owner_cancellation_debts.*authenticated/i
  );
});

test("owner debt Checkout authenticates the signed-in owner and accepts only an open backend debt", () => {
  assert.match(checkoutSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(checkoutSource, /STRIPE_SECRET_KEY/);
  assert.match(checkoutSource, /SITE_URL/);
  assert.match(checkoutSource, /getUser\(accessToken\)/);
  assert.match(checkoutSource, /let payload: \{ debt_id\?: string \}/);
  assert.match(checkoutSource, /\.from\("owner_cancellation_debts"\)/);
  assert.match(checkoutSource, /actor\.id !== debt\.owner_id/);
  assert.match(checkoutSource, /debt\.status !== "open"/);
  assert.doesNotMatch(
    checkoutSource,
    /payload\.(?:amount|amount_minor|currency|owner_id|status)/i
  );
});

test("owner debt Checkout derives the exact CZK amount and adds no surcharge", () => {
  assert.match(checkoutSource, /const amountMinor = Number\(debt\.amount_minor\);/);
  assert.match(checkoutSource, /debt\.currency !== "czk"/);
  assert.match(checkoutSource, /"line_items\[0\]\[price_data\]\[currency\]", "czk"/);
  assert.match(checkoutSource, /"line_items\[0\]\[price_data\]\[unit_amount\]", String\(amountMinor\)/);
  assert.doesNotMatch(checkoutSource, /application_fee_amount/i);
  assert.doesNotMatch(checkoutSource, /transfer_data\[/i);
  assert.doesNotMatch(checkoutSource, /amountMinor\s*[+*]/);
});

test("owner debt Checkout correlates Stripe objects with one debt and uses an idempotency key", () => {
  assert.match(checkoutSource, /"metadata\[payment_kind\]", "owner_cancellation_debt"/);
  assert.match(checkoutSource, /"metadata\[owner_cancellation_debt_id\]", debt\.id/);
  assert.match(checkoutSource, /"metadata\[owner_id\]", actor\.id/);
  assert.match(
    checkoutSource,
    /"payment_intent_data\[metadata\]\[owner_cancellation_debt_id\]"[\s\S]*debt\.id/
  );
  assert.match(
    checkoutSource,
    /"Idempotency-Key": `rentulo-owner-debt-checkout-\$\{debt\.id\}`/
  );
  assert.match(checkoutSource, /stripe_checkout_session_id: checkoutSession\.id/);
  assert.match(checkoutSource, /payment_requested_at: new Date\(\)\.toISOString\(\)/);
  assert.match(checkoutSource, /moje-nabidky\.html\?debt_payment=success/);
  assert.match(checkoutSource, /moje-nabidky\.html\?debt_payment=cancelled/);
  assert.match(checkoutSource, /return jsonResponse\(\{ url: checkoutSession\.url \}\);/);
});

test("Stripe webhook routes a debt PaymentIntent to the dedicated trusted completion RPC", () => {
  assert.match(webhookSource, /metadata\.payment_kind/);
  assert.match(webhookSource, /owner_cancellation_debt/);
  assert.match(webhookSource, /metadata\.owner_cancellation_debt_id/);
  assert.match(webhookSource, /metadata\.owner_id/);
  assert.match(
    webhookSource,
    /admin\.rpc\(\s*"complete_owner_cancellation_debt_payment_from_webhook"/
  );
  assert.match(webhookSource, /owner_cancellation_debt_id: debtId/);

  const debtRoute = webhookSource.indexOf(
    'asString(metadata.payment_kind) === "owner_cancellation_debt"'
  );
  const reservationMetadata = webhookSource.lastIndexOf(
    "const paymentId = asString(metadata.payment_id);"
  );
  assert.ok(
    debtRoute >= 0 && reservationMetadata > debtRoute,
    "Debt PaymentIntents must be routed before reservation-payment metadata is required"
  );
});

test("owner debt completion RPC validates owner, exact amount and initialized Checkout before settling", () => {
  assert.match(
    compactMigration,
    /create or replace function public\.complete_owner_cancellation_debt_payment_from_webhook\(/i
  );
  assert.match(compactMigration, /auth\.role\(\) <> 'service_role'/i);
  assert.match(compactMigration, /v_debt\.owner_id <> p_owner_id/i);
  assert.match(compactMigration, /v_debt\.currency <> 'czk'/i);
  assert.match(compactMigration, /v_debt\.amount_minor <> p_amount_received_minor/i);
  assert.match(compactMigration, /v_debt\.status <> 'open'/i);
  assert.match(compactMigration, /v_debt\.stripe_checkout_session_id is null/i);
  assert.match(compactMigration, /v_debt\.payment_requested_at is null/i);
  assert.match(compactMigration, /status = 'paid'/i);
  assert.match(compactMigration, /settlement_reference = p_stripe_payment_intent_id/i);
  assert.match(compactMigration, /stripe_payment_intent_status = 'succeeded'/i);
  assert.doesNotMatch(compactMigration, /update public\.reservations/i);
  assert.doesNotMatch(compactMigration, /update public\.payments/i);
});

test("owner debt completion is service-role only and idempotent for the same successful PaymentIntent", () => {
  assert.match(compactMigration, /if v_debt\.status = 'paid' then/i);
  assert.match(
    compactMigration,
    /v_debt\.settlement_reference <> p_stripe_payment_intent_id/i
  );
  assert.match(
    compactMigration,
    /v_debt\.stripe_payment_intent_id <> p_stripe_payment_intent_id/i
  );
  assert.match(
    compactMigration,
    /v_debt\.stripe_payment_intent_status <> 'succeeded'/i
  );
  assert.match(
    compactMigration,
    /revoke all on function public\.complete_owner_cancellation_debt_payment_from_webhook\([\s\S]*?\) from public, anon, authenticated/i
  );
  assert.match(
    compactMigration,
    /grant execute on function public\.complete_owner_cancellation_debt_payment_from_webhook\([\s\S]*?\) to service_role/i
  );
});
