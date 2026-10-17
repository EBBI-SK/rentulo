"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const policy = read("supabase/migrations/20261017203000_cancellation_cutoff_24h_exception_TEST.sql");
const owner = read("js/offers-page.js");
const renter = read("js/reservations-page.js");
const edge = read("supabase/functions/cancel-paid-reservation/index.ts");
const shared = read("js/reservations.js");
const terms = read("obchodni-podminky.html");

function reservationUi() {
  const ctx = {
    console, Date,
    RESERVATION_STATUS_PENDING: "pending", RESERVATION_STATUS_APPROVED: "approved",
    RESERVATION_STATUS_PAID: "paid", RESERVATION_STATUS_PICKED_UP: "picked_up",
    RESERVATION_STATUS_RETURNED: "returned",
    getReservationStatus: row => row.status,
    normalizeReservationStatus: value => value
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(shared, ctx, { filename: "reservations.js" });
  return ctx;
}

test("new reservations have a non-forgeable 24-hour snapshot; older ones keep 6 hours", () => {
  assert.match(policy, /add column if not exists cancellation_cutoff_hours integer not null default 6/);
  assert.match(policy, /alter column cancellation_cutoff_hours set default 24/);
  assert.match(policy, /new\.cancellation_cutoff_hours := 24/);
  assert.match(policy, /CANCELLATION_POLICY_IMMUTABLE/);
  assert.match(policy, /new\.cancellation_cutoff_hours is distinct from old\.cancellation_cutoff_hours/);
});

test("server exposes per-booking exact cutoff, not a global 24-hour cutoff", () => {
  assert.match(policy, /make_interval\(hours => r\.cancellation_cutoff_hours\) as cancellation_cutoff_at/);
  assert.match(policy, /make_interval\(hours => old\.cancellation_cutoff_hours\)/);
  assert.match(policy, /make_interval\(hours => v_reservation\.cancellation_cutoff_hours\)/);
  assert.match(policy, /at time zone 'Europe\/Prague'/);
  assert.match(policy, /create or replace function public\.get_my_reservations\(\)/);
  assert.doesNotMatch(policy, /drop function public\.get_my_reservations\(/);
});

test("client closes ordinary cancellation at the precise stored timestamp for both policies", () => {
  const ui = reservationUi();
  for (const [hours, deadline] of [[24, "2026-11-05T11:00:00.000Z"], [6, "2026-11-06T05:00:00.000Z"]]) {
    const reservation = { status: "paid", cancellationCutoffAt: deadline };
    const threshold = Date.parse(deadline);
    assert.equal(ui.isReservationCancellationWindowOpen(reservation, new Date(threshold - 1)), true, `${hours}h pre-cutoff`);
    assert.equal(ui.isReservationCancellationWindowOpen(reservation, new Date(threshold)), false, `${hours}h cutoff`);
  }
});

test("ordinary approved cancellation blocks known, in-flight or ambiguous Stripe Checkout", () => {
  assert.match(policy, /RESERVATION_ACTIVE_CHECKOUT/);
  assert.match(policy, /p\.checkout_attempt_started_at is not null/);
  assert.match(policy, /p\.checkout_inflight_started_at is not null/);
  assert.match(policy, /nullif\(p\.provider_payment_id, ''\) is not null/);
  assert.match(policy, /p\.status <> 'pending'/);
});

test("paid renter cannot cancel past the stored cutoff while owner can attest unavailability", () => {
  assert.match(policy, /v_actor_role <> 'owner'/);
  assert.match(policy, /p_cancelled_by_role <> 'owner'/);
  assert.match(policy, /p_cancelled_by_role = 'owner'/);
  assert.match(policy, /exceptional_reason/);
  assert.match(policy, /then 'owner_unavailable' else null end/);
  assert.match(policy, /owner_full_refund_owner_cost/);
  assert.match(policy, /Exceptional cancellation after scheduled return is unavailable/);
});

test("only an authenticated owner can invoke an unpaid exceptional cancellation", () => {
  assert.match(policy, /function public\.cancel_approved_reservation_item_unavailable/);
  assert.match(policy, /v_reservation\.owner_id <> auth\.uid\(\)/);
  assert.match(policy, /v_reservation\.status <> 'approved'/);
  assert.match(policy, /clock_timestamp\(\) < v_cutoff or clock_timestamp\(\) >= v_return/);
  assert.match(policy, /reservation_approved_exception_log/);
  assert.match(policy, /grant execute on function public\.cancel_approved_reservation_item_unavailable\(uuid\)\s+to authenticated/);
});

test("paid exceptional reason must be explicitly attested by the owner at the API", () => {
  assert.match(edge, /payload\.exceptional_reason !== "owner_unavailable"/);
  assert.match(edge, /context\.actor_role !== "owner"/);
  assert.match(edge, /Ordinary cancellation deadline has passed/);
  assert.match(edge, /context\.cancellation_id/);
  assert.match(edge, /Idempotency-Key/);
  assert.match(edge, /begin_paid_reservation_cancellation/);
});

test("owner's ordinary cancellation is locked at cutoff, without automatic exception", () => {
  assert.doesNotMatch(owner, /ownerExceptionAvailable/);
  assert.doesNotMatch(owner, /extraordinary\s*=\s*cutoff/);
  assert.doesNotMatch(owner, /exceptionalReason\s*=\s*!ordinaryWindowOpen/);
  assert.match(owner, /renderOwnerReservationCancellationAction/);
  assert.match(owner, /reservation-cancel-locked/);
  assert.match(owner, /isReservationCancellationWindowOpen/);
  assert.match(renter, /renderRenterReservationCancellationAction/);
  assert.match(renter, /isReservationCancellationWindowOpen/);
});

test("all languages show 24-hour ordinary cutoff, refund exception and legacy cutoff", () => {
  const translations = read("js/i18n.js");
  for (const key of ["terms.section10.item1", "terms.section10.item4", "terms.section10.item6",
    "reservations.cancelException.button", "reservations.cancelException.title",
    "reservations.cancelException.attestation", "reservations.cancelException.confirm",
    "reservations.cancelException.unpaidAttestation", "reservations.cancelException.unpaidError"]) {
    const re = new RegExp('"' + key.replaceAll('.', '\\.') + '":', 'g');
    assert.equal([...translations.matchAll(re)].length, 5, key);
  }
  const cutoffCopy = [...translations.matchAll(/"terms\.section10\.item1": "([^"]+)"/g)].map(m => m[1]);
  assert.equal(cutoffCopy.length, 5);
  for (const copy of cutoffCopy) assert.match(copy, /24/);
  assert.match(terms, /více než 24 hodin/);
  assert.match(terms, /plnou platbu zpět/);
});

test("the migration does not change owner transfers or Stripe refund workers", () => {
  assert.doesNotMatch(policy, /create or replace function public\.create_owner_transfer/);
  assert.doesNotMatch(policy, /create or replace function public\.finalize_paid_reservation_cancellation_refund/);
  assert.doesNotMatch(policy, /create or replace function public\.expire_unpaid_reservation/);
  assert.match(policy, /transfer_status <> 'not_created'/);
  assert.match(policy, /refund_status = 'pending'/);
  assert.match(policy, /refund_policy/);
});
