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
