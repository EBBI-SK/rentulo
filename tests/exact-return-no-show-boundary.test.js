'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const sql = read('supabase/migrations/20261015161000_paid_no_show_settlement_TEST.sql');
const getPin = read('supabase/functions/get-pickup-pin/index.ts');
const resolve = read('supabase/functions/resolve-pickup-pin/index.ts');

const helperPromise = import('../supabase/functions/_shared/prague-rental-window.mjs');

test('12 Nov 10:00–13 Nov 10:00 Prague: no PIN after exactly 24 hours', async () => {
  const { pragueRentalInstant, rentalHandoverOpen, rentalEndReached } = await helperPromise;
  const start = pragueRentalInstant('2026-11-12', '10:00:00');
  const end = pragueRentalInstant('2026-11-13', '10:00:00');
  assert.equal(end - start, 24 * 60 * 60 * 1000);
  assert.equal(new Date(end).toISOString(), '2026-11-13T09:00:00.000Z');
  assert.equal(rentalHandoverOpen('2026-11-12', '2026-11-13', '10:00:00', new Date(end - 1)), true);
  assert.equal(rentalHandoverOpen('2026-11-12', '2026-11-13', '10:00:00', new Date(end)), false);
  assert.equal(rentalEndReached('2026-11-13', '10:00:00', new Date(end - 1)), false);
  assert.equal(rentalEndReached('2026-11-13', '10:00:00', new Date(end)), true);
});

test('daylight-saving transitions choose same instant as PostgreSQL Europe/Prague', async () => {
  const { pragueRentalInstant } = await helperPromise;
  const cases = [
    ['2026-03-29', '02:30:00', '2026-03-29T01:30:00.000Z'], // nonexistent local time
    ['2026-10-25', '02:30:00', '2026-10-25T01:30:00.000Z'], // later occurrence
    ['2026-03-29', '10:00:00', '2026-03-29T08:00:00.000Z'],
    ['2026-10-25', '10:00:00', '2026-10-25T09:00:00.000Z'],
  ];
  for (const [date, time, expected] of cases) {
    assert.equal(new Date(pragueRentalInstant(date, time)).toISOString(), expected);
  }
});

test('missing or invalid pickup time is never considered safe for PIN or automated payout', async () => {
  const { pragueRentalInstant, rentalEndReached, rentalHandoverOpen } = await helperPromise;
  assert.equal(pragueRentalInstant('2026-11-13', null), null);
  assert.equal(pragueRentalInstant('2026-11-13', '25:00'), null);
  assert.equal(pragueRentalInstant('2026-11-31', '10:00'), null);
  assert.equal(rentalEndReached('2026-11-13', null), true);
  assert.equal(rentalHandoverOpen('2026-11-12', '2026-11-13', null), false);
  assert.match(sql, /if v_reservation\.pickup_time is null/);
  assert.match(sql, /old\.pickup_time is not null[\s\S]{0,120}clock_timestamp\(\) >= \(\(old\.end_date/);
  assert.match(sql, /or \(r\.pickup_time is null[\s\S]{0,120}r\.end_date/);
  assert.match(sql, /reservation_no_show_issues/);
});

test('SQL guards check wall-clock time even after waiting for a row lock', () => {
  assert.match(sql, /clock_timestamp\(\) >= \(\(old\.end_date \+ old\.pickup_time\) at time zone 'Europe\/Prague'\)/);
  assert.match(sql, /clock_timestamp\(\) < \(\(old\.start_date \+ old\.pickup_time\) at time zone 'Europe\/Prague'\)/);
  assert.match(sql, /clock_timestamp\(\) >= \(\(r\.end_date \+ r\.pickup_time\) at time zone 'Europe\/Prague'\)/);
  assert.match(sql, /for update of r skip locked/);
  assert.match(sql, /where r\.id = v_reservation\.id and r\.status = 'paid'/);
  assert.match(sql, /created_at >= a\.first_reservation_created_at/);
});

test('both PIN Edge endpoints recheck the exact cutoff before a successful response', () => {
  assert.match(getPin, /const pin = await createPickupPin[\s\S]*?if \(rentalEndReached\(reservation\.end_date, reservation\.pickup_time\)\)/);
  assert.match(resolve, /const matched = ownerReservations\.find[\s\S]*?if \(!matched \|\| !rentalHandoverOpen/);
  assert.match(resolve, /code: "pickup_wrong_day"/);
  assert.match(getPin, /pickup_time/);
});
