"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const js = fs.readFileSync(path.join(__dirname, "..", "js", "connect-settings.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "nastaveni.html"), "utf8");

test("settings page loads isolated Stripe Connect UI", () => {
  assert.match(html, /id="connectSettingsSection"/);
  assert.match(html, /src="js\/connect-settings\.js"/);
});

test("frontend uses only backend functions for Connect lifecycle", () => {
  assert.match(js, /functions\.invoke\("get-connect-status"/);
  assert.match(js, /functions\.invoke\("create-connect-account"/);
  assert.match(js, /functions\.invoke\("create-connect-onboarding-link"/);
  assert.doesNotMatch(js, /api\.stripe\.com/);
  assert.doesNotMatch(js, /stripe_connected_account_id\s*:/);
});

test("Connect UI contains all five supported languages", () => {
  for (const lang of ["cs", "sk", "en", "de", "pl"]) assert.match(js, new RegExp("\\b" + lang + ": \\{"));
});

test("Connect UI explains private-person onboarding before redirecting to Stripe", () => {
  assert.match(html, /id="connectSettingsGuidance"/);
  assert.match(js, /nejde o registraci \\u017eivnosti ani firmy/);
  assert.match(js, /https:\/\/rentulo\.eu/);
  assert.match(js, /Rentulo je neukl\\u00e1d\\u00e1/);
  assert.match(js, /guidance\.hidden = currentStatus === "ready" \|\| currentStatus === "loading"/);
});
