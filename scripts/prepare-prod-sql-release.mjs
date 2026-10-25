// Rentulo V1, BOD 2: ONLY offline preparation of an isolated PROD SQL migration folder.
// NO connections, NO PROD writes, NO automatic supabase db push, NO secrets.
// Usage from the Rentulo project root:
//   node scripts/prepare-prod-sql-release.mjs
// Live SQL deployment requires a separate, explicit approval and operator action.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(thisFile), '..');
const manifestFile = join(repoRoot, 'supabase', 'prod-release-20261024', 'deploy-manifest.json');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function versionFromFile(filename) {
  const found = /^([0-9]{14})_[a-zA-Z0-9_-]+\.sql$/.exec(filename);
  if (!found) throw new Error(`Invalid SQL migration filename: ${filename}`);
  return found[1];
}
function versionFingerprint(versions) {
  return createHash('md5').update([...versions].sort().join(',')).digest('hex');
}
function sameList(actual, expected, context) {
  const a = [...actual].sort();
  const b = [...expected].sort();
  if (a.length !== b.length || a.some((value, i) => value !== b[i])) {
    const missing = b.filter((x) => !a.includes(x));
    const unexpected = a.filter((x) => !b.includes(x));
    throw new Error(`${context}: unexpected count or list (missing: ${missing.join(',') || '-'}; extra: ${unexpected.join(',') || '-'})`);
  }
}

