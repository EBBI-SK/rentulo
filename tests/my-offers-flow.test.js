"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const FLOW = path.join(ROOT, "js", "my-offers-flow.js");
const OFFERS_PAGE = path.join(ROOT, "js", "offers-page.js");
const I18N = path.join(ROOT, "js", "i18n.js");
const CSS = path.join(ROOT, "css", "my-offers-flow.css");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

test("My offers separates reservations from listing rows", () => {
  const source = read(FLOW);

  assert.match(source, /owner-reservations-section/);
  assert.match(source, /owner-reservations-list/);
  assert.match(source, /reservationCards\.push\(card\)/);
  assert.match(source, /panel\.remove\(\)/);
  assert.match(source, /owner-offer-request-summary/);
});

test("My offers keeps a hidden paid handover action available for the verified PIN flow", () => {
  const source = read(FLOW);
  const pickupStart = source.indexOf('card.querySelectorAll(\'[data-offers-action="mark-picked-up"]\')');
  const pickupBlock = source.slice(pickupStart, pickupStart + 220);

  assert.ok(pickupStart >= 0);
  assert.match(pickupBlock, /button\.hidden = true/);
  assert.doesNotMatch(pickupBlock, /button\.remove\(\)/);
  assert.ok(source.includes('data-offers-action="mark-returned"'));
});

test("My offers simple flow supports all five languages and mobile layout", () => {
  const source = read(FLOW);
  const offersPage = read(OFFERS_PAGE);
  const i18n = read(I18N);
  const css = read(CSS);

  for (const language of ["cs", "sk", "en", "de", "pl"]) {
    assert.match(source, new RegExp("\\b" + language + ": \\{"));
  }

  assert.match(source, /Spravovat nabídku/);
  assert.match(source, /Žádosti a rezervace/);
  assert.match(offersPage, /Po skutečném vrácení potvrďte vrácení v Rentulu/);
  assert.match(i18n, /After the item is actually returned, confirm its return in Rentulo/);
  assert.match(i18n, /Bestätigen Sie nach der tatsächlichen Rückgabe die Rückgabe bei Rentulo/);
  assert.match(i18n, /Po faktycznym zwrocie potwierdź zwrot w Rentulo/);
  assert.doesNotMatch(i18n, /Věc byla předána zájemci\. Až ji dostanete zpět/);
  assert.match(css, /\.owner-offer-row/);
  assert.match(css, /\.owner-reservation-card/);
  assert.match(css, /@media \(max-width: 560px\)/);
});

test("My offers prioritizes decisions, returns and PIN handovers before waiting for payment", () => {
  const { priorityForStatus, compareReservationData } = require(FLOW);
  const statuses = ["approved", "paid", "picked_up", "pending"];
  const result = statuses.map((status) => ({ status, date: "2026-10-25", number: status }))
    .sort(compareReservationData)
    .map((entry) => entry.status);
  assert.deepEqual(result, ["pending", "picked_up", "paid", "approved"]);
  assert.ok(priorityForStatus("approved") > priorityForStatus("paid"));
  assert.deepEqual([
    { status: "pending", date: "2026-10-29" },
    { status: "pending", date: "2026-10-23" }
  ].sort(compareReservationData).map((entry) => entry.date), ["2026-10-23", "2026-10-29"]);
});

test("My offers search matches reservation number, offer number, renter and name regardless of accents", () => {
  const { matchesReservation } = require(FLOW);
  const item = {
    status: "pending", number: "R-000040", offerNumber: "N-000001",
    offer: "Test Pila", renter: "Ji\u0159\u00ed \u010Cern\u00fd"
  };
  for (const query of ["R-000040", "r-000040", "N-000001", "test pila", "jiri cerny"]) {
    assert.equal(matchesReservation(item, query, "all"), true, `Expected match for ${query}`);
  }
  assert.equal(matchesReservation(item, "R-000040", "paid"), false);
  assert.equal(matchesReservation(item, "unknown", "pending"), false);
  assert.equal(matchesReservation(item, "", "pending"), true);
});

