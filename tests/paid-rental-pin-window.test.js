"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const sql = read("supabase/migrations/20261015161000_paid_no_show_settlement_TEST.sql");
const getPin = read("supabase/functions/get-pickup-pin/index.ts");
const resolvePin = read("supabase/functions/resolve-pickup-pin/index.ts");
const confirmPin = read("supabase/functions/confirm-pickup/index.ts");
const originalConfirm = read("supabase/migrations/20260926120000_add_secure_pickup_pin_flow.sql");
const pinUi = read("js/pickup-security.js");
const renterPage = read("js/reservations-page.js");

function pragueDay(timestamp) {
  const dt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit"
  });
  const v = Object.fromEntries(dt.formatToParts(new Date(timestamp)).map(x => [x.type, x.value]));
  return `${v.year}-${v.month}-${v.day}`;
}

function compareRange(start, end, timestamp) {
  const today = pragueDay(timestamp);
  return start <= today && today <= end;
}

test("PIN can be confirmed on every reserved day (including end_date), not before or after", () => {
  const guard = sql.slice(sql.indexOf("-- Trusted pickup PIN confirmation"), sql.indexOf("-- KROK 79: a trusted postgres Cron"));
  assert.match(guard, /new\.status = 'picked_up'/);
  assert.match(guard, /not between old\.start_date and old\.end_date/);
  assert.match(guard, /time zone 'Europe\/Prague'/);
  assert.doesNotMatch(guard, /old\.start_date is distinct from/);
  assert.match(resolvePin, /reservation\.start_date <= pickupDay && pickupDay <= reservation\.end_date/);
  assert.match(getPin, /reservation\.end_date < getPragueCalendarDate\(\)/);
  assert.doesNotMatch(getPin, /reservation\.start_date < getPragueCalendarDate\(\)/);
  const start = "2026-10-17", end = "2026-10-20";
  for (const ts of [
    "2026-10-16T21:59:59Z", // 16 October in Prague
    "2026-10-20T22:00:00Z", // 21 October in Prague
  ]) assert.equal(compareRange(start, end, ts), false, ts);
  for (const ts of [
    "2026-10-16T22:00:00Z", // 17 October in Prague
    "2026-10-17T22:00:00Z", // 18 October in Prague
    "2026-10-19T22:00:00Z", // 20 October in Prague
    "2026-10-20T21:59:59Z", // final second before midnight
  ]) assert.equal(compareRange(start, end, ts), true, ts);
});

test("single-use PIN is consumed only after the explicit successful handover", () => {
  assert.match(getPin, /reservation\.status !== "paid"/);
  assert.match(getPin, /if \(security\?\.confirmed_at\)/);
  assert.match(getPin, /code: "pin_used"/);
  assert.match(resolvePin, /\.eq\("status", "paid"\)/);
  assert.match(resolvePin, /if \(reservationSecurity\?\.confirmed_at\)/);
  assert.match(confirmPin, /reservation\.status !== "paid"/);
  assert.match(confirmPin, /if \(security\?\.confirmed_at\)/);
  assert.match(confirmPin, /if \(!timingSafeTextEqual/);
  const procedure = originalConfirm.slice(originalConfirm.indexOf("create or replace function public.confirm_reservation_pickup"), originalConfirm.indexOf("revoke all on function public.register_failed_pickup_pin"));
  assert.match(procedure, /v_reservation\.status <> 'paid'/);
  assert.match(procedure, /v_security\.confirmed_at is not null/);
  assert.match(procedure, /set\s+status = 'picked_up'/);
  assert.match(procedure, /confirmed_at = v_now/);
  assert.match(procedure, /for update/);
  assert.ok(sql.indexOf("new.status = 'picked_up'") < sql.indexOf("new.status = 'no_show'"));
  assert.match(pinUi, /if \(result\.ok && result\.data && result\.data\.status === "picked_up"\)/);
});

test("no-show is impossible before end_date and never consumes a legitimately picked-up booking", () => {
  assert.match(sql, /old\.status = 'paid'[\s\S]{0,90}new\.status = 'no_show'[\s\S]{0,100}old\.end_date < \(now\(\) at time zone 'Europe\/Prague'\)::date/);
  assert.match(sql, /where r\.status = 'paid'[\s\S]{0,250}r\.end_date < \(now\(\) at time zone 'Europe\/Prague'\)::date/);
  assert.match(sql, /where r\.id = v_reservation\.id and r\.status = 'paid'[\s\S]{0,300}r\.end_date < \(now\(\) at time zone 'Europe\/Prague'\)::date/);
  assert.match(sql, /r\.created_at >= a\.first_reservation_created_at/);
  assert.match(sql, /r\.start_date >= a\.first_pickup_date/);
  assert.match(sql, /where s\.name = 'rentulo_project_url'/);
  assert.match(sql, /'rentulo-paid-no-show-every-minute'/);
});

test("Prague DST changes do not shift PIN cutoff to UTC midnight", () => {
  for (const [lastDay, before, after] of [
    ["2026-03-29", "2026-03-29T21:59:59Z", "2026-03-29T22:00:00Z"],
    ["2026-10-25", "2026-10-25T22:59:59Z", "2026-10-25T23:00:00Z"],
  ]) {
    assert.equal(compareRange(lastDay, lastDay, before), true);
    assert.equal(compareRange(lastDay, lastDay, after), false);
  }
});

test("full-period PIN availability is consistently shown in renter markup and UI", () => {
  assert.match(renterPage, /data-pickup-end-date="\$\{escapeHtml\(endDate\)\}"/);
  assert.match(pinUi, /isExpiredRentalPeriod\(row\.dataset\.pickupEndDate\)/);
  assert.doesNotMatch(pinUi, /isExpiredPickupDate\(/);
  assert.match(pinUi, /window\.setInterval\(refreshExpiredRenterPins, 30000\)/);
  assert.match(pinUi, /result\.data\?\.code === "pickup_day_expired"/);
  assert.match(confirmPin, /code: "pickup_wrong_day"/);
});
