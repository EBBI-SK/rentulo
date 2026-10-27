"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const sql = read("supabase/migrations/20261027160000_bod2_verified_email_signup_gate.sql");
const registration = read("js/registration-page.js");
const settings = read("js/settings-page.js");
const acceptance = read("supabase/migrations/20261020170000_bod02_v1_compliance_registry_TEST.sql");

function definition(name, nextMarker) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  const end = sql.indexOf(nextMarker, start);
  assert.ok(start !== -1 && end > start, `${name} must be defined`);
  return sql.slice(start, end);
}

test("BOD 2: a new transactional migration never backfills or blocks historical accounts", () => {
  assert.match(sql, /^begin;\s*$/m);
  assert.match(sql, /to_regclass\('public\.gdpr_terms_acceptances'\)/);
  assert.match(sql, /trg_gdpr_capture_signup_terms/);
  assert.match(sql, /t\.tgenabled in \('O', 'A'\)/);
  assert.match(sql, /commit;\s*$/);
  assert.match(sql, /after insert on auth\.users/i);
  assert.match(sql, /values \(new\.id\)/i);
  assert.doesNotMatch(sql, /insert into public\.v1_signup_acceptance_required[\s\S]*?select[\s\S]*?from auth\.users/i);
  assert.doesNotMatch(sql, /\b(?:update|delete from|truncate)\s+public\.(?:profiles|offers|reservations|gdpr_terms_acceptances)\b/i);
});

test("BOD 2: profile email changes require a confirmed matching Auth email", () => {
  const fn = definition("protect_verified_profile_email", "drop trigger if exists protect_verified_profile_email_before_update");
  assert.match(fn, /new\.email is distinct from old\.email/i);
  assert.match(fn, /new\.account_status = 'active'/i);
  assert.match(fn, /from auth\.users u/i);
  assert.match(fn, /u\.id = new\.id/i);
  assert.match(fn, /u\.email_confirmed_at is not null/i);
  assert.match(fn, /lower\(btrim\(u\.email\)\) = lower\(btrim\(new\.email\)\)/i);
  assert.match(fn, /errcode = '42501'/i);
  assert.match(sql, /before update of email on public\.profiles/i);
  assert.match(sql, /revoke all on function public\.protect_verified_profile_email\(\)/i);
  assert.doesNotMatch(sql, /create or replace function public\.(?:sync_profile_email_from_auth|protect_profile_update)\(/i);
});

test("BOD 2: a private server-owned signup marker is created on auth.users INSERT", () => {
  assert.match(sql, /create table if not exists public\.v1_signup_acceptance_required\s*\(/i);
  assert.match(sql, /primary key references auth\.users\(id\) on delete cascade/i);
  assert.match(sql, /alter table public\.v1_signup_acceptance_required enable row level security/i);
  assert.match(sql, /revoke all on table public\.v1_signup_acceptance_required\s+from public, anon, authenticated, service_role/i);
  assert.match(sql, /create trigger trg_mark_new_v1_signup_acceptance_required\s+after insert on auth\.users/i);
  assert.match(sql, /security definer/i);
  assert.doesNotMatch(sql, /create policy .*v1_signup_acceptance_required/i);
});

test("BOD 2: only existing server-captured signup audit can unlock a new account", () => {
  const fn = definition("has_v1_signup_acceptance", "revoke all on function public.has_v1_signup_acceptance");
  assert.match(fn, /auth\.uid\(\) is not null/i);
  assert.match(fn, /not exists\s*\(\s*select 1 from public\.v1_signup_acceptance_required/i);
  assert.match(fn, /or exists\s*\(\s*select 1 from public\.gdpr_terms_acceptances/i);
  assert.match(fn, /a\.source = 'auth_signup'/i);
  assert.doesNotMatch(fn, /raw_user_meta_data|user_metadata/i);
  for (const declaration of ["terms_business_accepted", "terms_privacy_accepted", "private_individual_confirmed"]) {
    assert.ok(acceptance.includes(`'${declaration}'`), declaration);
    assert.ok(registration.includes(`${declaration}: true`), declaration);
  }
  assert.match(acceptance, /BEFORE UPDATE OR DELETE ON public\.gdpr_terms_acceptances/);
  assert.match(acceptance, /AFTER INSERT ON auth\.users/);
});

test("BOD 2: offer insert/update and reservation insert retain original safety checks", () => {
  const required = [
    ["offers_insert_own", ["owner_id = auth.uid()", "public.is_current_account_active()", "public.has_v1_signup_acceptance()"]],
    ["offers_update_own", ["owner_id = auth.uid()", "public.is_current_account_active()", "public.has_v1_signup_acceptance()"]],
    ["reservations_insert_as_renter", ["renter_id = auth.uid()", "public.is_current_account_active()", "public.has_v1_signup_acceptance()", "public.can_create_reservation(offer_id, owner_id, renter_id)"]]
  ];
  for (const [policy, conditions] of required) {
    const match = sql.match(new RegExp(`alter policy ${policy} on public\\.\\w+[\\s\\S]*?;`, "i"));
    assert.ok(match, `${policy} must be amended rather than removed`);
    for (const condition of conditions) assert.ok(match[0].includes(condition), `${policy}: ${condition}`);
  }
  assert.doesNotMatch(sql, /drop policy if exists/i);
  assert.doesNotMatch(sql, /alter policy (?:offers_select_own|reservations_select_related|profiles_update_own)/i);
});

test("BOD 2: existing registration and two-step Auth email-change flow remain in place", () => {
  assert.match(registration, /auth\.signUp\(/);
  assert.match(settings, /client\.auth\.updateUser\(\{\s*email:/);
  assert.match(settings, /if \(!emailConfirmationRequired\)\s*\{\s*profileUpdate\.email = email;/);
  assert.match(settings, /from\("profiles"\)/);
});
