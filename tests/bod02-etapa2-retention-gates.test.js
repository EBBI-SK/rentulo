'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const migration = (part) => source('supabase', 'migrations', part);
const stamps = migration('20261020170500_bod02_v1_trusted_finalized_timestamps_TEST.sql');
const retention = migration('20261020171000_bod02_v1_guarded_retention_TEST.sql');
const owners = migration('20261020172000_bod02_v1_owner_contacts_legal_hold_TEST.sql');
const photos = migration('20261020173000_bod02_v1_deleted_offer_photo_retention_TEST.sql');
const policy = source('docs', 'BOD02_GDPR_RETENCNA_POLITIKA_V1.md');
const verify = source('docs', 'BOD02_ETAPA2_OVERENIE_TEST.sql');
const worker = source('supabase', 'functions', 'gdpr-cleanup-offer-photo', 'index.ts');
const sqlFiles = [stamps, retention, owners, photos];

test('stage2: each migration refuses the wrong project and is transactional', () => {
  for (const file of sqlFiles) {
    assert.match(file, /^\s*--/);
    assert.match(file, /\bBEGIN;[\s\S]*\bCOMMIT;\s*$/i);
    assert.match(file, /vault\.decrypted_secrets/);
    assert.match(file, /rentulo_project_url/);
    assert.match(file, /https:\/\/vspposovhdgvbeukoivh\.supabase\.co/);
    assert.doesNotMatch(file, /tfvgxrdjrpicgtvovehl\.supabase\.co/);
  }
});

test('stage2: trusted timestamps are immutable, only new transitions are stamped', () => {
  assert.match(stamps, /ADD COLUMN IF NOT EXISTS gdpr_finalized_at timestamptz/);
  assert.match(stamps, /ADD COLUMN IF NOT EXISTS gdpr_deleted_at timestamptz/);
  assert.match(stamps, /NEW\.status IS DISTINCT FROM OLD\.status[\s\S]*?\('returned','no_show'\)/);
  assert.match(stamps, /NEW\.status IS DISTINCT FROM OLD\.status AND NEW\.status::text = 'deleted'/);
  assert.match(stamps, /NEW\.gdpr_finalized_at IS DISTINCT FROM OLD\.gdpr_finalized_at/);
  assert.match(stamps, /NEW\.gdpr_deleted_at IS DISTINCT FROM OLD\.gdpr_deleted_at/);
  assert.doesNotMatch(stamps, /UPDATE public\.(reservations|offers) SET/i);
});

test('stage2: no additional gate gets enabled during installation', () => {
  for (const file of [retention, owners, photos]) {
    assert.match(file, /is_enabled boolean NOT NULL DEFAULT false/i);
    assert.match(file, /VALUES\(true,false\)/i);
    assert.doesNotMatch(file, /SET\s+is_enabled\s*=\s*true/i);
    assert.match(file, /ENABLE ROW LEVEL SECURITY/i);
    assert.match(file, /REVOKE ALL ON/i);
  }
  assert.match(retention, /Retention execution gate disabled; run preview first/);
  assert.match(retention, /CREATE TABLE IF NOT EXISTS public\.gdpr_retention_category_approvals/);
  assert.match(owners, /Owner-contact retention gate disabled/);
  assert.match(photos, /g\.is_enabled AND g\.approved_at IS NOT NULL/);
});

