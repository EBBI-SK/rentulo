"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (pathName) => fs.readFileSync(path.join(root, pathName), "utf8");
const sql = read("supabase/migrations/20261102090000_bod7_history_owner_finance_TEST.sql");
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const reservation = {
  id: "reservation-45", reservation_number: "R-000045", offer_number: "N-000005",
  owner_id: "owner-id", renter_id: "renter-id", status: "returned",
  start_date: "2026-10-27", end_date: "2026-10-31",
  total_price: 450, platform_fee_amount: 70, owner_payout: 380,
  offer_name: "Vrtačka"
};
const extension = {
  id: "extension-1", reservation_id: reservation.id,
  new_end_date: "2026-10-31", amount_total: 150,
  platform_fee_amount: 0, owner_payout: 150,
  status: "paid", transfer_status: "succeeded"
};
const evidence = {
  reservation_id: reservation.id,
  original_amount_total: 450,
  original_platform_fee_amount: 70,
  original_owner_payout: 380,
  payment_provider: "stripe",
  payment_status: "paid",
  stripe_payment_intent_status: "succeeded",
  refund_status: "not_requested",
  original_transfer_status: "succeeded",
  payout_blocked: false
};

function harness({
  language = "cs", userId = "owner-id", reservations = [reservation],
  extensions = [extension], financeRows = [evidence], financeError = null
} = {}) {
  const calls = [];
  const rentalList = { innerHTML: "" };
  const offerList = { innerHTML: "" };
  const client = {
    async rpc(name) {
      calls.push(name);
      if (name === "get_my_reservation_extensions") {
        return { data: extensions, error: null };
      }
      assert.equal(name, "get_my_history_owner_transfers");
      return financeError
        ? { data: null, error: financeError }
        : { data: financeRows, error: null };
    },
    from(name) {
      assert.equal(name, "reviews");
      return {
        select() { return this; },
        or() { return this; },
        async order() { return { data: [], error: null }; }
      };
    }
  };
  const context = vm.createContext({
    window: {
      getRentuloLanguage: () => language,
      getRentuloReservationsData: async () => ({ data: reservations, error: null })
    },
    document: {
      documentElement: { lang: language },
      addEventListener() {},
      getElementById(id) {
        return { rentalHistoryList: rentalList, offerHistoryList: offerList }[id] || null;
      }
    },
    getSupabaseClient: () => client,
    escapeHtml,
    console: { warn() {}, error() {} }
  });
  vm.runInContext(read("js/history-i18n.js"), context);
  vm.runInContext(read("js/history-page.js"), context);
  context.userIdForTest = userId;
  vm.runInContext("historyCurrentUser = { id: userIdForTest };", context);
  return {
    calls, context, rentalList, offerList,
    render: async () => await vm.runInContext("historyLoadData()", context)
  };
}

test("owner R-000045 sees one compact statement, not duplicate prices or transfer states", async () => {
  const app = harness();
  assert.equal(await app.render(), true);
  const html = app.offerList.innerHTML;
  assert.match(html, /Finanční vyúčtování/);
  assert.match(html, /Původní pronájem<\/span><strong>450 Kč/);
  assert.match(html, /Prodloužení<\/span><strong>\+150 Kč/);
  assert.match(html, /Celkem zaplaceno<\/span><strong>600 Kč/);
  assert.match(html, /Provize Rentulo<\/span><strong>-70 Kč/);
  assert.match(html, /Celkem k výplatě<\/span><strong>530 Kč/);
  assert.match(html, /Stav výplaty<\/span><strong>Převedeno na účet Stripe/);
  assert.equal((html.match(/Převedeno na účet Stripe/g) || []).length, 1);
  assert.equal((html.match(/Celkem zaplaceno/g) || []).length, 1);
  assert.doesNotMatch(html, /Původní cena|Celková cena|Výplata za původní pronájem|Výplata za prodloužení/);
  assert.match(html, /Číslo rezervace/);
  assert.deepEqual(app.calls, ["get_my_reservation_extensions", "get_my_history_owner_transfers"]);
});

