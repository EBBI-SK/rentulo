"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const GET_PIN = path.join(ROOT, "supabase", "functions", "get-pickup-pin", "index.ts");
const CONFIRM = path.join(ROOT, "supabase", "functions", "confirm-pickup", "index.ts");
const MIGRATION = path.join(ROOT, "supabase", "migrations", "20260926120000_add_secure_pickup_pin_flow.sql");
const UI = path.join(ROOT, "js", "pickup-security.js");
const CSS = path.join(ROOT, "css", "pickup-security.css");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function compact(value) {
  return value.replace(/\s+/g, " ").trim();
}

test("pickup PIN is derived server-side and never stored as plaintext", () => {
  const getPin = read(GET_PIN);
  const migration = read(MIGRATION);
  assert.match(getPin, /PICKUP_PIN_SECRET/);
  assert.match(getPin, /crypto\.subtle\.sign\("HMAC"/);
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

test("owner confirmation accepts exactly six digits and verifies owner identity", () => {
  const source = read(CONFIRM);
  assert.match(source, /\^\\d\{6\}\$/);
  assert.match(source, /reservation\.owner_id !== actor\.id/);
  assert.match(source, /reservation\.status !== "paid"/);
});

test("three failed PIN attempts create a fifteen minute lock", () => {
  const sql = compact(read(MIGRATION));
  assert.match(sql, /failed_attempts smallint not null default 0 check \(failed_attempts between 0 and 3\)/i);
  assert.match(sql, /v_attempts := least\(v_security\.failed_attempts \+ 1, 3\)/i);
  assert.match(sql, /v_now \+ interval '15 minutes'/i);
  assert.match(sql, /attempts_remaining/i);
});

test("correct PIN cannot bypass an active lock", () => {
  const source = read(CONFIRM);
  const checkIndex = source.indexOf("security?.locked_until");
  const expectedPinIndex = source.indexOf("const expectedPin");
  assert.ok(checkIndex >= 0);
  assert.ok(expectedPinIndex > checkIndex);
  assert.match(source, /code: "locked"/);
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

test("pickup RPCs are service-role only", () => {
  const sql = compact(read(MIGRATION));
  assert.match(sql, /revoke all on function public\.register_failed_pickup_pin\(uuid, uuid\) from public, anon, authenticated/i);
  assert.match(sql, /revoke all on function public\.confirm_reservation_pickup\(uuid, uuid\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.register_failed_pickup_pin\(uuid, uuid\) to service_role/i);
  assert.match(sql, /grant execute on function public\.confirm_reservation_pickup\(uuid, uuid\) to service_role/i);
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

test("pickup UI supports all five languages and keeps the secure backend action", () => {
  const source = read(UI);
  assert.match(source, /data-offers-action=\\?"mark-picked-up/);
  assert.match(source, /stopImmediatePropagation\(\)/);
  assert.match(source, /invoke\("confirm-pickup"/);
  for (const language of ["cs", "sk", "en", "de", "pl"]) {
    assert.match(source, new RegExp("\\b" + language + ": \\{"));
  }
});

test("first owner step clearly says hand over item and explains the PIN before clicking", () => {
  const source = read(UI);
  const css = read(CSS);
  assert.match(source, /ownerAction: "Předat věc"/);
  assert.match(source, /ownerGuide: "Při předání budete potřebovat 6místný PIN od nájemce\."/);
  assert.match(source, /pickup-owner-guide/);
  assert.match(source, /pickup-primary-handover/);
  assert.match(css, /content: var\(--pickup-action-label\)/);
});

test("owner enters the PIN inline on the concrete reservation instead of a modal", () => {
  const source = read(UI);
  assert.match(source, /pickup-inline-confirm/);
  assert.match(source, /button\.closest\("\.request-card"\)/);
  assert.match(source, /buildInlineForm\(card, reservationId, button\)/);
  assert.doesNotMatch(source, /pickup-confirm-modal/);
  assert.doesNotMatch(source, /role="dialog"/);
});

test("inline pickup auto-submits only after exactly six digits are entered", () => {
  const source = read(UI);
  assert.match(source, /event\.target\.value = event\.target\.value\.replace\(\/\\D\/g, ""\)\.slice\(0, 6\)/);
  assert.match(source, /if \(\/\^\\d\{6\}\$\/\.test\(event\.target\.value\) && form\.dataset\.submitting !== "true"\)/);
  assert.match(source, /submitInlinePickup\(form, returnFocus\)/);
});

test("offers observer does not watch class changes and cannot retrigger itself from UX class updates", () => {
  const source = read(UI);
  assert.match(source, /observer\.observe\(offersList, \{ childList: true, subtree: true \}\)/);
  assert.doesNotMatch(source, /observer\.observe\(offersList,[\s\S]*attributes:\s*true/);
  assert.doesNotMatch(source, /attributeFilter:\s*\["class"\]/);
});
