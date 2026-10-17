"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
function loadDetailContext(rpcData, rpcError = null) {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: rpcData, error: rpcError };
    }
  };
  const context = {
    URL, URLSearchParams,
    console: { log() {}, error() {}, warn() {} },
    document: { addEventListener() {}, getElementById() { return null; } },
    getSupabaseClient() { return client; }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "js/detail-page.js"), "utf8"), context);
  return { context, calls };
}

const offerId = "123e4567-e89b-42d3-a456-426614174000";

test("availability checks both dates AND pickup time with a single boolean-only RPC", async () => {
  const { context, calls } = loadDetailContext(false);
  const conflict = await context.hasReservationDateConflict(offerId, "2026-10-19", "2026-10-20", "12:00");
  assert.equal(conflict, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "has_offer_reservation_time_conflict");
  assert.equal(JSON.stringify(calls[0].args), JSON.stringify({
    p_offer_id: offerId,
    p_start_date: "2026-10-19",
    p_end_date: "2026-10-20",
    p_pickup_time: "12:00"
  }));
});

test("server-reported overlap or missing two-hour buffer locks the booking", async () => {
  const { context } = loadDetailContext(true);
  assert.equal(await context.hasReservationDateConflict(offerId, "2026-10-19", "2026-10-20", "11:45"), true);
});

test("server errors and invalid result fail closed", async () => {
  const error = new Error("Availability unavailable");
  const failure = loadDetailContext(null, error);
  await assert.rejects(failure.context.hasReservationDateConflict(offerId, "2026-10-19", "2026-10-20", "12:00"), error);
  const invalid = loadDetailContext([]);
  await assert.rejects(invalid.context.hasReservationDateConflict(offerId, "2026-10-19", "2026-10-20", "12:00"));
  const missing = loadDetailContext(false);
  await assert.rejects(missing.context.hasReservationDateConflict(offerId, "2026-10-19", "2026-10-20", ""));
  assert.equal(missing.calls.length, 0);
});

test("both live UI checks pass the selected time into availability lookup", () => {
  const js = fs.readFileSync(path.join(root, "js/detail-page.js"), "utf8");
  assert.match(js, /hasReservationDateConflict\(\s*offer\.id,\s*activeStartDate,\s*activeEndDate,\s*pickupTime\s*\)/);
  assert.match(js, /hasReservationDateConflict\(offer\.id, startDate, endDate, pickupTime\)/);
  assert.doesNotMatch(js, /\.rpc\("get_blocking_reservations"/);
});
