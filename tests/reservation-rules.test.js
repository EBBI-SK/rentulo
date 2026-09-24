"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function loadReservationContext() {
  const context = {
    console,
    window: null
  };

  context.window = context;
  vm.createContext(context);

  for (const relativePath of [
    "js/reservation-status.js",
    "js/reservations.js"
  ]) {
    vm.runInContext(
      fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8"),
      context,
      { filename: relativePath }
    );
  }

  return context;
}

const context = loadReservationContext();

function reservation(status) {
  return { status };
}

test("reservation status normalization preserves the canonical workflow", () => {
  const canonical = [
    "pending",
    "approved",
    "paid",
    "picked_up",
    "returned",
    "rejected",
    "cancelled",
    "completed"
  ];

  for (const status of canonical) {
    assert.equal(context.normalizeReservationStatus(status), status);
  }

  assert.equal(context.normalizeReservationStatus("Čeká na potvrzení"), "pending");
  assert.equal(context.normalizeReservationStatus("Čeká na platbu"), "approved");
  assert.equal(context.normalizeReservationStatus("Zaplaceno"), "paid");
  assert.equal(context.normalizeReservationStatus("Vyzvednuto"), "picked_up");
  assert.equal(context.normalizeReservationStatus("Vráceno"), "returned");
  assert.equal(context.normalizeReservationStatus("Odmítnuto"), "rejected");
  assert.equal(context.normalizeReservationStatus("Zrušeno"), "cancelled");
  assert.equal(context.normalizeReservationStatus("Dokončeno"), "completed");
});

test("only active reservation statuses block availability", () => {
  for (const status of ["pending", "approved", "paid", "picked_up"]) {
    assert.equal(context.isBlockingReservationStatus(status), true, status);
  }

  for (const status of ["returned", "rejected", "cancelled", "completed"]) {
    assert.equal(context.isBlockingReservationStatus(status), false, status);
  }
});

test("owner and renter actions follow the intended status transitions", () => {
  for (const status of [
    "pending",
    "approved",
    "paid",
    "picked_up",
    "returned",
    "rejected",
    "cancelled",
    "completed"
  ]) {
    const item = reservation(status);

    assert.equal(
      context.canOwnerApproveReservation(item),
      status === "pending",
      "owner approve: " + status
    );
    assert.equal(
      context.canOwnerRejectReservation(item),
      status === "pending",
      "owner reject: " + status
    );
    assert.equal(
      context.canRenterPayReservation(item),
      status === "approved",
      "renter pay: " + status
    );
    assert.equal(
      context.canRenterCancelReservation(item),
      status === "pending" || status === "approved",
      "renter cancel: " + status
    );
    assert.equal(
      context.canOwnerCancelReservation(item),
      status === "approved",
      "owner cancel: " + status
    );
    assert.equal(
      context.canOwnerConfirmPickedUpReservation(item),
      status === "paid",
      "owner pickup: " + status
    );
    assert.equal(
      context.canOwnerConfirmReturnedReservation(item),
      status === "picked_up",
      "owner return: " + status
    );
  }
});

test("contact details become visible only after payment and remain visible through return", () => {
  for (const status of ["pending", "approved", "rejected", "cancelled", "completed"]) {
    assert.equal(context.getReservationContactVisible(status), false, status);
  }

  for (const status of ["paid", "picked_up", "returned"]) {
    assert.equal(context.getReservationContactVisible(status), true, status);
  }
});
