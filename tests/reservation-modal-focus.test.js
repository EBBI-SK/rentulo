"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "js", "reservations-page.js"),
  "utf8"
);

function getFunctionSource(functionName) {
  const start = source.indexOf("function " + functionName + "(");
  assert.notEqual(start, -1, functionName + " must exist");

  const braceStart = source.indexOf("{", start);
  let depth = 0;

  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  assert.fail(functionName + " body was not closed");
}

for (const functionName of [
  "closeReservationCancelModal",
  "closeReservationPaymentModal"
]) {
  test(functionName + " removes focus before aria-hidden", () => {
    const fn = getFunctionSource(functionName);
    const containsIndex = fn.indexOf("elements.overlay.contains(document.activeElement)");
    const blurIndex = fn.indexOf("activeElement.blur()");
    const hiddenIndex = fn.indexOf("elements.overlay.hidden = true");
    const ariaHiddenIndex = fn.indexOf(
      'elements.overlay.setAttribute("aria-hidden", "true")'
    );

    assert.ok(containsIndex >= 0, "focused modal content must be detected");
    assert.ok(blurIndex > containsIndex, "focused modal content must be blurred");
    assert.ok(blurIndex < hiddenIndex, "focus must leave the modal before hidden=true");
    assert.ok(blurIndex < ariaHiddenIndex, "focus must leave the modal before aria-hidden=true");
  });
}
