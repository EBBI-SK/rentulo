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
  const policy = read("supabase/prod-release-20261024/migrations/20261017180000_payment_deadline_before_pickup_PROD.sql");
  assert.match(policy, /interval '24 hours'/);
  assert.match(policy, /interval '30 minutes'/);
});

test("PROD signup acceptance contract records legal V1.0 server-side without a TEST-only migration", () => {
  const frontend = read("js/registration-page.js");
  const prodSql = read("supabase/prod-release-20261024/migrations/20261020170000_bod02_v1_compliance_registry_PROD.sql");
  assert.match(frontend, /terms_version:\s*"1\.0"/);
  assert.match(frontend, /privacy_notice_version:\s*"1\.0"/);
  assert.match(frontend, /terms_business_accepted:\s*true/);
  assert.match(frontend, /terms_privacy_accepted:\s*true/);
  assert.match(frontend, /private_individual_confirmed:\s*true/);
  assert.doesNotMatch(frontend, /1\.0-test-2026-10-20/);
  assert.match(prodSql, /CREATE OR REPLACE FUNCTION public\.gdpr_capture_signup_terms\(\)/);
  assert.match(prodSql, /NEW\.raw_user_meta_data ->> 'terms_business_accepted'/);
  assert.match(prodSql, /NEW\.raw_user_meta_data ->> 'terms_privacy_accepted'/);
  assert.match(prodSql, /NEW\.raw_user_meta_data ->> 'private_individual_confirmed'/);
  assert.match(prodSql, /NEW\.raw_user_meta_data ->> 'terms_version' IS DISTINCT FROM '1\.0'/);
  assert.match(prodSql, /NEW\.raw_user_meta_data ->> 'privacy_notice_version' IS DISTINCT FROM '1\.0'/);
  assert.match(prodSql, /v_lang NOT IN \('cs','sk','en','de','pl'\)/);
  assert.match(prodSql, /NEW\.id, '1\.0', '1\.0'/);
  assert.match(prodSql, /clock_timestamp\(\)/);
  assert.match(prodSql, /'auth_signup'/);
  assert.match(prodSql, /AFTER INSERT ON auth\.users/);
  assert.match(prodSql, /ON CONFLICT \(user_id, terms_version, source\) DO NOTHING/);
  assert.doesNotMatch(prodSql, /1\.0-test-2026-10-20/);
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

test("legal V1.0 wording is consistent in SK EN DE and PL", () => {
  const t = dictionary();
  for (const lang of ["sk", "en", "de", "pl"]) {
    const status = t("terms.section3.item1", lang);
    const prohibited = t("terms.section12.item1", lang);
    assert.match(status, /Rentulo/, `${lang}: platform name`);
    assert.doesNotMatch(status + prohibited, /vo verzii 1|ve verzi 1|version 1|in version 1|w wersji 1/i, `${lang}: internal version label`);
    assert.ok(prohibited.length > 90, `${lang}: prohibited activities remain described`);
  }
});

test("legal V1.0 GDPR translations disclose mandatory data, transfers and consent withdrawal", () => {
  const t = dictionary();
  const required = {
    sk: ["registr", "telef", "heslo", "PS", "Bez"],
    en: ["registration", "phone", "password", "postal code", "Without"],
    de: ["Registrierung", "Telefonnummer", "Passwort", "Postleitzahl", "Ohne"],
    pl: ["rejestracji", "telefonu", "has", "pocztowy", "Bez"]
  };
  const us = {sk: "Spojen", en: "United States", de: "Vereinigten Staaten", pl: "Stanach Zjednoczonych"};
  const withdrawal = {sk: "pred jeho", en: "before its withdrawal", de: "vor dem Widerruf", pl: "przed jej wycofaniem"};
  for (const lang of ["sk", "en", "de", "pl"]) {
    const legalBasis = t("privacy.s4p1", lang);
    for (const needle of required[lang]) assert.ok(legalBasis.includes(needle), `${lang}: mandatory signup data: ${needle}`);
    assert.ok(t("privacy.s4p2", lang).includes(withdrawal[lang]), `${lang}: consent withdrawal cannot work retroactively`);
    const transfers = t("privacy.s6p3", lang);
    for (const needle of ["Vercel", "Stripe", "Resend", "Supabase", "Data Privacy Framework", "46", "policy@rentulo.com", us[lang]]) {
      assert.ok(transfers.includes(needle), `${lang}: international transfers: ${needle}`);
    }
  }
});

test("legal V1.0 GDPR translations contain retention rules without internal TEST rollout notes or duplicated deadlines", () => {
  const t = dictionary();
  const duration = {sk: "tri roky", en: "three years", de: "drei Jahre", pl: "trzy lata"};
  for (const lang of ["sk", "en", "de", "pl"]) {
    const retention = t("privacy.s10p6", lang);
    assert.ok(retention.includes(duration[lang]), `${lang}: acceptance record period`);
    assert.match(retention, /90/, `${lang}: technical logs`);
    assert.doesNotMatch(retention, /testovac|testdaten|test data|dane testowe|mazacie mechanizmy|automated deletion|L.schmechanismen/i, `${lang}: no internal rollout statements`);
    const rights = t("privacy.s11p1", lang);
    assert.match(rights, /policy@rentulo\.com/, `${lang}: privacy contact`);
    assert.doesNotMatch(rights, /one month|within a month|ein(?:em|es) Monat|miesi|jedn.ho mesiaca|gesetzliche Verl.ngerungen/i, `${lang}: no duplicate response deadline`);
    assert.ok(t("privacy.s11p3", lang).length > 120, `${lang}: the detailed response deadline is retained`);
  }
});
