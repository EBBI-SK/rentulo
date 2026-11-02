"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const reservation = {
  id: "reservation-45",
  reservation_number: "R-000045",
  offer_number: "N-000005",
  owner_id: "owner-id",
  renter_id: "renter-id",
  offer_name: "Vrtačka",
  status: "returned",
  start_date: "2026-10-27",
  end_date: "2026-10-31",
  total_price: 450
};

const paid = {
  id: "extension-one",
  reservation_id: reservation.id,
  status: "paid",
  amount_total: 150,
  new_end_date: "2026-10-31",
  transfer_status: "succeeded"
};

function harness({ language = "cs", extensions = [paid], rpcError = null, rows = [reservation] } = {}) {
  const requests = [];
  const rentalList = { innerHTML: "" };
  const offerList = { innerHTML: "" };
  const reviewsQuery = {
    select() { return this; },
    or() { return this; },
    order: async () => ({ data: [], error: null })
  };
  const client = {
    rpc: async (name) => {
      requests.push(["rpc", name]);
      if (name === "get_my_history_owner_transfers") return { data: [], error: null };
      assert.equal(name, "get_my_reservation_extensions");
      return rpcError
        ? { data: null, error: rpcError }
        : { data: extensions, error: null };
    },
    from(name) {
      requests.push(["from", name]);
      assert.equal(name, "reviews", "History must not read private extension table directly");
      return reviewsQuery;
    }
  };
  const context = vm.createContext({
    window: {
      getRentuloLanguage: () => language,
      getRentuloReservationsData: async () => ({ data: rows, error: null })
    },
    document: {
      documentElement: { lang: language },
      addEventListener() {},
      getElementById(name) {
        return { rentalHistoryList: rentalList, offerHistoryList: offerList }[name] || null;
      }
    },
    getSupabaseClient: () => client,
    escapeHtml,
    console: { warn() {}, error() {} }
  });
  vm.runInContext(read("js/history-i18n.js"), context);
  vm.runInContext(read("js/history-page.js"), context);
  vm.runInContext("historyCurrentUser = {id: 'renter-id'};", context);
  return {
    context, client, requests, rentalList, offerList,
    async render(userId = "renter-id") {
      context.userIdForTest = userId;
      vm.runInContext("historyCurrentUser = { id: userIdForTest };", context);
      return await vm.runInContext("historyLoadData()", context);
    }
  };
}

test("R-000045: renter and owner history show original 450 + paid extension 150 = 600 CZK", async () => {
  for (const userId of ["renter-id", "owner-id"]) {
    const original = { ...reservation };
    const app = harness({
      rows: [original],
      extensions: [
        { ...paid },
        { id: "extension-pending", reservation_id: reservation.id, status: "approved", amount_total: 300 },
        { id: "extension-rejected", reservation_id: reservation.id, status: "rejected", amount_total: 900 },
        { id: "extension-other", reservation_id: "another-reservation", status: "paid", amount_total: 999 }
      ]
    });
    assert.equal(await app.render(userId), true);
    const html = userId === "renter-id" ? app.rentalList.innerHTML : app.offerList.innerHTML;
    assert.match(html, /R-000045/);
    assert.match(html, /simple-reservation-price">600 Kč/);
    assert.match(html, /Původní cena<\/span><strong>450 Kč/);
    assert.match(html, /Zaplacené prodloužení do/);
    assert.match(html, /\+ 150 Kč/);
    assert.match(html, /Celková cena<\/span><strong>600 Kč/);
    assert.doesNotMatch(html, /\+ 300 Kč|\+ 900 Kč|\+ 999 Kč/);
    assert.equal(original.total_price, 450, "original financial snapshot must stay unchanged");
    assert.deepEqual(app.requests.map(x => x.join(":")), [
      "from:reviews", "rpc:get_my_reservation_extensions",
      ...(userId === "owner-id" ? ["rpc:get_my_history_owner_transfers"] : [])
    ]);
  }
});

test("two paid extensions are both listed and counted only once", async () => {
  const app = harness({ extensions: [
    paid,
    { id: "extension-two", reservation_id: reservation.id, status: "paid", amount_total: 100, new_end_date: "2026-11-01" }
  ] });
  assert.equal(await app.render(), true);
  const html = app.rentalList.innerHTML;
  assert.match(html, /simple-reservation-price">700 Kč/);
  assert.equal((html.match(/Zaplacené prodloužení do/g) || []).length, 2);
  assert.match(html, /\+ 150 Kč/);
  assert.match(html, /\+ 100 Kč/);
  assert.match(html, /Celková cena<\/span><strong>700 Kč/);
});

test("no paid extensions preserves legacy History amounts and has no breakdown", async () => {
  const app = harness({ extensions: [
    { id: "pending", reservation_id: reservation.id, status: "approved", amount_total: 150 }
  ] });
  assert.equal(await app.render(), true);
  const html = app.rentalList.innerHTML;
  assert.match(html, /simple-reservation-price">450 Kč/);
  assert.doesNotMatch(html, /Původní cena|Zaplacené prodloužení do/);
});

test("extension RPC error fails closed with retry instead of showing understated prices", async () => {
  const app = harness({ rpcError: { message: "network error" } });
  assert.equal(await app.render(), false);
  assert.match(app.rentalList.innerHTML, /Historii se nepodařilo načíst/);
  assert.match(app.rentalList.innerHTML, /data-history-retry/);
  assert.doesNotMatch(app.rentalList.innerHTML, /450 Kč/);
  assert.equal(app.offerList.innerHTML, app.rentalList.innerHTML);
});

test("extension breakdown labels are localized in all five supported languages", async () => {
  const labels = {
    cs: ["Původní cena", "Zaplacené prodloužení do"],
    sk: ["Pôvodná cena", "Zaplatené predĺženie do"],
    en: ["Original price", "Paid extension until"],
    de: ["Ursprünglicher Preis", "Bezahlte Verlängerung bis"],
    pl: ["Cena pierwotna", "Opłacone przedłużenie do"]
  };
  for (const [language, values] of Object.entries(labels)) {
    const app = harness({ language });
    assert.equal(await app.render(), true);
    for (const label of values) assert.ok(app.rentalList.innerHTML.includes(label), `${language}: ${label}`);
  }
});
