"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DETAIL_PATH = path.join(PROJECT_ROOT, "js", "detail-page.js");
const MIGRATION_PATH = path.join(
  PROJECT_ROOT,
  "supabase",
  "migrations",
  "20260923093000_add_reservation_pickup_time.sql"
);

function read(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8");
}

function compact(value) {
  return value.replace(/\s+/g, " ").trim();
}

test("reservation form requires and submits a pickup time", () => {
  const source = fs.readFileSync(DETAIL_PATH, "utf8");

  assert.match(source, /<input\s+type="time"\s+id="pickupTime"\s+required>/);
  assert.match(source, /<select id="pickupHour"/);
  assert.match(source, /<select id="pickupMinute"/);
  assert.match(source, /\["00", "15", "30", "45"\]/);
  assert.match(source, /syncPickupTimeFromSelectors/);
  assert.match(
    compact(source),
    /pickup_time:\s*pickupTime/
  );
  assert.match(
    compact(source),
    /createSupabaseReservation\( offer, startDate, endDate, pickupTime \)/
  );
  assert.match(source, /pickupHourInput\.addEventListener\("change"/);
  assert.match(source, /pickupMinuteInput\.addEventListener\("change"/);
});

test("pickup time validation accepts only canonical 24-hour values", () => {
  const source = fs.readFileSync(DETAIL_PATH, "utf8");
  const start = source.indexOf("function isValidPickupTime(");
  const end = source.indexOf("function renderPickupHourOptions(", start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    source.slice(start, end) + "\nthis.isValidPickupTime = isValidPickupTime;",
    sandbox
  );

  for (const value of ["00:00", "08:05", "15:30", "23:59"]) {
    assert.equal(sandbox.isValidPickupTime(value), true, value);
  }

  for (const value of ["", "9:00", "24:00", "12:60", "15:30:00", "abc"]) {
    assert.equal(sandbox.isValidPickupTime(value), false, value);
  }
});

test("pickup selector offers every hour and quarter-hour minutes", () => {
  const source = fs.readFileSync(DETAIL_PATH, "utf8");
  const start = source.indexOf("function renderPickupHourOptions(");
  const end = source.indexOf("function detailTranslate(", start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    source.slice(start, end) +
      "\nthis.renderPickupHourOptions = renderPickupHourOptions;" +
      "\nthis.renderPickupMinuteOptions = renderPickupMinuteOptions;",
    sandbox
  );

  const hourOptions = sandbox.renderPickupHourOptions();
  const minuteOptions = sandbox.renderPickupMinuteOptions();

  assert.match(hourOptions, /value="00">00<\/option>/);
  assert.match(hourOptions, /value="15">15<\/option>/);
  assert.match(hourOptions, /value="23">23<\/option>/);
  assert.doesNotMatch(hourOptions, /value="24"/);

  for (const minute of ["00", "15", "30", "45"]) {
    assert.match(minuteOptions, new RegExp(`value="${minute}">${minute}<\\/option>`));
  }
});

test("pickup time copy exists for every supported Rentulo language", () => {
  const source = fs.readFileSync(DETAIL_PATH, "utf8");

  for (const language of ["cs", "sk", "en", "de", "pl"]) {
    assert.match(
      source,
      new RegExp("\\b" + language + ":\\s*\\{[\\s\\S]*?pickupTime:")
    );
  }

  assert.match(source, /pickupTimeValue = document\.getElementById\("pickupTime"\)/);
  assert.match(source, /pickupHourInput\.value = pickupTimeParts\[0\]/);
  assert.match(source, /pickupMinuteInput\.value = pickupTimeParts\[1\]/);
});

test("database stores pickup time and keeps it immutable after reservation creation", () => {
  const sql = compact(fs.readFileSync(MIGRATION_PATH, "utf8"));

  assert.match(
    sql,
    /alter table public\.reservations add column if not exists pickup_time time without time zone/i
  );
  assert.match(
    sql,
    /if new\.pickup_time is null then raise exception 'Pickup time is required'; end if;/i
  );
  assert.match(
    sql,
    /new\.pickup_time is distinct from old\.pickup_time/i
  );
  assert.match(
    sql,
    /item is due back at the same time on end_date/i
  );
});
