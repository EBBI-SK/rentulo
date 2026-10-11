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

test("pickup PIN expiry follows Prague's date at midnight rather than UTC or browser locale", () => {
  const { getPragueCalendarDate, isExpiredPickupDate } = testCalendar();
  assert.equal(getPragueCalendarDate(new Date("2026-10-11T21:59:59.000Z")), "2026-10-11");
  assert.equal(getPragueCalendarDate(new Date("2026-10-11T22:00:00.000Z")), "2026-10-12");
  assert.equal(isExpiredPickupDate("2026-10-11", new Date("2026-10-11T21:59:59.000Z")), false);
  assert.equal(isExpiredPickupDate("2026-10-11", new Date("2026-10-11T22:00:00.000Z")), true);
  assert.equal(isExpiredPickupDate("2026-10-12", new Date("2026-10-11T22:00:00.000Z")), false);
  assert.equal(isExpiredPickupDate("2026-10-20", new Date("2026-10-11T22:00:00.000Z")), false);
  assert.equal(isExpiredPickupDate("", new Date("2026-10-11T22:00:00.000Z")), false);
});

test("PIN expiry handles Prague daylight-saving changes", () => {
  const { getPragueCalendarDate, isExpiredPickupDate } = testCalendar();
  assert.equal(getPragueCalendarDate(new Date("2026-03-28T22:59:59.000Z")), "2026-03-28");
  assert.equal(getPragueCalendarDate(new Date("2026-03-28T23:00:00.000Z")), "2026-03-29");
  assert.equal(getPragueCalendarDate(new Date("2026-10-25T22:59:59.000Z")), "2026-10-25");
  assert.equal(getPragueCalendarDate(new Date("2026-10-25T23:00:00.000Z")), "2026-10-26");
  assert.equal(isExpiredPickupDate("2026-10-25", new Date("2026-10-25T22:59:59.000Z")), false);
  assert.equal(isExpiredPickupDate("2026-10-25", new Date("2026-10-25T23:00:00.000Z")), true);
});

function fakeRenterPage(pickupDate, now) {
  let clock = now;
  let requestCount = 0;
  let response = { ok: true, data: { pin: "123456" } };
  let shownBlock = null;
  const row = {
    dataset: { pickupDate },
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

test("an open paid-reservation page removes its PIN after Prague midnight", async () => {
  const page = fakeRenterPage("2026-10-11", "2026-10-11T21:50:00.000Z");
  page.render();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(page.block().innerHTML, /123456/);
  page.advance("2026-10-11T22:00:00.000Z");
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

test("paid reservation markup carries the escaped ISO pickup date", () => {
  assert.match(reservations, /data-pickup-date="\$\{escapeHtml\(startDate\)\}"/);
  assert.match(reservations, /const startDate = getSafeReservationDateFrom\(reservation\)/);
});

test("server refuses expired renter PIN requests after authentication but before signing a PIN", () => {
  assert.match(edge, /\.select\("id, renter_id, owner_id, status, start_date"\)/);
  assert.match(edge, /reservation\.renter_id !== actor\.id/);
  assert.match(edge, /reservation\.status !== "paid"/);
  assert.match(edge, /if \(reservation\.start_date < getPragueCalendarDate\(\)\)/);
  assert.match(edge, /code: "pickup_day_expired"/);
  assert.match(edge, /}, 409\)/);
  assert.ok(edge.indexOf('code: "pickup_day_expired"') < edge.lastIndexOf("const pin = await createPickupPin("));
  assert.match(edge, /timeZone: "Europe\/Prague"/);
});

test("expired PIN message is localized and styled without changing paid reservation status", () => {
  assert.equal((ui.match(/pinExpired:/g) || []).length, 5);
  assert.match(ui, /Term\u00edn pro p\u0159evzet\u00ed ji\u017e uplynul\./);
  assert.match(ui, /window\.setInterval\(refreshExpiredRenterPins, 30000\)/);
  assert.match(ui, /visibilitychange/);
  assert.match(css, /\.pickup-pin-card\.expired\s*\{/);
  assert.doesNotMatch(edge, /\.update\(|\.delete\(|\.rpc\(/);
});