export function validateSources(root = repoRoot) {
  const file = join(root, 'supabase', 'prod-release-20261024', 'deploy-manifest.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  if (manifest.release_id !== 'rentulo-v1-prod-sql-20261025' ||
      manifest.prod_ref !== 'tfvgxrdjrpicgtvovehl' ||
      manifest.test_ref !== 'vspposovhdgvbeukoivh' ||
      manifest.github_main_at_preparation !== 'e4be9fbfd0e18fb15473984bf0a883d72c35bfa2') {
    throw new Error('Unexpected manifest identity or frozen GitHub commit; STOP');
  }
  if (manifest.baseline_migrations.length !== 75 || manifest.new_migrations.length !== 38) {
    throw new Error('Expected exactly 75 baseline + 38 PROD migrations; STOP');
  }
  if (new Set(manifest.baseline_migrations.map(versionFromFile)).size !== 75 ||
      new Set(manifest.new_migrations.map(({ file }) => versionFromFile(file))).size !== 38) {
    throw new Error('Repeated or invalid migration versions; STOP');
  }
  const baselineVersions = manifest.baseline_migrations.map(versionFromFile);
  const newVersions = manifest.new_migrations.map(({ file }) => versionFromFile(file));
  if (baselineVersions.some((v) => newVersions.includes(v)) ||
      newVersions.some((v) => v <= '20261008120000')) {
    throw new Error('Overlapping or out-of-order migration versions; STOP');
  }
  if (versionFingerprint(baselineVersions) !== manifest.baseline_md5_versions ||
      manifest.baseline_md5_versions !== 'a30b4b2c515cf6a02d8831be001c297f' ||
      versionFingerprint([...baselineVersions, ...newVersions]) !== manifest.expected_after_md5_versions) {
    throw new Error('Baseline or final migration fingerprint mismatch; STOP');
  }

  const sourceDir = join(root, manifest.source_path);
  const sourceFiles = readdirSync(sourceDir).filter((s) => s.endsWith('.sql'));
  sameList(sourceFiles, manifest.new_migrations.map((m) => m.file), 'PROD SQL files');
  for (const row of manifest.new_migrations) {
    if (!/^[a-f0-9]{64}$/.test(row.sha256)) throw new Error('Invalid SQL checksum in manifest');
    const sqlBytes = readFileSync(join(sourceDir, row.file));
    if (sha256(sqlBytes) !== row.sha256) throw new Error(`PROD SQL changed: ${row.file}; STOP`);
    const sql = sqlBytes.toString('utf8');
    if (!sql.includes('rentulo_prod_release_target') ||
        !sql.includes(manifest.prod_ref) || sql.includes(manifest.test_ref)) {
      throw new Error(`Unsafe or absent PROD target guard: ${row.file}; STOP`);
    }
    if (/\b(?:select|perform)\s+cron\.schedule\s*\(/i.test(sql)) {
      throw new Error(`Unexpected cron.schedule in PROD release: ${row.file}; STOP`);
    }
  }
  const originalFiles = readdirSync(join(root, 'supabase', 'migrations'))
    .filter((f) => f.endsWith('.sql') && versionFromFile(f) <= '20261008100000');
  const expectedOriginalFiles = manifest.baseline_migrations.filter((f) =>
    f !== '20260721100000_prod_fresh_project_guard.sql' &&
    f !== '20261008120000_prod_final_guard.sql');
  sameList(originalFiles, expectedOriginalFiles, 'Original 73 baseline migrations');
  return manifest;
}

function baselineFailClosed(version) {
  return [
    `-- Rentulo PROD isolated release: already-applied baseline ${version}.`,
    '-- This is a protective marker, NOT the original historical SQL.',
    '-- If the remote does not have this migration version, deployment MUST STOP.',
    'DO $rentulo_baseline_guard$',
    'BEGIN',
    `  RAISE EXCEPTION 'STOP: expected baseline migration ${version} not found on PROD';`,
    'END;',
    '$rentulo_baseline_guard$;',
    '',
  ].join('\n');
}

export function validateStage(stageDir, manifest, root = repoRoot) {
  const directory = join(stageDir, 'supabase', 'migrations');
  const expected = [...manifest.baseline_migrations, ...manifest.new_migrations.map((m) => m.file)];
  const actual = readdirSync(directory).filter((f) => f.endsWith('.sql'));
  sameList(actual, expected, 'Generated isolated migrations');
  if (actual.length !== 113) throw new Error('Expected 113 isolated migration files');
  for (const file of manifest.baseline_migrations) {
    if (readFileSync(join(directory, file), 'utf8') !== baselineFailClosed(versionFromFile(file))) {
      throw new Error(`Baseline safety marker changed: ${file}; STOP`);
    }
  }
  for (const { file, sha256: pinnedHash } of manifest.new_migrations) {
    if (sha256(readFileSync(join(directory, file))) !== pinnedHash) {
      throw new Error(`Staged SQL modified: ${file}; STOP`);
    }
  }
  const config = readFileSync(join(stageDir, 'supabase', 'config.toml'), 'utf8');
  if (config !== 'project_id = "rentulo-v1-prod-sql-isolated"\n') {
    throw new Error('Isolated Supabase configuration has been modified; STOP');
  }
  if (existsSync(join(stageDir, 'supabase', '.temp', 'project-ref'))) {
    throw new Error('Staging directory is linked to a Supabase project; STOP');
  }
  if (existsSync(join(stageDir, 'supabase', 'seed.sql')) ||
      existsSync(join(stageDir, 'supabase', 'roles.sql'))) {
    throw new Error('Unexpected seed or role file in isolated workspace; STOP');
  }
  return { baseline: 75, pending: 38, total: 113 };
}

export function prepareStage(root = repoRoot, target = null) {
  const manifest = validateSources(root);
  const manifestDigest = sha256(readFileSync(join(root, 'supabase', 'prod-release-20261024', 'deploy-manifest.json'))).slice(0, 12);
  const stageDir = target ? resolve(target) : join(tmpdir(), `rentulo-prod-sql-release-${manifestDigest}`);
  const migrations = join(stageDir, 'supabase', 'migrations');
  const configPath = join(stageDir, 'supabase', 'config.toml');
  // Do NOT modify existing staging: instead validate it and fail if it drifted.
  if (existsSync(stageDir)) {
    validateStage(stageDir, manifest, root);
    return { stageDir, reused: true, manifest };
  }
  mkdirSync(migrations, { recursive: true, mode: 0o700 });
  writeFileSync(configPath, 'project_id = "rentulo-v1-prod-sql-isolated"\n', { mode: 0o600 });
  for (const filename of manifest.baseline_migrations) {
    writeFileSync(join(migrations, filename), baselineFailClosed(versionFromFile(filename)), { mode: 0o600 });
  }
  for (const { file } of manifest.new_migrations) {
    const sql = readFileSync(join(root, manifest.source_path, file));
    writeFileSync(join(migrations, file), sql, { mode: 0o600 });
  }
  validateStage(stageDir, manifest, root);
  return { stageDir, reused: false, manifest };
}

export function validateProdDbUrl(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('Missing PROD database URL; STOP');
  let uri;
  try { uri = new URL(raw); } catch { throw new Error('Invalid database URL; STOP'); }
  if (!['postgres:', 'postgresql:'].includes(uri.protocol) ||
      !uri.password || uri.pathname !== '/postgres' || uri.hash ||
      (uri.port && uri.port !== '5432') || uri.searchParams.get('sslmode') === 'disable') {
    throw new Error('Unexpected PostgreSQL connection settings; STOP');
  }
  const ref = 'tfvgxrdjrpicgtvovehl';
  const direct = uri.hostname === `db.${ref}.supabase.co` && decodeURIComponent(uri.username) === 'postgres';
  const pool = /^(?:[a-z0-9-]+\.)+pooler\.supabase\.com$/.test(uri.hostname) &&
    decodeURIComponent(uri.username) === `postgres.${ref}`;
  if (!direct && !pool) throw new Error('Database URL is not unambiguously Rentulo PROD; STOP');
  return true;
}

function main() {
  if (process.argv.length > 2) {
    throw new Error('This script only prepares an offline staging directory. No arguments are supported.');
  }
  const { stageDir, reused, manifest } = prepareStage();
  process.stdout.write(`OK: ${reused ? 'Existing' : 'New'} isolated PROD migration staging verified.\n`);
  process.stdout.write(`Folder: ${stageDir}\n`);
  process.stdout.write('Baseline (not to execute): 75 | PROD SQL pending: 38 | Total: 113\n');
  process.stdout.write(`Before: ${manifest.baseline_md5_versions} | Expected after: ${manifest.expected_after_md5_versions}\n`);
  process.stdout.write('NO DATABASE CONNECTION. NO SQL APPLIED. NO CRONS ACTIVATED.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(thisFile)) {
  try { main(); } catch (err) { process.stderr.write(`STOP: ${err.message}\n`); process.exitCode = 1; }
}
