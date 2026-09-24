"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, "supabase", "migrations");

function migrationFilesNewestFirst() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .reverse();
}

function latestMigrationMatching(pattern, description) {
  for (const fileName of migrationFilesNewestFirst()) {
    const filePath = path.join(MIGRATIONS_DIR, fileName);
    const sql = fs.readFileSync(filePath, "utf8");

    if (pattern.test(sql)) {
      return { fileName, sql };
    }
  }

  assert.fail("No active migration defines: " + description);
}

function compactSql(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

function assertSensitiveFieldIsStatusGated(sql, fieldName) {
  const pattern = new RegExp(
    "case\\s+when\\s+r\\.status\\s+in\\s*\\(" +
      "\\s*'paid'\\s*,\\s*'picked_up'\\s*,\\s*'returned'\\s*" +
      "\\)\\s+then\\s+r\\." + fieldName +
      "\\s+else\\s+null\\s+end\\s+as\\s+" + fieldName,
    "i"
  );

  assert.match(sql, pattern, fieldName + " must remain hidden before payment");
}

test("latest get_my_reservations contract hides sensitive contact and pickup data before payment", () => {
  const { sql: rawSql } = latestMigrationMatching(
    /create\s+(?:or\s+replace\s+)?function\s+public\.get_my_reservations\s*\(\s*\)/i,
    "public.get_my_reservations()"
  );
  const sql = compactSql(rawSql);

  for (const fieldName of [
    "renter_email",
    "renter_phone",
    "owner_phone",
    "pickup_phone",
    "pickup_street",
    "pickup_postal_code",
    "pickup_full_address",
    "pickup_note",
    "pickup_latitude",
    "pickup_longitude"
  ]) {
    assertSensitiveFieldIsStatusGated(sql, fieldName);
  }

  assert.match(
    sql,
    /where\s+auth\.uid\(\)\s+is\s+not\s+null\s+and\s*\(\s*r\.owner_id\s*=\s*auth\.uid\(\)\s+or\s+r\.renter_id\s*=\s*auth\.uid\(\)\s*\)/i,
    "get_my_reservations must remain limited to related users"
  );
});

test("latest reservation insert contract serializes and rejects overlapping blocking dates", () => {
  const { sql: rawSql } = latestMigrationMatching(
    /create\s+(?:or\s+replace\s+)?function\s+public\.prepare_reservation_insert\s*\(\s*\)/i,
    "public.prepare_reservation_insert()"
  );
  const sql = compactSql(rawSql);

  assert.match(
    sql,
    /pg_advisory_xact_lock\s*\(\s*hashtext\s*\(\s*new\.offer_id::text\s*\)\s*\)/i,
    "reservation creation must serialize per offer"
  );
  assert.match(
    sql,
    /existing\.status::text\s+in\s*\(\s*'pending'\s*,\s*'approved'\s*,\s*'paid'\s*,\s*'picked_up'\s*\)/i,
    "all blocking statuses must participate in overlap protection"
  );
  assert.match(
    sql,
    /new\.start_date\s*<\s*existing\.end_date\s+and\s+new\.end_date\s*>\s*existing\.start_date/i,
    "reservation overlap must use the same half-open interval rule as the frontend"
  );
  assert.match(
    sql,
    /new\.status\s*:=\s*'pending'::public\.reservation_status/i,
    "new reservations must always start as pending"
  );
  assert.match(sql, /new\.contact_visible\s*:=\s*false/i);
  assert.match(sql, /new\.contact_visible_after_payment\s*:=\s*false/i);
});

test("public availability RPC exposes only dates for blocking reservations", () => {
  const { sql: rawSql } = latestMigrationMatching(
    /create\s+(?:or\s+replace\s+)?function\s+public\.get_blocking_reservations\s*\(\s*p_offer_id\s+uuid\s*\)/i,
    "public.get_blocking_reservations(uuid)"
  );
  const sql = compactSql(rawSql);

  assert.match(
    sql,
    /returns\s+table\s*\(\s*start_date\s+date\s*,\s*end_date\s+date\s*\)/i
  );
  assert.match(
    sql,
    /r\.status\s+in\s*\(\s*'pending'\s*,\s*'approved'\s*,\s*'paid'\s*,\s*'picked_up'\s*\)/i
  );
  assert.doesNotMatch(
    sql,
    /renter_email|renter_phone|owner_phone|pickup_phone|pickup_street|pickup_postal_code|pickup_full_address|pickup_latitude|pickup_longitude/i,
    "public availability must not expose contact or precise pickup data"
  );
});

test("latest server status-transition guard keeps role-specific transitions and test-payment authorization", () => {
  const { sql: rawSql } = latestMigrationMatching(
    /create\s+(?:or\s+replace\s+)?function\s+public\.protect_reservation_status_transition\s*\(\s*\)/i,
    "public.protect_reservation_status_transition()"
  );
  const sql = compactSql(rawSql);

  assert.match(
    sql,
    /auth\.uid\(\)\s*=\s*old\.owner_id[\s\S]*old\.status\s*=\s*'pending'\s+and\s+new\.status\s+in\s*\(\s*'approved'\s*,\s*'rejected'\s*\)/i
  );
  assert.match(
    sql,
    /old\.status\s*=\s*'paid'\s+and\s+new\.status\s*=\s*'picked_up'/i
  );
  assert.match(
    sql,
    /old\.status\s*=\s*'picked_up'\s+and\s+new\.status\s*=\s*'returned'/i
  );
  assert.match(
    sql,
    /new\.status\s*=\s*'cancelled'/i
  );
  assert.match(
    sql,
    /auth\.uid\(\)\s*=\s*old\.owner_id[\s\S]*old\.status\s*=\s*'approved'/i
  );
  assert.match(
    sql,
    /auth\.uid\(\)\s*=\s*old\.renter_id[\s\S]*old\.status\s+in\s*\(\s*'pending'\s*,\s*'approved'\s*\)/i
  );
  assert.match(
    sql,
    /current_setting\s*\(\s*'app\.test_payment_authorized'\s*,\s*true\s*\)\s*=\s*'on'/i
  );
  assert.match(sql, /from\s+public\.test_payment_users/i);
});
