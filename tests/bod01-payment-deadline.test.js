"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const update = read("supabase/migrations/20261017180000_payment_deadline_before_pickup_TEST.sql");
const original = read("supabase/migrations/20261012171000_reservation_expiration_policy.sql");

// These static regression checks supplement (not replace) TEST SQL and end-to-end checks.
test("owner still has 24 hours, capped at pickup", () => {
  assert.match(update, /if tg_op = 'INSERT' then[\s\S]*?new\.expires_at := least\(now\(\) \+ interval '24 hours', v_pickup_at\)/);
  assert.match(update, /old\.expires_at is not null and old\.expires_at <= now\(\)/);
  assert.match(update, /message = 'RESERVATION_APPROVAL_EXPIRED'/);
});

test("payment deadline is 24 hours before pickup when approval is early", () => {
  assert.match(update, /create or replace function public\.calculate_reservation_payment_deadline/);
  assert.match(update, /p_approved_at < p_pickup_at - interval '24 hours'/);
  assert.match(update, /then p_pickup_at - interval '24 hours'/);
  assert.match(update, /new\.expires_at := public\.calculate_reservation_payment_deadline\(new\.approved_at, v_pickup_at\)/);
});

test("late approvals allow 30 minutes but never after pickup", () => {
  assert.match(update, /else least\(p_approved_at \+ interval '30 minutes', p_pickup_at\)/);
  assert.match(update, /v_pickup_at <= now\(\)/);
  assert.match(update, /message = 'PICKUP_TIME_PASSED'/);
  assert.match(update, /Europe\/Prague/);
});

test("legacy approved reservations are not backfilled; expiry reasons stay immutable", () => {
  assert.doesNotMatch(update, /update\s+public\.reservations\s+set\s+expires_at/i);
  assert.match(update, /new\.expired_at := old\.expired_at/);
  assert.match(update, /new\.expiry_reason := case when old\.status = 'pending'/);
  assert.match(update, /Reservation expiration fields cannot be changed/);
});

test("urgent payment reminders are not queued immediately on approval", () => {
  assert.match(update, /r\.expires_at - r\.approved_at > interval '30 minutes'/);
  assert.match(update, /r\.expires_at <= now\(\) \+ interval '10 minutes'/);
  assert.match(update, /expiry_reminder_pending/);
  assert.match(update, /expiry_reminder_approved/);
  assert.match(update, /d\.channel = 'email'/);
});

test("existing Stripe-safe expiration and checkout claim remain untouched", () => {
  assert.match(original, /create or replace function public\.expire_unpaid_reservation/);
  assert.match(original, /checkout_inflight_started_at is not null/);
  assert.match(original, /create or replace function public\.mark_reservation_checkout_started/);
  assert.doesNotMatch(update, /create or replace function public\.(expire_unpaid_reservation|mark_reservation_checkout_started|protect_reservation_status_transition)/);
});

test("How it works clearly explains new payment rule in five languages", () => {
  const translation = read("js/i18n.js");
  const matches = [...translation.matchAll(/"how\.renterStep5Text": "([^"]+)"/g)].map(m => m[1]);
  assert.equal(matches.length, 5);
  for (const message of matches) {
    assert.match(message, /24/);
    assert.match(message, /30/);
    assert.doesNotMatch(message, /dalších 24 hodin od schválení|ďalších 24 hodín od schválenia|another 24 hours from approval|weitere 24 Stunden zum Bezahlen|kolejne 24 godziny na płatność/);
  }
});

test("payment reminder emails do not claim a four-hour window when only minutes remain", () => {
  const email = read("supabase/functions/send-reservation-email/index.ts");
  const matching = [...email.matchAll(/^\s+expiry_reminder_approved: \[(.+)\],$/gm)].map(m => m[1]);
  assert.equal(matching.length, 5);
  for (const message of matching) {
    assert.doesNotMatch(message, /4 hodin|4 hodiny|4 hours|4 Stunden|4 godziny/);
  }
  assert.match(email, /event\.startsWith\("expiry_reminder_"\) && reservation\.expires_at/);
});
