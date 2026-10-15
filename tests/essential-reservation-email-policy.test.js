"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const emailSource = fs.readFileSync(
  path.join(root, "supabase/functions/send-reservation-email/index.ts"), "utf8"
);
const policyPath = path.join(root, "supabase/functions/_shared/notification-email-policy.mjs");
const policy = import(pathToFileURL(policyPath).href);

const essential = [
  "new_request", "approved", "rejected", "cancelled", "paid", "paid_cancelled",
  "expiry_reminder_pending", "expiry_reminder_approved",
  "expired_pending", "expired_approved", "no_show",
];
const optional = ["picked_up", "returned"];

test("all reservation email events have an explicit, reviewed essential/optional classification", async () => {
  const sourceEvents = emailSource.match(/type EmailEvent =([\s\S]*?);/)?.[1] || "";
  const knownEvents = [...sourceEvents.matchAll(/"([a-z_]+)"/g)].map(m => m[1]);
  assert.deepEqual(knownEvents.sort(), [...essential, ...optional].sort());

  const { shouldDeliverReservationEmail } = await policy;
  for (const event of essential) {
    assert.equal(shouldDeliverReservationEmail(event, "person@example.com", false), true, event);
  }
  for (const event of optional) {
    assert.equal(shouldDeliverReservationEmail(event, "person@example.com", false), false, event);
  }
});

test("booking decision emails cannot be disabled during 24-hour response/payment windows", async () => {
  const { shouldDeliverReservationEmail } = await policy;
  for (const event of ["new_request", "approved", "rejected", "cancelled"]) {
    assert.equal(shouldDeliverReservationEmail(event, "person@example.com", false), true, event);
  }
});

test("payment, verified paid cancellation and refund/debt receipts bypass optional email opt-out", async () => {
  const { shouldDeliverReservationEmail } = await policy;
  for (const event of ["paid", "paid_cancelled"]) {
    assert.equal(shouldDeliverReservationEmail(event, "person@example.com", false), true, event);
  }
  // This policy does not relax the existing refund success/finalization guards.
  assert.match(emailSource, /payment\.refund_status !== "succeeded"/);
  assert.match(emailSource, /!paidCancellation\.financials_finalized_at/);
});

test("deadline reminders and expiration notices stay mandatory when notifications are off", async () => {
  const { shouldDeliverReservationEmail } = await policy;
  for (const event of essential.filter(e => e.startsWith("expiry_") || e.startsWith("expired_"))) {
    assert.equal(shouldDeliverReservationEmail(event, "person@example.com", false), true, event);
  }
});

test("pickup and return updates remain optional and enabled by default", async () => {
  const { shouldDeliverReservationEmail } = await policy;
  for (const event of optional) {
    assert.equal(shouldDeliverReservationEmail(event, "person@example.com", false), false);
    for (const preference of [true, null, undefined]) {
      assert.equal(shouldDeliverReservationEmail(event, "person@example.com", preference), true);
    }
  }
});

test("all events require a recipient email; never send an unknown event", async () => {
  const { shouldDeliverReservationEmail } = await policy;
  for (const recipientEmail of ["", "  ", null, undefined]) {
    for (const event of [...essential, ...optional]) {
      assert.equal(shouldDeliverReservationEmail(event, recipientEmail, true), false);
    }
  }
  for (const preference of [true, false, undefined]) {
    assert.equal(shouldDeliverReservationEmail("future_unclassified", "person@example.com", preference), false);
    assert.equal(shouldDeliverReservationEmail("marketing", "person@example.com", preference), false);
  }
});

test("real email send loop uses reviewed delivery policy before writing transport log", () => {
  assert.match(emailSource, /import \{ shouldDeliverReservationEmail \} from "\.\.\/_shared\/notification-email-policy\.mjs"/);
  assert.match(emailSource, /for \(const profile of profiles \|\| \[\]\) \{[\s\S]*?if \(!shouldDeliverReservationEmail\(event, profile\.email, profile\.email_notifications\)\) \{/);
  const condition = emailSource.indexOf("if (!shouldDeliverReservationEmail(event, profile.email, profile.email_notifications))");
  const deliveryLog = emailSource.indexOf('from("reservation_email_deliveries")', condition);
  const provider = emailSource.indexOf('fetch("https://api.resend.com/emails"', condition);
  assert.ok(condition >= 0 && deliveryLog > condition && provider > deliveryLog);
  assert.doesNotMatch(emailSource, /!isEssentialExpiryNotice/);
});

test("existing claimed-worker and paid-cancellation authorization checks are preserved", () => {
  assert.match(emailSource, /const isWorkerDelivery = isServiceRoleCall/);
  assert.match(emailSource, /Claimed notification delivery not found/);
  assert.match(emailSource, /!isServiceRoleCall && event === "paid_cancelled"/);
  assert.match(emailSource, /Paid cancellation email requires service role/);
  assert.match(emailSource, /"Idempotency-Key": `rentulo-\$\{logRow\.id\}`/);
});
