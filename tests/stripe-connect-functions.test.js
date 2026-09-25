"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
function read(name) { return fs.readFileSync(path.join(__dirname, "..", "supabase", "functions", name, "index.ts"), "utf8"); }

test("connected account is Czech, Express, transfer-capable and idempotent", () => {
  const source = read("create-connect-account");
  assert.match(source, /params\.set\("type", "express"\)/);
  assert.match(source, /params\.set\("country", "CZ"\)/);
  assert.match(source, /capabilities\[transfers\]\[requested\]/);
  assert.match(source, /Idempotency-Key.*rentulo-connect-account-/s);
  assert.doesNotMatch(source, /country[^\n]*payload/i);
});

test("onboarding link uses trusted connected account and Rentulo return URLs", () => {
  const source = read("create-connect-onboarding-link");
  assert.match(source, /stripe_connected_account_id/);
  assert.match(source, /nastaveni\.html\?connect=refresh/);
  assert.match(source, /nastaveni\.html\?connect=return/);
  assert.match(source, /params\.set\("type", "account_onboarding"\)/);
});

test("status is synchronized from Stripe and requires transfers plus payouts", () => {
  const source = read("get-connect-status");
  assert.match(source, /capabilities\?\.transfers === "active"/);
  assert.match(source, /account\.payouts_enabled === true/);
  assert.match(source, /stripe_connect_transfers_enabled: transfersEnabled/);
  assert.match(source, /stripe_connect_status: status/);
});