test("a renter never sees owner-only financial rows nor requests transfer evidence", async () => {
  const app = harness({ userId: "renter-id" });
  assert.equal(await app.render(), true);
  const html = app.rentalList.innerHTML;
  assert.match(html, /Celková cena<\/span><strong>600 Kč/);
  assert.doesNotMatch(html, /history-owner-finance|Provize Rentulo|Celkem k výplatě|Převedeno na účet Stripe/);
  assert.deepEqual(app.calls, ["get_my_reservation_extensions"]);
});

test("multiple paid extensions have one total but show distinct payout statuses", async () => {
  const app = harness({ extensions: [
    extension,
    { id: "extension-2", reservation_id: reservation.id, new_end_date: "2026-11-01",
      amount_total: 200, platform_fee_amount: 15, owner_payout: 185,
      status: "paid", transfer_status: "pending" },
    { id: "pending", reservation_id: reservation.id, amount_total: 9999,
      platform_fee_amount: 999, owner_payout: 9000, status: "approved" }
  ] });
  assert.equal(await app.render(), true);
  const html = app.offerList.innerHTML;
  assert.match(html, /Prodloužení<\/span><strong>\+350 Kč/);
  assert.equal((html.match(/Prodloužení<\/span><strong>/g) || []).length, 1);
  assert.match(html, /Celkem zaplaceno<\/span><strong>800 Kč/);
  assert.match(html, /Provize Rentulo<\/span><strong>-85 Kč/);
  assert.match(html, /Celkem k výplatě<\/span><strong>715 Kč/);
  assert.equal((html.match(/Převedeno na účet Stripe/g) || []).length, 2);
  assert.match(html, /Původní převod/);
  assert.match(html, /Prodloužení do 31\.\s?10\.\s?2026/);
  assert.match(html, /Prodloužení do 1\.\s?11\.\s?2026/);
  assert.match(html, /Převod se zpracovává/);
  assert.doesNotMatch(html, /Stav výplaty|9999|9 999/);
});

test("unverified, refunded, inconsistent payment evidence cannot create a payout claim", async () => {
  const variants = [
    [],
    [{ ...evidence, payment_status: "pending" }],
    [{ ...evidence, stripe_payment_intent_status: "requires_action" }],
    [{ ...evidence, refund_status: "succeeded" }],
    [{ ...evidence, refund_status: "pending" }],
    [{ ...evidence, original_platform_fee_amount: 90 }],
    [{ ...evidence, original_owner_payout: 400 }],
    [{ ...evidence, original_amount_total: 500 }]
  ];
  for (const financeRows of variants) {
    const app = harness({ financeRows });
    assert.equal(await app.render(), true);
    const html = app.offerList.innerHTML;
    assert.match(html, /Finanční údaje se nepodařilo ověřit/);
    assert.match(html, /Původní cena<\/span><strong>450 Kč/);
    assert.match(html, /Celková cena<\/span><strong>600 Kč/);
    assert.doesNotMatch(html, /Celkem k výplatě|Převedeno na účet Stripe/);
  }
});

