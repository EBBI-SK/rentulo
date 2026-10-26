"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const GET_PIN = path.join(ROOT, "supabase", "functions", "get-pickup-pin", "index.ts");
const CONFIRM = path.join(ROOT, "supabase", "functions", "confirm-pickup", "index.ts");
const RESOLVE = path.join(ROOT, "supabase", "functions", "resolve-pickup-pin", "index.ts");
const MIGRATION = path.join(ROOT, "supabase", "migrations", "20260926120000_add_secure_pickup_pin_flow.sql");
const LOOKUP_MIGRATION = path.join(ROOT, "supabase", "migrations", "20260926143000_add_owner_pickup_pin_lookup_security.sql");
const UI = path.join(ROOT, "js", "pickup-security.js");
const CSS = path.join(ROOT, "css", "pickup-security.css");
const OFFERS_HTML = path.join(ROOT, "moje-nabidky.html");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function compact(value) {
  return value.replace(/\s+/g, " ").trim();
}

test("pickup PIN is derived server-side and never stored as plaintext", () => {
  const getPin = read(GET_PIN);
  const resolve = read(RESOLVE);
  const migration = read(MIGRATION);
  assert.match(getPin, /PICKUP_PIN_SECRET/);
  assert.match(resolve, /PICKUP_PIN_SECRET/);
  assert.match(resolve, /crypto\.subtle\.sign\("HMAC"/);
  assert.doesNotMatch(migration, /\bpin\s+(text|varchar|character varying|integer|bigint)/i);
});

test("only the renter can retrieve a PIN for a trusted paid Stripe payment", () => {
  const source = read(GET_PIN);
  assert.match(source, /reservation\.renter_id !== actor\.id/);
  assert.match(source, /reservation\.status !== "paid"/);
  assert.match(source, /payment\.provider !== "stripe"/);
  assert.match(source, /payment\.status !== "paid"/);
  assert.match(source, /stripe_payment_intent_status !== "succeeded"/);
  assert.match(source, /refund_status !== "not_requested"/);
});

test("owner PIN lookup searches only the authenticated owner's paid reservations", () => {
  const source = read(RESOLVE);
  assert.match(source, /\.eq\("owner_id", actor\.id\)/);
  assert.match(source, /\.eq\("status", "paid"\)/);
  assert.match(source, /payment\.owner_id === reservation\.owner_id/);
  assert.match(source, /payment\.provider === "stripe"/);
  assert.match(source, /payment\.stripe_payment_intent_status === "succeeded"/);
  assert.match(source, /payment\.refund_status === "not_requested"/);
});

test("owner PIN lookup returns only a reservation id after one exact PIN match", () => {
  const source = read(RESOLVE);
  assert.match(source, /if \(matches\.length === 1\)/);
  assert.match(source, /reservation_id: matches\[0\], status: "verified"/);
  assert.match(source, /timingSafeTextEqual\(pin, expectedPin\)/);
  assert.match(source, /matches\.length > 1/);
  assert.match(source, /reservation_pickup_security/);
  assert.match(source, /reservationSecurity\?\.locked_until/);
});

test("global owner PIN lookup locks after three wrong attempts for fifteen minutes", () => {
  const sql = compact(read(LOOKUP_MIGRATION));
  assert.match(sql, /failed_attempts smallint not null default 0 check \(failed_attempts between 0 and 3\)/i);
  assert.match(sql, /v_attempts := least\(v_security\.failed_attempts \+ 1, 3\)/i);
  assert.match(sql, /v_now \+ interval '15 minutes'/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /revoke all on function public\.register_failed_owner_pickup_pin\(uuid\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.register_failed_owner_pickup_pin\(uuid\) to service_role/i);
});

test("successful owner PIN lookup clears previous lookup failures", () => {
  const source = read(RESOLVE);
  assert.match(source, /from\("owner_pickup_pin_security"\)[\s\S]*\.delete\(\)[\s\S]*\.eq\("owner_id", actor\.id\)/);
});

test("owner confirmation accepts exactly six digits and verifies owner identity", () => {
  const source = read(CONFIRM);
  assert.match(source, /\^\\d\{6\}\$/);
  assert.match(source, /reservation\.owner_id !== actor\.id/);
  assert.match(source, /reservation\.status !== "paid"/);
});

test("successful pickup consumes PIN state and atomically changes paid to picked_up", () => {
  const sql = compact(read(MIGRATION));
  assert.match(sql, /status = 'picked_up'/i);
  assert.match(sql, /confirmed_at = v_now/i);
  assert.match(sql, /failed_attempts = 0/i);
  assert.match(sql, /locked_until = null/i);
});

test("browser can no longer directly change paid to picked_up", () => {
  const sql = compact(read(MIGRATION));
  assert.match(sql, /auth\.role\(\) = 'service_role'/i);
  assert.match(sql, /current_setting\('app\.pickup_pin_authorized', true\) = 'on'/i);
});

test("successful pickup consumes PIN but never initiates a Stripe transfer", () => {
  const source = read(CONFIRM);
  assert.match(source, /admin\.rpc\("confirm_reservation_pickup"/);
  assert.doesNotMatch(source, /\/functions\/v1\/create-owner-transfer/);
  assert.match(source, /transfer_status: "not_created"/);
  assert.match(source, /status: "picked_up"/);
});

test("owner enters PIN on homepage only, with a single accessible modal", () => {
  const offersHtml = read(OFFERS_HTML);
  const homeHtml = read(path.join(ROOT, "index.html"));
  const source = read(UI);
  assert.doesNotMatch(offersHtml, /id="pickupHandoffEntry"/);
  for (const id of ["homePinModal", "homePinForm", "homePinInput", "homePinSubmit"]) {
    assert.match(homeHtml, new RegExp('id="'+id+'"'));
  }
  assert.match(source, /invoke\("resolve-pickup-pin", \{ pin: pin \}\)/);
  assert.match(source, /sessionStorage\.setItem\(HANDOFF_SESSION_KEY/);
  assert.match(source, /sessionStorage\.removeItem\(HANDOFF_SESSION_KEY/);
  assert.doesNotMatch(source, /localStorage\.setItem\(HANDOFF_SESSION_KEY/);
  assert.doesNotMatch(homeHtml, /id="pickupHandoffEntry"/);
});

test("paid handover button is enabled only for the verified matching owner row", () => {
  const source = read(UI);
  const css = read(CSS);
  assert.match(source, /const isVerified = Boolean\(card && verifiedPin && activeOwnerHandoff &&/);
  assert.match(source, /reservationId === verifiedReservationId && !ownerIsOffline\(\)/);
  assert.match(source, /button\.hidden = !isVerified/);
  assert.match(source, /button\.classList\.add\("pickup-confirm-ready"\)/);
  assert.match(source, /card\.scrollIntoView/);
  assert.match(css, /data-offers-action="mark-picked-up"\]\[hidden\]/);
  assert.doesNotMatch(source, /showMatchedReservation/);
});

test("owner PIN navigation consumes short-lived proof and revalidates it on arrival", () => {
  const source = read(UI);
  assert.match(source, /HANDOFF_SESSION_TTL_MS = 90 \* 1000/);
  assert.match(source, /consumeOwnerHandoff\(\)/);
  assert.match(source, /window\.location\.hash !== "#handoff-" \+ session\.reservationId/);
  assert.match(source, /user\.id !== session\.ownerId/);
  assert.match(source, /invoke\("resolve-pickup-pin", \{ pin: session\.pin \}\)/);
  assert.match(source, /checked\.data\.reservation_id === session\.reservationId/);
  assert.doesNotMatch(source, /window\.location\.assign\([^\n]*pin[:=]/);
  assert.match(source, /verifiedReservationId = session\.reservationId/);
});

test("mobile pickup handoff copy does not keep the desktop flex basis as vertical height", () => {
  const css = read(CSS);
  assert.match(
    css,
    /@media \(max-width: 720px\)[\s\S]*\.pickup-handoff-copy\s*\{[\s\S]*flex:\s*0 0 auto;[\s\S]*width:\s*100%;/
  );
});

test("final handover requires an explicit Předat věc click after PIN verification", () => {
  const source = read(UI);
  assert.match(source, /confirmAction: "Předat věc"/);
  assert.match(source, /reservationId !== verifiedReservationId/);
  assert.match(source, /invoke\("confirm-pickup", \{[\s\S]*reservation_id: reservationId,[\s\S]*pin: verifiedPin/);
});

test("pickup UI supports all five languages", () => {
  const source = read(UI);
  for (const language of ["cs", "sk", "en", "de", "pl"]) {
    assert.match(source, new RegExp("\\b" + language + ": \\{"));
  }
});

test("offers pickup refresh remains coalesced and idempotent", () => {
  const source = read(UI);
  assert.match(source, /let ownerPickupRefreshScheduled = false/);
  assert.match(source, /if \(ownerPickupRefreshScheduled\) return/);
  assert.match(source, /window\.requestAnimationFrame\(function \(\) \{/);
  assert.match(source, /if \(button\.textContent !== text\("confirmAction"\)\)/);
  assert.match(source, /new MutationObserver\(scheduleOwnerPickupRefresh\)/);
  assert.doesNotMatch(source, /attributeFilter:\s*\["class"\]/);
});


test("verified owner PIN survives refresh, reconnects safely and clears after handover", async () => {
  const reservationId = "11111111-1111-4111-8111-111111111111";
  const ownerId = "22222222-2222-4222-8222-222222222222";
  const pin = "123456";
  const time = { now: Date.parse("2026-10-24T14:00:00Z") };
  const sessionStorage = new Map([
    ["rentuloVerifiedPickupHandoff", JSON.stringify({
      reservationId, ownerId, pin, createdAt: time.now
    })]
  ]);
  const serverCalls = [];

  function makePage(online = true) {
    const handlers = { window: {}, document: {} };
    const frames = [];
    const timers = new Map();
    let timerCounter = 0;
    const classList = { add() {}, remove() {}, toggle() {} };
    const card = { classList, scrollIntoView() {} };
    const button = {
      hidden: true, isConnected: true, disabled: false, textContent: "",
      dataset: { reservationId }, classList, focus() {},
      closest(selector) { return selector === ".owner-reservation-card" ? card : null; }
    };
    const message = { textContent: "", classList };
    const offersList = {};
    const window = {
      navigator: { onLine: online },
      location: { hash: "#handoff-" + reservationId, replace() {} },
      getRentuloLanguage() { return "cs"; },
      getSupabaseClient() {
        return { functions: { async invoke(name, { body }) {
          serverCalls.push({ name, body });
          return { error: null, data: name === "confirm-pickup"
            ? { status: "picked_up" }
            : { status: "verified", reservation_id: reservationId } };
        } } };
      },
      sessionStorage: {
        getItem(key) { return sessionStorage.get(key) ?? null; },
        setItem(key, value) { sessionStorage.set(key, value); },
        removeItem(key) { sessionStorage.delete(key); }
      },
      addEventListener(name, listener) {
        (handlers.window[name] ||= []).push(listener);
      },
      requestAnimationFrame(callback) { frames.push(callback); },
      setTimeout(callback) { const id = ++timerCounter; timers.set(id, callback); return id; },
      clearTimeout(id) { timers.delete(id); }
    };
    const document = {
      hidden: false, documentElement: { lang: "cs" },
      getElementById(id) {
        return id === "offersList" ? offersList : id === "accountMessage" ? message : null;
      },
      querySelectorAll(selector) {
        return selector === '[data-offers-action="mark-picked-up"]' ? [button] : [];
      },
      addEventListener(name, listener) {
        (handlers.document[name] ||= []).push(listener);
      }
    };
    const FakeDate = class extends Date { static now() { return time.now; } };
    vm.runInNewContext(read(UI), {
      document, window, Date: FakeDate,
      getCurrentSupabaseUser: async () => ({ id: ownerId }),
      MutationObserver: class { observe() {} }
    });
    (handlers.document.DOMContentLoaded || []).forEach((callback) => callback());

    return {
      window, document, button, message,
      fire(name, event = {}) {
        for (const callback of handlers.window[name] || []) callback(event);
      },
      async flush() {
        for (let i = 0; i < 5; i++) {
          await new Promise((resolve) => setImmediate(resolve));
          while (frames.length) frames.shift()();
        }
      },
      clickHandover() {
        const event = {
          target: { closest(selector) {
            return selector === '[data-offers-action="mark-picked-up"]' ? button : null;
          } },
          preventDefault() {}, stopImmediatePropagation() {}
        };
        (handlers.document.click || []).forEach((callback) => callback(event));
      },
      runExpiry() {
        for (const callback of [...timers.values()]) callback();
      }
    };
  }

  const firstPage = makePage();
  await firstPage.flush();
  assert.equal(firstPage.button.hidden, false, "first arrival must unlock the matching paid row");
  assert.equal(sessionStorage.has("rentuloVerifiedPickupHandoff"), false);
  assert.equal(sessionStorage.has("rentuloOwnerPickupResume"), true);
  assert.equal(serverCalls.filter((call) => call.name === "resolve-pickup-pin").length, 1);

  const refreshed = makePage();
  assert.equal(refreshed.button.hidden, true, "refresh must not trust sessionStorage before server recheck");
  await refreshed.flush();
  assert.equal(refreshed.button.hidden, false, "server recheck restores action after refresh");
  assert.equal(serverCalls.filter((call) => call.name === "resolve-pickup-pin").length, 2);

  refreshed.window.navigator.onLine = false;
  refreshed.fire("offline");
  await refreshed.flush();
  assert.equal(refreshed.button.hidden, true);
  assert.match(refreshed.message.textContent, /Připojení se přerušilo/);
  assert.equal(sessionStorage.has("rentuloOwnerPickupResume"), true);

  refreshed.window.navigator.onLine = true;
  refreshed.fire("online");
  await refreshed.flush();
  assert.equal(refreshed.button.hidden, false, "server must verify again after reconnect");
  assert.equal(serverCalls.filter((call) => call.name === "resolve-pickup-pin").length, 3);

  refreshed.clickHandover();
  await refreshed.flush();
  assert.equal(serverCalls.filter((call) => call.name === "confirm-pickup").length, 1);
  assert.equal(sessionStorage.has("rentuloOwnerPickupResume"), false,
    "successful handover must clear the transient PIN");
});

test("a resumed PIN cannot stay active beyond 30 minutes", async () => {
  const source = read(UI);
  assert.match(source, /OWNER_RESUME_TTL_MS = 30 \* 60 \* 1000/);
  assert.match(source, /validOwnerHandoff\(activeOwnerHandoff, OWNER_RESUME_TTL_MS\)/);
  assert.match(source, /ownerExpiryTimer = window\.setTimeout/);
  assert.match(source, /window\.sessionStorage\.setItem\(OWNER_RESUME_KEY/);
  assert.match(source, /window\.sessionStorage\.removeItem\(OWNER_RESUME_KEY/);
  assert.match(source, /window\.addEventListener\("online"/);
  assert.match(source, /window\.addEventListener\("offline"/);
  assert.doesNotMatch(source, /window\.localStorage\.setItem\(OWNER_RESUME_KEY/);
  assert.match(source, /forgetOwnerHandoff\(\);[\s\S]*?window\.setTimeout\(function \(\) \{ window\.location\.replace/);
});
