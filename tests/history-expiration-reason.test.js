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

// Exact role-by-role copy, including five language variants and unknown reasons.
const expected = {
  cs: { label: "Důvod vypršení", renterPending: "Majitel žádost nepotvrdil ve stanovené lhůtě.", ownerPending: "Žádost jste nepotvrdili ve stanovené lhůtě.", renterPayment: "Platbu jste nedokončili ve stanovené lhůtě.", ownerPayment: "Zájemce nedokončil platbu ve stanovené lhůtě.", unknown: "Důvod vypršení není k dispozici." },
  sk: { label: "Dôvod vypršania", renterPending: "Majiteľ žiadosť nepotvrdil v stanovenej lehote.", ownerPending: "Žiadosť ste nepotvrdili v stanovenej lehote.", renterPayment: "Platbu ste nedokončili v stanovenej lehote.", ownerPayment: "Záujemca nedokončil platbu v stanovenej lehote.", unknown: "Dôvod vypršania nie je k dispozícii." },
  en: { label: "Reason for expiration", renterPending: "The owner did not approve the request within the deadline.", ownerPending: "You did not approve the request before the deadline.", renterPayment: "You did not complete the payment before the deadline.", ownerPayment: "The renter did not complete the payment before the deadline.", unknown: "The reason for expiration is unavailable." },
  de: { label: "Grund für den Fristablauf", renterPending: "Der Eigentümer hat die Anfrage nicht innerhalb der Frist bestätigt.", ownerPending: "Sie haben die Anfrage nicht fristgerecht bestätigt.", renterPayment: "Sie haben die Zahlung nicht fristgerecht abgeschlossen.", ownerPayment: "Der Mieter hat die Zahlung nicht fristgerecht abgeschlossen.", unknown: "Der Grund für den Fristablauf ist nicht verfügbar." },
  pl: { label: "Powód wygaśnięcia", renterPending: "Właściciel nie zatwierdził prośby w wyznaczonym terminie.", ownerPending: "Nie udało Ci się zatwierdzić prośby w wyznaczonym terminie.", renterPayment: "Nie udało Ci się dokończyć płatności w wyznaczonym terminie.", ownerPayment: "Najemca nie dokończył płatności w wyznaczonym terminie.", unknown: "Powód wygaśnięcia jest niedostępny." }
};

for (const [language, copy] of Object.entries(expected)) {
  test(`history ${language} renders the correct perspective for both expiration reasons`, () => {
    const history = setupHistory(language);
    for (const role of ["renter", "owner"]) {
      const pendingText = role === "owner" ? copy.ownerPending : copy.renterPending;
      const paymentText = role === "owner" ? copy.ownerPayment : copy.renterPayment;
      const otherPendingText = role === "owner" ? copy.renterPending : copy.ownerPending;
      const otherPaymentText = role === "owner" ? copy.renterPayment : copy.ownerPayment;

      for (const [reason, expectedText, otherText] of [
        ["owner_no_response", pendingText, otherPendingText],
        ["payment_timeout", paymentText, otherPaymentText]
      ]) {
        const html = history.detail({ ...sample, expiry_reason: reason }, role);
        assert.ok(html.includes(`<span>${copy.label}</span><strong>${expectedText}</strong>`), `${language}/${role}/${reason}`);
        assert.ok(!html.includes(`<strong>${otherText}</strong>`), `${language}/${role}/${reason} must not show the other side's message`);
      }

      for (const reason of [null, "unexpected_reason"]) {
        const unavailable = history.detail({ ...sample, expiry_reason: reason }, role);
        assert.ok(unavailable.includes(`<span>${copy.label}</span><strong>${copy.unknown}</strong>`), `${language}/${role} unknown`);
        assert.ok(!unavailable.includes(`<strong>${copy.renterPayment}</strong>`));
      }
      for (const status of ["cancelled", "returned", "rejected"]) {
        assert.ok(!history.detail({ ...sample, status }, role).includes(`<span>${copy.label}</span>`), `${language}/${role}/${status}`);
      }
    }
  });
}

test("R-000027 displays recipient-specific expiration reasons in the two history tabs", () => {
  const history = setupHistory();
  history.showFor(sample, "renter-id");
  assert.match(history.rentalList.innerHTML, /R-000027/);
  assert.match(history.rentalList.innerHTML, /Majitel žádost nepotvrdil ve stanovené lhůtě\./);
  assert.doesNotMatch(history.rentalList.innerHTML, /Žádost jste nepotvrdili/);
  history.showFor(sample, "owner-id");
  assert.match(history.offerList.innerHTML, /R-000027/);
  assert.match(history.offerList.innerHTML, /Žádost jste nepotvrdili ve stanovené lhůtě\./);
  assert.doesNotMatch(history.offerList.innerHTML, /Majitel žádost nepotvrdil/);
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
