// Rentulo V1 BOD 2: one offline targeted test. NO network and NO database writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  validateSources, prepareStage, validateStage, validateProdDbUrl,
} from '../scripts/prepare-prod-sql-release.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('BOD 2: only 75 guarded baseline + 38 pinned PROD SQL in isolated staging; no accidental TEST target', () => {
  const stageParent = mkdtempSync(join(tmpdir(), 'rentulo-bod2-offline-test-'));
  try {
    const manifest = validateSources(root);
    assert.equal(manifest.baseline_migrations.length, 75);
    assert.equal(manifest.new_migrations.length, 38);
    assert.equal(manifest.baseline_md5_versions, 'a30b4b2c515cf6a02d8831be001c297f');
    assert.equal(manifest.expected_after_md5_versions, '949655b5e6ecb1e50920894efd269930');
    const output = join(stageParent, 'isolated-workspace');
    assert.equal(prepareStage(root, output).reused, false);
    assert.deepEqual(validateStage(output, manifest), { baseline: 75, pending: 38, total: 113 });
    assert.equal(prepareStage(root, output).reused, true);
    const oneBaseline = join(output, 'supabase', 'migrations', '20261008120000_prod_final_guard.sql');
    assert.match(readFileSync(oneBaseline, 'utf8'), /RAISE EXCEPTION/);
    // PROD bootstrap already dropped the test payment RPC. Migration 2 must tolerate its absence.
    const secondProdSql = join(root, 'supabase', 'prod-release-20261024', 'migrations',
      '20261011103000_guard_pickup_and_remove_test_payment.sql');
    const secondStagedSql = join(output, 'supabase', 'migrations',
      '20261011103000_guard_pickup_and_remove_test_payment.sql');
    for (const path of [secondProdSql, secondStagedSql]) {
      const sql = readFileSync(path, 'utf8');
      assert.doesNotMatch(sql, /revoke\s+all\s+on\s+function\s+public\.mark_my_reservation_paid_test\s*\(/i);
      assert.match(sql, /drop\s+function\s+if\s+exists\s+public\.mark_my_reservation_paid_test\s*\(uuid\)/i);
    }
    const onePending = join(output, 'supabase', 'migrations', '20261024150000_returned_booking_actual_return_buffer_PROD.sql');
    assert.match(readFileSync(onePending, 'utf8'), /rentulo_prod_release_target/);
    assert.doesNotMatch(readFileSync(onePending, 'utf8'), /vspposovhdgvbeukoivh/);
    assert.throws(() => validateProdDbUrl('postgresql://postgres.vspposovhdgvbeukoivh:password@aws-0-eu-central-1.pooler.supabase.com:5432/postgres'), /STOP/);
    assert.throws(() => validateProdDbUrl('postgresql://postgres.tfvgxrdjrpicgtvovehl:password@aws-0-eu-central-1.pooler.supabase.com:6543/postgres'), /STOP/);
    assert.equal(validateProdDbUrl('postgresql://postgres.tfvgxrdjrpicgtvovehl:password@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require'), true);
    assert.equal(validateProdDbUrl('postgresql://postgres:password@db.tfvgxrdjrpicgtvovehl.supabase.co:5432/postgres?sslmode=require'), true);
    // Verify fail-closed behavior if an already staged migration changes.
    writeFileSync(oneBaseline, '-- changed\n');
    assert.throws(() => validateStage(output, manifest), /changed/);
  } finally {
    rmSync(stageParent, { recursive: true, force: true });
  }
});
