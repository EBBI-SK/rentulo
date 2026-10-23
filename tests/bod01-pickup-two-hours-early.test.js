"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const previous = read("supabase/migrations/20261017223000_pending_withdrawal_cutoff_FIX_TEST.sql");
const updated = read("supabase/migrations/20261018090000_pickup_pin_two_hours_early_TEST.sql");
const followup = read("supabase/migrations/20261017233000_return_followup_incident_TEST.sql");
const lookup = read("supabase/functions/resolve-pickup-pin/index.ts");
const confirm = read("supabase/functions/confirm-pickup/index.ts");
const ui = read("js/pickup-security.js");
const i18n = read("js/i18n.js");

function trigger(sql) {
  const match = sql.match(/create or replace function public\.protect_reservation_status_transition\(\)\n[\s\S]*?\n\$function\$;/);
  assert.ok(match, "Full authoritative state transition guard required");
  return match[0];
}

test("new migration changes only pickup window inside the latest trusted trigger", () => {
  const before = trigger(previous);
  const expected = before
    .replace(
      "    -- PIN handover is allowed only inside [start, return); at the exact return\n    -- instant the PIN is expired and cannot initiate an owner transfer.",
      "    -- Owner may hand over up to two elapsed hours before scheduled pickup.\n    -- PIN expires at the original scheduled return, not two hours later."
    )
    .replace(
      "    if clock_timestamp() < ((old.start_date + old.pickup_time) at time zone 'Europe/Prague') then",
      "    if clock_timestamp() < (\n      ((old.start_date + old.pickup_time) at time zone 'Europe/Prague')\n      - interval '2 hours'\n    ) then"
    );
  assert.notEqual(expected, before);
  assert.equal(trigger(updated), expected, "Cancellation/no-show/financial guard must be unchanged");
  assert.match(updated, /where s\.name = 'rentulo_project_url'/);
  assert.match(updated, /vspposovhdgvbeukoivh\.supabase\.co/);
  assert.match(updated, /revoke all on function public\.protect_reservation_status_transition\(\)/);
  assert.match(updated, /\bbegin;[\s\S]*\bcommit;/i);
  assert.doesNotMatch(updated, /\b(delete from|truncate|update public\.payments|update public\.reservations)\b/i);
});

test("renter's one-use PIN may be verified exactly two hours before pickup", async () => {
  const { rentalHandoverOpen, pragueRentalInstant } = await import("../supabase/functions/_shared/prague-rental-window.mjs");
  const start = "2026-10-18", end = "2026-10-19", at = "10:00:00";
  assert.equal(new Date(pragueRentalInstant(start, at)).toISOString(), "2026-10-18T08:00:00.000Z");
  for (const [iso, expected] of [
    ["2026-10-18T05:59:59.999Z", false],
    ["2026-10-18T06:00:00.000Z", true], // 08:00 Prague: two hours before pickup
    ["2026-10-18T07:59:59.999Z", true],
    ["2026-10-18T08:00:00.000Z", true],  // 10:00 Prague: agreed pickup
    ["2026-10-19T07:59:59.999Z", true],
    ["2026-10-19T08:00:00.000Z", false], // 10:00 Prague: agreed return, exclusive
    ["2026-10-19T10:00:00.000Z", false], // No extra 2h PIN extension
  ]) {
    assert.equal(rentalHandoverOpen(start, end, at, new Date(iso)), expected, iso);
  }
});

test("midnight pickups can start on previous day, without moving return time", async () => {
  const { rentalHandoverOpen } = await import("../supabase/functions/_shared/prague-rental-window.mjs");
  const params = ["2026-11-12", "2026-11-13", "00:00:00"];
  assert.equal(rentalHandoverOpen(...params, new Date("2026-11-11T20:59:59.999Z")), false);
  assert.equal(rentalHandoverOpen(...params, new Date("2026-11-11T21:00:00.000Z")), true);
  assert.equal(rentalHandoverOpen(...params, new Date("2026-11-12T23:00:00.000Z")), false);
});

test("two elapsed pickup hours use correct Prague DST start instant", async () => {
  const { rentalHandoverOpen, pragueRentalInstant } = await import("../supabase/functions/_shared/prague-rental-window.mjs");
  for (const [date, endDate] of [["2026-03-29", "2026-03-30"], ["2026-10-25", "2026-10-26"]]) {
    const begin = pragueRentalInstant(date, "02:30:00");
    const cutoff = new Date(begin - 2 * 60 * 60 * 1000);
    assert.equal(rentalHandoverOpen(date, endDate, "02:30:00", new Date(cutoff.getTime() - 1)), false);
    assert.equal(rentalHandoverOpen(date, endDate, "02:30:00", cutoff), true);
  }
});

test("both Edge operations honor the window while PIN and no-show expire at original return", () => {
  assert.match(lookup, /rentalHandoverOpen\(reservation\.start_date, reservation\.end_date, reservation\.pickup_time\)/);
  assert.match(lookup, /rentalHandoverOpen\(matched\.start_date, matched\.end_date, matched\.pickup_time\)/);
  assert.match(lookup, /from two hours before scheduled pickup until scheduled return/);
  assert.match(confirm, /admin\.rpc\("confirm_reservation_pickup"/);
  assert.match(confirm, /code: "pickup_not_started"/);
  assert.match(confirm, /status: "picked_up"/);
  assert.match(confirm, /transfer_status: "not_created"/);
  const get = read("supabase/functions/get-pickup-pin/index.ts");
  assert.match(get, /rentalEndReached\(reservation\.end_date, reservation\.pickup_time\)/);
  const triggerSql = trigger(updated);
  assert.match(triggerSql, /clock_timestamp\(\) >= \(\(old\.end_date \+ old\.pickup_time\) at time zone 'Europe\/Prague'\)/);
  assert.match(triggerSql, /old\.status = 'paid'[\s\S]*new\.status = 'no_show'/);
});

test("the existing 2h return tolerance is voluntary, not an automatic incident", () => {
  assert.match(followup, /return_reminder_30m/);
  assert.match(followup, /return_reminder_2h/);
  assert.match(followup, /create or replace function public\.report_my_reservation_not_returned/);
  assert.match(followup, /interval '2 hours'/);
  assert.match(followup, /No automatic report is created/);
  assert.match(followup, /v_reservation\.status <> 'picked_up'/);
});

test("all five UI locales explain early pickup and the unchanged return deadline", () => {
  for (const key of ["cs:", "sk:", "en:", "de:", "pl:"]) assert.match(ui, new RegExp(key));
  for (const lang of ["cs", "sk", "en", "de", "pl"]) {
    const section = ui.match(new RegExp(`\\b${lang}: \\{([\\s\\S]*?)\\n    \\}`));
    assert.ok(section, lang);
    const copy = section[1];
    assert.match(copy, /wrongDay:/);
    assert.match(copy, /tooEarly:/);
    assert.match(copy, /2 hodiny|2 hours|2 Stunden|2 godziny/);
  }
  for (const key of ["terms.section7.item3", "terms.section8.item4", "reservations.paymentModal.noShowWarning"]) {
    assert.equal((i18n.match(new RegExp('"' + key.replaceAll(".", "\\.") + '":', "g")) || []).length, 5);
  }
  const terms = read("obchodni-podminky.html");
  const reservation = read("moje-rezervace.html");
  assert.match(terms, /2 hodiny před sjednaným/);
  assert.match(reservation, /2 hodin před převzetím/);
});
