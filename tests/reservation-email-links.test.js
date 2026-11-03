"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const source = read("supabase/functions/send-reservation-email/index.ts");
const reservationId = "33333333-3333-4333-8333-333333333333";
const begin = source.indexOf("type EmailActionKind =");
const end = source.indexOf("const extensionPaidOwnerIntros:", begin);
assert.ok(begin !== -1 && end > begin, "email CTA action resolver must remain testable");
const actionCode = stripTypeScriptTypes(source.slice(begin, end));
const action = vm.runInNewContext(actionCode + "\nreservationEmailAction", {
  Set, encodeURIComponent,
});

const historical = ["rejected", "cancelled", "paid_cancelled", "returned", "expired_pending", "expired_approved", "no_show"];
const active = [
  "new_request", "approved", "paid", "picked_up", "expiry_reminder_pending",
  "expiry_reminder_approved", "return_reminder_30m", "return_reminder_2h", "return_not_received",
  "extension_requested", "extension_approved", "extension_rejected", "extension_paid", "extension_expired",
];

const expectedLabels = {
  cs: ["Zobrazit \u017e\u00e1dost", "Zaplatit rezervaci", "Zobrazit rezervaci", "Zobrazit v historii", "Zobrazit \u017e\u00e1dost o prodlou\u017een\u00ed", "Zaplatit doplatek"],
  sk: ["Zobrazi\u0165 \u017eiados\u0165", "Zaplati\u0165 rezerv\u00e1ciu", "Zobrazi\u0165 rezerv\u00e1ciu", "Zobrazi\u0165 v hist\u00f3rii", "Zobrazi\u0165 \u017eiados\u0165 o pred\u013a\u017eenie", "Zaplati\u0165 doplatok"],
  en: ["View request", "Pay for reservation", "View reservation", "View in history", "View extension request", "Pay additional amount"],
  de: ["Anfrage anzeigen", "Reservierung bezahlen", "Reservierung anzeigen", "Im Verlauf anzeigen", "Verl\u00e4ngerungsanfrage anzeigen", "Nachzahlung leisten"],
  pl: ["Zobacz pro\u015bb\u0119", "Op\u0142a\u0107 rezerwacj\u0119", "Zobacz rezerwacj\u0119", "Zobacz w historii", "Zobacz pro\u015bb\u0119 o przed\u0142u\u017cenie", "Op\u0142a\u0107 dop\u0142at\u0119"],
};

for (const [language, labels] of Object.entries(expectedLabels)) {
  test(`all email action categories are translated in ${language}`, () => {
    const events = ["new_request", "approved", "paid", "returned", "extension_requested", "extension_approved"];
    events.forEach((event, i) => {
      const result = action(event, language, false, "https://rentulo.eu", reservationId);
      assert.equal(result.label, labels[i]);
      assert.notEqual(result.label, "Rentulo");
    });
  });
}

test("all completed/cancelled/expired email links open their exact History entry for either participant", () => {
  for (const event of historical) {
    for (const owner of [true, false]) {
      const result = action(event, "cs", owner, "https://rentulo.eu", reservationId);
      assert.equal(result.url, `https://rentulo.eu/historie.html?reservation=${reservationId}`, event);
      assert.equal(result.label, "Zobrazit v historii");
    }
  }
});

test("active email links target the correct participant's reservation without leaking a PIN", () => {
  for (const event of active) {
    for (const owner of [true, false]) {
      const { label, url } = action(event, "en", owner, "https://rentulo.com", reservationId);
      assert.equal(url, `https://rentulo.com/${owner ? "moje-nabidky" : "moje-rezervace"}.html?reservation=${reservationId}`, event);
      assert.ok(label && label !== "Rentulo");
      assert.doesNotMatch(url, /pin|checkout|payment_intent/i);
    }
  }
});

test("each action is chosen by event, not a generic homepage button", () => {
  assert.equal(action("expiry_reminder_pending", "cs", true, "https://rentulo.eu", reservationId).label, "Zobrazit \u017e\u00e1dost");
  assert.equal(action("expiry_reminder_approved", "cs", false, "https://rentulo.eu", reservationId).label, "Zaplatit rezervaci");
  assert.equal(action("extension_rejected", "cs", false, "https://rentulo.eu", reservationId).label, "Zobrazit rezervaci");
  assert.match(source, /const recipientIsOwner = profile\.id === reservation\.owner_id;/);
  assert.match(source, /reservationEmailAction\(event, language, recipientIsOwner, siteUrl, reservation\.id\)/);
  assert.doesNotMatch(source, /: "Rentulo";\s*const html/);
});

test("deep-link consumers use participant-scoped rendered cards and do not auto-mutate reservations", () => {
  const owner = read("js/my-offers-flow.js");
  const renter = read("js/reservations-page.js");
  const history = read("js/history-page.js");
  const login = read("js/login-page.js");
  assert.match(owner, /const linkedId = params\.get\("reservation"\)/);
  assert.match(owner, /section\.querySelectorAll\("\.owner-reservation-card"\)/);
  assert.match(renter, /function focusEmailReservation\(\)/);
  assert.match(renter, /document\.getElementById\("reservation-detail-" \+ reservationId\.toLowerCase\(\)\)/);
  assert.match(history, /const renterDetail = document\.getElementById\("history-detail-"/);
  assert.match(history, /const ownerDetail = document\.getElementById\("history-detail-"/);
  assert.match(login, /returnPath \+ "\?reservation=" \+ encodeURIComponent\(reservationId\)/);
  for (const page of [owner, renter, history]) assert.match(page, /email-reservation-target/);
});
