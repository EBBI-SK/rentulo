"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8");
}

function compactSql(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

test("database enforces 100 CZK minimum listing price and 50 CZK minimum platform fee", () => {
  const sql = compactSql(read(
    "supabase/migrations/20260924093000_enforce_minimum_price_and_platform_fee.sql"
  ));

  assert.match(
    sql,
    /drop constraint if exists offers_price_per_day_check/i
  );
  assert.match(
    sql,
    /add constraint offers_price_per_day_check check \(price_per_day >= 100\)/i
  );
  assert.match(sql, /new\.platform_fee_percent := 10/i);
  assert.match(
    sql,
    /new\.platform_fee_amount := greatest\( round\(new\.total_price \* new\.platform_fee_percent \/ 100\.0\)::integer, 50 \)/i
  );
  assert.match(
    sql,
    /new\.owner_payout := new\.total_price - new\.platform_fee_amount/i
  );
});

test("create and edit listing forms reject prices below 100 CZK", () => {
  const createSource = read("js/offer-form-page.js");
  const editSource = read("js/edit-offer.js");

  assert.match(createSource, /const MINIMUM_OFFER_PRICE_CZK = 100;/);
  assert.match(
    createSource,
    /parsedPrice < MINIMUM_OFFER_PRICE_CZK/
  );

  assert.match(editSource, /const MINIMUM_OFFER_PRICE_CZK = 100;/);
  assert.match(
    editSource,
    /priceValue < MINIMUM_OFFER_PRICE_CZK/
  );
});

test("owner-side fee fallback applies the same 10 percent or 50 CZK minimum rule", () => {
  const source = read("js/offers-page.js");

  assert.match(source, /const PLATFORM_FEE_PERCENT = 10;/);
  assert.match(source, /const PLATFORM_FEE_MINIMUM_CZK = 50;/);
  assert.match(source, /function calculatePlatformFee\(price\)/);
  assert.match(
    source,
    /Math\.max\(\s*Math\.round\(total \* PLATFORM_FEE_PERCENT \/ 100\),\s*PLATFORM_FEE_MINIMUM_CZK\s*\)/
  );
  assert.match(
    source,
    /reservation\.platformFeeAmount \|\| calculatePlatformFee\(price\)/
  );
});

test("fee and minimum-price copy is synchronized across supported languages and static fallbacks", () => {
  const i18n = read("js/i18n.js");
  const detailSource = read("js/detail-page.js");
  const offerHtml = read("nabidnout.html");
  const termsHtml = read("obchodni-podminky.html");

  assert.equal(
    (i18n.match(/"offer\.priceValidationPositive":/g) || []).length,
    5
  );
  assert.equal(
    (i18n.match(/"detail\.platformFee":/g) || []).length,
    5
  );

  for (const copy of [
    "Minimální cena je 100 Kč za den.",
    "Minimálna cena je 100 Kč za deň.",
    "The minimum price is 100 Kč per day.",
    "Der Mindestpreis beträgt 100 Kč pro Tag.",
    "Minimalna cena wynosi 100 Kč za dzień."
  ]) {
    assert.ok(i18n.includes(copy), copy);
  }

  assert.ok(i18n.includes("minimálně 50 Kč za rezervaci"));
  assert.ok(i18n.includes("minimálne 50 Kč za rezerváciu"));
  assert.ok(i18n.includes("minimum fee of 50 Kč per reservation"));
  assert.ok(i18n.includes("mindestens jedoch 50 Kč pro Reservierung"));
  assert.ok(i18n.includes("minimum 50 Kč za rezerwację"));
  assert.doesNotMatch(i18n, /90\s*%/);

  assert.match(detailSource, /const PLATFORM_FEE_MINIMUM_CZK = 50;/);
  assert.match(
    detailSource,
    /detailTranslate\("detail\.platformFee", \{\s*percent: PLATFORM_FEE_PERCENT,\s*minimum: PLATFORM_FEE_MINIMUM_CZK\s*\}\)/
  );

  assert.ok(offerHtml.includes("Minimální cena je 100 Kč za den."));
  assert.ok(offerHtml.includes("minimálně 50 Kč za rezervaci."));
  assert.ok(termsHtml.includes("minimálně však"));
  assert.ok(termsHtml.includes("50 Kč za rezervaci"));
  assert.doesNotMatch(termsHtml, /majiteli připadne 90\s*%/i);
});
