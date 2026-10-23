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

test("historical migration enforces 100 CZK minimum listing price and originally 50 CZK fee", () => {
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

test("new fee migration upgrades only future reservation pricing to 70 CZK", () => {
  const sql = read(
    "supabase/migrations/20261023150000_raise_platform_fee_minimum_to_70.sql"
  );
  assert.match(sql, /to_regprocedure\('public\.prepare_reservation_insert\(\)'\)/);
  assert.match(sql, /pg_get_functiondef\(v_function_oid\)/);
  assert.match(sql, /v_old_expression constant text := E'.*50/);
  assert.match(sql, /v_new_expression constant text := E'.*70/);
  assert.match(sql, /execute replace\(v_definition, v_old_expression, v_new_expression\)/);
  assert.doesNotMatch(sql, /update\s+public\.(reservations|payments)/i);
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

test("owner-side fee fallback applies the 10 percent or 70 CZK minimum rule", () => {
  const source = read("js/offers-page.js");

  assert.match(source, /const PLATFORM_FEE_PERCENT = 10;/);
  assert.match(source, /const PLATFORM_FEE_MINIMUM_CZK = 70;/);
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

  assert.ok(i18n.includes("minimálně 70 Kč za rezervaci"));
  assert.ok(i18n.includes("minimálne 70 Kč za rezerváciu"));
  assert.ok(i18n.includes("minimum fee of 70 Kč per reservation"));
  assert.ok(i18n.includes("mindestens jedoch 70 Kč pro Reservierung"));
  assert.ok(i18n.includes("minimum 70 Kč za rezerwację"));
  assert.doesNotMatch(i18n, /90\s*%/);

  assert.match(detailSource, /const PLATFORM_FEE_MINIMUM_CZK = 70;/);
  assert.match(
    detailSource,
    /detailTranslate\("detail\.platformFee", \{\s*percent: PLATFORM_FEE_PERCENT,\s*minimum: PLATFORM_FEE_MINIMUM_CZK\s*\}\)/
  );

  assert.ok(offerHtml.includes("Minimální cena je 100 Kč za den."));
  assert.ok(offerHtml.includes("minimálně 70 Kč za rezervaci."));
  assert.ok(termsHtml.includes("minimálně však"));
  assert.ok(termsHtml.includes("70 Kč za rezervaci"));
  assert.doesNotMatch(termsHtml, /majiteli připadne 90\s*%/i);
});


test("existing create and edit price fields explain commission in all five languages", () => {
  const create = read("nabidnout.html");
  const edit = read("edit-nabidka.html");
  const i18n = read("js/i18n.js");
  const owner = read("js/offers-page.js");

  assert.match(create, /id="toolPrice"[^>]+aria-describedby="toolPriceError offerCommissionInfo"/);
  assert.match(edit, /id="edit-price"[^>]+aria-describedby="editCommissionInfo"/);
  assert.match(create, /id="offerCommissionInfo" data-i18n="offer.commissionNote"/);
  assert.match(edit, /id="editCommissionInfo" data-i18n="offer.commissionNote"/);
  assert.equal((i18n.match(/"offer.commissionNote":/g) || []).length, 5);
  for (const phrase of [
    "minimálně 70 Kč za rezervaci",
    "minimálne 70 Kč za rezerváciu",
    "minimum fee of 70 Kč per reservation",
    "mindestens jedoch 70 Kč pro Reservierung",
    "minimum 70 Kč za rezerwację"
  ]) {
    assert.ok(i18n.includes(phrase), `Missing fee information: ${phrase}`);
  }
  const reservationStart = owner.indexOf("function renderRequest(reservation)");
  const reservationEnd = owner.indexOf("function toggleRequestDetail(", reservationStart);
  const row = owner.slice(reservationStart, reservationEnd);
  assert.doesNotMatch(row, /owner-reservation-payout-label|ownerPayout|platformFee/);
  assert.match(row, /renderReservationContactBlock\(reservation\)/);
});