test("missing new SQL function does not break existing History and shows an honest warning", async () => {
  const app = harness({ financeError: { message: "function not found" } });
  assert.equal(await app.render(), true);
  assert.match(app.offerList.innerHTML, /simple-reservation-price">600 Kč/);
  assert.match(app.offerList.innerHTML, /Finanční údaje se nepodařilo ověřit/);
  assert.match(app.offerList.innerHTML, /Celková cena<\/span><strong>600 Kč/);
  assert.doesNotMatch(app.offerList.innerHTML, /Celkem k výplatě/);
});

test("blocked transfers are not presented as paid; completed transfers retain their actual status", async () => {
  const app = harness({
    extensions: [{ ...extension, transfer_status: "failed" }],
    financeRows: [{ ...evidence, payout_blocked: true }]
  });
  assert.equal(await app.render(), true);
  const html = app.offerList.innerHTML;
  assert.equal((html.match(/Převedeno na účet Stripe/g) || []).length, 1);
  assert.match(html, /Výplata pozastavena \(spor\)/);
});

test("reversed original transfers are never described as paid, even during a dispute", async () => {
  const app = harness({ financeRows: [{ ...evidence, original_transfer_status: "reversed", payout_blocked: true }] });
  assert.equal(await app.render(), true);
  const html = app.offerList.innerHTML;
  assert.match(html, /Převod byl vrácen/);
  assert.equal((html.match(/Převedeno na účet Stripe/g) || []).length, 1);
});

test("cancelled and expired reservations do not show a payout statement", async () => {
  for (const status of ["cancelled", "expired", "rejected"]) {
    const app = harness({ reservations: [{ ...reservation, status }] });
    assert.equal(await app.render(), true);
    assert.doesNotMatch(app.offerList.innerHTML, /history-owner-finance/);
    assert.deepEqual(app.calls, ["get_my_reservation_extensions"]);
  }
});

test("owner statement handles paid no-show and displays awaiting payout correctly", async () => {
  const app = harness({
    reservations: [{ ...reservation, status: "no_show" }],
    financeRows: [{ ...evidence, original_transfer_status: "not_created" }],
    extensions: [{ ...extension, transfer_status: "not_created" }]
  });
  assert.equal(await app.render(), true);
  assert.match(app.offerList.innerHTML, /Celkem k výplatě<\/span><strong>530 Kč/);
  assert.equal((app.offerList.innerHTML.match(/Čeká na výplatu/g) || []).length, 1);
  assert.match(app.offerList.innerHTML, /Stav výplaty<\/span><strong>Čeká na výplatu/);
});

test("owner summary is translated in all five languages", async () => {
  const examples = {
    cs: ["Finanční vyúčtování", "Stav výplaty"],
    sk: ["Finančné vyúčtovanie", "Stav výplaty"],
    en: ["Financial summary", "Payout status"],
    de: ["Finanzübersicht", "Auszahlungsstatus"],
    pl: ["Rozliczenie finansowe", "Status wypłaty"]
  };
  for (const [language, strings] of Object.entries(examples)) {
    const app = harness({ language });
    assert.equal(await app.render(), true);
    const html = app.offerList.innerHTML;
    for (const value of strings) assert.ok(html.includes(value), language + ": " + value);
    assert.doesNotMatch(html, /history\.finance\./);
  }
});

test("owner with no paid extensions sees one total, commission and transfer state", async () => {
  const app = harness({ extensions: [] });
  assert.equal(await app.render(), true);
  const html = app.offerList.innerHTML;
  assert.match(html, /Celkem zaplaceno<\/span><strong>450 Kč/);
  assert.match(html, /Provize Rentulo<\/span><strong>-70 Kč/);
  assert.match(html, /Celkem k výplatě<\/span><strong>380 Kč/);
  assert.doesNotMatch(html, /Prodloužení<\/span><strong>/);
  assert.equal((html.match(/Stav výplaty/g) || []).length, 1);
});

test("one shared state is displayed only once when all extension payouts match", async () => {
  const app = harness({ extensions: [
    extension,
    { ...extension, id: "extension-2", new_end_date: "2026-11-01", amount_total: 200,
      platform_fee_amount: 15, owner_payout: 185 }
  ] });
  assert.equal(await app.render(), true);
  const html = app.offerList.innerHTML;
  assert.match(html, /Prodloužení<\/span><strong>\+350 Kč/);
  assert.equal((html.match(/Převedeno na účet Stripe/g) || []).length, 1);
  assert.equal((html.match(/Stav výplaty/g) || []).length, 1);
});

test("new SQL reader is TEST-guarded, owner-only and read-only", () => {
  assert.match(sql, /https:\/\/vspposovhdgvbeukoivh\.supabase\.co/);
  assert.match(sql, /PROD forbidden/);
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /SET search_path\s*=\s*''/);
  assert.match(sql, /r\.owner_id\s*=\s*auth\.uid\(\)/);
  assert.match(sql, /r\.status::text IN \('returned', 'no_show'\)/);
  assert.match(sql, /FROM public\.stripe_card_disputes d/);
  assert.match(sql, /AND d\.payout_blocked IS TRUE/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_my_history_owner_transfers\(\)\s+FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_my_history_owner_transfers\(\)\s+TO authenticated/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|public\.)/i);
  const client = read("js/history-page.js");
  assert.doesNotMatch(client, /\.from\(["']payments["']\)/);
  assert.doesNotMatch(client, /\.from\(["']stripe_card_disputes["']\)/);
});
