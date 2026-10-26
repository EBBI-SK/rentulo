const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('minimum rental length uses safe defaults and server-side checks', () => {
  const sql = read('supabase/migrations/20261026170000_min_rental_days_v1.sql');
  assert.match(sql, /min_rental_days integer not null default 1/i);
  assert.match(sql, /check \(min_rental_days between 1 and 365\)/i);
  assert.match(sql, /before insert on public\.reservations/i);
  assert.match(sql, /new\.end_date - new\.start_date/i);
});

test('create, edit and detail all enforce the configured number of days', () => {
  for (const name of ['nabidnout.html', 'edit-nabidka.html']) {
    assert.match(read(name), /min-rental-days|MinRentalDays/);
  }
  assert.match(read('js/offer-form-page.js'), /min_rental_days: Number\(getInputValue\("toolMinRentalDays"\)\)/);
  assert.match(read('js/edit-offer.js'), /min_rental_days: minDaysValue/);
  const detail = read('js/detail-page.js');
  assert.match(detail, /days < minimumDays/);
  assert.match(detail, /getEarliestReturnDate\(startDate, minimumDays\)/);
});

test('report link removed from detail, reporting retained on contact page', () => {
  assert.doesNotMatch(read('js/detail-page.js'), /detail\.reportOffer/);
  assert.match(read('kontakt.html'), /id="nahlaseni-obsahu"/);
  assert.match(read('kontakt.html'), /rentulo@rentulo\.com/);
});
