"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const sql = read("supabase/migrations/20261017235500_two_hour_booking_buffer_TEST.sql");
const js = read("js/detail-page.js");
const i18n = read("js/i18n.js");

const { createRequire } = require("node:module");

// Pure example of the same interval inequality used by PostgreSQL; these
// clock values are concrete instants (UTC), not naive browser-local dates.
function conflicts(newStart, newEnd, oldStart, oldEnd) {
  const twoHours = 2 * 60 * 60 * 1000;
  return newStart < oldEnd + twoHours && newEnd + twoHours > oldStart;
}
const at = s => Date.parse(s);

test("exactly two hours after an existing return is allowed; one minute early is blocked", () => {
  const oldStart = at("2026-10-18T08:00:00Z");
  const oldEnd = at("2026-10-19T08:00:00Z");
  assert.equal(conflicts(at("2026-10-19T10:00:00Z"), at("2026-10-20T10:00:00Z"), oldStart, oldEnd), false);
  assert.equal(conflicts(at("2026-10-19T09:59:00Z"), at("2026-10-20T09:59:00Z"), oldStart, oldEnd), true);
  assert.equal(conflicts(at("2026-10-19T08:00:00Z"), at("2026-10-20T08:00:00Z"), oldStart, oldEnd), true);
});

test("the same two-hour gap is required before the next booked pickup", () => {
  const oldStart = at("2026-10-19T10:00:00Z");
  const oldEnd = at("2026-10-20T10:00:00Z");
  assert.equal(conflicts(at("2026-10-17T08:00:00Z"), at("2026-10-19T08:00:00Z"), oldStart, oldEnd), false);
  assert.equal(conflicts(at("2026-10-17T08:01:00Z"), at("2026-10-19T08:01:00Z"), oldStart, oldEnd), true);
});

test("spring DST gap uses actual elapsed hours, not naive wall clock", async () => {
  const { pragueRentalInstant } = await import("../supabase/functions/_shared/prague-rental-window.mjs");
  const oldStart = pragueRentalInstant("2027-03-27", "23:00:00");
  const oldEnd = pragueRentalInstant("2027-03-28", "23:00:00");
  assert.equal(conflicts(oldEnd + 2 * 3600e3, oldEnd + 26 * 3600e3, oldStart, oldEnd), false);
  assert.equal(conflicts(oldEnd + 90 * 60e3, oldEnd + 25 * 3600e3, oldStart, oldEnd), true);
});

test("database enforces the same predicate atomically on INSERT", () => {
  assert.match(sql, /has_offer_reservation_time_conflict\(/);
  assert.match(sql, /new\.offer_id, new\.start_date, new\.end_date, new\.pickup_time/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\(new\.offer_id::text\)\)/);
  assert.match(sql, /at time zone 'Europe\/Prague'/);
  assert.match(sql, /interval '2 hours'/);
  assert.match(sql, /r\.status::text in \('pending', 'approved', 'paid', 'picked_up', 'returned'\)/);
  assert.match(sql, /from public, anon, authenticated;/);
  assert.match(sql, /to anon, authenticated, service_role;/);
  assert.match(sql, /returns boolean\s+language sql\s+volatile/);
  assert.match(sql, /btrim\(s\.decrypted_secret, '\/'\)/);
  assert.doesNotMatch(sql, /stripe[_-]transfer|refund_status|no_show/);
});

test("frontend and translations acknowledge the two-hour buffer", () => {
  assert.match(js, /has_offer_reservation_time_conflict/);
  assert.match(js, /Mezi dv\u011bma pron\u00e1jmy mus\u00ed b\u00fdt alespo\u0148 2 hodiny\./);
  assert.equal((i18n.match(/detail\.dateConflictText/g) || []).length, 5);
  assert.equal((i18n.match(/detail\.error\.overlap/g) || []).length, 5);
});
