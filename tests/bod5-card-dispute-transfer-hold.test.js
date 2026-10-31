"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const testSql = read("supabase/migrations/20261031180000_bod5_card_dispute_transfer_hold_TEST.sql");
const prodSql = read("supabase/prod-release-20261031/migrations/20261031180000_bod5_card_dispute_transfer_hold_PROD.sql");
const duFixSql = read("supabase/migrations/20261031183000_bod5_dispute_id_du_prefix_TEST.sql");
const webhook = read("supabase/functions/stripe-webhook/index.ts");
const original = read("supabase/functions/create-owner-transfer/index.ts");
const extension = read("supabase/functions/create-extension-transfer/index.ts");
const retry = read("supabase/functions/retry-owner-transfers/index.ts");

test("BOD5: Stripe real dispute IDs du_ are accepted end-to-end, dp_ still rejected", () => {
  // Applied migrations stay immutable; corrections go into a new TEST migration.
  assert.ok(testSql.includes("CHECK (dispute_id ~ '^dp_[A-Za-z0-9]+$')"));
  assert.ok(duFixSql.includes("https://vspposovhdgvbeukoivh.supabase.co"));
  assert.ok(!duFixSql.includes("https://tfvgxrdjrpicgtvovehl.supabase.co"));
  assert.ok(duFixSql.includes("DROP CONSTRAINT stripe_card_disputes_dispute_id_check"));
  assert.ok(duFixSql.includes("ADD CONSTRAINT stripe_card_disputes_dispute_id_check"));
  for (const sql of [duFixSql, prodSql]) {
    assert.ok(sql.includes("CHECK (dispute_id ~ '^du_[A-Za-z0-9]+$')"));
    assert.ok(sql.includes("p_dispute_id !~ '^du_[A-Za-z0-9]+$'"));
    assert.ok(!sql.includes("'^dp_[A-Za-z0-9]+$'"));
  }
  assert.ok(webhook.includes("!/^du_[A-Za-z0-9]+$/.test(disputeId)"));
  assert.ok(!webhook.includes("!/^dp_[A-Za-z0-9]+$/.test(disputeId)"));
  const duIdPattern = /^du_[A-Za-z0-9]+$/;
  assert.equal(duIdPattern.test("du_1UWcxN2EOGKeXJDiC8Opm7Bl"), true);
  assert.equal(duIdPattern.test("dp_1UWcxN2EOGKeXJDiC8Opm7Bl"), false);
  assert.equal(duIdPattern.test("du_"), false);
});

test("BOD5: two releases use project-specific, fail-closed SQL guards", () => {
  assert.match(testSql, /vspposovhdgvbeukoivh\.supabase\.co/);
  assert.doesNotMatch(testSql, /rentulo_prod_release_target/);
  assert.match(prodSql, /rentulo_prod_release_target/);
  assert.match(prodSql, /tfvgxrdjrpicgtvovehl\.supabase\.co/);
  for (const sql of [testSql,prodSql]) {
    assert.match(sql,/BEGIN;[\s\S]*COMMIT;/);
    assert.match(sql,/reservation_dispute_settlements/);
    assert.match(sql,/stripe_webhook_events/);
    assert.doesNotMatch(sql,/UPDATE public\.payments SET status='paid'/i);
  }
});

test("BOD5: a dispute on original OR extension charge blocks every future payout", () => {
  for (const sql of [testSql,prodSql]) {
    assert.match(sql,/CREATE TABLE public\.stripe_card_disputes/i);
    assert.match(sql,/FROM public\.payments p WHERE p\.stripe_charge_id=p_charge_id/i);
    assert.match(sql,/FROM public\.reservation_extensions e WHERE e\.stripe_charge_id=p_charge_id/i);
    assert.match(sql,/CREATE TRIGGER bod5_hold_original_owner_transfer/);
    assert.match(sql,/CREATE TRIGGER bod5_hold_extension_owner_transfer/);
    assert.match(sql,/NEW\.transfer_attempt_count > OLD\.transfer_attempt_count/);
    assert.match(sql,/pg_advisory_xact_lock\(hashtextextended\(NEW\.reservation_id::text, 5005\)\)/);
    assert.match(sql,/bod5_reservation_has_card_dispute\(NEW\.reservation_id\)/);
    assert.match(sql,/payout_blocked boolean NOT NULL DEFAULT true/);
    assert.match(sql,/CREATE TRIGGER bod5_prevent_partial_bod03b_settlement/);
    assert.match(sql,/e.status='paid'/);
  }
});

test("BOD5: Stripe signed webhook records five dispute events, no silent unmatched charge", () => {
  for (const ev of ["created","updated","closed","funds_withdrawn","funds_reinstated"]) {
    assert.match(webhook,new RegExp(`charge\\.dispute\\.${ev}`));
  }
  const dispatch=webhook.indexOf('return await handleStripeCardDispute(admin, event, object)');
  const genericIgnore=webhook.indexOf('eventType !== "payment_intent.succeeded"');
  assert.ok(dispatch > 0 && dispatch < genericIgnore);
  assert.match(webhook,/event\.livemode !== expectedLiveMode/);
  assert.match(webhook,/admin\.rpc\("bod5_record_stripe_card_dispute"/);
  assert.match(webhook,/outcome !== "recorded"/);
  assert.match(webhook,/Card dispute charge has not been matched to Rentulo payment/);
  assert.match(webhook,/previouslyIgnoredDispute/);
});

test("BOD5: existing transfers can be reconciled, new transfers recheck the hold", () => {
  for (const sql of [testSql,prodSql]) {
    assert.match(sql,/A transfer already sent to Stripe MAY still be reconciled as succeeded/);
    assert.match(sql,/NEW\.transfer_status='pending'/);
    assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION public\.claim_stripe_owner_transfer_attempt/);
    assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION public\.claim_reservation_extension_transfer/);
  }
  const origPost=original.indexOf('fetch("https://api.stripe.com/v1/transfers", {');
  const extPost=extension.indexOf('fetch("https://api.stripe.com/v1/transfers", {');
  assert.ok(original.lastIndexOf('bod5_reservation_has_card_dispute', origPost)>0);
  assert.ok(extension.lastIndexOf('bod5_reservation_has_card_dispute', extPost)>0);
  assert.match(original,/bod5_charge_dispute_cleared/);
  assert.match(extension,/bod5_charge_dispute_cleared/);
  assert.equal((retry.match(/bod5_reservation_has_card_dispute/g)||[]).length,2);
});

test("BOD5: no automatic release, only documented Owner review of won warning", () => {
  for (const sql of [testSql,prodSql]) {
    assert.match(sql,/CREATE OR REPLACE FUNCTION public\.bod5_admin_release_won_dispute/);
    assert.match(sql,/PERFORM public\.platform_admin_assert\(p_reason\)/);
    assert.match(sql,/dispute_status NOT IN \('won','warning_closed'\)/);
    assert.match(sql,/payout_blocked=false, reviewed_at=clock_timestamp\(\)/);
    assert.match(sql,/REVOKE ALL ON FUNCTION public\.bod5_admin_release_won_dispute\(text,text\)[\s\S]*?service_role/);
    assert.match(sql,/bod5_dispute_audit_append_only/);
    assert.match(sql,/Stripe dispute evidence cannot be deleted/);
  }
});
