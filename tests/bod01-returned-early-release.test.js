"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const sql = fs.readFileSync(path.join(root,
  "supabase/migrations/20261024150000_returned_booking_actual_return_buffer_TEST.sql"), "utf8");

const hours = n => n * 60 * 60 * 1000;
const when = s => Date.parse(s);
function conflicts(start, end, oldStart, oldScheduledEnd, status, confirmedReturn) {
  const protectedEnd = status === "returned" && confirmedReturn !== null
    ? confirmedReturn : oldScheduledEnd;
  return start < protectedEnd + hours(2) && end + hours(2) > oldStart;
}

test("R-000042: a confirmed early return releases the 24 Oct 17:00 pickup", () => {
  const oldStart = when("2026-10-23T16:00:00Z"); // Prague: Oct 23 18:00
  const plannedEnd = when("2026-10-24T16:00:00Z"); // Prague: Oct 24 18:00
  const actualReturn = when("2026-10-23T16:02:37.397Z");
  const newStart = when("2026-10-24T15:00:00Z"); // Prague: Oct 24 17:00
  const newEnd = when("2026-10-25T16:00:00Z"); // DST switch to CET Oct 25
  assert.equal(conflicts(newStart, newEnd, oldStart, plannedEnd, "returned", actualReturn), false);
  assert.equal(conflicts(newStart, newEnd, oldStart, plannedEnd, "picked_up", actualReturn), true);
  assert.equal(conflicts(newStart, newEnd, oldStart, plannedEnd, "returned", null), true);
});

test("two elapsed hours after confirmed return is allowed; one second earlier is not", () => {
  const oldStart = when("2026-10-23T16:00:00Z");
  const oldEnd = when("2026-10-24T16:00:00Z");
  const returnedAt = when("2026-10-23T16:02:37.397Z");
  assert.equal(conflicts(returnedAt + hours(2), returnedAt + hours(26),
    oldStart, oldEnd, "returned", returnedAt), false);
  assert.equal(conflicts(returnedAt + hours(2) - 1000, returnedAt + hours(26),
    oldStart, oldEnd, "returned", returnedAt), true);
});

test("late return extends blocking, and only returned uses actual time", () => {
  const oldStart = when("2026-10-23T16:00:00Z");
  const oldEnd = when("2026-10-24T16:00:00Z");
  const lateReturn = when("2026-10-24T19:00:00Z");
  assert.equal(conflicts(when("2026-10-24T20:00:00Z"), when("2026-10-25T20:00:00Z"),
    oldStart, oldEnd, "returned", lateReturn), true);
  assert.equal(conflicts(when("2026-10-24T20:00:00Z"), when("2026-10-25T20:00:00Z"),
    oldStart, oldEnd, "paid", lateReturn), false);
});

test("migration changes only availability and keeps project guard, authorization and legacy fallback", () => {
  assert.match(sql, /TEST only: wrong Supabase project/);
  assert.match(sql, /gdpr_stamp_finalized_at/);
  assert.match(sql, /WHEN r\.status::text = 'returned'\s+AND r\.gdpr_finalized_at IS NOT NULL\s+THEN r\.gdpr_finalized_at/i);
  assert.match(sql, /ELSE \(\(r\.end_date \+ r\.pickup_time\) AT TIME ZONE 'Europe\/Prague'\)/i);
  assert.match(sql, /r\.status::text IN \('pending', 'approved', 'paid', 'picked_up', 'returned'\)/i);
  assert.match(sql, /r\.pickup_time IS NULL/i);
  assert.match(sql, /INTERVAL '2 hours'/i);
  assert.match(sql, /RETURNS boolean\s+LANGUAGE sql\s+VOLATILE\s+SECURITY DEFINER\s+SET search_path = ''/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.has_offer_reservation_time_conflict\(/i);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.prepare_reservation_insert/i);
});
