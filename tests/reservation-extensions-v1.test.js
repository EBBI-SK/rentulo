"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20261027100000_reservation_extensions_v1_TEST.sql");
const checkout = read("supabase/functions/create-extension-checkout/index.ts");
const webhook = read("supabase/functions/stripe-webhook/index.ts");
const payout = read("supabase/functions/create-extension-transfer/index.ts");
const worker = read("supabase/functions/retry-owner-transfers/index.ts");
const renter = read("js/reservations-page.js");
const owner = read("js/offers-page.js");
const labels = require("../js/reservation-extension-ui.js");

function sqlFunction(name) {
  const pattern = new RegExp("create or replace function public\\." + name + "\\(", "i");
  const match = migration.match(pattern);
  assert.ok(match, "Missing SQL function: " + name);
  const start = migration.indexOf(match[0]);
  const afterStart = migration.slice(start);
  const marker = afterStart.match(/\bas\s+(\$[A-Za-z_]+\$)/i);
  assert.ok(marker, "Missing function body: " + name);
  const bodyStart = start + marker.index + marker[0].length;
  const bodyEnd = migration.indexOf(marker[1] + ";", bodyStart);
  assert.ok(bodyEnd > bodyStart, "Missing SQL body terminator: " + name);
  return migration.slice(start, bodyEnd + marker[1].length + 1);
}

test("extension migration is guarded to the TEST project and does not replace payments", () => {
  assert.match(migration, /rentulo_project_url/);
  assert.match(migration, /vspposovhdgvbeukoivh\.supabase\.co/);
  assert.match(migration, /create table public\.reservation_extensions/i);
  assert.doesNotMatch(migration, /update\s+public\.payments\b/i);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.payments\b/i);
  assert.match(migration, /revoke select on public\.reservation_extensions from authenticated/i);
  assert.match(migration, /get_my_reservation_extensions/);
});

test("tenant can request an extension only for the picked-up original paid booking", () => {
  const f = sqlFunction("request_reservation_extension");
  assert.match(f, /v_r\.renter_id\s*<>\s*auth\.uid\(\)/);
  assert.match(f, /v_r\.status::text\s*<>\s*'picked_up'/);
  assert.match(f, /v_base\.stripe_payment_intent_status\s*<>\s*'succeeded'/);
  assert.match(f, /pg_advisory_xact_lock\(hashtext\(v_r\.offer_id::text\)\)/);
  assert.match(f, /reservation_extension_has_conflict\(p_reservation_id,p_new_end_date\)/);
});

test("the minimum 70 Kč applies to the entire reservation only once", () => {
  const f = sqlFunction("request_reservation_extension");
  assert.match(f, /v_r\.price_per_day/);
  assert.match(f, /where e\.reservation_id=p_reservation_id and e\.status='paid'/);
  assert.match(f, /v_target_fee\s*:=\s*greatest\([\s\S]*?70/);
  assert.match(f, /v_extra_fee\s*:=\s*greatest\(0,v_target_fee-\(v_r\.platform_fee_amount\+v_existing_fee\)\)/);
  const supplementalFee = (basePrice, originalFee, extraPrice, priorExtraPrice, priorExtraFees, pct=10) =>
    Math.max(0, Math.max(Math.round((basePrice + priorExtraPrice + extraPrice)*pct/100),70)
      -originalFee-priorExtraFees);
  assert.equal(supplementalFee(150,70,100,0,0),0);
  assert.equal(supplementalFee(250,50,100,0,0),20);
  assert.equal(supplementalFee(600,70,200,0,0),10);
  assert.equal(supplementalFee(600,70,200,200,10),20);
});

test("owner approval validates ownership, overdue debt and same 2-hour availability lock", () => {
  const f = sqlFunction("decide_reservation_extension");
  assert.match(f,/v_e\.owner_id<>auth\.uid\(\)/);
  assert.match(f,/pg_advisory_xact_lock\(hashtext\(v_e\.offer_id::text\)\)/);
  assert.match(f,/owner_cancellation_debts debt/);
  assert.match(f,/reservation_extension_has_conflict\(v_r\.id,v_e\.new_end_date\)/);
  assert.match(f,/update public\.reservation_extensions set status='approved'/);
  assert.doesNotMatch(f,/update public\.reservations set/);
});

test("new booking availability preserves trusted actual return + two hours", () => {
  const f = sqlFunction("has_offer_reservation_time_conflict");
  assert.match(f,/r\.gdpr_finalized_at is not null/);
  assert.match(f,/r\.status::text='returned'/);
  assert.match(f,/interval '2 hours'/);
  assert.match(f,/reservation_extensions e/);
  const extension = sqlFunction("reservation_extension_has_conflict");
  assert.match(extension,/other\.gdpr_finalized_at is not null/);
  assert.match(extension,/interval '2 hours'/);
});

test("Stripe webhook commits the new return date only after verified additional payment", () => {
  const finalize = sqlFunction("complete_reservation_extension_payment");
  assert.match(finalize,/auth\.role\(\)<>'service_role'/);
  assert.match(finalize,/v_e\.status<>'approved'/);
  assert.match(finalize,/p_amount_minor<>v_e\.amount_total\*100/);
  assert.match(finalize,/reservation_extension_has_conflict\(v_r\.id,v_e\.new_end_date\)/);
  assert.match(finalize,/update public\.reservations set[\s\S]*?end_date=v_e\.new_end_date/);
  assert.match(finalize,/update public\.reservation_extensions set status='paid'/);
  const immutable = sqlFunction("protect_reservation_immutable_fields");
  assert.match(immutable,/v_extension_change_authorized/);
  assert.match(immutable,/new\.total_price IS DISTINCT FROM old\.total_price/);
  assert.match(immutable,/new\.platform_fee_amount IS DISTINCT FROM old\.platform_fee_amount/);
  assert.match(webhook,/payment_kind\) === "reservation_extension"/);
  assert.match(webhook,/complete_reservation_extension_payment/);
});

