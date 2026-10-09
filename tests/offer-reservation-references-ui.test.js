"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const i18n = read("js/i18n.js");
const offers = read("js/offers-page.js");
const reservations = read("js/reservations-page.js");
const history = read("js/history-page.js");
const detail = read("js/detail-page.js");
const email = read("supabase/functions/send-reservation-email/index.ts");
const expected = {
  cs: ["Číslo nabídky", "Číslo rezervace"],
  sk: ["Číslo ponuky", "Číslo rezervácie"],
  en: ["Listing number", "Reservation number"],
  de: ["Angebotsnummer", "Reservierungsnummer"],
  pl: ["Numer oferty", "Numer rezerwacji"]
};

function extractFunction(source, name, next) {
  const start = source.indexOf("function " + name + "(");
  assert.ok(start >= 0, "Missing function: " + name);
  const end = source.indexOf(next, start);
  assert.ok(end > start, "Missing function boundary after: " + name);
  return vm.runInNewContext("(" + source.slice(start, end).trim() + ")", {
    Number, String, Boolean,
    PLATFORM_FEE_PERCENT: 10,
    RESERVATION_STATUS_PENDING: "pending",
    RESERVATION_STATUS_APPROVED: "approved",
    RESERVATION_STATUS_PAID: "paid",
    RESERVATION_STATUS_PICKED_UP: "picked_up",
    getSafeReservationStatus: (row) => row.status || "pending",
    normalizeReservationStatus: (value) => value,
    getSafeReservationContactVisible: () => false,
    getSafeReservationStatusText: () => "Čeká na potvrzení",
    getSafeReservationToolName: (row) => row.toolName,
    getPickupCity: () => "Praha",
    getSafeReservationOfferId: (row) => row.offerId,
    getSafeReservationTotalPrice: (row) => row.totalPrice || 0,
    getSafeReservationDateFrom: (row) => row.startDate,
    getSafeReservationDateTo: (row) => row.endDate,
    formatReservationsMoney: (value) => value + " Kč",
    formatReservationsDate: (value) => value,
    getReservationScheduleCopy: () => ({ pickup: "Převzetí", return: "Vrácení" }),
    formatReservationScheduleValue: (date) => date,
    renderReservationStateBox: () => "",
    renderPaymentBox: () => "",
    renderContactBox: () => "",
    renderToolThumb: () => "",
    renderRenterReservationCancellationAction: () => "",
    reservationsTranslate: (key, fallback) => ({
      "reference.offer": "Číslo nabídky",
      "reference.reservation": "Číslo rezervace"
    }[key] || fallback),
    escapeHtml: (value) => String(value ?? "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
  });
}

test("all five frontend and email languages define matching reference labels", () => {
  const locales = Object.keys(expected);
  for (let index = 0; index < locales.length; index += 1) {
    const language = locales[index];
    const [offerLabel, reservationLabel] = expected[language];
    const start = i18n.indexOf('"' + language + '": {');
    const end = index + 1 === locales.length
      ? i18n.length
      : i18n.indexOf('"' + locales[index + 1] + '": {', start);
    assert.ok(start > -1 && end > start);
    const block = i18n.slice(start, end);
    assert.ok(block.includes('"reference.offer": "' + offerLabel + '"'));
    assert.ok(block.includes('"reference.reservation": "' + reservationLabel + '"'));
    assert.ok(email.includes('  ' + language + ': { offer: "' + offerLabel + '", reservation: "' + reservationLabel + '" }'));
  }
});

test("owner listing and requests normalize and render database reference fields", () => {
  const normalOffer = extractFunction(offers, "normalizeOffer", "function normalizeReservation");
  const normalReservation = extractFunction(offers, "normalizeReservation", "async function loadOwnerData");
  const row = { id: "uuid-offer", offer_number: "N-000002", owner_id: "owner" };
  const offer = normalOffer(row);
  const reservation = normalReservation({ id: "uuid-reservation", offer_id: row.id,
    reservation_number: "R-000011", offer_number: "N-000002" });
  assert.equal(offer.id, "uuid-offer");
  assert.equal(offer.offerNumber, "N-000002");
  assert.equal(reservation.id, "uuid-reservation");
  assert.equal(reservation.offerId, "uuid-offer");
  assert.equal(reservation.reservationNumber, "R-000011");
  assert.equal(reservation.offerNumber, "N-000002");
  assert.match(offers, /simple-offer-meta[^\n]*offer\.offerNumber/);
  assert.match(offers, /request-email[^\n]*reservation\.reservationNumber/);
  assert.match(offers, /escapeHtml\(offer\.offerNumber\)/);
  assert.match(offers, /escapeHtml\(reservation\.reservationNumber\)/);
  assert.match(offers, /data-offers-action="toggle-request-detail" data-reservation-id="\$\{escapeHtml\(reservationId\)\}"/);
});

test("renter list and detail show immutable labels while actions still use UUID", () => {
  const normalize = extractFunction(reservations, "normalizeSupabaseReservation", "async function loadMyReservationsFromSupabase");
  const row = normalize({ id: "uuid-r", offer_id: "uuid-o", reservation_number: "R-000011", offer_number: "N-000002", status: "pending" });
  assert.equal(row.reservationId, "uuid-r");
  assert.equal(row.offerId, "uuid-o");
  assert.equal(row.reservationNumber, "R-000011");
  assert.equal(row.offerNumber, "N-000002");
  assert.match(reservations, /simple-reservation-info[\s\S]*?reservation\.reservationNumber/);
  assert.match(reservations, /data-reservations-action="toggle-detail" data-reservation-id="\$\{escapeHtml\(reservationId\)\}"/);
  assert.match(reservations, /detail\.html\?id=\$\{encodeURIComponent\(offerId\)\}/);

  const render = extractFunction(reservations, "renderReservationDetailPanel", "function renderReservationCard");
  const html = render({ status: "pending", totalPrice: 250, startDate: "2026-10-15", endDate: "2026-10-16",
    reservationNumber: "R-000011<script>", offerNumber: "N-000002&" });
  assert.match(html, /Číslo rezervace<\/span><strong>R-000011&lt;script&gt;<\/strong>/);
  assert.match(html, /Číslo nabídky<\/span><strong>N-000002&amp;<\/strong>/);
  assert.doesNotMatch(html, /<script>/);
});

test("history shows reference on each row and both references in detail", () => {
  assert.match(history, /function historyRenderRow[\s\S]*?reservation\.reservation_number/);
  assert.match(history, /function historyRenderDetail[\s\S]*?historyT\("reference\.reservation"/);
  assert.match(history, /function historyRenderDetail[\s\S]*?historyT\("reference\.offer"/);
  assert.match(history, /escapeHtml\(reservation\.reservation_number\)/);
  assert.match(history, /escapeHtml\(reservation\.offer_number\)/);
  assert.match(history, /historyGetReservationId\(reservation\)/);
});

test("public offer detail displays only existing public offer reference", () => {
  assert.match(detail, /function normalizeSupabaseOffer\(row\)[\s\S]*?offerNumber: row\.offer_number \|\| ""/);
  assert.match(detail, /offer\.offerNumber\s*\?[^\n]*escapeHtml\(offer\.offerNumber\)/);
  assert.match(detail, /\.from\("public_offers"\)/);
  assert.match(detail, /\.eq\("id", offerId\)/);
});

test("all reservation notification emails include both safely escaped references", () => {
  assert.match(email, /\.select\("id, offer_id, owner_id, renter_id, offer_name, start_date, end_date, status, reservation_number"\)/);
  assert.match(email, /\.from\("offers"\)\s*\.select\("offer_number"\)\s*\.eq\("id", reservation\.offer_id\)\s*\.single\(\)/);
  assert.match(email, /Offer reference lookup failed/);
  assert.match(email, /escapeHtml\(referenceLabels\[language\]\.reservation\)/);
  assert.match(email, /escapeHtml\(referenceLabels\[language\]\.offer\)/);
  assert.match(email, /escapeHtml\(reservation\.reservation_number\)/);
  assert.match(email, /escapeHtml\(offerReference\.offer_number\)/);
  const refPosition = email.indexOf('escapeHtml(referenceLabels[language].reservation)');
  const standardEmailHtml = email.indexOf('const html = `');
  assert.ok(refPosition > standardEmailHtml, "both references are part of the email HTML for all events");
  assert.match(email, /const recipientIsOwner = profile\.id === reservation\.owner_id;/);
  assert.match(email, /if \(event === "paid_cancelled"\)/);
});
