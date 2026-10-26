// Rentulo V1 / BOD 1 / one release-bundle integrity test.
// Pure file checks; no network, Supabase connection, live payments or deployments.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(repo, 'supabase', 'migrations');
const releaseDir = join(repo, 'supabase', 'prod-release-20261024', 'migrations');
const prodRef = 'tfvgxrdjrpicgtvovehl';
const originalTestRef = 'vspposovhdgvbeukoivh';
const pinnedSourceTree = 'f175056d5087adf00925e6ef89c56148d6e9fa2a';
// SHA-256 of the 38 original migrations in release candidate bd1b8d1.
const expected = [
  {
    "source": "20261009130000_add_offer_and_reservation_numbers.sql",
    "target": "20261009130000_add_offer_and_reservation_numbers.sql",
    "sha256": "dc31674f818ca33f9e3050a5eac2f562ab4b7ffa803d0312d530eeec96a8f352"
  },
  {
    "source": "20261011103000_guard_pickup_and_remove_test_payment.sql",
    "target": "20261011103000_guard_pickup_and_remove_test_payment.sql",
    "sha256": "fa85b6c99bd8aea3301130d7f5a0f664756b9b6610de2b65d51d28ce98a5b1f9"
  },
  {
    "source": "20261011170000_limit_pickup_pin_to_pickup_day.sql",
    "target": "20261011170000_limit_pickup_pin_to_pickup_day.sql",
    "sha256": "92bbf0ad4c52d38a5758a8d03043ee9784ee6fd18f6d5ff8e32fd085631eede7"
  },
  {
    "source": "20261012100000_unify_reservation_notification_outbox.sql",
    "target": "20261012100000_unify_reservation_notification_outbox.sql",
    "sha256": "e8a3cb7015e86e4d7bd802b71800919d53dc3cb276b18add05cb21a5a8662687"
  },
  {
    "source": "20261012101000_schedule_notification_worker.sql",
    "target": "20261012101000_schedule_notification_worker.sql",
    "sha256": "12ae9180b1ff9084729773088bcfea4314e769d33676ee82afe3242fc470f696"
  },
  {
    "source": "20261012150000_harden_reservation_notification_worker.sql",
    "target": "20261012150000_harden_reservation_notification_worker.sql",
    "sha256": "0931303b8d2fb8b8140ecbccfbb339df99ea01c9619fd22dcd206de2115a12a3"
  },
  {
    "source": "20261012170000_add_expired_reservation_status.sql",
    "target": "20261012170000_add_expired_reservation_status.sql",
    "sha256": "151c05a2f7da1f57db7ccb3d5d8010d548c06a728a314da26d0e21cc6a323c15"
  },
  {
    "source": "20261012171000_reservation_expiration_policy.sql",
    "target": "20261012171000_reservation_expiration_policy.sql",
    "sha256": "7678f104055aaa2d9824779dbfedd8efab27fa2225590a61911ba5e6d0f34278"
  },
  {
    "source": "20261012172000_schedule_reservation_expiration.sql",
    "target": "20261012172000_schedule_reservation_expiration.sql",
    "sha256": "0b4d33137e3b4698953992077e86bf5b7f41003508512134fc5ee97977b314cd"
  },
  {
    "source": "20261013090000_reset_sms_opt_in_on_phone_change.sql",
    "target": "20261013090000_reset_sms_opt_in_on_phone_change.sql",
    "sha256": "741d59753bc8930029f10cdcce305ecdbe40cdd428e8df9246d9e3ae822f31e3"
  },
  {
    "source": "20261013100000_monitor_reservation_notifications_TEST.sql",
    "target": "20261013100000_monitor_reservation_notifications_PROD.sql",
    "sha256": "c4fcc9a831088bd7bd1b1e7bd5b784c1e11ca72e0344afdfd5606e0e4a080194"
  },
  {
    "source": "20261014100000_fix_owner_debt_reminder_claim_ambiguity.sql",
    "target": "20261014100000_fix_owner_debt_reminder_claim_ambiguity.sql",
    "sha256": "4f083ecd503d35f7045194b4655aefc676aefcc030809e8715e153c24560f55a"
  },
  {
    "source": "20261014110000_pin_stripe_checkout_locale.sql",
    "target": "20261014110000_pin_stripe_checkout_locale.sql",
    "sha256": "66ad6a3483adafa40cc2e2f55d51831cbbd3abf48ec2ab053baee49756173318"
  },
  {
    "source": "20261014120000_fix_paid_cancellation_refund_finalization.sql",
    "target": "20261014120000_fix_paid_cancellation_refund_finalization.sql",
    "sha256": "712fded2a53eab455f469edb6624cfb0a9f4bbd2f07478efaa60c6020bd78d0b"
  },
  {
    "source": "20261015160000_add_paid_no_show_status.sql",
    "target": "20261015160000_add_paid_no_show_status.sql",
    "sha256": "2346b8c70991d08f4eb148267172984961a45ae6af80ad38bef7994bb15ff1ad"
  },
  {
    "source": "20261015161000_paid_no_show_settlement_TEST.sql",
    "target": "20261015161000_paid_no_show_settlement_PROD.sql",
    "sha256": "c116237ac5b03a2fa9ec2cb8c2bbeae4ae27eb6dff027257d5f3a4d4699eb3db"
  },
  {
    "source": "20261017180000_payment_deadline_before_pickup_TEST.sql",
    "target": "20261017180000_payment_deadline_before_pickup_PROD.sql",
    "sha256": "7dc564defd737998077c0aa0208cd9141c33f69e56d92d0a30d509da7cd5db66"
  },
  {
    "source": "20261017203000_cancellation_cutoff_24h_exception_TEST.sql",
    "target": "20261017203000_cancellation_cutoff_24h_exception_PROD.sql",
    "sha256": "16a487f340268fa7ed692b714b3d69ca14824082d2e19f0faf19e3b482e95b60"
  },
  {
    "source": "20261017223000_pending_withdrawal_cutoff_FIX_TEST.sql",
    "target": "20261017223000_pending_withdrawal_cutoff_FIX_PROD.sql",
    "sha256": "bbe1a26a7bca82d3171412363ea76e905b38be6bde9b8c2663b023d589514f2b"
  },
  {
    "source": "20261017233000_return_followup_incident_TEST.sql",
    "target": "20261017233000_return_followup_incident_PROD.sql",
    "sha256": "73381c9f4d886cb775cf78d5128ae622eda37f3eb5456eed17441c8e1624bdb7"
  },
  {
    "source": "20261017235500_two_hour_booking_buffer_TEST.sql",
    "target": "20261017235500_two_hour_booking_buffer_PROD.sql",
    "sha256": "56ea9db61a89e92d9c2b893240626cdaa4ce869d1b3fd81cd8ea902af78c65d9"
  },
  {
    "source": "20261018001000_transfer_only_after_return_TEST.sql",
    "target": "20261018001000_transfer_only_after_return_PROD.sql",
    "sha256": "7166d6a8be2a4eed57b2993ebe0683399534b18c57127f0861f18089cce8f021"
  },
  {
    "source": "20261018090000_pickup_pin_two_hours_early_TEST.sql",
    "target": "20261018090000_pickup_pin_two_hours_early_PROD.sql",
    "sha256": "eca030d13e8d232925f78d3840b2f160f0a6221aab47bec580793bec453d8822"
  },
  {
    "source": "20261018110000_bod02_v1_transport_rule_TEST.sql",
    "target": "20261018110000_bod02_v1_transport_rule_PROD.sql",
    "sha256": "a601d95fe6e099b170cac6119edf1c7a6f803bf44ad4359ecfe8a0f686956c08"
  },
  {
    "source": "20261018130000_bod02_gdpr_deactivation_cleanup_TEST.sql",
    "target": "20261018130000_bod02_gdpr_deactivation_cleanup_PROD.sql",
    "sha256": "6f022d78a9b7125fa9160cfca7b00046bc331d099f0735587de081d472612026"
  },
  {
    "source": "20261018140000_bod02_gdpr_deleted_offer_address_TEST.sql",
    "target": "20261018140000_bod02_gdpr_deleted_offer_address_PROD.sql",
    "sha256": "acba06a6d37e642312ec244b1c155d512c29b23174b4a95b1ec15001f6b6d72d"
  },
  {
    "source": "20261020120000_bod02_gdpr_reservation_contacts_gate_TEST.sql",
    "target": "20261020120000_bod02_gdpr_reservation_contacts_gate_PROD.sql",
    "sha256": "cde244f8c1366a31ab08bc2a18e1e5ebfed4e955be1a9a0ef64bacbeaf8fcf44"
  },
  {
    "source": "20261020150000_bod02_gdpr_closed_status_90_days_TEST.sql",
    "target": "20261020150000_bod02_gdpr_closed_status_90_days_PROD.sql",
    "sha256": "e0c5692722c3cc81c693136a59a7265ef76ea007386e6f83f3706389484e4b2d"
  },
  {
    "source": "20261020170000_bod02_v1_compliance_registry_TEST.sql",
    "target": "20261020170000_bod02_v1_compliance_registry_PROD.sql",
    "sha256": "767fb008eada9fd432e1ef7748db156580ad5b9e34b2f97df8bae4686e20db6d"
  },
  {
    "source": "20261020170500_bod02_v1_trusted_finalized_timestamps_TEST.sql",
    "target": "20261020170500_bod02_v1_trusted_finalized_timestamps_PROD.sql",
    "sha256": "53ba1999cfab9f4177ad9d705e4d1f40b662861561e65f76fde6ab47950b836b"
  },
  {
    "source": "20261020171000_bod02_v1_guarded_retention_TEST.sql",
    "target": "20261020171000_bod02_v1_guarded_retention_PROD.sql",
    "sha256": "b4e596cb2275e2a23f0c5490673c8fe93baac2a9f1e68841f3586e2585362b65"
  },
  {
    "source": "20261020172000_bod02_v1_owner_contacts_legal_hold_TEST.sql",
    "target": "20261020172000_bod02_v1_owner_contacts_legal_hold_PROD.sql",
    "sha256": "e41bcb6072db3184c47c5413a61fc52f41fb710877805a4c096e60d764b29e12"
  },
  {
    "source": "20261020173000_bod02_v1_deleted_offer_photo_retention_TEST.sql",
    "target": "20261020173000_bod02_v1_deleted_offer_photo_retention_PROD.sql",
    "sha256": "eeb0b2c2c91450873ad36f9d9a6a35e11bb57ad5b1a8441951b767353d41bc59"
  },
  {
    "source": "20261021100000_bod03a_incidents_moderation_TEST.sql",
    "target": "20261021100000_bod03a_incidents_moderation_PROD.sql",
    "sha256": "17acab80c771168a5eff880b3e6d50a2a08ce59d4e9d0884bf5ed6c8f35a2f5f"
  },
  {
    "source": "20261021110000_bod03b_exceptional_settlement_TEST.sql",
    "target": "20261021110000_bod03b_exceptional_settlement_PROD.sql",
    "sha256": "e1df5a96ed6312676d885534ea032d10c66b210307674bf8910cfbe0810873e5"
  },
  {
    "source": "20261023150000_raise_platform_fee_minimum_to_70.sql",
    "target": "20261023150000_raise_platform_fee_minimum_to_70.sql",
    "sha256": "a22c43bdd0aa1203e89b2f92487d1b1be3a2ffdffa242e15dabcc30d6c9647cb"
  },
  {
    "source": "20261023175000_fix_stripe_payment_immutable_guard_TEST.sql",
    "target": "20261023175000_fix_stripe_payment_immutable_guard_PROD.sql",
    "sha256": "c56a8d18d0f2d487c8acee8d7039dc1b372cc462f3b5ac6c1d6c5640d099e6de"
  },
  {
    "source": "20261024150000_returned_booking_actual_return_buffer_TEST.sql",
    "target": "20261024150000_returned_booking_actual_return_buffer_PROD.sql",
    "sha256": "3abfff5b628fc8f295466ded0027064a3a5d7bca44a17d41e31f30e51fb89ff0"
  }
];