test("extension immutability guard preserves service-role Stripe payment completion", () => {
  const guard = sqlFunction("protect_reservation_immutable_fields");
  const paymentAuth = guard.match(/v_payment_update_authorized\s*:=\s*coalesce\(\(([\s\S]*?)\),\s*false\);/i);
  assert.ok(paymentAuth, "Missing existing payment authorization guard");
  assert.match(paymentAuth[1], /old\.status\s*=\s*'approved'[\s\S]*?new\.status\s*=\s*'paid'/i);
  assert.match(paymentAuth[1], /OR\s*\(\s*coalesce\(auth\.role\(\),\s*''\)\s*=\s*'service_role'\s*AND\s*current_setting\('app\.stripe_payment_authorized',\s*true\)\s*=\s*'on'\s*\)/i);
  assert.match(guard, /NOT v_payment_update_authorized[\s\S]*?new\.paid_at IS DISTINCT FROM old\.paid_at[\s\S]*?new\.payment_provider_status IS DISTINCT FROM old\.payment_provider_status/i);
});

test("checkout session is bound to extension, reservation and Stripe PaymentIntent", () => {
  assert.match(checkout,/create-extension-checkout/);
  assert.match(checkout,/claim_reservation_extension_checkout/);
  assert.match(checkout,/payment_intent_data\[metadata\]\[extension_id\]/);
  assert.match(checkout,/payment_intent_data\[metadata\]\[reservation_id\]/);
  assert.match(checkout,/Idempotency-Key/);
  assert.match(checkout,/record_reservation_extension_checkout/);
  assert.match(checkout,/rentulo\.eu/);
});

test("abandoned checkout is released only after Stripe confirms expired and unpaid", () => {
  const expire = sqlFunction("expire_reservation_extension_checkout");
  assert.match(expire,/stripe_checkout_session_id<>p_session_id/);
  assert.match(worker,/get_expired_reservation_extension_checkouts/);
  assert.match(worker,/session\.status !== "expired" \|\| session\.payment_status !== "unpaid"/);
  assert.match(worker,/expire_reservation_extension_checkout/);
  assert.match(migration,/block_return_during_extension_checkout/);
});

test("extension payout uses a separate Stripe transfer after the original transfer", () => {
  const claim = sqlFunction("claim_reservation_extension_transfer");
  assert.match(claim,/v_p\.transfer_status<>'succeeded'/);
  assert.match(claim,/v_r\.status::text not in \('returned','no_show'\)/);
  assert.match(payout,/stripe_charge_id/);
  assert.match(payout,/source_transaction/);
  assert.match(payout,/Idempotency-Key/);
  assert.match(payout,/finish_reservation_extension_transfer/);
  assert.match(worker,/create-extension-transfer/);
});

test("tenant and owner receive both new actions while original flow remains", () => {
  assert.match(renter,/data-reservations-action="open-extension"/);
  assert.match(renter,/data-reservations-action="request-extension"/);
  assert.match(renter,/data-reservations-action="pay-extension"/);
  assert.match(owner,/data-offers-action="approve-extension"/);
  assert.match(owner,/data-offers-action="reject-extension"/);
  assert.match(read("moje-rezervace.html"),/js\/reservation-extension-ui\.js/);
  assert.match(read("moje-nabidky.html"),/js\/reservation-extension-ui\.js/);
});

test("paid additional amounts aggregate without changing the original amounts", () => {
  const initial = [{id:"r1",totalPrice:150,platformFeeAmount:70,ownerPayout:80},
    {id:"r2",totalPrice:250,platformFeeAmount:70,ownerPayout:180}];
  const extensions = [
    {reservation_id:"r1",status:"pending",amount_total:100,platform_fee_amount:0,owner_payout:100},
    {reservation_id:"r1",status:"paid",amount_total:100,platform_fee_amount:0,owner_payout:100},
    {reservation_id:"r1",status:"paid",amount_total:100,platform_fee_amount:0,owner_payout:100},
  ];
  const result = labels.attachPaidExtensions(initial,extensions);
  assert.equal(result[0].totalPrice,350);
  assert.equal(result[0].platformFeeAmount,70);
  assert.equal(result[0].ownerPayout,280);
  assert.equal(result[1].totalPrice,250);
  assert.equal(result[0].extensions.length,3);
  assert.equal(labels.nextDate("2026-10-31"),"2026-11-01");
});
