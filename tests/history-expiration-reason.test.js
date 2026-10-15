"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const migration = read("supabase/migrations/20261012171000_reservation_expiration_policy.sql");
const navigation = read("js/navigation.js");

function setupHistory(language = "cs") {
  const rentalList = { innerHTML: "" };
  const offerList = { innerHTML: "" };
  const context = vm.createContext({
    window: { getRentuloLanguage: () => language },
    document: {
      documentElement: { lang: "cs" },
      addEventListener() {},
      getElementById(id) {
        return { rentalHistoryList: rentalList, offerHistoryList: offerList }[id] || null;
      }
    },
    getSupabaseClient: () => ({}),
    escapeHtml: (value) => String(value ?? "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;")
  });
  vm.runInContext(read("js/history-i18n.js"), context);
  vm.runInContext(read("js/history-page.js"), context);
  vm.runInContext('historyCurrentUser = { id: "renter-id" };', context);
  return {
    context,
    rentalList,
    offerList,
    detail: (reservation, role) => vm.runInContext(
      `historyRenderDetail(${JSON.stringify(reservation)}, ${JSON.stringify(role)})`, context
    ),
    showFor: (reservation, userId) => {
      context.reservationDataForTest = reservation;
      context.userIdForTest = userId;
      vm.runInContext(
        "historyCurrentUser = { id: userIdForTest }; historyReservations = [reservationDataForTest]; historyRenderAll();",
        context
      );
    }
  };
}

const sample = {
  id: "test-id-27",
  owner_id: "owner-id",
  renter_id: "renter-id",
  reservation_number: "R-000027",
  offer_number: "N-000002",
  offer_name: "Test číslování",
  start_date: "2026-10-17",
  end_date: "2026-10-18",
  total_price: 250,
  status: "expired",
  expiry_reason: "owner_no_response"
};

const expected = {
  cs: ["Důvod vypršení", "Majitel žádost nepotvrdil ve stanovené lhůtě.", "Platba nebyla dokončena ve stanovené lhůtě.", "Důvod vypršení není k dispozici."],
  sk: ["Dôvod vypršania", "Majiteľ žiadosť nepotvrdil v stanovenej lehote.", "Platba nebola dokončená v stanovenej lehote.", "Dôvod vypršania nie je k dispozícii."],
  en: ["Reason for expiration", "The owner did not approve the request within the deadline.", "Payment was not completed within the deadline.", "The reason for expiration is unavailable."],
  de: ["Grund für den Fristablauf", "Der Eigentümer hat die Anfrage nicht innerhalb der Frist bestätigt.", "Die Zahlung wurde nicht innerhalb der Frist abgeschlossen.", "Der Grund für den Fristablauf ist nicht verfügbar."],
  pl: ["Powód wygaśnięcia", "Właściciel nie zatwierdził prośby w wyznaczonym terminie.", "Płatność nie została zakończona w wyznaczonym terminie.", "Powód wygaśnięcia jest niedostępny."]
};

for (const [language, [label, ownerCopy, paymentCopy, unavailableCopy]] of Object.entries(expected)) {
  test(`history ${language} shows both expiration reasons and honest unavailable fallback`, () => {
    const history = setupHistory(language);
    for (const role of ["renter", "owner"]) {
      const ownerHtml = history.detail(sample, role);
      assert.ok(ownerHtml.includes(`<span>${label}</span><strong>${ownerCopy}</strong>`), `${language} ${role} owner`);
      const paymentHtml = history.detail({ ...sample, expiry_reason: "payment_timeout" }, role);
      assert.ok(paymentHtml.includes(`<span>${label}</span><strong>${paymentCopy}</strong>`), `${language} ${role} payment`);
      const unavailableHtml = history.detail({ ...sample, expiry_reason: null }, role);
      assert.ok(unavailableHtml.includes(`<span>${label}</span><strong>${unavailableCopy}</strong>`), `${language} ${role} unavailable`);
      assert.ok(!unavailableHtml.includes(paymentCopy), `${language} ${role} must not guess payment reason`);
      assert.ok(!history.detail({ ...sample, status: "cancelled" }, role).includes(`<span>${label}</span>`), `${language} ${role} cancelled`);
      assert.ok(!history.detail({ ...sample, status: "returned" }, role).includes(`<span>${label}</span>`), `${language} ${role} returned`);
    }
  });
}

test("R-000027 history row displays the owner timeout reason in both account tabs", () => {
  const history = setupHistory();
  history.showFor(sample, "renter-id");
  assert.match(history.rentalList.innerHTML, /R-000027/);
  assert.match(history.rentalList.innerHTML, /Majitel žádost nepotvrdil ve stanovené lhůtě\./);
  history.showFor(sample, "owner-id");
  assert.match(history.offerList.innerHTML, /R-000027/);
  assert.match(history.offerList.innerHTML, /Majitel žádost nepotvrdil ve stanovené lhůtě\./);
});

test("History reads expiry_reason from the existing safe reservation RPC without a schema change", async () => {
  assert.match(migration, /r\.expiry_reason\s+from public\.reservations r/);
  assert.match(navigation, /supabaseClient\.rpc\("get_my_reservations"\)/);
  const history = setupHistory();
  history.context.window.getRentuloReservationsData = async () => ({ data: [sample], error: null });
  const rows = await vm.runInContext("historyLoadReservations()", history.context);
  assert.equal(rows.error, null);
  assert.equal(rows.data[0].expiry_reason, "owner_no_response");
});
