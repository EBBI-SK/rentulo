"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const utils = read("js/utils.js");
const context = vm.createContext({});
vm.runInContext(utils.slice(utils.indexOf("function formatRentuloCzechPostalCode(")), context);

function mockInput(value) {
  const events = new Map();
  const input = {
    value,
    addEventListener(type, handler) {
      if (!events.has(type)) events.set(type, []);
      events.get(type).push(handler);
    },
    trigger(type) {
      for (const handler of events.get(type) || []) handler();
    }
  };
  return { input, events };
}

test("PSČ is formatted only after leaving a valid field", () => {
  for (const [given, expected] of [
    ["11000", "110 00"], ["110 00", "110 00"],
    [" 60200 ", "602 00"], ["602 00", "602 00"]
  ]) {
    const { input, events } = mockInput(given);
    context.setupRentuloCzechPostalCodeBlur(input);
    assert.equal(events.get("blur").length, 1);
    assert.equal(input.value, given, "format only after blur, not while typing");
    input.trigger("input");
    assert.equal(input.value, given);
    input.trigger("blur");
    assert.equal(input.value, expected);
  }
});

test("invalid or incomplete PSČ is left untouched for existing submit validation", () => {
  for (const given of ["", "110", "1100", "11 000", "110-00", "110 000", "1234x", "30-001"]) {
    const { input } = mockInput(given);
    context.setupRentuloCzechPostalCodeBlur(input);
    input.trigger("blur");
    assert.equal(input.value, given);
  }
  assert.doesNotThrow(() => context.setupRentuloCzechPostalCodeBlur(null));
  assert.doesNotThrow(() => context.setupRentuloCzechPostalCodeBlur({ value: "11000" }));
});

test("registration, new offer, edit offer and settings all connect the same blur helper", () => {
  const pages = [
    ["registrace.html", "js/registration-page.js", "postalCode"],
    ["nabidnout.html", "js/offer-form-page.js", "pickupPostalCode"],
    ["edit-nabidka.html", "js/edit-offer.js", "edit-postal-code"],
    ["nastaveni.html", "js/settings-page.js", "profilePostalCode"]
  ];
  for (const [htmlPath, jsPath, id] of pages) {
    const html = read(htmlPath);
    const js = read(jsPath);
    assert.ok(html.includes(`id="${id}"`), `${htmlPath}: PSČ field must exist`);
    assert.ok(js.includes(`setupRentuloCzechPostalCodeBlur(document.getElementById("${id}"))`), `${jsPath}: missing blur binding`);
    assert.ok(html.indexOf('<script src="js/utils.js"></script>') !== -1, `${htmlPath}: shared helper must be loaded`);
    assert.ok(html.indexOf('<script src="js/utils.js"></script>') < html.indexOf(`<script src="${jsPath}"></script>`), `${htmlPath}: script ordering`);
  }
});
