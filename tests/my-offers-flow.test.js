"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const FLOW = path.join(ROOT, "js", "my-offers-flow.js");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

test("My offers prioritizes an approved reservation waiting for payment over older picked-up rows", () => {
  const source = read(FLOW);

  assert.match(
    source,
    /const waitingPaymentCount = panel\.querySelectorAll\("\.request-status\.active"\)\.length;/
  );

  const paidIndex = source.indexOf("if (pickupCount > 0)");
  const waitingPaymentIndex = source.indexOf("if (waitingPaymentCount > 0)");
  const pickedIndex = source.indexOf("if (returnCount > 0)");

  assert.ok(paidIndex >= 0);
  assert.ok(waitingPaymentIndex > paidIndex);
  assert.ok(pickedIndex > waitingPaymentIndex);
  assert.match(
    source,
    /return \{ kind: "reservation", count: waitingPaymentCount \};/
  );
});


test("My offers keeps one current reservation visible and reveals the others on demand", () => {
  const offersPage = read(path.join(ROOT, "js", "offers-page.js"));
  const pickupSecurity = read(path.join(ROOT, "js", "pickup-security.js"));
  const i18n = read(path.join(ROOT, "js", "i18n.js"));
  const css = read(path.join(ROOT, "css", "my-offers-flow.css"));

  assert.match(offersPage, /function selectCurrentOpenRequest\(openRequests\)/);
  assert.match(offersPage, /data-offers-action="toggle-other-reservations"/);
  assert.match(offersPage, /function toggleOtherReservations\(panelId\)/);
  assert.match(offersPage, /data-other-reservations-expanded="false"/);
  assert.match(offersPage, /focusedReservationId = panelType === "history" \? "" : String\(reservationId \|\| ""\);/);

  assert.match(
    pickupSecurity,
    /sessionStorage\.setItem\("rentuloOwnerFocusReservationId", reservationId\)/
  );

  assert.match(i18n, /"offers\.otherReservations": "Další rezervace \(\{count\}\)"/);
  assert.match(i18n, /"offers\.backToCurrentReservation": "Zpět k aktuální rezervaci"/);
  assert.match(i18n, /"offers\.otherReservations": "Ďalšie rezervácie \(\{count\}\)"/);
  assert.match(i18n, /"offers\.otherReservations": "Other reservations \(\{count\}\)"/);
  assert.match(i18n, /"offers\.otherReservations": "Weitere Reservierungen \(\{count\}\)"/);
  assert.match(i18n, /"offers\.otherReservations": "Pozostałe rezerwacje \(\{count\}\)"/);

  assert.match(css, /\.offer-other-reservations\[hidden\]/);
  assert.match(css, /\.offer-other-reservations-toggle/);
});
