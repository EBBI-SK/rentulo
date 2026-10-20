"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(
  path.join(__dirname, "..", "supabase", "migrations",
    "20261020120000_bod02_gdpr_reservation_contacts_gate_TEST.sql"),
  "utf8"
);

const guard = sql.split("CREATE OR REPLACE FUNCTION public.protect_reservation_immutable_fields()")[1]
  ?.split("CREATE OR REPLACE FUNCTION public.gdpr_review_deactivated_renter_contacts(")[0];
const cleanup = sql.split("CREATE OR REPLACE FUNCTION public.gdpr_review_deactivated_renter_contacts(")[1]
  ?.split("REVOKE ALL ON FUNCTION public.gdpr_review_deactivated_renter_contacts")[0];

test("BOD02 GDPR migration is TEST-only at installation and execution", () => {
  assert.match(sql, /BEGIN;[\s\S]*?COMMIT;\s*$/);
  assert.equal((sql.match(/vault\.decrypted_secrets/g) || []).length, 2);
  assert.equal((sql.match(/https:\/\/vspposovhdgvbeukoivh\.supabase\.co/g) || []).length, 2);
  assert.match(sql, /GDPR reservation contacts migration is TEST-only/);
  assert.match(sql, /GDPR contact cleanup is TEST-only/);
  assert.match(sql, /Unexpected reservation immutability guard/);
  assert.doesNotMatch(sql, /https:\/\/tfvgxrdjrpicgtvovehl\.supabase\.co/);
});

test("retention approval gate is disabled by default and cannot be enabled by API roles", () => {
  assert.match(sql, /is_enabled boolean NOT NULL DEFAULT false/i);
  assert.match(sql, /VALUES \(true, false\)\s*ON CONFLICT \(singleton\) DO NOTHING/i);
  assert.match(sql, /approved_at IS NOT NULL/i);
  assert.match(sql, /length\(btrim\(coalesce\(approval_reference, ''\)\)\) >= 8/i);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /REVOKE ALL ON TABLE public\.gdpr_reservation_contact_cleanup_gate\s+FROM PUBLIC, anon, authenticated, service_role/i);
  assert.doesNotMatch(sql, /SET\s+is_enabled\s*=\s*true/i);
});

test("reservation guard still protects ALL original immutable snapshot fields", () => {
  assert.ok(guard, "immutable reservation trigger definition must be present");
  const unchanged = [
    "id", "offer_id", "owner_id", "renter_id", "start_date", "end_date",
    "pickup_time", "date_from", "date_to", "days", "price_per_day",
    "total_price", "platform_fee_percent", "platform_fee_amount",
    "owner_payout", "created_at", "offer_name", "category", "city",
    "total_days", "owner_name", "owner_phone", "pickup_phone",
    "pickup_street", "pickup_city", "pickup_postal_code",
    "pickup_full_address", "pickup_note", "pickup_latitude", "pickup_longitude",
  ];
  for (const field of unchanged) {
    assert.match(guard, new RegExp(`new\\.${field} IS DISTINCT FROM old\\.${field}`, "i"),
      `missing immutable snapshot protection for ${field}`);
  }
  for (const field of ["renter_name", "renter_email", "renter_phone"]) {
    assert.match(guard,
      new RegExp(`new\\.${field} IS DISTINCT FROM old\\.${field}\\s+AND NOT v_gdpr_contact_scrub_authorized`, "i"));
    assert.match(guard, new RegExp(`new\\.${field} IS NOT DISTINCT FROM ''`, "i"),
      `${field} must only be blanked, never replaced by arbitrary data`);
  }
  assert.match(guard, /v_payment_update_authorized := coalesce\(\([\s\S]*?\), false\);/i);
  assert.match(guard, /NOT v_payment_update_authorized/i);
  assert.match(guard, /new\.paid_at IS DISTINCT FROM old\.paid_at/i);
  assert.match(guard, /new\.payment_provider_status IS DISTINCT FROM old\.payment_provider_status/i);
  assert.match(guard, /Immutable reservation fields cannot be changed/i);
});

test("GDPR exception requires trusted role, matching target and approved gate", () => {
  assert.match(guard, /auth\.role\(\), ''\) = 'service_role'/i);
  assert.match(guard, /app\.gdpr_reservation_scrub_authorized/);
  assert.match(guard, /app\.gdpr_reservation_scrub_renter_id/);
  assert.match(guard, /old\.renter_id::text/);
  assert.match(guard, /new\.status IS NOT DISTINCT FROM old\.status/i);
  assert.match(guard, /old\.status::text IN \('cancelled', 'expired', 'rejected'\)/);
  assert.match(guard, /p\.account_status = 'deactivated'/);
  assert.match(guard, /g\.is_enabled = true/);
  assert.match(guard, /NOT EXISTS \(\s*SELECT 1 FROM public\.payments pay/i);
  assert.match(guard, /NOT EXISTS \(\s*SELECT 1 FROM public\.reservation_cancellations c/i);
  assert.match(guard, /NOT EXISTS \(\s*SELECT 1 FROM public\.reservation_return_incidents i/i);
});

test("preview is the default; manual execution fails until legal approval is recorded", () => {
  assert.ok(cleanup, "manual cleanup helper must be present");
  assert.match(cleanup, /p_apply boolean DEFAULT false/i);
  assert.match(cleanup, /IF p_apply IS TRUE THEN[\s\S]*?IF NOT coalesce\(v_enabled, false\) THEN[\s\S]*?Retention policy has not been approved/);
  assert.match(cleanup, /app\.gdpr_reservation_scrub_authorized', 'on', true/);
  assert.match(cleanup, /app\.gdpr_reservation_scrub_authorized', 'off', true/);
  assert.match(cleanup, /p_renter_id IS NULL/);
  assert.match(cleanup, /p\.account_status = 'deactivated'/);
  assert.match(cleanup, /pg_advisory_xact_lock\(860808/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.gdpr_review_deactivated_renter_contacts\(uuid, boolean\)\s+FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.gdpr_review_deactivated_renter_contacts\(uuid, boolean\)\s+TO service_role/);
});

test("cleanup is limited to unpaid closed renter contacts: history and messages stay intact", () => {
  assert.match(cleanup, /UPDATE public\.reservations r\s+SET renter_name = '', renter_email = '', renter_phone = ''/i);
  assert.match(cleanup, /r\.renter_id = p_renter_id/);
  assert.match(cleanup, /r\.status::text IN \('cancelled', 'expired', 'rejected'\)/);
  assert.match(cleanup, /NOT EXISTS \(\s*SELECT 1 FROM public\.payments pay/i);
  assert.match(cleanup, /NOT EXISTS \(\s*SELECT 1 FROM public\.reservation_cancellations c/i);
  assert.match(cleanup, /NOT EXISTS \(\s*SELECT 1 FROM public\.reservation_return_incidents i/i);
  assert.equal((sql.match(/UPDATE public\.reservations r/g) || []).length, 1,
    "the migration must not immediately run a cleanup outside the helper");
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\s+public\./i);
  assert.doesNotMatch(sql, /\bUPDATE\s+public\.(payments|reservation_email_deliveries|reservation_notification_deliveries|profiles|offers)\b/i);
  assert.match(cleanup, /SELECT count\(\*\) INTO v_legacy_emails[\s\S]*?public\.reservation_email_deliveries d/);
});
