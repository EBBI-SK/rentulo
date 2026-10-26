'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20261020150000_bod02_gdpr_closed_status_90_days_TEST.sql'), 'utf8');
const prior = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20261020120000_bod02_gdpr_reservation_contacts_gate_TEST.sql'), 'utf8');

const between = (start, end) => {
  const parts = sql.split(start);
  assert.equal(parts.length, 2, `Missing/duplicate SQL region: ${start}`);
  const rest = parts[1].split(end);
  assert.equal(rest.length, 2, `Missing/duplicate SQL region end: ${end}`);
  return rest[0];
};
const stamp = between('CREATE OR REPLACE FUNCTION public.gdpr_stamp_closed_status_time()',
  'DROP TRIGGER IF EXISTS zzzzzz_gdpr_stamp_closed_status_time');
const ageGuard = between('CREATE OR REPLACE FUNCTION public.gdpr_enforce_contact_90_day_age()',
  'DROP TRIGGER IF EXISTS zzzzzz_gdpr_enforce_contact_90_day_age');
const rpc = between('CREATE OR REPLACE FUNCTION public.gdpr_review_deactivated_renter_contacts(',
  'REVOKE ALL ON FUNCTION public.gdpr_review_deactivated_renter_contacts(uuid, boolean)');
const eligible = rpc.split('SELECT count(*) INTO v_eligible')[1]
  ?.split('SELECT count(*) INTO v_with_payments')[0];
const withPayments = rpc.split('SELECT count(*) INTO v_with_payments')[1]
  ?.split('SELECT count(*) INTO v_legacy_emails')[0];
const update = rpc.split('UPDATE public.reservations r')[1]
  ?.split('GET DIAGNOSTICS v_scrubbed')[0];

const hasAgeAnchor = (text) => {
  assert.match(text, /WHEN r\.status::text IN \('cancelled', 'rejected'\) THEN r\.gdpr_closed_at/i);
  assert.match(text, /WHEN r\.status::text = 'expired' THEN r\.expired_at/i);
  assert.match(text, /ELSE NULL::timestamptz/i);
  assert.match(text, /\) <= now\(\) - interval '90 days'/i);
};

test('BOD02: SQL is TEST-only, refuses missing prerequisite and enabled cleanup gate', () => {
  assert.match(sql, /^\s*--[\s\S]*?BEGIN;\s*/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /vault\.decrypted_secrets/);
  assert.match(sql, /rentulo_project_url/);
  assert.match(sql, /https:\/\/vspposovhdgvbeukoivh\.supabase\.co/);
  assert.doesNotMatch(sql, /https:\/\/tfvgxrdjrpicgtvovehl\.supabase\.co/);
  assert.match(sql, /g\.singleton = true AND g\.is_enabled = false/);
  assert.match(sql, /Unexpected GDPR cleanup RPC in TEST/);
  assert.match(sql, /Unexpected immutability protection in TEST/);
  assert.match(sql, /Required reservation immutability trigger missing or disabled/);
});

test('BOD02: migration neither backfills nor deletes historical personal records', () => {
  assert.match(sql, /ALTER TABLE public\.reservations\s+ADD COLUMN IF NOT EXISTS gdpr_closed_at timestamptz/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\s+public\./i);
  assert.doesNotMatch(sql, /\bUPDATE\s+public\.(?!reservations\b)/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+public\.reservations\s+SET\s+gdpr_closed_at/i);
  assert.equal((sql.match(/UPDATE public\.reservations r/g) || []).length, 1,
    'only the pre-existing RPC may contain a conditional reservation UPDATE');
  assert.doesNotMatch(sql, /SET\s+is_enabled\s*=\s*true/i);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.protect_reservation_immutable_fields\(\)/i,
    'original contact/financial immutability guard must not be replaced');
});

