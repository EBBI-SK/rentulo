"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const languages = ["cs", "sk", "en", "de", "pl"];
const legalKeys = ["terms.tax.title", "terms.tax.item1", "terms.tax.item2", "terms.tax.item3", "terms.tax.item4"];
const privacyKeys = ["privacy.s2li10", "privacy.s3li9", "privacy.s6p4", "privacy.s10p5"];

function getTranslate() {
  const context = vm.createContext({
    window: {},
    document: { documentElement: { lang: "cs" }, addEventListener() {} }
  });
  vm.runInContext(read("js/i18n.js"), context, { timeout: 5000 });
  return context.window.rentuloTranslate;
}

test("DAC7 clauses are translated in all five languages and conditional on the law", () => {
  const source = read("js/i18n.js");
  const t = getTranslate();
  for (const key of [...legalKeys, ...privacyKeys]) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.equal((source.match(new RegExp('"' + escaped + '":', "g")) || []).length, 5, key);
    for (const lang of languages) {
      const value = t(key, lang);
      assert.notEqual(value, key, `${lang}: untranslated ${key}`);
      assert.ok(value.length > (key.endsWith("title") ? 10 : 50), `${lang}: short ${key}`);
    }
  }
  const legalConditions = {
    cs: /^Pokud to vy/,
    sk: /^Ak to vy/,
    en: /^Where required by law/,
    de: /^Soweit gesetzlich/,
    pl: /^Je\u015bli wymaga tego prawo/
  };
  for (const lang of languages) {
    assert.match(t("terms.tax.item2", lang), /DAC7/);
    assert.match(t("terms.tax.item3", lang), legalConditions[lang]);
    assert.match(t("privacy.s6p4", lang), /DAC7/);
    assert.match(t("terms.section15.title", lang), /^16\./);
  }
  assert.match(t("terms.tax.item2", "cs"), /pron\u00e1jem b\u011b\u017en\u00e9ho n\u00e1\u0159ad\u00ed/);
  assert.match(t("terms.tax.item4", "en"), /not a universal reporting threshold/i);
});

test("Czech legal fallback mirrors runtime translations and has no global DAC7 threshold", () => {
  const t = getTranslate();
  const terms = read("obchodni-podminky.html");
  const privacy = read("ochrana-osobnich-udaju.html");
  for (const key of legalKeys) {
    assert.ok(terms.includes(`data-i18n="${key}"`));
    assert.ok(terms.includes(t(key, "cs")), `Terms fallback differs: ${key}`);
  }
  for (const key of privacyKeys) {
    assert.ok(privacy.includes(`data-i18n="${key}"`));
    assert.ok(privacy.includes(t(key, "cs")), `Privacy fallback differs: ${key}`);
  }
  assert.ok(terms.indexOf('data-i18n="terms.tax.title"') < terms.indexOf('data-i18n="terms.section15.title"'));
  assert.match(terms, /\bDAC7\b/);
  assert.ok(!/v\u0161echny pron\u00e1jmy.{0,70}p\u0159ekro\u010d\u00ed.{0,20}2 000 EUR/.test(terms));
  assert.ok(privacy.includes("Finan\u010dn\u00ed spr\u00e1v\u011b SR"));
});
