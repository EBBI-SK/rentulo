"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const FLOW = path.join(ROOT, "js", "my-offers-flow.js");
const OFFERS_PAGE = path.join(ROOT, "js", "offers-page.js");
const I18N = path.join(ROOT, "js", "i18n.js");
const CSS = path.join(ROOT, "css", "my-offers-flow.css");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

test("My offers separates reservations from listing rows", () => {
  const source = read(FLOW);

  assert.match(source, /owner-reservations-section/);
  assert.match(source, /owner-reservations-list/);
  assert.match(source, /reservationCards\.push\(card\)/);
  assert.match(source, /panel\.remove\(\)/);
  assert.match(source, /owner-offer-request-summary/);
});

test("My offers keeps a hidden paid handover action available for the verified PIN flow", () => {
  const source = read(FLOW);
  const pickupStart = source.indexOf('card.querySelectorAll(\'[data-offers-action="mark-picked-up"]\')');
  const pickupBlock = source.slice(pickupStart, pickupStart + 220);

  assert.ok(pickupStart >= 0);
  assert.match(pickupBlock, /button\.hidden = true/);
  assert.doesNotMatch(pickupBlock, /button\.remove\(\)/);
  assert.ok(source.includes('data-offers-action="mark-returned"'));
});

test("My offers simple flow supports all five languages and mobile layout", () => {
  const source = read(FLOW);
  const offersPage = read(OFFERS_PAGE);
  const i18n = read(I18N);
  const css = read(CSS);

  for (const language of ["cs", "sk", "en", "de", "pl"]) {
    assert.match(source, new RegExp("\\b" + language + ": \\{"));
  }

  assert.match(source, /Spravovat nabídku/);
  assert.match(source, /Žádosti a rezervace/);
  assert.match(offersPage, /Výplata byla uvolněna\. Rentulo předalo Stripe pokyn/);
  assert.match(i18n, /Your payout has been released\. Rentulo has instructed Stripe/);
  assert.match(i18n, /Die Auszahlung wurde freigegeben\. Rentulo hat Stripe angewiesen/);
  assert.match(i18n, /Wypłata została zwolniona\. Rentulo przekazało Stripe/);
  assert.doesNotMatch(i18n, /Věc byla předána zájemci\. Až ji dostanete zpět/);
  assert.match(css, /\.owner-offer-row/);
  assert.match(css, /\.owner-reservation-card/);
  assert.match(css, /@media \(max-width: 560px\)/);
});