test('stage2: all SQL maintenance is preview-only by default', () => {
  assert.match(retention, /gdpr_retention_maintenance\(p_apply boolean DEFAULT false\)/);
  assert.match(owners, /p_reservation_id uuid, p_apply boolean DEFAULT false/);
  assert.match(photos, /gdpr_preview_deleted_offer_photos\(\)/);
  assert.match(retention, /IF p_apply THEN[\s\S]*?gdpr_retention_execution_gate/);
  assert.match(retention, /IF p_apply AND EXISTS \([\s\S]*?WHERE a.category='ordinary_notifications' AND a.is_enabled[\s\S]*?DELETE FROM public\.notifications n/i);
});

test('stage2: each automated retention class has a grounded lifetime', () => {
  const targets = [
    ['ordinary_notifications', "interval '90 days'"],
    ['expired_pin_attempts', "interval '30 days'"],
    ['unneeded_legacy_email_addresses', "interval '90 days'"],
    ['resolved_delivery_errors', "interval '90 days'"],
    ['old_delivery_provider_ids', "interval '12 months'"],
    ['old_stripe_error_text', "interval '180 days'"],
    ['resolved_monitor_alerts', "interval '90 days'"],
  ];
  for (const [label, term] of targets) {
    assert.ok(retention.includes(`'${label}'`), label);
    assert.ok(retention.includes(term), term);
  }
  assert.equal((retention.match(/RETURN QUERY SELECT '/g) || []).length, 7);
  assert.equal((retention.match(/WHERE a\.category='/g) || []).length, 7,
    'a separate category approval must protect every write');
});

test('stage2: PIN proof, Stripe idempotency and history are not deleted', () => {
  assert.match(retention, /SET failed_attempts=0,locked_until=NULL/);
  assert.doesNotMatch(retention, /SET\s+confirmed_at\s*=/);
  assert.doesNotMatch(retention, /DELETE\s+FROM\s+public\.(payments|stripe_webhook_events|reservations|reviews)/i);
  assert.match(retention, /UPDATE public\.stripe_webhook_events e SET last_error=NULL/);
  assert.doesNotMatch(retention, /SET\s+stripe_event_id\s*=/i);
  assert.match(retention, /UPDATE public\.reservation_notification_deliveries d SET provider_message_id=NULL/);
});

test('stage2: all snapshots require a trustworthy status timestamp', () => {
  for (const file of [retention, owners, photos]) {
    assert.match(file, /gdpr_closed_at/);
    assert.match(file, /expired_at/);
    assert.match(file, /gdpr_finalized_at/);
  }
  assert.match(photos, /gdpr_deleted_at <= now\(\)-interval '30 days'/);
  assert.doesNotMatch(photos, /r\.updated_at\s*<=/);
});

test('stage2: legal holds prevent both renter and owner contact erasure', () => {
  assert.match(retention, /gdpr_has_reservation_legal_hold/);
  assert.match(owners, /AND NOT public\.gdpr_has_reservation_legal_hold\(r\.id\)/);
  assert.match(owners, /AND NOT public\.gdpr_has_reservation_legal_hold\(old\.id\)/);
  assert.match(owners, /AND NOT public\.gdpr_has_reservation_legal_hold\(v_r\.id\)/);
  assert.match(retention, /pg_advisory_xact_lock\(860808, 20261020\)/);
  assert.match(photos, /pg_advisory_xact_lock\(860808,20261020\)/);
});

test('stage2: contacts of owners require settlement and 90 full days', () => {
  assert.match(owners, /v_owner_contact_scrub_authorized/);
  assert.match(owners, /interval '90 days'/);
  assert.match(owners, /p\.transfer_status='succeeded'/);
  assert.match(owners, /p\.refund_status='not_requested'/);
  assert.match(owners, /c\.cancellation_kind='paid_refund'/);
  assert.match(owners, /status='open'/);
  assert.match(owners, /new\.owner_name IS DISTINCT FROM old\.owner_name/);
  assert.match(owners, /new\.total_price IS DISTINCT FROM old\.total_price/);
  assert.match(owners, /v_payment_update_authorized/);
  assert.match(owners, /gdpr_reservation_owner_contact_cleanup_gate/);
});

test('stage2: legacy email addresses only scrub resolved sent and unpaid rows', () => {
  assert.equal((retention.match(/d\.status='sent'/g) || []).length, 2);
  assert.match(retention, /SET recipient_email=''/);
  assert.match(retention, /NOT EXISTS \(SELECT 1 FROM public\.payments p WHERE p\.reservation_id=r\.id\)/);
  assert.doesNotMatch(retention, /DELETE FROM public\.reservation_email_deliveries/i);
});

test('stage2: photo eligibility prevents shared URLs and unresolved finance', () => {
  assert.match(photos, /other\.photo_url=o\.photo_url/);
  assert.match(photos, /p\.transfer_status IS DISTINCT FROM 'succeeded'/);
  assert.match(photos, /p\.refund_status IS DISTINCT FROM 'not_requested'/);
  assert.match(photos, /gdpr_legal_holds/);
  assert.match(photos, /gdpr_deleted_at <= now\(\)-interval '30 days'/);
  assert.match(photos, /split_part\(o\.photo_url,'\/storage\/v1\/object\/public\/offer-photos\/',2\)/);
  assert.match(photos, /gdpr_photo_is_safe_to_remove/);
  assert.match(photos, /gdpr_revalidate_deleted_offer_photo/);
});

test('stage2: Storage worker refuses arbitrary paths and protects secrets', () => {
  assert.match(worker, /url !== TEST_URL/);
  assert.match(worker, /RENTULO_GDPR_PHOTO_SECRET/);
  assert.match(worker, /x-rentulo-gdpr-photo-secret/);
  assert.match(worker, /equalSecret\(submittedSecret, expectedSecret\)/);
  assert.match(worker, /gdpr_claim_deleted_offer_photo/);
  assert.match(worker, /gdpr_revalidate_deleted_offer_photo/);
  assert.match(worker, /storage\.from\("offer-photos"\)/);
  assert.match(worker, /gdpr_finish_deleted_offer_photo/);
  assert.doesNotMatch(worker, /console\.log\(|console\.error\(/);
  assert.doesNotMatch(worker, /request\.json\(\)/);
  assert.doesNotMatch(worker, /Access-Control-Allow-Origin/);
});

test('stage2: scheduler stays a no-op unless authorized', () => {
  assert.match(retention, /IF EXISTS \(SELECT 1 FROM public\.gdpr_retention_execution_gate g[\s\S]*?g\.is_enabled=true\)/);
  assert.match(retention, /RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER/);
  assert.match(retention, /'rentulo-bod02-gdpr-retention-daily-TEST'/);
  assert.match(retention, /RETURN false;/);
});

test('stage2: approvals and verification explicitly prohibit PROD execution', () => {
  assert.match(verify, /AS je_test/);
  for (const col of ['renter_cleanup_enabled','owner_cleanup_enabled',
    'periodic_cleanup_enabled','photo_cleanup_enabled']) {
    assert.ok(verify.includes(col), col);
  }
  assert.match(policy, /20\. 10\. 2026/);
  assert.match(policy, /PRAVIDL|schv.len|SCHV.LEN/i);
  assert.match(policy, /PROD/);
});
