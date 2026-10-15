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

test("PIN handover starts at pickup time and stops at exact return time", async () => {
  const { rentalHandoverOpen } = await import("../supabase/functions/_shared/prague-rental-window.mjs");
  const guard = sql.slice(sql.indexOf("-- Trusted pickup PIN confirmation"), sql.indexOf("-- KROK 79: trusted postgres Cron"));
  assert.match(guard, /new\.status = 'picked_up'/);
  assert.match(guard, /clock_timestamp\(\) >= \(\(old\.end_date \+ old\.pickup_time\) at time zone 'Europe\/Prague'\)/);
  assert.match(guard, /clock_timestamp\(\) < \(\(old\.start_date \+ old\.pickup_time\) at time zone 'Europe\/Prague'\)/);
  assert.match(resolvePin, /rentalHandoverOpen\(reservation\.start_date, reservation\.end_date, reservation\.pickup_time\)/);
  assert.match(getPin, /rentalEndReached\(reservation\.end_date, reservation\.pickup_time\)/);
  assert.match(getPin, /pickup_time"\)/);
  const start = "2026-11-12", end = "2026-11-13", time = "10:00:00";
  for (const [utc, expected] of [
    ["2026-11-12T08:59:59.999Z", false],
    ["2026-11-12T09:00:00.000Z", true],
    ["2026-11-13T08:59:59.999Z", true],
    ["2026-11-13T09:00:00.000Z", false],
    ["2026-11-13T09:01:00.000Z", false]
  ]) assert.equal(rentalHandoverOpen(start, end, time, new Date(utc)), expected, utc);
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

test("no-show cannot settle before the exact contractual return timestamp", () => {
  assert.match(sql, /old\.status = 'paid'[\s\S]{0,140}new\.status = 'no_show'[\s\S]{0,180}clock_timestamp\(\) >= \(\(old\.end_date \+ old\.pickup_time\) at time zone 'Europe\/Prague'\)/);
  assert.match(sql, /where r\.status = 'paid'[\s\S]{0,500}clock_timestamp\(\) >= \(\(r\.end_date \+ r\.pickup_time\) at time zone 'Europe\/Prague'\)/);
  assert.match(sql, /where r\.id = v_reservation\.id and r\.status = 'paid'[\s\S]{0,350}clock_timestamp\(\) >= \(\(r\.end_date \+ r\.pickup_time\) at time zone 'Europe\/Prague'\)/);
  assert.match(sql, /r\.created_at >= a\.first_reservation_created_at/);
  assert.match(sql, /r\.start_date >= a\.first_pickup_date/);
  assert.match(sql, /where s\.name = 'rentulo_project_url'/);
  assert.match(sql, /'rentulo-paid-no-show-every-minute'/);
});

test("Prague DST switches preserve the agreed return clock time", async () => {
  const { pragueRentalInstant, rentalEndReached } = await import("../supabase/functions/_shared/prague-rental-window.mjs");
  for (const [lastDay, expectedUtc] of [
    ["2026-03-29", "2026-03-29T08:00:00.000Z"],
    ["2026-10-25", "2026-10-25T09:00:00.000Z"],
  ]) {
    assert.equal(new Date(pragueRentalInstant(lastDay, "10:00:00")).toISOString(), expectedUtc);
    const cutoff = new Date(expectedUtc).getTime();
    assert.equal(rentalEndReached(lastDay, "10:00:00", new Date(cutoff - 1)), false);
    assert.equal(rentalEndReached(lastDay, "10:00:00", new Date(cutoff)), true);
  }
  assert.equal(new Date(pragueRentalInstant("2026-03-29", "02:30:00")).toISOString(), "2026-03-29T01:30:00.000Z");
  assert.equal(new Date(pragueRentalInstant("2026-10-25", "02:30:00")).toISOString(), "2026-10-25T01:30:00.000Z");
});

test("full-period PIN availability is consistently shown in renter markup and UI", () => {
  assert.match(renterPage, /data-pickup-end-date="\$\{escapeHtml\(endDate\)\}"/);
  assert.match(renterPage, /data-pickup-time="\$\{escapeHtml\(reservation\.pickupTime/);
  assert.match(pinUi, /isExpiredRentalPeriod\(row\.dataset\.pickupEndDate, row\.dataset\.pickupTime\)/);
  assert.doesNotMatch(pinUi, /isExpiredPickupDate\(/);
  assert.match(pinUi, /window\.setInterval\(refreshExpiredRenterPins, 30000\)/);
  assert.match(pinUi, /result\.data\?\.code === "pickup_day_expired"/);
  assert.match(confirmPin, /code: "pickup_wrong_day"/);
});
