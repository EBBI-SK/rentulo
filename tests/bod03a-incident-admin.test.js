"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const sql = read('supabase/migrations/20261021100000_bod03a_incidents_moderation_TEST.sql');
const verification = read('docs/BOD03A_OVERENIE_TEST.sql');
const runbook = read('docs/BOD03A_INCIDENTY_ADMIN_TEST.md');
const monitor = read('supabase/functions/monitor-reservation-notifications/index.ts');

test('03A: one atomic TEST-only migration, no historical money or reservation mutations', () => {
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /vault\.decrypted_secrets/);
  assert.match(sql, /https:\/\/vspposovhdgvbeukoivh\.supabase\.co/);
  assert.match(sql, /PROD forbidden/);
  assert.doesNotMatch(sql, /(?:insert into|update|delete from)\s+public\.(?:payments|reservation_cancellations|reservations)\s/gi);
  assert.doesNotMatch(sql, /stripe_transfer_id|stripe_payment_intent|\bcron\.schedule\b/i);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE TABLE/i);
});

test('03A: four incident categories only, pre-existing DSA/GDPR/return registers preserved', () => {
  for (const table of ['platform_incidents','platform_incident_events','platform_user_blocks','platform_offer_moderation','platform_admin_actions']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\s*\\(`));
  }
  for (const type of ['damage','loss','fraud','problem_user']) {
    assert.ok(sql.includes(`'${type}'`));
  }
  assert.match(sql, /platform_incident_number_seq/);
  assert.match(sql, /'I-' \|\| lpad\(/);
  assert.match(sql, /'received', 'reviewing', 'closed'/);
  assert.match(sql, /dsa_content_notices/);
  assert.match(sql, /reservation_return_incidents/);
  assert.match(sql, /gdpr_legal_holds/);
  assert.match(runbook, /bezpečenej schránke/);
  assert.match(runbook, /gdpr_legal_holds/);
});

test('03A: SQL Editor owner only, browser and service-role access explicitly revoked', () => {
  assert.match(sql, /session_user <> 'postgres' OR current_user <> 'postgres'/);
  assert.match(sql, /auth\.uid\(\) IS NOT NULL/);
  assert.match(sql, /char_length\(btrim\(coalesce\(p_reason, ''\)\)\) NOT BETWEEN 12 AND 2000/);
  assert.match(sql, /ALTER TABLE public\.%I ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.%I FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.%s FROM PUBLIC, anon, authenticated, service_role/);
  assert.doesNotMatch(sql, /CREATE POLICY|GRANT EXECUTE.*authenticated|GRANT SELECT.*authenticated/i);
  assert.match(runbook, /Owner \/ SQL Editor/);
  assert.match(runbook, /nedokáže kryptograficky potvrdiť/);
});

test('03A: normal admin functions append history with reason and reject mutation of audit', () => {
  for (const name of ['platform_admin_create_incident','platform_admin_update_incident',
    'platform_admin_block_user','platform_admin_unblock_user',
    'platform_admin_hide_offer','platform_admin_release_offer']) {
    assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`));
  }
  assert.match(sql, /trg_platform_incident_event_write/);
  assert.match(sql, /trg_platform_user_control_audit/);
  assert.match(sql, /trg_platform_offer_control_audit/);
  assert.match(sql, /trg_platform_incident_events_append_only/);
  assert.match(sql, /trg_platform_admin_actions_append_only/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON public\.platform_admin_actions/);
  assert.match(sql, /BEFORE INSERT ON public\.platform_admin_actions/);
  assert.match(sql, /BEFORE DELETE ON public\.platform_incidents/);
  assert.match(sql, /set_config\('rentulo\.platform_admin_reason', '', true\)/);
  assert.match(sql, /added_evidence_reference/);
});

test('03A: restrictions guard new offers, new reservations and owner approvals without rewriting paid flows', () => {
  assert.match(sql, /BEFORE INSERT OR UPDATE ON public\.offers/);
  assert.match(sql, /BEFORE INSERT ON public\.reservations/);
  assert.match(sql, /BEFORE UPDATE OF status ON public\.reservations/);
  assert.match(sql, /NEW\.status = 'approved'/);
  assert.match(sql, /user_id IN \(NEW\.renter_id, NEW\.owner_id\) AND b\.is_blocked/);
  assert.match(sql, /RENTULO_USER_RESTRICTED/);
  assert.match(sql, /RENTULO_OFFER_MODERATED/);
  assert.match(sql, /new\.status = 'hidden'::public\.offer_status/);
  assert.match(sql, /and exists \(select 1 from public\.platform_offer_moderation m/);
  assert.match(sql, /-- Do not auto-publish/);
  assert.match(runbook, /existujúce zaplatené rezervácie sa dokončia/);
});

test('03A: tech alarms use support mailbox and fresh idempotency namespace', () => {
  assert.match(monitor, /const TEST_ALERT_TO = "support@rentulo\.com"/);
  assert.match(monitor, /rentulo-test-monitor-support-v2:/);
  assert.match(monitor, /cron-job\.org TEST monitor/);
  assert.match(monitor, /TEST_SUPABASE_URL = "https:\/\/vspposovhdgvbeukoivh\.supabase\.co"/);
  assert.match(runbook, /cron-job\.org/);
  assert.match(runbook, /samostatne a ručne nastaviť e-mail/);
});

test('03A: single read-only verification query and no new PROD deployment instructions', () => {
  assert.match(verification, /relrowsecurity/);
  assert.match(verification, /has_table_privilege\('anon'/);
  assert.match(verification, /has_function_privilege\('authenticated'/);
  assert.match(verification, /spravny_test/);
  assert.match(verification, /platform_offer_moderation/);
  assert.doesNotMatch(verification, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE)\s+(?:INTO|FROM|TABLE|public)/i);
  assert.match(runbook, /03B/);
  assert.match(runbook, /TEST/);
  assert.doesNotMatch(sql, /GRANT .* TO (?:anon|authenticated|service_role)/i);
});
