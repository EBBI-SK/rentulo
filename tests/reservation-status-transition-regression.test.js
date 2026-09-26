"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const MIGRATION = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20260926170000_restore_reservation_status_transition_guards.sql"
);

function readMigration() {
  return fs.readFileSync(MIGRATION, "utf8");
}

function compact(value) {
  return value.replace(/\s+/g, " ").trim();
}

test("latest reservation guard preserves trusted Stripe and pickup PIN transitions", () => {
  const sql = compact(readMigration());

  assert.match(
    sql,
    /auth\.role\(\) = 'service_role' and current_setting\('app\.stripe_payment_authorized', true\) = 'on' and old\.status = 'approved' and new\.status = 'paid'/i
  );
  assert.match(
    sql,
    /auth\.role\(\) = 'service_role' and current_setting\('app\.pickup_pin_authorized', true\) = 'on' and old\.status = 'paid' and new\.status = 'picked_up'/i
  );
});

test("latest reservation guard preserves the six-hour cancellation rules", () => {
  const sql = compact(readMigration());

  assert.match(sql, /new\.status = 'cancelled'/i);
  assert.match(sql, /auth\.uid\(\) = old\.owner_id and old\.status = 'approved'/i);
  assert.match(
    sql,
    /auth\.uid\(\) = old\.renter_id and old\.status in \('pending', 'approved'\)/i
  );
  assert.match(sql, /at time zone 'Europe\/Prague'/i);
  assert.match(sql, /interval '6 hours'/i);
});

test("ordinary owner lifecycle cannot bypass the pickup PIN", () => {
  const sql = compact(readMigration());
  const ownerStart = sql.indexOf("if auth.uid() = old.owner_id then");
  const renterStart = sql.indexOf("if auth.uid() = old.renter_id then");

  assert.ok(ownerStart >= 0 && renterStart > ownerStart);
  const ownerBranch = sql.slice(ownerStart, renterStart);

  assert.match(
    ownerBranch,
    /old\.status = 'pending' and new\.status in \('approved', 'rejected'\)/i
  );
  assert.match(ownerBranch, /old\.status = 'picked_up' and new\.status = 'returned'/i);
  assert.doesNotMatch(
    ownerBranch,
    /old\.status = 'paid'[\s\S]*new\.status = 'picked_up'/i
  );
});

test("test-payment path remains available only to allowlisted renters", () => {
  const sql = compact(readMigration());

  assert.match(sql, /auth\.uid\(\) = old\.renter_id/i);
  assert.match(sql, /old\.status = 'approved' and new\.status = 'paid'/i);
  assert.match(
    sql,
    /current_setting\( 'app\.test_payment_authorized', true \) = 'on'/i
  );
  assert.match(sql, /from public\.test_payment_users t where t\.user_id = auth\.uid\(\)/i);
});
