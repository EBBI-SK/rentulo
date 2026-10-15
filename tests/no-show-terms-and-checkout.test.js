"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const languages = ["cs", "sk", "en", "de", "pl"];

function translations() {
  const context = vm.createContext({
    window: {},
    document: { documentElement: { lang: "cs" }, addEventListener() {} },
  });
  vm.runInContext(read("js/i18n.js"), context, { timeout: 5000 });
  return (key, lang) => context.window.rentuloTranslate(key, lang);
}

test("no-show terms give the same rule in five languages without hiding the renter's rights", () => {
  const t = translations();
  const keys = [
    "terms.section6.item3", "terms.section7.item3", "terms.section8.item1", "terms.section8.noShowTitle",
    "terms.section8.item4", "terms.section8.item5",
    "terms.section8.item6", "terms.section8.item7"
  ];
  const source = read("js/i18n.js");
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.equal((source.match(new RegExp('"' + escaped + '":', "g")) || []).length, 5, key);
  }
  for (const lang of languages) {
    for (const key of keys) {
      const text = t(key, lang);
      assert.notEqual(text, key, `${lang}/${key}`);
      assert.ok(text.length > 35 || key.endsWith("Title"), `${lang}/${key} too short`);
    }
    assert.match(t("terms.section7.item3", lang), /Europe\/Prague/);
    assert.match(t("terms.section8.item4", lang), /Europe\/Prague/);
    assert.match(t("terms.section8.item4", lang), /23:59/);
    assert.ok(t("terms.section8.item4", lang).length > 270);
    assert.match(t("terms.section8.item4", lang), /23:59/);
    assert.match(t("terms.section8.item6", lang), /rentulo@rentulo\.com/);
    assert.ok(t("terms.section8.item7", lang).length > 80);
    assert.ok(t("terms.section8.item5", lang).length > 100);
  }
});

test("the Czech legal fallback and the live translated clauses agree", () => {
  const html = read("obchodni-podminky.html");
  const t = translations();
  assert.match(html, /<h3 id="nevyzvednuti" data-i18n="terms\.section8\.noShowTitle">/);
  for (const key of ["terms.section6.item3", "terms.section7.item3", "terms.section8.item1", "terms.section8.item4", "terms.section8.item5", "terms.section8.item6", "terms.section8.item7"]) {
    assert.match(html, new RegExp('data-i18n="' + key.replace(/\./g, "\\.") + '"'));
    assert.ok(html.includes(t(key, "cs")), `HTML fallback for ${key} differs from Czech translation`);
  }
  assert.match(html, /rentulo@rentulo\.com/);
  assert.match(html, /zákonná práva/);
  assert.match(html, /celého sjednaného a zaplaceného období/);
});

test("renter is informed about no-show before opening Stripe Checkout", () => {
  const t = translations();
  const html = read("moje-rezervace.html");
  const page = read("js/reservations-page.js");
  assert.match(html, /id="reservationPaymentModalNoShowWarning"[^>]*data-i18n="reservations\.paymentModal\.noShowWarning"/);
  assert.match(html, /aria-describedby="reservationPaymentModalDescription reservationPaymentModalNoShowWarning"/);
  assert.match(html, /href="obchodni-podminky\.html#nevyzvednuti"/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /reservation-payment-no-show-warning\s*\{/);
  assert.match(page, /noShowWarning: document\.getElementById\("reservationPaymentModalNoShowWarning"\)/);
  assert.match(page, /reservationsTranslate\(\s*"reservations\.paymentModal\.noShowWarning"/);
  assert.match(page, /const confirmPayment = await openReservationPaymentModal\(\)/);
  assert.match(page, /if \(!confirmPayment\)\s*\{\s*return;/);
  assert.ok(page.indexOf("const confirmPayment = await openReservationPaymentModal()") < page.indexOf('"create-checkout-session"'));
  for (const lang of languages) {
    const warning = t("reservations.paymentModal.noShowWarning", lang);
    const link = t("reservations.paymentModal.noShowTermsLink", lang);
    assert.notEqual(warning, "reservations.paymentModal.noShowWarning");
    assert.ok(warning.length > 140, `${lang} payment warning missing detail`);
    assert.ok(warning.includes("23:59"));
    assert.ok(warning.length > 300, `${lang} needs to describe full rental period and single-use PIN`);
    assert.ok(link.length > 30, `${lang} terms link too short`);
  }
  assert.ok(html.includes(t("reservations.paymentModal.noShowWarning", "cs")));
});

test("old reservations cannot be auto-paid under newly introduced no-show rule", () => {
  const sql = read("supabase/migrations/20261015161000_paid_no_show_settlement_TEST.sql");
  assert.match(sql, /first_pickup_date date not null/);
  assert.match(sql, /first_reservation_created_at timestamptz not null default now\(\)/);
  assert.match(sql, /r\.created_at >= a\.first_reservation_created_at/);
  assert.match(sql, /r\.created_at >= \(\s*select a\.first_reservation_created_at\s*from public\.reservation_no_show_activation/);
  assert.match(sql, /https:\/\/vspposovhdgvbeukoivh\.supabase\.co/);
});