function sourceHash(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}
function count(content, pattern) {
  return [...content.matchAll(pattern)].length;
}

test('BOD 1 PROD migration package: pinned sources, all 38 versions, no auto-cron and no TEST links', () => {
  assert.equal(expected.length, 38);
  const filenames = readdirSync(releaseDir).filter((x) => x.endsWith('.sql')).sort();
  assert.deepEqual(filenames, expected.map((row) => row.target).sort(), 'Unexpected/missing release SQL');
  assert.equal(new Set(filenames.map((x) => x.slice(0, 14))).size, 38, 'Duplicate migration version');

  const originalScheduleFiles = [];
  for (const row of expected) {
    const source = readFileSync(join(sourceDir, row.source), 'utf8');
    const target = readFileSync(join(releaseDir, row.target), 'utf8');
    assert.equal(sourceHash(join(sourceDir, row.source)), row.sha256, `Source migration drifted: ${row.source}`);
    assert.match(target, /PROD RELEASE CANDIDATE bd1b8d1/, row.target);
    assert.match(target, /DO \$rentulo_prod_release_guard\$/i, row.target);
    assert.match(target, /rentulo_prod_release_target/, row.target);
    assert.ok(target.includes(prodRef), row.target);
    assert.ok(!target.includes(originalTestRef), `Old TEST project URL in: ${row.target}`);
    assert.doesNotMatch(target, /\b(?:select|perform)\s+cron\.schedule\s*\(/i, `Cron auto-start in: ${row.target}`);
    assert.doesNotMatch(target, /PROD forbidden|Do not execute on PROD|Do not apply this change to rentulo-prod/i, row.target);
    assert.doesNotMatch(target, /\bR-0000[0-9]+\b|16b3017d-13b5-4a39-b617-fd56614d7d6d/i, row.target);
    const begin = count(target, /^\s*BEGIN\s*;/gim);
    const commit = count(target, /^\s*COMMIT\s*;/gim);
    assert.equal(begin, commit, `SQL transaction wrapper mismatched: ${row.target}`);
    assert.equal(count(target, /\bCREATE\s+OR\s+REPLACE\s+FUNCTION\b/gi),
      count(source, /\bCREATE\s+OR\s+REPLACE\s+FUNCTION\b/gi), `Function definitions altered: ${row.target}`);
    assert.equal(count(target, /\bCREATE\s+TABLE\b/gi),
      count(source, /\bCREATE\s+TABLE\b/gi), `Table creation altered: ${row.target}`);
    assert.equal(count(target, /\bCREATE\s+TRIGGER\b/gi),
      count(source, /\bCREATE\s+TRIGGER\b/gi), `Trigger definitions altered: ${row.target}`);
    if (/\b(?:select|perform)\s+cron\.schedule\s*\(/i.test(source)) originalScheduleFiles.push(row.source);
  }
  assert.equal(originalScheduleFiles.length, 6, 'Expected exactly six deferred scheduling blocks');
  for (const version of ['20261012170000', '20261015160000']) {
    const sql = readFileSync(join(releaseDir, filenames.find((x) => x.startsWith(version))), 'utf8');
    assert.match(sql, /ALTER TYPE public\.reservation_status ADD VALUE/i);
    assert.doesNotMatch(sql, /^\s*BEGIN\s*;/im, `Enum needs standalone statement: ${version}`);
  }
  const photoSql = readFileSync(join(releaseDir, filenames.find((x) => x.startsWith('20261020173000'))), 'utf8');
  const retentionSql = readFileSync(join(releaseDir, filenames.find((x) => x.startsWith('20261020171000'))), 'utf8');
  assert.match(photoSql, /gdpr_photo_cleanup_gate/i);
  assert.match(photoSql, /is_enabled boolean NOT NULL DEFAULT false/i);
  assert.match(retentionSql, /gdpr_retention_execution_gate/i);
  assert.match(retentionSql, /is_enabled boolean NOT NULL DEFAULT false/i);
  const legalSql = readFileSync(join(releaseDir, filenames.find((x) => x.startsWith('20261020170000'))), 'utf8');
  assert.ok(!legalSql.includes('1.0-test-2026-10-20'), 'PROD SQL must not stamp a TEST legal version');
  assert.ok(legalSql.includes("'1.0'"), 'PROD legal version should be 1.0');
  const oldPayment = readFileSync(join(releaseDir, filenames.find((x) => x.startsWith('20261011103000'))), 'utf8');
  assert.ok(oldPayment.includes('drop function if exists public.mark_my_reservation_paid_test(uuid)'),
    'Legacy test-payment RPC removal must be present');
  // Structural check: the number of DDL and permission statements stays intact.
  for (const row of expected) {
    const from = readFileSync(join(sourceDir, row.source), 'utf8');
    const into = readFileSync(join(releaseDir, row.target), 'utf8');
    for (const pattern of [/ALTER\s+TABLE/gi, /REVOKE\s+ALL/gi, /GRANT\s+EXECUTE/gi]) {
      assert.equal(count(into, pattern), count(from, pattern), `Unexpected DDL/grants drift: ${row.target}`);
    }
  }
  const latestSql = readFileSync(join(releaseDir, filenames.find((x) => x.startsWith('20261024150000'))), 'utf8');
  assert.match(latestSql, /gdpr_finalized_at/i);
  assert.match(latestSql, /interval '2 hours'/i);
  const readme = readFileSync(join(repo, 'docs', 'BOD1_PROD_RELEASE_V1_20261024.md'), 'utf8');
  assert.ok(readme.includes(pinnedSourceTree), 'Runbook must pin the reviewed source tree');
  assert.ok(readme.includes('NO-GO'), 'Runbook must include an abort/rollback decision');
});
