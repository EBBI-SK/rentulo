"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const locales = ["cs", "sk", "en", "de", "pl"];
function dictionary() {
  const context = vm.createContext({window: {}, document: {documentElement: {lang: "cs"}, addEventListener() {}}});
  vm.runInContext(read("js/i18n.js"), context);
  return context.window.rentuloTranslate;
}

test("legal V1.0 effective date and neutral presentation are consistent in all languages", () => {
  const t = dictionary();
  const s = read("js/i18n.js");
  const date = {cs: "1. 12. 2026", sk: "1. 12. 2026", en: "1 December 2026", de: "1. Dezember 2026", pl: "1 grudnia 2026"};
  const keys = ["terms.warning", "privacy.warning", "terms.section15.item3", "privacy.s13p2", "registration.termsVersionNote"];
  for (const k of keys) {
    assert.equal((s.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length, 5, k);
    for (const l of locales) {
      const str = t(k, l);
      assert.match(str, /1\.0/, `${l}:${k}:version`);
      assert.ok(str.includes(date[l]), `${l}:${k}:date`);
      assert.doesNotMatch(str, /testovac|testovacia|testbetrieb|testing|test version|wersja testowa|future effective date|before public/i, `${l}:${k}`);
    }
  }
  const htmlByKey = {
    "terms.warning": "obchodni-podminky.html",
    "terms.section15.item3": "obchodni-podminky.html",
    "privacy.warning": "ochrana-osobnich-udaju.html",
    "privacy.s13p2": "ochrana-osobnich-udaju.html",
    "registration.termsVersionNote": "registrace.html"
  };
  for (const [k, file] of Object.entries(htmlByKey)) {
    const html = read(file);
    assert.ok(html.includes(t(k, "cs")), `${file}: Czech fallback for ${k}`);
  }
});

test("operator info is complete, with no public TEST status badge", () => {
  const contact = read("kontakt.html");
  const registration = read("registrace.html");
  assert.match(contact, /EBBI s\. r\. o\./);
  assert.match(contact, /46 306 374/);
  assert.doesNotMatch(contact, /contact-test-badge|contact\.testBadge|Testovací verze/);
  assert.doesNotMatch(registration, /Pro testovací provoz|před veřejným spuštěním/i);
  assert.doesNotMatch(read("js/i18n.js"), /"contact\.(?:testBadge|operatorNotice)":/);
});

test("legal booking deadlines correspond to existing server policy in all languages", () => {
  const t = dictionary();
  for (const l of locales) {
    assert.ok(t("terms.section5.item1", l).length > 160, `${l}:owner deadline`);
    assert.ok(t("terms.section5.item2", l).length > 240, `${l}:payment deadline`);
  }
  const terms = read("obchodni-podminky.html");
  assert.match(terms, /do 24 hodin od vytvoření žádosti/);
  assert.match(terms, /nejvýše 30 minut/);
  const policy = read("supabase/migrations/20261017180000_payment_deadline_before_pickup_TEST.sql");
  assert.match(policy, /interval '24 hours'/);
  assert.match(policy, /interval '30 minutes'/);
});

test("TEST-only server migration aligns signup legal version without rewriting old records", () => {
  const frontend = read("js/registration-page.js");
  const sql = read("supabase/migrations/20261105150000_bod12_legal_version_v1_TEST.sql");
  const production = read("supabase/prod-release-20261024/migrations/20261020170000_bod02_v1_compliance_registry_PROD.sql");
  assert.match(frontend, /terms_version:\s*"1\.0"/);
  assert.match(frontend, /privacy_notice_version:\s*"1\.0"/);
  assert.doesNotMatch(frontend, /1\.0-test-2026-10-20/);
  assert.match(sql, /^BEGIN;\s*$/m);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /vault\.decrypted_secrets/);
  assert.match(sql, /https:\/\/vspposovhdgvbeukoivh\.supabase\.co/);
  assert.match(sql, /TEST-only; PROD forbidden/);
  assert.match(sql, /SECURITY DEFINER SET search_path = ''/);
  assert.match(sql, /IS DISTINCT FROM '1\.0'/);
  assert.match(sql, /NEW\.id, '1\.0', '1\.0'/);
  assert.match(sql, /clock_timestamp\(\)/);
  assert.doesNotMatch(sql, /\b(?:DELETE|UPDATE|TRUNCATE)\s+(?:FROM\s+)?(?:public\.gdpr_terms_acceptances|auth\.users)\b/i);
  assert.doesNotMatch(sql, /\b(?:DROP TRIGGER|CREATE TRIGGER|cron\.schedule)\b/i);
  assert.match(production, /NEW\.id, '1\.0', '1\.0'/);
});


test("Czech terms and privacy notice keep a single accurate public text", () => {
  const t = dictionary();
  const keys = {
    "obchodni-podminky.html": ["terms.section3.item1", "terms.section12.item1"],
    "ochrana-osobnich-udaju.html": ["privacy.s4p1", "privacy.s4p2", "privacy.s6p3", "privacy.s10p6", "privacy.s11p1"]
  };
  for (const [file, translationKeys] of Object.entries(keys)) {
    const html = read(file).replace(/\s+/g, " ");
    for (const key of translationKeys) {
      assert.ok(html.includes(t(key, "cs").replace(/\s+/g, " ")), `${file}: ${key} fallback matches CS translation`);
    }
  }
  assert.doesNotMatch(t("terms.section3.item1", "cs"), /ve verzi 1/i);
  assert.doesNotMatch(t("terms.section12.item1", "cs"), /ve verzi 1/i);
  assert.match(t("privacy.s4p1", "cs"), /policy|registraci/);
  assert.match(t("privacy.s4p1", "cs"), /Bez pot/);
  assert.match(t("privacy.s4p2", "cs"), /p\u0159ed jeho odvol/);
  assert.match(t("privacy.s6p3", "cs"), /policy@rentulo\.com/);
  assert.match(t("privacy.s6p3", "cs"), /Vercel.*Stripe.*Resend.*Spojen/);
  assert.match(t("privacy.s6p3", "cs"), /standardn/);
  assert.doesNotMatch(t("privacy.s10p6", "cs"), /testech|Mazac/);
  assert.doesNotMatch(t("privacy.s11p1", "cs"), /lh\S*tu prodlou/);
  assert.match(t("privacy.s11p3", "cs"), /dva dal/);
});
