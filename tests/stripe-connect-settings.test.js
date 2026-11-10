"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
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

test("Connect UI explains private-person onboarding and payout timing before redirecting to Stripe", () => {
  assert.match(html, /id="connectSettingsGuidance"/);
  assert.match(html, /id="connectSettingsGuidanceRelease"/);
  assert.match(html, /id="connectSettingsGuidanceFirstPayout"/);
  assert.match(js, /nejde o registraci \\u017eivnosti ani firmy/);
  assert.match(js, /https:\/\/rentulo\.com/);
  assert.doesNotMatch(js, /https:\/\/rentulo\.eu/);
  assert.match(js, /Rentulo nedr\\u017e\\u00ed va\\u0161e pen\\u00edze na vlastn\\u00edm bankovn\\u00edm \\u00fa\\u010dtu/);
  assert.doesNotMatch(js, /Rentulo okam\\u017eit\\u011b zad\\u00e1 Stripe pokyn k uvoln\\u011bn\\u00ed va\\u0161\\u00ed v\\u00fdplaty/);
  assert.match(js, /Prvn\\u00ed v\\u00fdplata m\\u016f\\u017ee z bezpe\\u010dnostn\\u00edch a ov\\u011b\\u0159ovac\\u00edch d\\u016fvod\\u016f Stripe trvat n\\u011bkolik dn\\u00ed/);
  assert.match(js, /Rentulo je neukl\\u00e1d\\u00e1/);
  assert.match(js, /guidance\.hidden = currentStatus === "ready" \|\| currentStatus === "loading"/);
});


test("Connect payout wording in all five languages requires confirmed return, not the PIN", () => {
  const match = js.match(/const COPY = (\{[\s\S]*?\n  \});/);
  assert.ok(match, "Stripe Connect translation object must exist");
  const copy = vm.runInNewContext("(" + match[1] + ")");
  const required = {
    cs: ["PINem", "nespou\u0161t\u00ed", "potvrzen\u00ed vr\u00e1cen\u00ed", "nevyzvednut\u00fdch"],
    sk: ["PIN-om", "nesp\u00fa\u0161\u0165a", "potvrden\u00ed vr\u00e1tenia", "neprevzat\u00fdch"],
    en: ["PIN", "does not trigger", "return confirmed", "without pickup"],
    de: ["PIN", "keine Auszahlung", "Best\u00e4tigung in Rentulo", "ohne Abholung"],
    pl: ["PIN", "nie uruchamia", "potwierdzeniu zwrotu", "bez odbioru"]
  };
  for (const [lang, phrases] of Object.entries(required)) {
    const guidance = copy[lang]?.guidanceRelease;
    assert.equal(typeof guidance, "string", "Missing guidance in " + lang);
    for (const phrase of phrases) {
      assert.ok(guidance.includes(phrase), lang + " must mention: " + phrase);
    }
    assert.ok(guidance.includes("Stripe"), lang + " must identify Stripe");
    assert.doesNotMatch(guidance, /okam\u017eit\u011b|okam\u017eite|immediately|sofort|natychmiast/i);
  }
});