test("My offers renders action-first rows, a five-language filter and a separate history link", () => {
  const flow = read(FLOW);
  const page = read(OFFERS_PAGE);
  const css = read(CSS);
  assert.match(flow, /root\.insertBefore\(section, offersHeader\)/);
  assert.match(flow, /ATTENTION_STATUSES = new Set\(\["pending", "picked_up", "paid"\]\)/);
  assert.match(flow, /createReservationToolbar\(/);
  assert.match(flow, /ownerReservationSearch/);
  assert.match(flow, /ownerReservationStatus/);
  assert.match(flow, /statusFilter = FILTER_STATUSES\.includes/);
  assert.match(flow, /historyLink\.href = "historie\.html"/);
  assert.match(flow, /owner-reservation-card/);
  assert.match(page, /data-owner-status="\$\{escapeHtml\(normalizeReservationStatus\(status\)\)\}"/);
  assert.match(page, /data-owner-number="\$\{escapeHtml\(reservation\.reservationNumber \|\| ""\)\}"/);
  assert.match(page, /data-owner-offer-number="\$\{escapeHtml\(offer\.offerNumber \|\| ""\)\}"/);
  assert.match(css, /\.owner-reservation-card\[hidden\]/);
  assert.match(css, /grid-template-columns: minmax\(235px, 1\.6fr\) minmax\(160px, 180px\) minmax\(110px, 130px\) minmax\(185px, auto\)/);
  assert.match(css, /\.owner-reservations-toolbar/);
  assert.match(css, /@media \(max-width: 560px\)/);

  for (const lang of ["cs", "sk", "en", "de", "pl"]) {
    assert.match(flow, new RegExp(`\\b${lang}: \\{`));
  }
});

test("Reservation detail uses a compact financial summary and retains contact, notes, actions and PIN", () => {
  const flow = read(FLOW);
  const page = read(OFFERS_PAGE);
  const css = read(CSS);
  const start = page.indexOf("function renderRequestDetailContent(");
  const end = page.indexOf("function renderOwnerRequestDeadline(", start);
  const detail = page.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(detail, /class="owner-payment-summary"/);
  assert.doesNotMatch(detail, /class="money-cell"/);
  assert.match(detail, /offers\.detail\.customerPrice/);
  assert.match(detail, /offers\.detail\.fee/);
  assert.match(detail, /offers\.detail\.ownerReceives/);
  assert.match(detail, /renderReservationContactBlock\(reservation\)/);
  assert.match(detail, /renderRequestNote\(status\)/);
  assert.match(page, /data-offers-action="report-return-missing"/);
  assert.match(page, /data-offers-action="mark-returned"/);
  assert.match(flow, /button\.hidden = true/);
  assert.match(css, /\.owner-payment-summary/);
});

test("My offers shows listings first unless an existing reservation needs owner attention", () => {
  const { shouldShowReservationsFirst } = require(FLOW);
  assert.equal(shouldShowReservationsFirst([]), false);
  assert.equal(shouldShowReservationsFirst(["approved"]), false);
  assert.equal(shouldShowReservationsFirst(["pending"]), true);
  assert.equal(shouldShowReservationsFirst(["picked_up"]), true);
  assert.equal(shouldShowReservationsFirst(["paid"]), true);
  assert.equal(shouldShowReservationsFirst(["approved", "pending"]), true);

  const flow = read(FLOW);
  assert.match(flow, /if \(shouldShowReservationsFirst\(reservationCards\.map/);
  assert.match(flow, /root\.insertBefore\(section, offersHeader\)/);
  assert.match(flow, /root\.insertBefore\(section, offersList\.nextSibling\)/);
});

test("My offers hides zero-reservation search and filter, with a compact empty message and history link", () => {
  const flow = read(FLOW);
  const css = read(CSS);

  assert.match(flow, /toolbar\.hidden = reservationCards\.length === 0/);
  assert.match(flow, /if \(toolbar\) toolbar\.hidden = total === 0/);
  assert.match(css, /\.owner-reservations-toolbar\[hidden\] \{ display: none !important; \}/);
  assert.match(flow, /Zatím nemáte žádné aktivní rezervace/);
  assert.match(flow, /Aktivní rezervace/);
  assert.match(flow, /header\.appendChild\(historyLink\)/);
  assert.doesNotMatch(flow, /completedTitle = document\.createElement/);
  for (const language of ["cs", "sk", "en", "de", "pl"]) {
    const entry = flow.match(new RegExp(`\\b${language}: \\{\\n\\s+activeReservations:`));
    assert.ok(entry, `Zero-reservation heading should be translated into ${language}`);
  }
});

test("My offers opens existing public detail from the active offer photo and name, not the manage menu", () => {
  const flow = read(FLOW);
  const page = read(OFFERS_PAGE);
  const css = read(CSS);

  assert.match(flow, /const detailLink = actions\.querySelector/);
  assert.match(flow, /if \(detailLink\) \{/);
  assert.match(flow, /photoLink\.href = href/);
  assert.match(flow, /titleLink\.href = href/);
  assert.match(flow, /detailLink\.remove\(\)/);
  assert.match(flow, /owner-offer-photo-link/);
  assert.match(flow, /owner-offer-title-link/);
  assert.match(page, /isActive \? `<a href="detail\.html\?id=/);
  assert.match(css, /owner-offer-detail-link:focus-visible/);
});


test("My offers reservation toolbar is compact on desktop and full-width on mobile", () => {
  const css = read(CSS);
  assert.match(css, /\.owner-reservations-toolbar \{\s*display: grid;\s*grid-template-columns: minmax\(0, 320px\) minmax\(0, 180px\);/);
  assert.match(css, /@media \(max-width: 560px\) \{[\s\S]*?\.owner-reservations-toolbar \{ grid-template-columns: 1fr; \}/);
});

test("My offers shows minimum fee text only when the 70 CZK floor increases the 10 percent fee", () => {
  const vm = require("node:vm");
  const page = read(OFFERS_PAGE);
  const i18n = read(I18N);
  const prefixEnd = page.indexOf("function formatOffersMoneyPerDay(");
  assert.ok(prefixEnd > 0);
  const isMinimum = vm.runInNewContext(page.slice(0, prefixEnd) + "\nisMinimumPlatformFeeApplied");

  assert.equal(isMinimum(150, 70, 10), true);
  assert.equal(isMinimum(400, 70, 10), true);
  assert.equal(isMinimum(694, 70, 10), true); // 10% rounds to 69 CZK.
  assert.equal(isMinimum(695, 70, 10), false); // 10% already rounds to 70 CZK.
  assert.equal(isMinimum(700, 70, 10), false);
  assert.equal(isMinimum(800, 80, 10), false);
  assert.equal(isMinimum(150, 60, 10), false);
  assert.equal(isMinimum(0, 70, 10), false);

  const start = page.indexOf("function renderRequestDetailContent(");
  const end = page.indexOf("function renderOwnerRequestDeadline(", start);
  const detail = page.slice(start, end);
  assert.match(detail, /const minimumFeeNote = isMinimumPlatformFeeApplied\(price, platformFee, reservation\.platformFeePercent\)/);
  assert.match(detail, /offers\.detail\.minimumFee/);
  assert.match(detail, /\$\{minimumFeeNote\}/);
  const expected = ["minimální provize", "minimálna provízia", "minimum fee", "Mindestgebühr", "minimalna prowizja"];
  for (const translated of expected) {
    assert.ok(i18n.includes('"offers.detail.minimumFee": "' + translated + '"'), translated);
  }
});


test("My offers keeps active reservation rows free of financial amounts and preserves paid contacts", () => {
  const vm = require("node:vm");
  const page = read(OFFERS_PAGE);
  const start = page.indexOf("function renderRequest(reservation)");
  const end = page.indexOf("function toggleRequestDetail(", start);
  assert.ok(start >= 0 && end > start);
  const render = vm.runInNewContext("(" + page.slice(start, end).trim() + ")", {
    getStatusText: (status) => status,
    offersTranslate: (_key, fallback) => fallback,
    canShowContact: (status) => status === "paid" || status === "picked_up",
    escapeHtml: (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    normalizeReservationStatus: (status) => status,
    formatOffersMoney: (amount) => amount + " Kč",
    formatOffersDate: (date) => date,
    calculatePlatformFee: (price) => Math.max(50, Math.round(price * 0.1)),
    renderRequestActions: () => "<button>Akce</button>",
    renderOwnerRequestDeadline: () => "",
    getRequestStatusClass: () => "paid",
    renderReservationContactBlock: (r) => r.status === "paid" || r.status === "picked_up"
      ? `<aside class="owner-reservation-contacts">${r.renterPhone}|${r.renterEmail}</aside>` : ""
  });
  const reservation = { id: "uuid-test", reservationNumber: "R-000041", renterName: "Jan",
    renterEmail: "jan@example.cz", renterPhone: "+420777123456", status: "pending",
    totalPrice: 150, platformFeeAmount: 50, ownerPayout: 100,
    startDate: "2026-10-26", endDate: "2026-10-27" };
  const pending = render(reservation);
  assert.doesNotMatch(pending, /Vy dostanete/);
  assert.doesNotMatch(pending, /100 Kč/);
  assert.doesNotMatch(pending, /150 Kč/);
  assert.doesNotMatch(pending, /data-offers-action="toggle-request-detail"/);
  assert.doesNotMatch(pending, /jan@example\.cz/);
  assert.doesNotMatch(pending, /\+420777123456/);
  const paid = render({ ...reservation, status: "paid" });
  assert.match(paid, /owner-reservation-contacts/);
  assert.match(paid, /jan@example\.cz/);
  assert.match(paid, /\+420777123456/);
});

test("My offers gates contact block on existing payment-verified visibility rule", () => {
  const vm = require("node:vm");
  const page = read(OFFERS_PAGE);
  const start = page.indexOf("function renderReservationContactBlock(reservation)");
  const end = page.indexOf("function renderRequestDetailContent(", start);
  assert.ok(start >= 0 && end > start);
  const contact = vm.runInNewContext("(" + page.slice(start, end).trim() + ")", {
    canShowContact: (status) => ["paid", "picked_up", "returned"].includes(status),
    offersTranslate: (_key, fallback) => fallback,
    escapeHtml: (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  });
  for (const status of ["pending", "approved"]) {
    assert.equal(contact({ status, renterPhone: "+420111", renterEmail: "secret@example.cz" }), "");
  }
  const paid = contact({ status: "paid", renterPhone: "+420111", renterEmail: "hello@example.cz" });
  assert.match(paid, /Telefon/);
  assert.match(paid, /E-mail/);
  assert.match(paid, /\+420111/);
  assert.match(paid, /hello@example\.cz/);
  assert.match(paid, /owner-reservation-contacts/);
  const injection = contact({ status: "paid", renterPhone: "<script>alert(1)</script>", renterEmail: "x&y" });
  assert.doesNotMatch(injection, /<script>/);
  assert.match(injection, /&lt;script&gt;/);
  assert.match(injection, /x&amp;y/);
});

test("My offers shows one action in the matched reservation after homepage PIN verification", () => {
  const flow = read(FLOW);
  const page = read(OFFERS_PAGE);
  const pickup = read(path.join(ROOT, "js", "pickup-security.js"));
  const ownerHtml = read(path.join(ROOT, "moje-nabidky.html"));
  assert.doesNotMatch(flow, /data-owner-open-pickup/);
  assert.doesNotMatch(ownerHtml, /id="pickupHandoffEntry"/);
  assert.match(page, /hidden data-offers-action="mark-picked-up" data-reservation-id="\$\{escapeHtml\(reservationId\)\}"/);
  assert.match(pickup, /consumeOwnerHandoff\(\)/);
  assert.match(pickup, /card\.scrollIntoView/);
  assert.match(pickup, /reservationId === verifiedReservationId/);
  assert.match(pickup, /confirmVerifiedPickup\(button\)/);
  assert.match(pickup, /invoke\("confirm-pickup", \{/);
  assert.doesNotMatch(flow, /invoke\("confirm-pickup"/);
});

test("My offers labels existing return action and paid handover in all five languages", () => {
  const flow = read(FLOW);
  const page = read(OFFERS_PAGE);
  const translations = ["Předat věc", "Převzít zpět", "Odovzdať vec", "Prevziať späť",
    "Hand over item", "Receive item back", "Gegenstand übergeben", "Gegenstand zurücknehmen",
    "Przekaż przedmiot", "Odbierz przedmiot z powrotem"];
  for (const label of translations) assert.ok(flow.includes(label), label);
  assert.match(flow, /receiveBack\.textContent = label\("receiveBack"\)/);
  assert.match(flow, /data-offers-action="mark-returned"/);
  assert.match(page, /data-offers-action="mark-returned" data-reservation-id="\$\{escapeHtml\(reservationId\)\}"/);
});
