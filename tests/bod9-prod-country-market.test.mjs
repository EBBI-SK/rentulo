// BOD 9: isolated PROD country/pickup migration safety and TEST parity.
// Offline static contract checks only. Never connects to Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');
const version = '20261104120000';
const migration = `supabase/prod-release-20261104/migrations/${version}_bod9_country_ready_pickup_market_PROD.sql`;
const source = read('supabase/migrations/20261029120000_bod1_country_ready_pickup_market.sql');
const prod = read(migration);
const originalSignup = read('supabase/migrations/20260827143000_add_slovak_language_support.sql');
const oldBody = originalSignup.split('as $$')[1]?.split('$$;')[0];
const expectedMd5 = createHash('md5').update(oldBody).digest('hex');

function count(pattern, input = prod) {
  return [...input.matchAll(pattern)].length;
}

test('BOD9 country PROD SQL is a new isolated migration, not the TEST migration timestamp', () => {
  const names = readdirSync(join(root, 'supabase/prod-release-20261104/migrations'));
  assert.deepEqual(names, [`${version}_bod9_country_ready_pickup_market_PROD.sql`]);
  assert.ok(Number(version) > 20261102160000, 'PROD migration must follow already prepared PROD migrations');
  assert.match(prod, /NEW PROD VERSION 20261104120000/);
  assert.match(prod, /BEGIN;[\s\S]*DO \$prod_guard\$[\s\S]*\$prod_guard\$;[\s\S]*COMMIT;/);
  assert.equal(count(/\bBEGIN\s*;/gi), 1, 'exactly one top-level transaction begin');
  assert.equal(count(/\bCOMMIT\s*;/gi), 1, 'exactly one top-level transaction commit');
});

test('BOD9 PROD safety checks both vault identifiers and existing migration history', () => {
  assert.match(prod, /rentulo_prod_release_target/);
  assert.match(prod, /tfvgxrdjrpicgtvovehl/);
  assert.match(prod, /rentulo_project_url/);
  assert.match(prod, /https:\/\/tfvgxrdjrpicgtvovehl\.supabase\.co/);
  assert.doesNotMatch(prod, /vspposovhdgvbeukoivh|https:\/\/rentulo\.eu/);
  assert.match(prod, /supabase_migrations\.schema_migrations/);
  assert.match(prod, /version IN \('20261029120000', '20261104120000'\)/);
  assert.match(prod, /on_auth_user_created/);
  assert.match(prod, /profiles_postal_code_length_check/);
  assert.match(prod, /required PROD schema objects missing/);
  assert.match(prod, /new objects already exist; stop/);
  assert.match(prod, /changed profile\/offer data require review/);
});

test('BOD9 PROD registration replacement is blocked on any unknown live function body', () => {
  assert.ok(oldBody?.includes("when 'sk' then 'sk'"), 'baseline must support Slovak');
  assert.equal(expectedMd5, 'd334f99f2c9ab43f72d29ae0d2677ca5');
  assert.ok(prod.includes(`md5(v_signup_body) <> '${expectedMd5}'`));
  assert.match(prod, /v_signup_definer IS DISTINCT FROM true/);
  assert.match(prod, /PROD signup function has changed; review before replacing/);
  assert.match(prod, /public\.finalize_account_deactivation\(uuid\)/);
});

test('BOD9 PROD schema change exactly retains tested TEST country/pickup DDL', () => {
  const start = 'alter table public.profiles\n  add column if not exists country_code text;';
  assert.ok(source.includes(start));
  const sourceDDL = source.slice(source.indexOf(start)).replace(/\s*commit;\s*$/i, '').trim();
  const prodDDL = prod.slice(prod.indexOf(start)).split('-- Refresh PostgREST schema cache')[0].trim();
  assert.equal(prodDDL, sourceDDL, 'All SQL definitions must match the already-tested TEST migration');
  assert.match(prod, /NOTIFY pgrst, 'reload schema';/);
});

test('BOD9 only adds country and currency fields and active CZ pickup safeguards', () => {
  for (const item of [
    'country_code text', "pickup_country_code text not null default 'CZ'",
    "currency_code text not null default 'CZK'", 'offers_czech_market_only_check',
    'offers_active_pickup_plausible_location_check',
    'guard_offer_profile_pickup_country',
    'scrub_deactivated_residence_country',
    'profiles_country_code_format_check'
  ]) assert.ok(prod.includes(item), `Missing: ${item}`);
  assert.match(prod, /\) not valid;/i);
  assert.match(prod, /if new\.status = 'active' and new\.pickup_mode = 'profile'/);
  assert.match(prod, /p\.country_code = 'CZ'/);
  assert.match(prod, /if new\.account_status = 'deactivated' then\s+new\.country_code := null;/);
  assert.match(prod, /when 'sk' then 'sk'/);
  assert.match(prod, /new\.country_code := null;/i);
  assert.doesNotMatch(prod, /\b(update|delete|truncate)\s+public\.(payments|reservations|offers)/i);
  assert.doesNotMatch(prod, /\bcreate\s+extension|\bcreate\s+policy|\bselect\s+cron\.schedule/ig);
  assert.doesNotMatch(prod, /\bcreate\s+or\s+replace\s+function\s+public\.(finalize_account_deactivation|create_owner_transfer)/i);
});

test('BOD9 original TEST migration and deployment isolation remain untouched', () => {
  assert.match(source, /TEST-only/);
  assert.match(source, /vspposovhdgvbeukoivh/);
  assert.doesNotMatch(source, /tfvgxrdjrpicgtvovehl/);
  assert.equal(count(/^\s*create\s+or\s+replace\s+function\b/gim), 3);
  assert.equal(count(/\bcreate\s+trigger\b/gi), 2);
  assert.doesNotMatch(prod, /\b(?:http_post|net\.http_post|supabase\s+functions\s+deploy|curl\s+-X)\b/i);
});
