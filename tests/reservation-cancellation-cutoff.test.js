"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const RESERVATIONS_PATH = path.join(PROJECT_ROOT, "js", "reservations.js");
const MIGRATION_PATH = path.join(
  PROJECT_ROOT,
  "supabase",
  "migrations",
  "20260923093000_add_reservation_pickup_time.sql"
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

test("cancellation stays open before the exact two-hour cutoff and closes at it", () => {
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
});

test("database exposes the exact cutoff and enforces it in the status trigger", () => {
  const sql = compact(fs.readFileSync(MIGRATION_PATH, "utf8"));

  assert.match(
    sql,
    /pickup_time time without time zone, cancellation_cutoff_at timestamp with time zone/i
  );
  assert.match(
    sql,
    /\(\(r\.start_date \+ r\.pickup_time\) at time zone 'Europe\/Prague'\) - interval '2 hours' as cancellation_cutoff_at/i
  );
  assert.match(
    sql,
    /old\.status in \('pending', 'approved'\) and new\.status = 'cancelled'/i
  );
  assert.match(
    sql,
    /old\.pickup_time is not null and now\(\) >= \( \(\(old\.start_date \+ old\.pickup_time\) at time zone 'Europe\/Prague'\) - interval '2 hours' \)/i
  );
  assert.match(
    sql,
    /Reservation can no longer be cancelled within 2 hours of pickup/i
  );
});
