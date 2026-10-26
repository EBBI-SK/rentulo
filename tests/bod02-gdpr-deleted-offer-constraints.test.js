"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const fix = read("supabase/migrations/20261018140000_bod02_gdpr_deleted_offer_address_TEST.sql");
const original = read("supabase/migrations/20261018130000_bod02_gdpr_deactivation_cleanup_TEST.sql");

function addedConstraint(name) {
  const pattern = new RegExp(
    "alter table public\\.offers\\s+add constraint " + name + "\\s+check\\s*\\(([\\s\\S]*?)\\);",
    "i"
  );
  const match = fix.match(pattern);
  assert.ok(match, `expected ADD CONSTRAINT ${name}`);
  return match[1];
}

test("deleted-offer repair is a separate transaction guarded to Supabase TEST", () => {
  assert.match(fix, /^\s*--[\s\S]*?\bbegin;\s*/i);
  assert.match(fix, /\bcommit;\s*$/i);
  const guardIndex = fix.indexOf("vault.decrypted_secrets");
  const ddlIndex = fix.indexOf("alter table public.offers");
  assert.ok(guardIndex >= 0 && guardIndex < ddlIndex, "project guard must precede DDL");
  assert.match(fix, /s\.name = 'rentulo_project_url'/);
  assert.match(fix, /https:\/\/vspposovhdgvbeukoivh\.supabase\.co/);
  assert.match(fix, /raise exception 'BOD02 GDPR deleted-offer constraints migration is TEST-only'/);
});

test("deleted offers may clear city; active offers retain original city limits", () => {
  const rule = addedConstraint("offers_city_length_check");
  assert.match(fix, /drop constraint offers_city_length_check;/i);
  assert.match(rule, /char_length\(trim\(city\)\)\s+between\s+1\s+and\s+100/i);
  assert.match(rule, /\bor\s*\(status\s*=\s*'deleted'::public\.offer_status\s+and\s+city\s*=\s*''\)/i);
  assert.equal((fix.match(/add constraint offers_city_length_check/gi) || []).length, 1);
});

test("deleted offers may clear postal_code; active offers retain original postal limits", () => {
  const rule = addedConstraint("offers_postal_code_length_check");
  assert.match(fix, /drop constraint offers_postal_code_length_check;/i);
  assert.match(rule, /char_length\(trim\(postal_code\)\)\s+between\s+1\s+and\s+20/i);
  assert.match(rule, /\bor\s*\(status\s*=\s*'deleted'::public\.offer_status\s+and\s+postal_code\s*=\s*''\)/i);
  assert.equal((fix.match(/add constraint offers_postal_code_length_check/gi) || []).length, 1);
});

test("repair does not modify finalizer, payment, reservation, or unrelated constraints", () => {
  const dropped = [...fix.matchAll(/\bdrop constraint\s+(\w+)/gi)].map(x => x[1]).sort();
  const added = [...fix.matchAll(/\badd constraint\s+(\w+)/gi)].map(x => x[1]).sort();
  const expected = ["offers_city_length_check", "offers_postal_code_length_check"].sort();
  assert.deepEqual(dropped, expected);
  assert.deepEqual(added, expected);
  assert.doesNotMatch(fix, /\b(?:update|delete\s+from|insert\s+into)\s+public\./i);
  assert.doesNotMatch(fix, /\b(?:create\s+or\s+replace\s+function|drop\s+function)\b/i);
  assert.doesNotMatch(fix, /\balter table public\.(?!offers\b)/i);
});

test("fix matches the deployed account-deactivation offer sanitization", () => {
  assert.match(original, /update public\.offers o\s+set status = 'deleted'::public\.offer_status/i);
  assert.match(original, /\bcity = '',\s+postal_code = '',/i);
  assert.match(original, /\bphoto_url = null/);
});
