"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const FLOW = path.join(ROOT, "js", "my-offers-flow.js");
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

test("My offers keeps paid handover inside the verified PIN flow", () => {
  const source = read(FLOW);

  assert.ok(source.includes('data-offers-action="mark-picked-up"'));
  assert.match(source, /button\.remove\(\)/);
  assert.ok(source.includes('data-offers-action="mark-returned"'));
});

test("My offers simple flow supports all five languages and mobile layout", () => {
  const source = read(FLOW);
  const css = read(CSS);

  for (const language of ["cs", "sk", "en", "de", "pl"]) {
    assert.match(source, new RegExp("\\b" + language + ": \\{"));
  }

  assert.match(source, /Spravovat nabídku/);
  assert.match(source, /Žádosti a rezervace/);
  assert.match(css, /\.owner-offer-row/);
  assert.match(css, /\.owner-reservation-card/);
  assert.match(css, /@media \(max-width: 560px\)/);
});
