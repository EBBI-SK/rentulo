"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const RESERVATIONS_PATH = path.join(PROJECT_ROOT, "js", "reservations.js");
const RESERVATIONS_CSS_PATH = path.join(PROJECT_ROOT, "css", "my-reservations.css");
const OFFERS_PATH = path.join(PROJECT_ROOT, "js", "offers-page.js");
const MIGRATION_PATH = path.join(
  PROJECT_ROOT,
  "supabase",
  "migrations",
  "20260924110000_enforce_six_hour_cancellation_cutoff.sql"
);

function compact(value) {
  return value.replace(/\s+/g, " ").trim();
}

function loadReservationContext() {
  const context = {
    console,
    Date,
    window: null,
    RESERVATION_STATUS_PENDING: "pending",
    RESERVATION_STATUS_APPROVED: "approved",
    RESERVATION_STATUS_PAID: "paid",
    RESERVATION_STATUS_PICKED_UP: "picked_up",
    RESERVATION_STATUS_RETURNED: "returned",
    getReservationStatus(reservation) {
      return reservation && reservation.status ? reservation.status : "pending";
    },
    normalizeReservationStatus(status) {
      return status;
    }
  };

  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(RESERVATIONS_PATH, "utf8"), context, {
    filename: "js/reservations.js"
  });

  return context;
}

test("cancellation stays open before the exact six-hour cutoff and closes at it", () => {
  const context = loadReservationContext();
  const reservation = {
    status: "approved",
    cancellationCutoffAt: "2026-10-12T11:00:00.000Z"
  };

  assert.equal(
    context.isReservationCancellationWindowOpen(
      reservation,
      new Date("2026-10-12T10:59:59.999Z")
    ),
    true
  );
  assert.equal(
    context.isReservationCancellationWindowOpen(
      reservation,
      new Date("2026-10-12T11:00:00.000Z")
    ),
    false
  );
});

test("old reservations without a stored cutoff keep the previous status-only behavior", () => {
  const context = loadReservationContext();

  assert.equal(
    context.isReservationCancellationWindowOpen({ status: "pending" }),
    true
  );
  assert.equal(
    context.isReservationCancellationWindowOpen({ status: "approved" }),
    true
  );
  assert.equal(
    context.isReservationCancellationWindowOpen({ status: "paid" }),
    false
  );
});

test("reservations page integration stores the server cutoff and renders a disabled action after it", () => {
  const source = fs.readFileSync(RESERVATIONS_PATH, "utf8");

  assert.match(source, /row\.cancellation_cutoff_at/);
  assert.match(source, /reservation\.cancellationCutoffAt/);
  assert.match(source, /data-cancel-cutoff/);
  assert.match(source, /reservation-cancel-locked/);
  assert.match(source, /disabled[\s\S]*aria-disabled="true"/);
  assert.match(source, /DOMContentLoaded[\s\S]*installReservationCancellationCutoffUi/);

  for (const language of ["cs", "sk", "en", "de", "pl"]) {
    assert.match(
      source,
      new RegExp("\\b" + language + ":\\s*\\\"")
    );
  }

  for (const fragment of [
    "více než 6 hodin",
    "viac ako 6 hodín",
    "more than 6 hours",
    "mehr als 6 Stunden",
    "ponad 6 godzin"
  ]) {
    assert.match(source, new RegExp(fragment));
  }
});

test("owner approved reservation uses the same six-hour cutoff and locked action", () => {
  const source = fs.readFileSync(OFFERS_PATH, "utf8");

  assert.match(source, /cancellationCutoffAt:\s*row\.cancellation_cutoff_at/);
  assert.match(source, /canOwnerCancelReservation\(reservation\)/);
  assert.match(source, /data-offers-action=\\?"cancel-reservation\\?"/);
  assert.match(source, /data-cancel-cutoff/);
  assert.match(source, /openOwnerReservationCancelModal/);
  assert.match(source, /RESERVATION_STATUS_CANCELLED/);
});

