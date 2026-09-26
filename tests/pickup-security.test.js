"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const GET_PIN = path.join(ROOT, "supabase", "functions", "get-pickup-pin", "index.ts");
const CONFIRM = path.join(ROOT, "supabase", "functions", "confirm-pickup", "index.ts");
const RESOLVE = path.join(ROOT, "supabase", "functions", "resolve-pickup-pin", "index.ts");
const MIGRATION = path.join(ROOT, "supabase", "migrations", "20260926120000_add_secure_pickup_pin_flow.sql");
const LOOKUP_MIGRATION = path.join(ROOT, "supabase", "migrations", "20260926143000_add_owner_pickup_pin_lookup_security.sql");
const UI = path.join(ROOT, "js", "pickup-security.js");
const CSS = path.join(ROOT, "css", "pickup-security.css");
const OFFERS_HTML = path.join(ROOT, "moje-nabidky.html");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function compact(value) {
  return value.replace(/\s+/g, " ").trim();
}

test("pickup PIN is derived server-side and never stored as plaintext", () => {
  const getPin = read(GET_PIN);
  const resolve = read(RESOLVE);
  const migration = read(MIGRATION);
  assert.match(getPin, /PICKUP_PIN_SECRET/);
  assert.match(resolve, /PICKUP_PIN_SECRET/);
  assert.match(resolve, /crypto\.subtle\.sign\("HMAC"/);
  assert.doesNotMatch(migration, /\bpin\s+(text|varchar|character varying|integer|bigint)/i);
});

test("only the renter can retrieve a PIN for a trusted paid Stripe payment", () => {
  const source = read(GET_PIN);
  assert.match(source, /reservation\.renter_id !== actor\.id/);
  assert.match(source, /reservation\.status !== "paid"/);
  assert.match(source, /payment\.provider !== "stripe"/);
  assert.match(source, /payment\.status !== "paid"/);
  assert.match(source, /stripe_payment_intent_status !== "succeeded"/);
  assert.match(source, /refund_status !== "not_requested"/);
});

test("owner PIN lookup searches only the authenticated owner's paid reservations", () => {
  const source = read(RESOLVE);
  assert.match(source, /\.eq\("owner_id", actor\.id\)/);
  assert.match(source, /\.eq\("status", "paid"\)/);
  assert.match(source, /payment\.owner_id === reservation\.owner_id/);
  assert.match(source, /payment\.provider === "stripe"/);
  assert.match(source, /payment\.stripe_payment_intent_status === "succeeded"/);
  assert.match(source, /payment\.refund_status === "not_requested"/);
});

test("owner PIN lookup returns only a reservation id after one exact PIN match", () => {
  const source = read(RESOLVE);
  assert.match(source, /if \(matches\.length === 1\)/);
  assert.match(source, /reservation_id: matches\[0\], status: "verified"/);
  assert.match(source, /timingSafeTextEqual\(pin, expectedPin\)/);
  assert.match(source, /matches\.length > 1/);
  assert.match(source, /reservation_pickup_security/);
  assert.match(source, /reservationSecurity\?\.locked_until/);
});

test("global owner PIN lookup locks after three wrong attempts for fifteen minutes", () => {
  const sql = compact(read(LOOKUP_MIGRATION));
  assert.match(sql, /failed_attempts smallint not null default 0 check \(failed_attempts between 0 and 3\)/i);
  assert.match(sql, /v_attempts := least\(v_security\.failed_attempts \+ 1, 3\)/i);
  assert.match(sql, /v_now \+ interval '15 minutes'/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /revoke all on function public\.register_failed_owner_pickup_pin\(uuid\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.register_failed_owner_pickup_pin\(uuid\) to service_role/i);
});

test("successful owner PIN lookup clears previous lookup failures", () => {
  const source = read(RESOLVE);
  assert.match(source, /from\("owner_pickup_pin_security"\)[\s\S]*\.delete\(\)[\s\S]*\.eq\("owner_id", actor\.id\)/);
});

test("owner confirmation accepts exactly six digits and verifies owner identity", () => {
  const source = read(CONFIRM);
  assert.match(source, /\^\\d\{6\}\$/);
  assert.match(source, /reservation\.owner_id !== actor\.id/);
  assert.match(source, /reservation\.status !== "paid"/);
});

test("successful pickup consumes PIN state and atomically changes paid to picked_up", () => {
  const sql = compact(read(MIGRATION));
  assert.match(sql, /status = 'picked_up'/i);
  assert.match(sql, /confirmed_at = v_now/i);
  assert.match(sql, /failed_attempts = 0/i);
  assert.match(sql, /locked_until = null/i);
});

test("browser can no longer directly change paid to picked_up", () => {
  const sql = compact(read(MIGRATION));
  assert.match(sql, /auth\.role\(\) = 'service_role'/i);
  assert.match(sql, /current_setting\('app\.pickup_pin_authorized', true\) = 'on'/i);
});

test("successful pickup triggers internal owner transfer without rolling pickup back on transfer failure", () => {
  const source = read(CONFIRM);
  const pickupIndex = source.indexOf('admin.rpc("confirm_reservation_pickup"');
  const transferIndex = source.indexOf("/functions/v1/create-owner-transfer");
  assert.ok(pickupIndex >= 0);
  assert.ok(transferIndex > pickupIndex);
  assert.match(source, /transfer_status: transferStatus/);
  assert.match(source, /will require retry/);
});

test("owner handoff starts from one clear PIN entry above the offers", () => {
  const html = read(OFFERS_HTML);
  const source = read(UI);
  assert.match(html, /id="pickupHandoffEntry"/);
  assert.match(html, /id="pickupHandoffOpen"/);
  assert.match(html, /id="pickupHandoffPin"/);
  assert.match(source, /invoke\("resolve-pickup-pin", \{ pin: pin \}\)/);
  assert.match(source, /Rentulo najde správnou rezervaci za vás/);
});

test("paid reservation handoff buttons stay hidden until the entered PIN resolves to that reservation", () => {
  const source = read(UI);
  const css = read(CSS);
  assert.match(source, /button\.hidden = !isVerified/);
  assert.match(source, /reservationId === verifiedReservationId/);
  assert.match(css, /data-offers-action="mark-picked-up"\]\[hidden\]/);
  assert.doesNotMatch(source, /pickup-primary-handover/);
  assert.doesNotMatch(css, /--pickup-action-label/);
  assert.match(source, /showReservations: "Zobrazit rezervace"/);
  assert.match(source, /primary\.classList\.remove\("urgent"\)/);
});

test("verified PIN opens and highlights exactly the matched reservation", () => {
  const source = read(UI);
  assert.match(source, /data-reservation-id/);
  assert.match(source, /CSS\.escape\(reservationId\)/);
  assert.match(source, /panel\.classList\.add\("open"\)/);
  assert.match(source, /card\.classList\.add\("pickup-matched-reservation"\)/);
  assert.match(source, /pickup-verified-note/);
  assert.match(source, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
});

test("final handover requires an explicit confirmation click after PIN verification", () => {
  const source = read(UI);
  assert.match(source, /confirmAction: "Potvrdit předání"/);
  assert.match(source, /reservationId !== verifiedReservationId/);
  assert.match(source, /invoke\("confirm-pickup", \{[\s\S]*reservation_id: reservationId,[\s\S]*pin: verifiedPin/);
});

test("pickup UI supports all five languages", () => {
  const source = read(UI);
  for (const language of ["cs", "sk", "en", "de", "pl"]) {
    assert.match(source, new RegExp("\\b" + language + ": \\{"));
  }
});

test("offers observer only watches DOM children and cannot loop on class changes", () => {
  const source = read(UI);
  assert.match(source, /observer\.observe\(offersList, \{ childList: true, subtree: true \}\)/);
  assert.doesNotMatch(source, /attributeFilter:\s*\["class"\]/);
});
