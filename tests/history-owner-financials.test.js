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

test("owner R-000045 sees 450 + 150 = 600 CZK, 70 commission and 530 payout", async () => {
  const app = harness();
  assert.equal(await app.render(), true);
  const html = app.offerList.innerHTML;
  assert.match(html, /Finanční vyúčtování pronájmu/);
  assert.match(html, /Celkem zaplaceno<\/span><strong>600 Kč/);
  assert.match(html, /Provize Rentulo celkem<\/span><strong>-70 Kč/);
  assert.match(html, /Výplata za původní pronájem<\/span><strong>380 Kč/);
  assert.match(html, /Výplata za prodloužení do.*?<\/span><strong>150 Kč/s);
  assert.match(html, /Celkem k výplatě<\/span><strong>530 Kč/);
  assert.equal((html.match(/Převedeno na účet Stripe/g) || []).length, 2);
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

test("two paid extensions, including additional commission, remain separate", async () => {
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
  assert.match(html, /Celkem zaplaceno<\/span><strong>800 Kč/);
  assert.match(html, /Provize Rentulo celkem<\/span><strong>-85 Kč/);
  assert.match(html, /Celkem k výplatě<\/span><strong>715 Kč/);
  assert.match(html, /Převod se zpracovává/);
  assert.doesNotMatch(html, /9999|9 999/);
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
    assert.doesNotMatch(html, /Celkem k výplatě|Převedeno na účet Stripe/);
  }
});

test("missing new SQL function does not break existing History and shows an honest warning", async () => {
  const app = harness({ financeError: { message: "function not found" } });
  assert.equal(await app.render(), true);
  assert.match(app.offerList.innerHTML, /simple-reservation-price">600 Kč/);
  assert.match(app.offerList.innerHTML, /Finanční údaje se nepodařilo ověřit/);
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
  assert.equal((app.offerList.innerHTML.match(/Čeká na výplatu/g) || []).length, 2);
});

test("owner statement translations exist for all five languages", async () => {
  const examples = {
    cs: "Finanční vyúčtování pronájmu",
    sk: "Finančné vyúčtovanie prenájmu",
    en: "Rental financial breakdown",
    de: "Finanzübersicht zur Vermietung",
    pl: "Rozliczenie finansowe wynajmu"
  };
  for (const [language, title] of Object.entries(examples)) {
    const app = harness({ language });
    assert.equal(await app.render(), true);
    assert.ok(app.offerList.innerHTML.includes(title), language);
    assert.doesNotMatch(app.offerList.innerHTML, /history\.finance\./);
  }
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