test("locked cancellation keeps the cancel button aligned on the right", () => {
  const css = fs.readFileSync(RESERVATIONS_CSS_PATH, "utf8");

  assert.match(
    css,
    /\.reservation-detail-actions\s*\{[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?justify-content:\s*flex-end;/
  );
  assert.match(
    css,
    /\.reservation-detail-actions \.reservation-cancel-cutoff-note\s*\{[\s\S]*?flex:\s*0 0 100%;[\s\S]*?text-align:\s*right;/
  );
});

test("database exposes the exact six-hour cutoff and enforces it for both parties", () => {
  const sql = compact(fs.readFileSync(MIGRATION_PATH, "utf8"));

  assert.match(
    sql,
    /pickup_time time without time zone, cancellation_cutoff_at timestamp with time zone/i
  );
  assert.match(
    sql,
    /\(\(r\.start_date \+ r\.pickup_time\) at time zone 'Europe\/Prague'\) - interval '6 hours' as cancellation_cutoff_at/i
  );
  assert.match(
    sql,
    /auth\.uid\(\) = old\.owner_id and old\.status = 'approved'/i
  );
  assert.match(
    sql,
    /auth\.uid\(\) = old\.renter_id and old\.status in \('pending', 'approved'\)/i
  );
  assert.match(
    sql,
    /old\.pickup_time is not null and now\(\) >= \( \(\(old\.start_date \+ old\.pickup_time\) at time zone 'Europe\/Prague'\) - interval '6 hours' \)/i
  );
  assert.match(
    sql,
    /Reservation can no longer be cancelled within 6 hours of pickup/i
  );
  assert.match(
    sql,
    /new\.status\s*=\s*'cancelled'/i
  );
  assert.match(
    sql,
    /auth\.uid\(\)\s*=\s*old\.owner_id[\s\S]*old\.status\s*=\s*'approved'/i
  );
  assert.match(
    sql,
    /auth\.uid\(\)\s*=\s*old\.renter_id[\s\S]*old\.status\s+in\s*\(\s*'pending'\s*,\s*'approved'\s*\)/i
  );
  assert.match(
    sql,
    /new\.status\s*=\s*'cancelled'/i
  );
  assert.match(
    sql,
    /auth\.uid\(\)\s*=\s*old\.owner_id[\s\S]*old\.status\s*=\s*'approved'/i
  );
  assert.match(
    sql,
    /auth\.uid\(\)\s*=\s*old\.renter_id[\s\S]*old\.status\s+in\s*\(\s*'pending'\s*,\s*'approved'\s*\)/i
  );
  assert.match(
    sql,
    /new\.status\s*=\s*'cancelled'/i
  );
  assert.match(
    sql,
    /auth\.uid\(\)\s*=\s*old\.owner_id[\s\S]*old\.status\s*=\s*'approved'/i
  );
  assert.match(
    sql,
    /auth\.uid\(\)\s*=\s*old\.renter_id[\s\S]*old\.status\s+in\s*\(\s*'pending'\s*,\s*'approved'\s*\)/i
  );
  assert.match(
    sql,
    /new\.status\s*=\s*'cancelled'/i
  );
  assert.match(
    sql,
    /auth\.uid\(\)\s*=\s*old\.owner_id[\s\S]*old\.status\s*=\s*'approved'/i
  );
  assert.match(
    sql,
    /auth\.uid\(\)\s*=\s*old\.renter_id[\s\S]*old\.status\s+in\s*\(\s*'pending'\s*,\s*'approved'\s*\)/i
  );
  assert.match(
    sql,
    /new\.status\s*=\s*'cancelled'/i
  );
  assert.match(
    sql,
    /auth\.uid\(\)\s*=\s*old\.owner_id[\s\S]*old\.status\s*=\s*'approved'/i
  );
  assert.match(
    sql,
    /auth\.uid\(\)\s*=\s*old\.renter_id[\s\S]*old\.status\s+in\s*\(\s*'pending'\s*,\s*'approved'\s*\)/i
  );
});
