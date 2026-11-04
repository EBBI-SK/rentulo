// BOD 9 / owner finance history PROD release.
// Offline safety/parity checks only; does not connect to a database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const source = read('supabase/migrations/20261102090000_bod7_history_owner_finance_TEST.sql');
const releaseDirectory = 'supabase/prod-release-20261104-history/migrations';
const releaseName = '20261104150000_bod9_history_owner_finance_PROD.sql';
const prod = read(`${releaseDirectory}/${releaseName}`);
const routineName = 'public.get_my_history_owner_transfers()';
const sourceStart = `CREATE OR REPLACE FUNCTION ${routineName}`;
const prodStart = `CREATE FUNCTION ${routineName}`;

function count(pattern, content = prod) {
  return [...content.matchAll(pattern)].length;
}

test('BOD9 PROD history is a new migration after the already deployed country migration', () => {
  const names = readdirSync(join(root, releaseDirectory)).filter(name => name.endsWith('.sql')).sort();
  assert.deepEqual(names, [releaseName]);
  assert.match(prod, /New PROD version 20261104150000/);
  assert.equal(count(/^BEGIN;$/gm), 1);
  assert.equal(count(/^COMMIT;$/gm), 1);
  assert.ok(prod.indexOf('BEGIN;') < prod.indexOf('DO $prod_guard$'));
  assert.ok(prod.indexOf('$prod_guard$;') < prod.indexOf(prodStart));
});

test('BOD9 history migration fails closed outside explicit and configured Supabase PROD', () => {
  assert.match(prod, /s\.name = 'rentulo_prod_release_target'/);
  assert.match(prod, /s\.name = 'rentulo_project_url'/);
  assert.match(prod, /'tfvgxrdjrpicgtvovehl'/);
  assert.match(prod, /'https:\/\/tfvgxrdjrpicgtvovehl\.supabase\.co'/);
  assert.match(prod, /RAISE EXCEPTION 'BOD9 history: explicit configured Rentulo PROD project required'/);
  assert.doesNotMatch(prod, /vspposovhdgvbeukoivh|rentulo\.eu/);
});

test('BOD9 verifies recorded prerequisites and forbids the TEST or duplicate PROD version', () => {
  assert.match(prod, /supabase_migrations\.schema_migrations/);
  assert.match(prod, /version IN \('20261102090000', '20261104150000'\)/);
  for (const version of [
    '20261104120000', '20261102160000', '20261031180000', '20261031190000'
  ]) {
    assert.ok(prod.includes(`version = '${version}'`), `Missing history prerequisite ${version}`);
  }
  assert.match(prod, /migration history mismatch or prerequisite missing/);
  assert.match(prod, /n\.nspname = 'public' AND p\.proname = 'get_my_history_owner_transfers'/);
  assert.match(prod, /owner financial function already exists/);
});

test('BOD9 requires the financial tables, auth helper and all referenced columns', () => {
  for (const obj of [
    'public.reservations', 'public.payments', 'public.reservation_extensions',
    'public.stripe_card_disputes', 'auth.uid()'
  ]) {
    assert.ok(prod.includes(`'${obj}'`), `Missing object preflight: ${obj}`);
  }
  for (const [table, column] of [
    ['reservations', 'id'], ['reservations', 'owner_id'],
    ['reservations', 'status'], ['reservations', 'created_at'],
    ['payments', 'reservation_id'], ['payments', 'amount_total'],
    ['payments', 'platform_fee_amount'], ['payments', 'owner_payout'],
    ['payments', 'provider'], ['payments', 'status'],
    ['payments', 'stripe_payment_intent_status'], ['payments', 'refund_status'],
    ['payments', 'transfer_status'], ['stripe_card_disputes', 'reservation_id'],
    ['stripe_card_disputes', 'payout_blocked']
  ]) {
    assert.ok(prod.includes(`('${table}', '${column}')`), `Missing column preflight: ${table}.${column}`);
  }
  assert.match(prod, /existing financial schema differs from TEST/);
});

test('BOD9 owner financial SQL and role grants exactly match the tested TEST version', () => {
  assert.ok(source.includes(sourceStart), 'Missing source reader');
  assert.ok(prod.includes(prodStart), 'Missing PROD reader');
  const sourceRoutine = source.slice(source.indexOf(sourceStart), source.indexOf("NOTIFY pgrst, 'reload schema';"))
    .trim().replace(sourceStart, prodStart);
  const prodRoutine = prod.slice(prod.indexOf(prodStart), prod.indexOf('-- No historical backfill'))
    .trim();
  assert.equal(prodRoutine, sourceRoutine, 'PROD must only replace CREATE OR REPLACE with safe CREATE');
});

test('BOD9 read is owner-scoped and anonymized to required financial fields', () => {
  assert.match(prod, /LANGUAGE sql\s+STABLE\s+SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(prod, /auth\.uid\(\) IS NOT NULL/);
  assert.match(prod, /r\.owner_id = auth\.uid\(\)/);
  assert.match(prod, /r\.status::text IN \('returned', 'no_show'\)/);
  assert.match(prod, /LEFT JOIN public\.payments p ON p\.reservation_id = r\.id/);
  assert.match(prod, /FROM public\.stripe_card_disputes d/);
  assert.match(prod, /AND d\.payout_blocked IS TRUE/);
  assert.match(prod, /REVOKE ALL ON FUNCTION public\.get_my_history_owner_transfers\(\)\s+FROM PUBLIC, anon, authenticated;/);
  assert.match(prod, /GRANT EXECUTE ON FUNCTION public\.get_my_history_owner_transfers\(\)\s+TO authenticated;/);
  assert.doesNotMatch(prod, /\b(?:email|phone|street|stripe_charge_id|stripe_payment_intent_id)\s*,\s*$/m);
});

test('BOD9 does not alter data or activate payments, transfers, SMS or jobs', () => {
  assert.equal(count(/^CREATE FUNCTION /gm), 1);
  assert.equal(count(/^CREATE OR REPLACE FUNCTION /gm), 0);
  assert.doesNotMatch(prod, /\b(?:INSERT INTO|UPDATE\s+public\.|DELETE FROM|TRUNCATE\s+|DROP TABLE\s+|ALTER TABLE\s+)\b/i);
  assert.doesNotMatch(prod, /\b(?:cron\.schedule|net\.http_post|http_post|SELECT\s+stripe)\b/i);
  assert.doesNotMatch(prod, /GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*?TO\s+(?:PUBLIC|anon)\s*;/i);
  assert.match(prod, /NOTIFY pgrst, 'reload schema';\s+COMMIT;\s*$/);
});

test('BOD9 original TEST migration and the previously approved country SQL remain untouched', () => {
  assert.match(source, /TEST ONLY/);
  assert.match(source, /vspposovhdgvbeukoivh/);
  assert.doesNotMatch(source, /tfvgxrdjrpicgtvovehl/);
  const previous = read('supabase/prod-release-20261104/migrations/20261104120000_bod9_country_ready_pickup_market_PROD.sql');
  assert.match(previous, /NEW PROD VERSION 20261104120000/);
  assert.doesNotMatch(previous, /get_my_history_owner_transfers/);
  assert.doesNotMatch(prod, /\bcreate\s+(?:trigger|table|policy)\b/i);
});