test('BOD02: only new actual cancellation or rejection transition gets a trusted timestamp', () => {
  assert.match(stamp, /IF TG_OP = 'INSERT'[\s\S]*?NEW\.gdpr_closed_at IS NOT NULL[\s\S]*?RAISE EXCEPTION/i);
  assert.match(stamp, /NEW\.gdpr_closed_at IS DISTINCT FROM OLD\.gdpr_closed_at[\s\S]*?RAISE EXCEPTION/i);
  assert.match(stamp, /NEW\.status IS DISTINCT FROM OLD\.status\s+AND NEW\.status::text IN \('cancelled', 'rejected'\)/i);
  assert.match(stamp, /NEW\.gdpr_closed_at := clock_timestamp\(\)/i);
  assert.doesNotMatch(stamp, /updated_at|created_at|sent_at|end_date/i);
  assert.match(sql, /CREATE TRIGGER zzzzzz_gdpr_stamp_closed_status_time\s+BEFORE INSERT OR UPDATE OF status, gdpr_closed_at/i);
});

test('BOD02: fail-closed separate BEFORE UPDATE trigger enforces full 90 days', () => {
  for (const col of ['renter_name', 'renter_email', 'renter_phone']) {
    assert.match(ageGuard, new RegExp(`NEW\\.${col} IS DISTINCT FROM OLD\\.${col}`, 'i'));
  }
  assert.match(ageGuard, /WHEN OLD\.status::text IN \('cancelled', 'rejected'\) THEN OLD\.gdpr_closed_at/i);
  assert.match(ageGuard, /WHEN OLD\.status::text = 'expired' THEN OLD\.expired_at/i);
  assert.match(ageGuard, /v_closed_at IS NULL\s+OR v_closed_at > now\(\) - interval '90 days'/i);
  assert.match(sql, /CREATE TRIGGER zzzzzz_gdpr_enforce_contact_90_day_age\s+BEFORE UPDATE OF renter_name, renter_email, renter_phone/i);
  assert.doesNotMatch(ageGuard, /updated_at|end_date|sent_at|created_at/i);
});

test('BOD02: preview eligibility and actual cleanup BOTH require 90-day trusted anchor', () => {
  assert.ok(eligible && update && withPayments);
  hasAgeAnchor(eligible);
  hasAgeAnchor(update);
  assert.doesNotMatch(withPayments, /interval '90 days'/,
    'payment blocker counter should still show all closed records with payments');
  assert.equal((rpc.match(/interval '90 days'/g) || []).length, 2);
  assert.match(rpc, /p_apply boolean DEFAULT false/);
  assert.match(rpc, /Retention policy has not been approved: cleanup is disabled/);
});

test('BOD02: original security, financial and incident blockers remain unchanged', () => {
  for (const marker of [
    "coalesce(auth.role(), '') <> 'service_role'",
    "session_user <> 'postgres'",
    "p.account_status = 'deactivated'",
    "pg_advisory_xact_lock(860808",
    "SELECT 1 FROM public.payments pay",
    "SELECT 1 FROM public.reservation_cancellations c",
    "SELECT 1 FROM public.reservation_return_incidents i",
    "legacy_email_rows_with_address",
    "SET renter_name = '', renter_email = '', renter_phone = ''",
    "PERFORM set_config('app.gdpr_reservation_scrub_authorized', 'off', true)",
  ]) assert.ok(rpc.includes(marker), `Removed critical prior protection: ${marker}`);
  assert.match(prior, /CREATE OR REPLACE FUNCTION public\.protect_reservation_immutable_fields\(\)/);
  assert.match(prior, /gdpr_reservation_contact_cleanup_gate/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.gdpr_review_deactivated_renter_contacts\(uuid, boolean\)\s+TO service_role/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.gdpr_review_deactivated_renter_contacts\(uuid, boolean\)\s+FROM PUBLIC, anon, authenticated/i);
});

test('BOD02: no email-notification or payment table is ever changed by patch', () => {
  assert.doesNotMatch(sql, /\bDELETE\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+public\.(payments|reservation_email_deliveries|reservation_notification_deliveries|reservation_cancellations|profiles)/i);
  assert.match(rpc, /FROM public\.reservation_email_deliveries d/i);
  assert.match(sql, /IF NOT EXISTS \([\s\S]*?gdpr_reservation_contact_cleanup_gate/i);
});
