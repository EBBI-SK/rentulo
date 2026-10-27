"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sql = fs.readFileSync(path.join(__dirname, "..", "supabase/migrations/20261027140000_fix_extension_transfer_claim_ambiguity_TEST.sql"), "utf8");

test("TEST-only extension transfer claim fix disambiguates the payments reservation id", () => {
  assert.match(sql, /rentulo_project_url/);
  assert.match(sql, /https:\/\/vspposovhdgvbeukoivh\.supabase\.co/);
  assert.match(sql, /create or replace function public\.claim_reservation_extension_transfer\(p_extension_id uuid\)/i);
  assert.match(sql, /from public\.payments p where p\.reservation_id=v_e\.reservation_id;/);
  assert.doesNotMatch(sql, /from public\.payments where reservation_id=v_e\.reservation_id;/);
  assert.match(sql, /auth\.role\(\)<>\'service_role\'/);
  assert.match(sql, /v_p\.transfer_status<>\'succeeded\'/);
  assert.match(sql, /v_r\.owner_id<>v_e\.owner_id/);
  assert.match(sql, /grant execute on function public\.claim_reservation_extension_transfer\(uuid\)\s+to service_role/i);
  assert.doesNotMatch(sql, /(?:insert\s+into|update|delete\s+from)\s+public\.payments\b/i);
  assert.doesNotMatch(sql, /(?:insert\s+into|update|delete\s+from)\s+public\.reservations\b/i);
});
