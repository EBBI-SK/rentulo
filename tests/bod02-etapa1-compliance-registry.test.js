"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const sql = read("supabase/migrations/20261020170000_bod02_v1_compliance_registry_TEST.sql");
const doc = read("docs/BOD02_ETAPA1_GDPR_DSA_BEZPECNOST_TEST.md");
const verification = read("docs/BOD02_ETAPA1_OVERENIE_TEST.sql");
const registration = read("js/registration-page.js");

test("BOD02 E1: migration is transaction-scoped and strictly pinned to TEST and GDPR gate OFF", () => {
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /vault\.decrypted_secrets[\s\S]*?rentulo_project_url/);
  assert.match(sql, /https:\/\/vspposovhdgvbeukoivh\.supabase\.co/);
  assert.match(sql, /is_enabled = false/);
  assert.match(sql, /PROD forbidden/);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\s+(?:public\.)?(?:reservations|profiles|payments|offers)/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+(?:public\.)?(?:reservations|profiles|payments|offers)\s+SET\b/i);
  assert.doesNotMatch(sql, /\bcron\.schedule\b/i);
});

test("BOD02 E1: all five registers exist, have RLS and no public/client table grants", () => {
  for (const name of [
    "gdpr_legal_holds", "gdpr_subject_requests", "dsa_content_notices",
    "gdpr_security_incidents", "gdpr_terms_acceptances"
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${name}\\s*\\(`));
    assert.ok(sql.includes(`'${name}'`));
  }
  assert.match(sql, /ALTER TABLE public\.%I ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.%I FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /GRANT SELECT ON TABLE public\.gdpr_terms_acceptances TO service_role/);
  assert.doesNotMatch(sql, /GRANT (?:ALL|INSERT|UPDATE|DELETE) ON TABLE public\.gdpr_terms_acceptances TO service_role/i);
  assert.doesNotMatch(sql, /CREATE POLICY/i);
});

test("BOD02 E1: legal hold applies to exactly one entity and supports repeated 6-month reviews", () => {
  assert.match(sql, /num_nonnulls\(reservation_id, offer_id, user_id\) = 1/);
  assert.match(sql, /last_reviewed_at timestamptz/);
  assert.match(sql, /last_review_note text/);
  assert.match(sql, /next_review_at <= last_reviewed_at \+ interval '6 months'/);
  assert.match(sql, /released_at IS NULL/);
  assert.match(sql, /pg_advisory_xact_lock\(860808, 20261020\)/);
  assert.match(sql, /BEFORE INSERT OR UPDATE OR DELETE ON public\.gdpr_legal_holds/);
});

test("BOD02 E1: GDPR requests are restricted, track month-based deadlines and require closure evidence", () => {
  assert.match(sql, /received_at \+ interval '1 month'/);
  assert.match(sql, /received_at \+ interval '3 months'/);
  assert.match(sql, /extension_reason text/);
  assert.match(sql, /status NOT IN \('closed','refused'\) OR/);
  assert.match(sql, /responded_at IS NOT NULL/);
  assert.match(doc, /policy@rentulo\.com/);
  assert.match(doc, /ďalšie dva mesiace/);
});

test("BOD02 E1: DSA and incidents contain basic traceability without external side-effects", () => {
  for (const name of ["acknowledged_at", "decided_at", "decision_reason", "appeal_received_at", "notified_at"]) {
    assert.ok(sql.includes(name), name);
  }
  for (const name of ["detected_at", "authority_notified_at", "subjects_notified_at", "corrective_actions", "closed_at"]) {
    assert.ok(sql.includes(name), name);
  }
  assert.match(doc, /72 hodín/);
  assert.match(doc, /rentulo@rentulo\.com/);
  assert.doesNotMatch(sql, /\b(?:http_post|net\.http_post|pg_net)\s*\(/i);
});

test("BOD02 E1: acceptance snapshot is server-stamped, append-only and never backfilled", () => {
  assert.match(sql, /AFTER INSERT ON auth\.users/);
  for (const flag of ["terms_business_accepted", "terms_privacy_accepted", "private_individual_confirmed"]) {
    assert.ok(sql.includes(`'${flag}'`), flag);
    assert.ok(registration.includes(`${flag}: true`), `registration field ${flag}`);
  }
  for (const key of ["terms_version", "privacy_notice_version", "terms_language"]) {
    assert.ok(sql.includes(`'${key}'`), key);
  }
  assert.match(sql, /new\.raw_user_meta_data ->> 'terms_version' IS DISTINCT FROM '1\.0-test-2026-10-20'/i);
  assert.match(sql, /clock_timestamp\(\), 'auth_signup'/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON public\.gdpr_terms_acceptances/);
  assert.match(sql, /append-only/);
  assert.doesNotMatch(sql, /INSERT INTO public\.gdpr_terms_acceptances[\s\S]*?SELECT[\s\S]*?FROM auth\.users/i);
});

test("BOD02 E1: a separate read-only TEST verification is provided", () => {
  assert.match(verification, /relrowsecurity/);
  assert.match(verification, /has_table_privilege\('anon'/);
  assert.match(verification, /gdpr_mazanie_povolene/);
  assert.match(verification, /trg_gdpr_capture_signup_terms/);
  assert.match(verification, /je_test/);
  assert.doesNotMatch(verification, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|CREATE)\s+(?:ON\s+)?(?:TABLE|INTO|FROM|public|auth)\b/i);
});
