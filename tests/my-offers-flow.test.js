"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

test("My offers renders offers and reservations as two independent sections", () => {
  const page = read(path.join(ROOT, "js", "offers-page.js"));
  const html = read(path.join(ROOT, "moje-nabidky.html"));

  assert.match(page, /class="owner-page-section owner-offers-section"/);
  assert.match(page, /class="owner-page-section owner-reservations-section"/);
  assert.match(page, /offers\.sectionOffers/);
  assert.match(page, /offers\.sectionReservations/);
  assert.match(page, /openReservations\.map\(renderRequest\)\.join\("")/);

  assert.doesNotMatch(
    html,
    /<script src="js\/my-offers-flow\.js"><\/script>/
  );
});

test("My offers keeps pickup confirmation inside the verified PIN flow", () => {
  const page = read(path.join(ROOT, "js", "offers-page.js"));

  assert.match(
    page,
    /Handover is confirmed only through the verified pickup PIN flow/
  );

  assert.doesNotMatch(
    page,
    /data-offers-action="mark-picked-up"/
  );

  assert.match(
    page,
    /data-offers-action="mark-returned"/
  );
});

test("My offers simple layout includes translated section labels in all supported languages", () => {
  const i18n = read(path.join(ROOT, "js", "i18n.js"));
  const css = read(path.join(ROOT, "css", "my-offers-flow.css"));

  assert.match(i18n, /"offers\.sectionOffers": "Vaše nabídky"/);
  assert.match(i18n, /"offers\.sectionOffers": "Vaše ponuky"/);
  assert.match(i18n, /"offers\.sectionOffers": "Your listings"/);
  assert.match(i18n, /"offers\.sectionOffers": "Ihre Angebote"/);
  assert.match(i18n, /"offers\.sectionOffers": "Twoje oferty"/);

  assert.match(css, /\.owner-offer-row/);
  assert.match(css, /\.owner-reservation-card/);
  assert.match(css, /@media \(max-width: 560px\)/);
});
