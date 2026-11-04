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

test("reservation payment starts Stripe Checkout for the selected reservation", () => {
  const source = readReservationsPage();

  assert.match(
    source,
    /\.functions\.invoke\(\s*["']create-checkout-session["'][\s\S]*?reservation_id:\s*reservationId/
  );
  assert.match(
    source,
    /const checkoutUrl = data && typeof data\.url === ["']string["'][\s\S]*?data\.url\.trim\(\)/
  );
  assert.match(source, /window\.location\.href\s*=\s*checkoutUrl/);
});

test("reservation payment no longer marks the reservation paid from the browser", () => {
  const source = readReservationsPage();

  assert.doesNotMatch(source, /mark_my_reservation_paid_test/);
  assert.doesNotMatch(
    source,
    /sendReservationEmailSafely\(\s*reservationId\s*,\s*["']paid["']\s*\)/
  );
});

test("Stripe Checkout creation failures do not redirect the renter", () => {
  const source = readReservationsPage();

  assert.match(source, /if \(error\) \{[\s\S]*?reservations\.error\.payment[\s\S]*?return;/);
  assert.match(source, /if \(!checkoutUrl\) \{[\s\S]*?reservations\.error\.payment[\s\S]*?return;/);
});


const RESERVATION_STATUS_PATH = path.join(PROJECT_ROOT, "js", "reservation-status.js");
const TEST_RENTER_ID = "11111111-1111-4111-8111-111111111111";
const TEST_RESERVATION_ID = "22222222-2222-4222-8222-222222222222";

function makeStripeReturnHarness(statuses, options = {}) {
  const store = new Map();
  if (options.savedCheckout !== false) {
    store.set("rentuloPendingStripeCheckout", JSON.stringify({
      reservationId: TEST_RESERVATION_ID,
      userId: options.savedUserId || TEST_RENTER_ID,
      startedAt: Date.now()
    }));
  }
  const notice = {
    textContent: "", hidden: true, attributes: {},
    classList: { toggle() {} },
    setAttribute(key, value) { this.attributes[key] = value; }
  };
  const list = { innerHTML: "" };
  const queuedTimers = [];
  let readCount = 0;
  let invalidations = 0;
  let badgeRefreshes = 0;
  const historyCalls = [];
  const user = { id: TEST_RENTER_ID };
  const window = {
    __renderCount: 0, __testUser: user,
    location: {
      search: options.query || "?payment=success",
      href: "https://rentulo.eu/moje-rezervace.html" + (options.query || "?payment=success")
    },
    history: {
      state: null,
      replaceState(_state, _title, url) { historyCalls.push(url); }
    },
    sessionStorage: {
      getItem(key) { return store.get(key) || null; },
      setItem(key, value) { store.set(key, value); },
      removeItem(key) { store.delete(key); }
    },
    getRentuloLanguage() { return options.language || "cs"; },
    rentuloAuthGuard: { async requireUser() { return user; } },
    invalidateRentuloReservationsData() { invalidations += 1; },
    async refreshRentuloNotificationBadge() { badgeRefreshes += 1; },
    async getRentuloReservationsData() {
      const status = statuses[Math.min(readCount, statuses.length - 1)];
      readCount += 1;
      return { data: [{
        id: TEST_RESERVATION_ID, renter_id: TEST_RENTER_ID,
        status, offer_name: "Test Pila", total_price: 100
      }], error: null };
    },
    setTimeout(callback, ms) { queuedTimers.push({ callback, ms }); return queuedTimers.length; },
    clearTimeout() {}
  };
  const document = {
    addEventListener() {},
    getElementById(id) {
      if (id === "reservationsNotice") return notice;
      if (id === "reservationsList") return list;
      return null;
    },
    querySelectorAll() { return []; }
  };
  const context = vm.createContext({
    window, document, Date, URL, URLSearchParams,
    console: { log() {}, warn() {}, error() {} },
    getSupabaseClient() { return {
      async rpc(name) {
        if (name === "get_my_reservation_extensions") return { data: [], error: null };
        throw new Error("Unexpected RPC: " + name);
      }
    }; },
    RentuloReservationExtensions: {
      attachPaidExtensions(reservations) { return reservations; }
    },
    escapeHtml(value) { return String(value); },
    canRenterPayReservation(reservation) { return reservation.status === "approved"; },
    canRenterCancelReservation() { return false; }
  });
  vm.runInContext(fs.readFileSync(RESERVATION_STATUS_PATH, "utf8"), context);
  vm.runInContext(readReservationsPage(), context);
  vm.runInContext("renderReservations = function () { window.__renderCount += 1; };", context);

  return {
    context, window, store, notice, historyCalls, queuedTimers,
    get readCount() { return readCount; },
    get invalidations() { return invalidations; },
    get badgeRefreshes() { return badgeRefreshes; },
    async init() { await vm.runInContext("initializeReservationsPage()", context); },
    async poll() {
      await vm.runInContext("pollStripeReturnVerification(window.__testUser)", context);
    },
    blocking(id = TEST_RESERVATION_ID) {
      return vm.runInContext(`stripeReturnBlocksAction(${JSON.stringify(id)})`, context);
    }
  };
}

test("Stripe return invalidates prefetched data, waits for webhook and refreshes automatically", async () => {
  const h = makeStripeReturnHarness(["approved", "paid"]);
  await h.init();
  assert.equal(h.readCount, 1);
  assert.equal(h.invalidations, 1);
  assert.equal(h.badgeRefreshes, 0, "an unconfirmed checkout must not clear the alert");
  assert.equal(h.blocking(), true);
  assert.match(h.notice.textContent, /Ověřujeme dokončení platby/);
  assert.equal(h.queuedTimers.filter((timer) => timer.ms === 2000).length, 1);
  assert.equal(h.store.has("rentuloPendingStripeCheckout"), true);
  await h.poll();
  assert.equal(h.readCount, 2);
  assert.equal(h.invalidations, 2);
  assert.equal(h.badgeRefreshes, 1, "the alert is recalculated after the webhook confirms payment");
  assert.equal(h.blocking(), false);
  assert.equal(h.store.has("rentuloPendingStripeCheckout"), false);
  assert.deepEqual(h.historyCalls, ["/moje-rezervace.html"]);
  assert.match(h.notice.textContent, /Platba byla potvrzena/);
});

test("Stripe success URL is not treated as payment confirmation without paid server state", async () => {
  const h = makeStripeReturnHarness(["approved"]);
  await h.init();
  vm.runInContext("stripeReturnVerification.polls = STRIPE_RETURN_MAX_POLLS - 1;", h.context);
  await h.poll();
  assert.equal(h.blocking(), true);
  assert.equal(h.store.has("rentuloPendingStripeCheckout"), true);
  assert.equal(h.historyCalls.length, 0);
  assert.match(h.notice.textContent, /Neplaťte znovu/);
  assert.doesNotMatch(h.notice.textContent, /Platba byla potvrzena/);
  assert.equal(h.badgeRefreshes, 0);
});

test("already completed webhook is recognized on the first fresh read", async () => {
  const h = makeStripeReturnHarness(["paid"]);
  await h.init();
  assert.equal(h.readCount, 1);
  assert.equal(h.blocking(), false);
  assert.equal(h.queuedTimers.filter((timer) => timer.ms === 2000).length, 0);
  assert.equal(h.badgeRefreshes, 1);
  assert.match(h.notice.textContent, /Platba byla potvrzena/);
});

test("cancelled Stripe Checkout does not start confirmation polling", async () => {
  const h = makeStripeReturnHarness(["approved"], { query: "?payment=cancelled" });
  await h.init();
  assert.equal(h.invalidations, 0);
  assert.equal(h.blocking(), false);
  assert.equal(h.store.has("rentuloPendingStripeCheckout"), false);
  assert.equal(h.queuedTimers.filter((timer) => timer.ms === 2000).length, 0);
  assert.equal(h.badgeRefreshes, 0);
});

test("expired reservation clears the stale payment alert only after server confirmation", async () => {
  const h = makeStripeReturnHarness(["approved", "expired"]);
  await h.init();
  assert.equal(h.badgeRefreshes, 0);
  await h.poll();
  assert.equal(h.badgeRefreshes, 1);
  assert.equal(h.blocking(), false);
  assert.match(h.notice.textContent, /Stav platby se nepodařilo potvrdit/);
});

test("Stripe return with missing or different-user session never claims an unrelated payment", async () => {
  const h = makeStripeReturnHarness(["paid"], { savedUserId: "33333333-3333-4333-8333-333333333333" });
  await h.init();
  assert.equal(h.blocking("44444444-4444-4444-8444-444444444444"), true);
  assert.equal(h.historyCalls.length, 0);
  assert.match(h.notice.textContent, /Ověřujeme dokončení platby/);
});

test("Stripe return keeps each reservation's Pay action suppressed until verified", () => {
  const source = readReservationsPage();
  assert.match(source, /storeStripePendingCheckout\(reservationId, supabaseUser\.id\)/);
  assert.match(source, /const paymentAction = isPaymentRequired && !waitingForStripe/);
  assert.match(source, /function renderRenterReservationCancellationAction\(reservation\) {[\s\S]*?stripeReturnBlocksAction/);
  assert.match(source, /if \(stripeReturnBlocksAction\(reservationId\)\)/);
  assert.match(source, /stripeReturnVerification = readStripeReturnVerification\(verifiedUser\)/);
  assert.match(source, /window\.invalidateRentuloReservationsData\(\)/);
  assert.doesNotMatch(source, /window\.location\.search[^\n]*=== ?["']success/);
});


test("unconfirmed Stripe return hides Pay action on the matching reservation card", async () => {
  const h = makeStripeReturnHarness(["approved"]);
  await h.init();
  vm.runInContext(`
    renderToolThumb = function () { return ""; };
    renderReservationDetailPanel = function () { return ""; };
  `, h.context);
  const html = vm.runInContext("renderReservationCard(supabaseReservations[0])", h.context);
  assert.match(html, /Ověřujeme platbu/);
  assert.doesNotMatch(html, /data-reservations-action="pay"/);
  assert.doesNotMatch(html, /data-reservations-action="cancel"/);

  const unrelatedHtml = vm.runInContext(`renderReservationCard({
    ...supabaseReservations[0], id: "44444444-4444-4444-8444-444444444444"
  })`, h.context);
  assert.match(unrelatedHtml, /data-reservations-action="pay"/);
});
