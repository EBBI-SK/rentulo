"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migrationDirectory = path.join(root, "supabase", "migrations");
const migrations = fs.readdirSync(migrationDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({
    name,
    sql: fs.readFileSync(path.join(migrationDirectory, name), "utf8")
      .replace(/--[^\r\n]*/g, "")
  }));

function latestDefinition(pattern) {
  const migration = migrations.findLast(({ sql }) => pattern.test(sql));
  assert.ok(migration, "Expected an active migration definition");
  return migration.sql;
}

function effectiveTablePrivileges(table, role) {
  const privileges = new Set();
  const statements = new RegExp(
    "\\b(grant|revoke)\\s+(all(?:\\s+privileges)?|[a-z,\\s]+)" +
    "\\s+on\\s+(?:table\\s+)?\"?public\"?\\.\"?" + table + "\"?" +
    "\\s+(?:to|from)\\s+([^;]+);", "gi"
  );
  for (const { sql } of migrations) {
    for (const match of sql.matchAll(statements)) {
      const roles = match[3].toLowerCase().replace(/"/g, "").split(",").map((item) => item.trim());
      if (!roles.includes(role)) continue;
      const items = /^all\b/i.test(match[2])
        ? ["select", "insert", "update", "delete", "truncate", "references", "trigger"]
        : match[2].toLowerCase().split(",").map((item) => item.trim());
      for (const item of items) {
        if (match[1].toLowerCase() === "grant") privileges.add(item);
        else privileges.delete(item);
      }
    }
  }
  return privileges;
}

test("the effective offer SELECT policy only exposes an active owner's own rows", () => {
  const policies = new Map();
  const policyStatement = /\b(create|drop)\s+policy\s+(?:if\s+exists\s+)?"?(\w+)"?\s+on\s+"?public"?\."?offers"?\s*([^;]*);/gi;
  for (const { sql } of migrations) {
    for (const match of sql.matchAll(policyStatement)) {
      if (match[1].toLowerCase() === "drop") policies.delete(match[2]);
      else policies.set(match[2], match[3]);
    }
  }
  const readers = [...policies.entries()].filter(([, body]) =>
    !/\bfor\s+/i.test(body) || /\bfor\s+(select|all)\b/i.test(body)
  );
  assert.deepEqual(readers.map(([name]) => name), ["offers_select_own"]);
  assert.match(readers[0][1], /to\s+authenticated/i);
  assert.match(readers[0][1], /owner_id\s*=\s*auth\.uid\(\)/i);
  assert.match(readers[0][1], /public\.is_current_account_active\(\)/i);
  assert.ok(effectiveTablePrivileges("offers", "authenticated").has("select"));
  for (const role of ["public", "anon"]) {
    assert.equal(effectiveTablePrivileges("offers", role).has("select"), false);
  }
});

test("no browser role retains table-wide reservation SELECT after the complete migration chain", () => {
  for (const role of ["public", "anon", "authenticated"]) {
    assert.equal(effectiveTablePrivileges("reservations", role).has("select"), false, role);
  }
  const authenticated = effectiveTablePrivileges("reservations", "authenticated");
  assert.ok(authenticated.has("insert"), "booking creation must remain allowed");
  assert.ok(authenticated.has("update"), "existing guarded updates must remain allowed");
});

test("reservation insert may return only id while full reads still use the safe RPC", () => {
  const sql = latestDefinition(/revoke\s+select\s+on\s+table\s+public\.reservations\s/i);
  assert.match(sql, /revoke\s+select\s+on\s+table\s+public\.reservations\s+from\s+public,\s*anon,\s*authenticated;/i);
  assert.match(sql, /grant\s+select\s*\(\s*id\s*\)\s+on\s+table\s+public\.reservations\s+to\s+authenticated;/i);
  const laterSql = migrations.slice(migrations.findIndex((item) => item.sql === sql)).map((item) => item.sql).join("\n");
  const columnGrants = [...laterSql.matchAll(/grant\s+select\s*\(([^)]+)\)\s+on\s+(?:table\s+)?public\.reservations\s+to\s+([^;]+);/gi)];
  assert.ok(columnGrants.length > 0);
  for (const grant of columnGrants) {
    assert.equal(grant[1].trim(), "id");
    assert.equal(grant[2].trim(), "authenticated");
  }
  const detail = fs.readFileSync(path.join(root, "js", "detail-page.js"), "utf8");
  assert.match(detail, /\.from\("reservations"\)\s*\.insert\(reservationToInsert\)\s*\.select\("id"\)/);
  const reader = latestDefinition(/create\s+(?:or\s+replace\s+)?function\s+public\.get_my_reservations\s*\(/i);
  assert.match(reader, /language\s+sql\s+stable\s+security\s+definer/i);
  assert.match(reader, /grant\s+execute\s+on\s+function\s+public\.get_my_reservations\(\)\s+to\s+authenticated/i);
});

test("public offer reads remain available without exposing precise pickup contacts", () => {
  const sql = latestDefinition(/create\s+(?:or\s+replace\s+)?view\s+public\.public_offers\s/i);
  const view = sql.match(/create\s+(?:or\s+replace\s+)?view\s+public\.public_offers\s[\s\S]*?;/i)?.[0];
  assert.ok(view);
  assert.match(view, /security_invoker\s*=\s*false,\s*security_barrier\s*=\s*true/i);
  assert.doesNotMatch(view, /pickup_phone|pickup_street|pickup_full_address|pickup_note|pickup_latitude|pickup_longitude/i);
  assert.match(sql, /grant\s+select\s+on\s+table\s+public\.public_offers\s+to\s+anon,\s*authenticated;/i);
});
