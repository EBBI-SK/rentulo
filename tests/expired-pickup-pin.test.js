"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const ui = read("js/pickup-security.js");
const reservations = read("js/reservations-page.js");
const edge = read("supabase/functions/get-pickup-pin/index.ts");
const css = read("css/pickup-security.css");

function functionSlice(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing source boundary: ${start} or ${end}`);
  return source.slice(a, b);
}

const dateHelpers = functionSlice(ui, "  function getPragueCalendarDate(", "  function setOwnerMessage(");
const pinRenterFunctions = functionSlice(ui, "  function showExpiredRenterPin(", "  function resetRenterEnhancements(");

function testCalendar() {
  const context = vm.createContext({ Intl, Date });
  vm.runInContext(dateHelpers, context);
  return context;
}

test("renter PIN expires at 10:00 Prague time on return day, not at midnight", () => {
  const { isExpiredRentalPeriod } = testCalendar();
  assert.equal(isExpiredRentalPeriod("2026-11-13", "10:00:00", new Date("2026-11-13T08:59:59.000Z")), false);
  assert.equal(isExpiredRentalPeriod("2026-11-13", "10:00:00", new Date("2026-11-13T09:00:00.000Z")), true);
  assert.equal(isExpiredRentalPeriod("2026-11-13", "00:00:00", new Date("2026-11-12T23:00:00.000Z")), true);
  assert.equal(isExpiredRentalPeriod("", "10:00:00", new Date()), false);
  assert.equal(isExpiredRentalPeriod("2026-11-13", "", new Date()), false);
});

test("renter PIN expiry honors Prague daylight-saving changes and repeated hours", () => {
  const { isExpiredRentalPeriod } = testCalendar();
  for (const [date, cutoff] of [
    ["2026-03-29", "2026-03-29T08:00:00Z"],
    ["2026-10-25", "2026-10-25T09:00:00Z"]
  ]) {
    const ms = new Date(cutoff).getTime();
    assert.equal(isExpiredRentalPeriod(date, "10:00:00", new Date(ms - 1)), false);
    assert.equal(isExpiredRentalPeriod(date, "10:00:00", new Date(ms)), true);
  }
  // The repeated autumn 02:30 uses the later (winter-time) occurrence.
  assert.equal(isExpiredRentalPeriod("2026-10-25", "02:30:00", new Date("2026-10-25T00:45:00Z")), false);
  assert.equal(isExpiredRentalPeriod("2026-10-25", "02:30:00", new Date("2026-10-25T01:30:00Z")), true);
  // A missing spring 02:30 resolves to 03:30 local time.
  assert.equal(isExpiredRentalPeriod("2026-03-29", "02:30:00", new Date("2026-03-29T01:29:59Z")), false);
  assert.equal(isExpiredRentalPeriod("2026-03-29", "02:30:00", new Date("2026-03-29T01:30:00Z")), true);
});

function fakeRenterPage(pickupDate, now, pickupEndDate = pickupDate, pickupTime = "18:00:00") {
  let clock = now;
  let requestCount = 0;
  let response = { ok: true, data: { pin: "123456" } };
  let shownBlock = null;
  const row = {
    dataset: { pickupDate, pickupEndDate, pickupTime },
    isConnected: true,
    querySelector(selector) {
      if (selector === ".simple-reservation-status.status-paid") return {};
      if (selector === '[data-reservations-action="toggle-detail"][data-reservation-id]') {
        return { dataset: { reservationId: "reservation-uuid" } };
      }
      if (selector === ".pickup-pin-card") return shownBlock;
      return null;
    },
    appendChild(block) { shownBlock = block; }
  };
  const document = {
    querySelectorAll(selector) {
      if (selector === ".simple-reservation-row" || selector === ".simple-reservation-row[data-pickup-date]") {
        return [row];
      }
      return [];
    },
    createElement() {
      const classes = new Set();
      return {
        className: "",
        isConnected: true,
        classList: { add(cls) { classes.add(cls); }, contains(cls) { return classes.has(cls); } },
        innerHTML: "",
        setAttribute() {}
      };
    }
  };
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
  }
  const context = vm.createContext({
    Intl, Date: FakeDate, document,
    escapeHtml: value => String(value),
    text: key => ({ pinExpired: "PICKUP EXPIRED", pinTitle: "Pickup PIN", pinLoading: "Loading", pinUnavailable: "Unavailable", pinHint: "Keep private" }[key] || key),
    async invoke() { requestCount += 1; return response; }
  });
  vm.runInContext(dateHelpers + pinRenterFunctions, context);
  return {
    render: () => context.enhanceRenterRows(),
    refresh: () => context.refreshExpiredRenterPins(),
    block: () => shownBlock,
    requests: () => requestCount,
    advance: next => { clock = next; },
    respond: next => { response = next; }
  };
}

test("an already-expired paid reservation displays an expiry message without fetching a PIN", () => {
  const page = fakeRenterPage("2026-09-28", "2026-10-11T12:00:00.000Z");
  page.render();
  assert.match(page.block().innerHTML, /PICKUP EXPIRED/);
  assert.doesNotMatch(page.block().innerHTML, /123456|Pickup PIN|Loading/);
  assert.equal(page.requests(), 0);
  assert.equal(page.block().classList.contains("expired"), true);
});

test("today's and future paid reservations still provide a PIN", async () => {
  for (const pickupDate of ["2026-10-11", "2026-10-20"]) {
    const page = fakeRenterPage(pickupDate, "2026-10-11T12:00:00.000Z");
    page.render();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(page.requests(), 1);
    assert.match(page.block().innerHTML, /123456/);
    assert.equal(page.block().classList.contains("expired"), false);
  }
});

test("paid multi-day booking keeps the PIN visible after its first night", async () => {
  const page = fakeRenterPage("2026-10-11", "2026-10-11T21:50:00.000Z", "2026-10-13");
  page.render();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(page.block().innerHTML, /123456/);
  page.advance("2026-10-11T22:00:00.000Z"); // 12 Oct in Prague
  page.refresh();
  assert.match(page.block().innerHTML, /123456/);
  page.advance("2026-10-13T15:59:59.000Z"); // 17:59:59 in Prague on last day
  page.refresh();
  assert.match(page.block().innerHTML, /123456/);
  page.advance("2026-10-13T16:00:00.000Z"); // 18:00 in Prague on last day
  page.refresh();
  assert.match(page.block().innerHTML, /PICKUP EXPIRED/);
  assert.doesNotMatch(page.block().innerHTML, /123456/);
  assert.equal(page.requests(), 1);
});

test("an open paid-reservation page hides its PIN exactly at return time", async () => {
  const page = fakeRenterPage("2026-10-11", "2026-10-11T15:59:00.000Z");
  page.render();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(page.block().innerHTML, /123456/);
  page.advance("2026-10-11T16:00:00.000Z");
  page.refresh();
  assert.match(page.block().innerHTML, /PICKUP EXPIRED/);
  assert.doesNotMatch(page.block().innerHTML, /123456/);
  assert.equal(page.requests(), 1);
});

test("server expiry responses get a dedicated message, not the generic PIN error", async () => {
  const page = fakeRenterPage("2026-10-20", "2026-10-11T12:00:00.000Z");
  page.respond({ ok: false, data: { code: "pickup_day_expired" } });
  page.render();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(page.block().innerHTML, /PICKUP EXPIRED/);
  assert.doesNotMatch(page.block().innerHTML, /Unavailable|123456/);
});

test("paid reservation markup includes the return clock time", () => {
  assert.match(reservations, /data-pickup-date="\$\{escapeHtml\(startDate\)\}"/);
  assert.match(reservations, /data-pickup-end-date="\$\{escapeHtml\(endDate\)\}"/);
  assert.match(reservations, /data-pickup-time="\$\{escapeHtml\(reservation\.pickupTime/);
  assert.match(reservations, /const startDate = getSafeReservationDateFrom\(reservation\)/);
});

test("server refuses PIN requests at exact return deadline and after authentication", () => {
  assert.match(edge, /\.select\("id, renter_id, owner_id, status, start_date, end_date, pickup_time"\)/);
  assert.match(edge, /reservation\.renter_id !== actor\.id/);
  assert.match(edge, /reservation\.status !== "paid"/);
  assert.match(edge, /if \(rentalEndReached\(reservation\.end_date, reservation\.pickup_time\)\)/);
  assert.match(edge, /code: "pickup_day_expired"/);
  assert.match(edge, /}, 409\)/);
  assert.ok(edge.indexOf('code: "pickup_day_expired"') < edge.lastIndexOf("const pin = await createPickupPin("));
  assert.match(edge, /from "\.\.\/_shared\/prague-rental-window\.mjs"/);
});

test("expired PIN message is localized and styled without changing paid reservation status", () => {
  assert.equal((ui.match(/pinExpired:/g) || []).length, 5);
  assert.match(ui, /Celé zaplacené období již skončilo\./);
  assert.match(ui, /window\.setInterval\(refreshExpiredRenterPins, 30000\)/);
  assert.match(ui, /visibilitychange/);
  assert.match(css, /\.pickup-pin-card\.expired\s*\{/);
  assert.doesNotMatch(edge, /\.update\(|\.delete\(|\.rpc\(/);
});
