"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const RESERVATIONS_PAGE_PATH = path.join(
  PROJECT_ROOT,
  "js",
  "reservations-page.js"
);

function readReservationsPage() {
  return fs.readFileSync(RESERVATIONS_PAGE_PATH, "utf8");
}

test("reservation detail keeps pickup time from Supabase", () => {
  const source = readReservationsPage();

  assert.match(source, /pickupTime:\s*row\.pickup_time\s*\|\|\s*""/);
});

test("reservation time formatter keeps canonical HH:mm and ignores missing legacy time", () => {
  const source = readReservationsPage();
  const start = source.indexOf("function formatReservationsTime(");
  const end = source.indexOf("const PLATFORM_FEE_PERCENT", start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const sandbox = {
    formatReservationsDate(value) {
      return "DATE(" + value + ")";
    },
    getReservationScheduleCopy() {
      return { at: "at" };
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(
    source.slice(start, end) +
      "\nthis.formatReservationsTime = formatReservationsTime;" +
      "\nthis.formatReservationScheduleValue = formatReservationScheduleValue;",
    sandbox
  );

  assert.equal(sandbox.formatReservationsTime("15:00:00"), "15:00");
  assert.equal(sandbox.formatReservationsTime("08:45"), "08:45");
  assert.equal(sandbox.formatReservationsTime(""), "");
  assert.equal(sandbox.formatReservationsTime("25:00:00"), "");

  assert.equal(
    sandbox.formatReservationScheduleValue("2026-09-24", "15:00:00"),
    "DATE(2026-09-24) at 15:00"
  );
  assert.equal(
    sandbox.formatReservationScheduleValue("2026-09-24", ""),
    "DATE(2026-09-24)"
  );
});

test("reservation detail renders pickup and return schedule in all supported languages", () => {
  const source = readReservationsPage();

  const expectedCopy = {
    cs: ["Převzetí", "Vrácení", "v"],
    sk: ["Prevzatie", "Vrátenie", "o"],
    en: ["Pickup", "Return", "at"],
    de: ["Abholung", "Rückgabe", "um"],
    pl: ["Odbiór", "Zwrot", "o"]
  };

  for (const [language, values] of Object.entries(expectedCopy)) {
    assert.match(source, new RegExp("\\b" + language + ": \\{"));

    for (const value of values) {
      assert.ok(source.includes(value), language + ": " + value);
    }
  }

  assert.match(source, /reservation-schedule-pickup/);
  assert.match(source, /reservation-schedule-return/);
  assert.match(source, /scheduleCopy\.pickup/);
  assert.match(source, /scheduleCopy\.return/);
  assert.match(source, /reservation\.pickupTime/);
});
