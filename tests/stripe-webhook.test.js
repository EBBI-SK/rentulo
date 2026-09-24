"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
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
  "20260924132000_complete_stripe_payments_from_webhook.sql"
);

function compact(value) {
  return value.replace(/\s+/g, " ").trim();
}

function readWebhook() {
  return fs.readFileSync(WEBHOOK_PATH, "utf8");
}

function readMigration() {
  return fs.readFileSync(MIGRATION_PATH, "utf8");
}

test("Stripe webhook verifies the raw signed body with HMAC SHA-256 and a timestamp tolerance", () => {
  const source = readWebhook();

  assert.match(source, /const rawBody = await req\.text\(\)/);
  assert.match(source, /req\.headers\.get\("Stripe-Signature"\)/);
  assert.match(source, /crypto\.subtle\.importKey[\s\S]*HMAC[\s\S]*SHA-256/);
  assert.match(source, /`\$\{timestamp\}\.\$\{rawBody\}`/);
  assert.match(source, /SIGNATURE_TOLERANCE_SECONDS\s*=\s*300/);

  const verifyCallIndex = source.indexOf("await verifyStripeSignature(");
  const parseIndex = source.indexOf("JSON.parse(rawBody)");
  assert.ok(
    verifyCallIndex >= 0 && parseIndex > verifyCallIndex,
    "Signature must be verified before JSON parsing"
  );
});

test("Stripe webhook records idempotent events and does not require a browser authorization token", () => {
  const source = readWebhook();

  assert.match(source, /from\("stripe_webhook_events"\)/);
  assert.match(source, /processing_status:\s*"processing"/);
  assert.match(source, /attempt_count:\s*1/);
  assert.match(source, /inserted\.error\?\.code\s*!==\s*"23505"/);
  assert.match(source, /duplicateDone/);
  assert.doesNotMatch(source, /req\.headers\.get\("Authorization"\)/);
  assert.doesNotMatch(source, /auth\.getUser/);
});

test("Stripe webhook only completes payment_intent.succeeded and delegates state changes to the trusted RPC", () => {
  const source = readWebhook();

  assert.match(source, /eventType\s*!==\s*"payment_intent\.succeeded"/);
  assert.match(source, /metadata\.payment_id/);
  assert.match(source, /metadata\.reservation_id/);
  assert.match(source, /amount_received/);
  assert.match(source, /currency\s*!==\s*"czk"/);
  assert.match(source, /admin\.rpc\("complete_stripe_payment_from_webhook"/);
  assert.doesNotMatch(source, /from\("reservations"\)[\s\S]{0,120}\.update\(/);
  assert.doesNotMatch(source, /from\("payments"\)[\s\S]{0,120}\.update\(/);
});

test("database completion RPC validates Stripe amount and parties before atomically marking payment and reservation paid", () => {
  const sql = compact(readMigration());

  assert.match(sql, /create or replace function public\.complete_stripe_payment_from_webhook\(/i);
  assert.match(sql, /auth\.role\(\) <> 'service_role'/i);
  assert.match(sql, /v_payment\.provider <> 'stripe'/i);
  assert.match(sql, /v_payment\.payer_id <> v_reservation\.renter_id/i);
  assert.match(sql, /v_payment\.owner_id <> v_reservation\.owner_id/i);
  assert.match(sql, /v_payment\.stripe_amount_total_minor <> p_amount_received_minor/i);
  assert.match(sql, /v_payment\.amount_total \* 100 <> p_amount_received_minor/i);
  assert.match(sql, /v_payment\.status <> 'pending'/i);
  assert.match(sql, /v_reservation\.status <> 'approved'/i);
  assert.match(sql, /set_config\('app\.stripe_payment_authorized', 'on', true\)/i);
  assert.match(sql, /update public\.payments p set status = 'paid'/i);
  assert.match(sql, /update public\.reservations r set status = 'paid'/i);
  assert.match(sql, /payment_provider_status = 'succeeded'/i);
});

test("database completion RPC treats the same already-paid Stripe PaymentIntent as idempotent success", () => {
  const sql = compact(readMigration());

  assert.match(sql, /if v_payment\.status = 'paid' then/i);
  assert.match(sql, /v_payment\.stripe_payment_intent_id <> p_stripe_payment_intent_id/i);
  assert.match(sql, /v_payment\.stripe_payment_intent_status <> 'succeeded'/i);
  assert.match(sql, /v_reservation\.status not in \('paid', 'picked_up', 'returned'\)/i);

  const paidBranchIndex = sql.indexOf("if v_payment.status = 'paid' then");
  const pendingGuardIndex = sql.indexOf("if v_payment.status <> 'pending' then");
  assert.ok(
    paidBranchIndex >= 0 && pendingGuardIndex > paidBranchIndex,
    "Already-paid idempotency handling must run before the pending-only guard"
  );

  assert.match(
    sql,
    /return query select v_payment\.id, v_reservation\.id, v_payment\.status, v_reservation\.status, v_payment\.paid_at;/i
  );
});

test("Stripe completion path is service-role only and preserves the existing test-payment and cancellation rules", () => {
  const sql = compact(readMigration());

  assert.match(
    sql,
    /revoke all on function public\.complete_stripe_payment_from_webhook\([\s\S]*?\) from public, anon, authenticated/i
  );
  assert.match(
    sql,
    /grant execute on function public\.complete_stripe_payment_from_webhook\([\s\S]*?\) to service_role/i
  );
  assert.match(
    sql,
    /old\.status = 'approved' and new\.status = 'paid' and auth\.role\(\) = 'service_role' and current_setting\('app\.stripe_payment_authorized', true\) = 'on'/i
  );
  assert.match(sql, /current_setting\( 'app\.test_payment_authorized', true \) = 'on'/i);
  assert.match(sql, /from public\.test_payment_users t where t\.user_id = auth\.uid\(\)/i);
  assert.match(sql, /new\.status = 'cancelled'/i);
  assert.match(sql, /interval '6 hours'/i);
});
