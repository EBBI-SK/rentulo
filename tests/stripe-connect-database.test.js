"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "20260925210000_add_stripe_connect_owner_onboarding.sql"), "utf8");

test("Stripe Connect profile fields are added and account id is unique", () => {
  assert.match(source, /stripe_connected_account_id text/);
  assert.match(source, /stripe_connect_status text not null default 'not_started'/);
  assert.match(source, /stripe_connect_details_submitted boolean not null default false/);
  assert.match(source, /stripe_connect_transfers_enabled boolean not null default false/);
  assert.match(source, /unique index[\s\S]*stripe_connected_account_id/i);
});

test("browser cannot change trusted Stripe Connect profile fields", () => {
  assert.match(source, /auth\.role\(\) <> 'service_role'/);
  assert.match(source, /new\.stripe_connected_account_id is distinct from old\.stripe_connected_account_id/);
  assert.match(source, /new\.stripe_connect_status is distinct from old\.stripe_connect_status/);
});
