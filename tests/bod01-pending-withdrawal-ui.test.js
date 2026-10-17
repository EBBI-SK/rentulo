"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const sql = read("supabase/migrations/20261017223000_pending_withdrawal_cutoff_FIX_TEST.sql");
const policy = read("supabase/migrations/20261017180000_payment_deadline_before_pickup_TEST.sql");
const owner = read("js/offers-page.js");
const renter = read("js/reservations-page.js");
const shared = read("js/reservations.js");

test("pending request can be withdrawn even inside pickup cutoff, but approved and paid cannot", () => {
  const ctx = { console, Date,
    RESERVATION_STATUS_PENDING: "pending",
    RESERVATION_STATUS_APPROVED: "approved",
    RESERVATION_STATUS_PAID: "paid",
    RESERVATION_STATUS_PICKED_UP: "picked_up",
    RESERVATION_STATUS_RETURNED: "returned",
    getReservationStatus: x => x.status,
    normalizeReservationStatus: x => x
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(shared,ctx);
  const cutoff = "2026-10-10T10:00:00.000Z";
  const after = new Date("2026-10-10T10:00:01.000Z");
  assert.equal(ctx.isReservationCancellationWindowOpen({status:"pending", cancellationCutoffAt:cutoff}, after),true);
  assert.equal(ctx.isReservationCancellationWindowOpen({status:"approved", cancellationCutoffAt:cutoff}, after),false);
  assert.equal(ctx.isReservationCancellationWindowOpen({status:"paid", cancellationCutoffAt:cutoff}, after),false);
});

test("database pending withdrawal is tied to authenticated renter only", () => {
  assert.match(sql, /old.status = 'pending'\s+and new.status = 'cancelled'\s+and auth.uid\(\) = old.renter_id/);
  assert.match(sql, /RESERVATION_ACTIVE_CHECKOUT/);
  assert.match(sql, /make_interval\(hours => old.cancellation_cutoff_hours\)/);
  assert.match(sql, /app.no_show_authorized/);
  assert.match(sql, /app.paid_cancellation_authorized/);
  assert.doesNotMatch(sql, /create or replace function public.calculate_reservation_payment_deadline/);
});

test("renter page exposes withdrawal and keeps approved/paid cutoff lock", () => {
  assert.match(renter, /isPending \? null : getReservationCancellationCutoffAt\(reservation\)/);
  assert.match(renter, /reservations.pendingWithdraw.action/);
  assert.match(renter, /reservations.pendingWithdraw.description/);
  assert.match(renter, /if \(cutoff && !isReservationCancellationWindowOpen\(reservation\)\)/);
  assert.match(shared, /RESERVATION_STATUS_PENDING[\s\S]*?return true;/);
});

test("owner's ordinary cancel is disabled after cutoff instead of becoming 'item unavailable'", () => {
  assert.match(owner, /function disableOwnerReservationCancellationButton/);
  assert.match(owner, /button.disabled = true/);
  assert.match(owner, /reservation-cancel-locked/);
  assert.doesNotMatch(owner, /ownerExceptionAvailable|exceptionalReason|ownerReservationCancelModalExceptional/);
});

test("urgent reservation payment still due within 30 minutes after approval, no later than pickup", () => {
  assert.match(policy, /else least\(p_approved_at \+ interval '30 minutes', p_pickup_at\)/);
  assert.match(policy, /new.expires_at := public.calculate_reservation_payment_deadline/);
});

test("five languages contain pending withdrawal text", () => {
  const i18n = read("js/i18n.js");
  for (const key of ["reservations.pendingWithdraw.action", "reservations.pendingWithdraw.title", "reservations.pendingWithdraw.description"]) {
    const all=[...i18n.matchAll(new RegExp('"'+key.replaceAll('.','\\.')+'"', 'g'))];
    assert.equal(all.length,5,key);
  }
});
