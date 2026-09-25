"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
function read(name) { return fs.readFileSync(path.join(__dirname, "..", "supabase", "functions", name, "index.ts"), "utf8"); }

test("connected account uses Stripe Accounts v2 for a Czech Express transfer recipient", () => {
  const source = read("create-connect-account");
  assert.match(source, /https:\/\/api\.stripe\.com\/v2\/core\/accounts/);
  assert.match(source, /"Stripe-Version": STRIPE_V2_VERSION/);
  assert.match(source, /dashboard:\s*"express"/);
  assert.match(source, /country:\s*"CZ"/);
  assert.match(source, /recipient:[\s\S]*stripe_transfers:[\s\S]*requested:\s*true/);
  assert.match(source, /fees_collector:\s*"application"/);
  assert.match(source, /losses_collector:\s*"application"/);
  assert.match(source, /Idempotency-Key.*rentulo-connect-v2-account-/s);
  assert.doesNotMatch(source, /https:\/\/api\.stripe\.com\/v1\/accounts["`]/);
});

test("onboarding link uses trusted v2 account id with Stripe account-link compatibility endpoint", () => {
  const source = read("create-connect-onboarding-link");
  assert.match(source, /stripe_connected_account_id/);
  assert.match(source, /https:\/\/api\.stripe\.com\/v1\/account_links/);
  assert.match(source, /nastaveni\.html\?connect=refresh/);
  assert.match(source, /nastaveni\.html\?connect=return/);
  assert.match(source, /params\.set\("type", "account_onboarding"\)/);
});

test("status uses Stripe v1 compatibility representation for a v2 account", () => {
  const source = read("get-connect-status");
  assert.match(source, /https:\/\/api\.stripe\.com\/v1\/accounts\//);
  assert.match(source, /capabilities\?\.transfers === "active"/);
  assert.match(source, /account\.payouts_enabled === true/);
  assert.match(source, /stripe_connect_transfers_enabled: transfersEnabled/);
  assert.match(source, /stripe_connect_status: status/);
});
