"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (filename) => fs.readFileSync(path.join(root, filename), "utf8");
const email = read("supabase/functions/send-reservation-email/index.ts");
const renterPage = read("js/reservations-page.js");
const languages = ["cs", "sk", "en", "de", "pl"];

// Evaluate the two actual TS object literals (their values are ordinary JS)
// without loading the Deno-only transport, secrets or external services.
function emailLiteral(name) {
  const declaration = email.indexOf(`const ${name}:`);
  assert.ok(declaration >= 0, `Missing ${name}`);
  const assignment = email.indexOf("= {", declaration);
  assert.ok(assignment >= 0, `Missing ${name} assignment`);
  const end = email.indexOf("\n};", assignment);
  assert.ok(end > assignment, `Missing ${name} closing brace`);
  return vm.runInNewContext(`(${email.slice(assignment + 2, end + 2)})`);
}

const templates = emailLiteral("templates");
const ownerIntros = emailLiteral("expiredOwnerIntros");

function translations(language) {
  const context = vm.createContext({
    window: {},
    document: { documentElement: { lang: language }, addEventListener() {} },
    localStorage: { getItem() { return language; } }
  });
  vm.runInContext(read("js/i18n.js"), context);
  vm.runInContext(read("js/history-i18n.js"), context);
  const end = renterPage.indexOf("  const PLATFORM_FEE_PERCENT");
  assert.ok(end >= 0);
  vm.runInContext(renterPage.slice(0, end), context);
  return {
    history: (key) => context.window.historyExtraT(key),
    renter: (key) => context.window.rentuloTranslate(key),
    renterExpired: (reason) => vm.runInContext(`reservationsExpirationText(${JSON.stringify(reason)})`, context)
  };
}

for (const language of languages) {
  const t = translations(language);
  for (const [event, reason, renterKey, ownerKey] of [
    ["expired_pending", "owner_no_response", "history.expiry.ownerNoResponse.renter", "history.expiry.ownerNoResponse.owner"],
    ["expired_approved", "payment_timeout", "history.expiry.paymentTimeout.renter", "history.expiry.paymentTimeout.owner"]
  ]) {
    test(`${language} ${event}: renter email and History describe the same cause`, () => {
      const intro = templates[language][event][1];
      const historyIntro = t.history(renterKey);
      assert.ok(intro.startsWith(historyIntro), `Email: ${intro}, History: ${historyIntro}`);
      assert.ok(intro.length > historyIntro.length, "Email must mention what happened to the time slot");
      assert.ok(t.renterExpired(reason).startsWith(historyIntro), "Renter reservation detail must agree with History");
      assert.ok(templates[language][event][0], "Email subject must be localized");
    });

    test(`${language} ${event}: owner email and History use the owner perspective`, () => {
      const ownerIntro = ownerIntros[language][event];
      const ownerHistoryIntro = t.history(ownerKey);
      assert.ok(ownerIntro.startsWith(ownerHistoryIntro), `Email: ${ownerIntro}, History: ${ownerHistoryIntro}`);
      assert.notEqual(ownerIntro, templates[language][event][1], "Recipients must not get identical blame text");
      assert.ok(ownerIntro.length > ownerHistoryIntro.length, "Email must mention what happened to the time slot");
    });
  }

  test(`${language}: unknown expiration reason stays unknown in renter's detail`, () => {
    assert.equal(t.renterExpired("unexpected_reason"), t.renter("reservations.expiration.unknown"));
    assert.equal(t.renterExpired(""), t.renter("reservations.expiration.unknown"));
    assert.notEqual(t.renterExpired("unexpected_reason"), t.renterExpired("payment_timeout"));
  });
}

test("email worker chooses owner-specific expiration copy only for the owner", () => {
  assert.match(email, /const recipientIsOwner = profile\.id === reservation\.owner_id;/);
  assert.match(email, /if \(recipientIsOwner && \(event === "expired_pending" \|\| event === "expired_approved"\)\) \{\s*intro = expiredOwnerIntros\[language\]\[event\];/);
  assert.match(email, /\[subject, intro\] = templates\[language\]\[event as StandardEmailEvent\];/);
  assert.match(email, /escapeHtml\(intro\)/);
  assert.match(email, /if \(event\.startsWith\("expiry_reminder_"\)/);
});
