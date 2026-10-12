"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const CANCEL_FUNCTION_PATH = path.join(
  PROJECT_ROOT,
  "supabase",
  "functions",
  "cancel-paid-reservation",
  "index.ts"
);
const EMAIL_FUNCTION_PATH = path.join(
  PROJECT_ROOT,
  "supabase",
  "functions",
  "send-reservation-email",
  "index.ts"
);
const MIGRATION_PATH = path.join(
  PROJECT_ROOT,
  "supabase",
  "migrations",
  "20260928190000_add_paid_cancellation_email_event.sql"
);

const cancelSource = fs.readFileSync(CANCEL_FUNCTION_PATH, "utf8");
const emailSource = fs.readFileSync(EMAIL_FUNCTION_PATH, "utf8");
const migrationSource = fs.readFileSync(MIGRATION_PATH, "utf8").replace(/\s+/g, " ");

const queueMigration = fs.readFileSync(
  path.join(PROJECT_ROOT, "supabase", "migrations", "20261012100000_unify_reservation_notification_outbox.sql"), "utf8");

test("paid cancellation emails are queued for both parties only after refund success", () => {
  assert.match(migrationSource, /reservation_email_deliveries_event_type_check/i);
  assert.match(migrationSource, /'paid_cancelled'/i);
  assert.match(emailSource, /\| "paid_cancelled";/);
  assert.match(queueMigration, /queue_finalized_paid_cancellation_notifications/);
  assert.match(queueMigration, /p\.refund_status = 'succeeded'/);
  assert.match(queueMigration, /c\.financials_finalized_at is not null/);
  assert.match(queueMigration, /v_reservation\.owner_id/);
  assert.match(queueMigration, /v_reservation\.renter_id/);
  assert.match(queueMigration, /unique \(reservation_id, event_type, recipient_id, channel\)/);
});

test("trusted worker notification is verified against a claimed delivery", () => {
  assert.match(emailSource, /isWorkerDelivery = isServiceRoleCall/);
  assert.match(emailSource, /Claimed notification delivery not found/);
  assert.match(emailSource, /\.eq\("recipient_id", payload\.recipient_id\)/);
  assert.match(emailSource, /!isServiceRoleCall && event === "paid_cancelled"/);
  assert.match(emailSource, /Paid cancellation email requires service role/);
});

test("paid cancellation email requires finalized financials and a succeeded Stripe refund", () => {
  assert.match(emailSource, /cancellation_kind !== "paid_refund"/);
  assert.match(emailSource, /!paidCancellation\.financials_finalized_at/);
  assert.match(emailSource, /payment\.refund_status !== "succeeded"/);
  assert.match(emailSource, /Number\(payment\.stripe_refund_amount_minor\) !== refundAmountMinor/);
});

test("renter cancellation receipt contains the exact paid, Stripe cost and refund amounts", () => {
  assert.match(emailSource, /Rezervace byla zrušena – vrácení platby/);
  assert.match(emailSource, /Skutečné náklady Stripe/);
  assert.match(emailSource, /Částka bude vrácena na původní platební metodu\./);
  assert.match(emailSource, /formatCurrencyMinor\(Number\(cancellation\.payment_amount_minor\), language\)/);
  assert.match(emailSource, /formatCurrencyMinor\(Number\(cancellation\.refund_amount_minor\), language\)/);
  assert.match(emailSource, /formatCurrencyMinor\(Number\(cancellation\.external_cost_amount_minor\), language\)/);
});

test("owner email for renter cancellation stays simple and omits renter refund details", () => {
  const ownerRenterCopy = emailSource.match(
    /ownerRenter: \[([\s\S]*?)\n    \],\n    ownerSelf:/
  )?.[1] || "";

  assert.match(ownerRenterCopy, /Nájemce zrušil rezervaci/);
  assert.match(ownerRenterCopy, /Nájemce zrušil rezervaci\. Termín je znovu volný\./);
  assert.doesNotMatch(ownerRenterCopy, /zaplacenou rezervaci/);
  assert.doesNotMatch(ownerRenterCopy, /Nájemci vráceno/);
  assert.match(
    emailSource,
    /if \(recipientIsOwner && cancellation\.cancelled_by_role === "renter"\) \{[\s\S]*const \[subject, intro\] = copy\.ownerRenter;[\s\S]*financialHtml: ""/
  );
});

test("owner cancellation email supports full renter refund plus the exact seven-day owner debt", () => {
  assert.match(emailSource, /owner_full_refund_owner_cost/);
  assert.match(emailSource, /owner_cancellation_debts/);
  assert.match(emailSource, /Skutečné náklady Stripe k úhradě/);
  assert.match(emailSource, /Splatnost/);
  assert.match(emailSource, /formatTimestampDate\(ownerDebt\.due_at, language\)/);
});

test("all reservation emails use the same explicit typography across email clients", () => {
  assert.match(
    emailSource,
    /<div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;color:#103f32;font-size:16px;line-height:1\.5">/
  );
  assert.match(
    emailSource,
    /<h1 style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:1\.25;font-weight:700;color:#103f32">/
  );
  assert.match(
    emailSource,
    /<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1\.5;color:#103f32">\$\{escapeHtml\(intro\)\}<\/p>/
  );
  assert.match(
    emailSource,
    /font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1\.25;font-weight:700/
  );
});

test("paid cancellation copy remains available in all five supported languages", () => {
  for (const language of ["cs", "sk", "en", "de", "pl"]) {
    assert.match(emailSource, new RegExp(`\\n  ${language}: \\{`));
  }
  assert.match(emailSource, /Reservation cancelled – payment refund/);
  assert.match(emailSource, /Reservierung storniert – Rückerstattung/);
  assert.match(emailSource, /Rezerwacja anulowana – zwrot płatności/);
});

test("refund endpoint leaves notification scheduling to Stripe/financial completion triggers", () => {
  assert.doesNotMatch(cancelSource, /sendPaidCancellationEmail/);
  assert.match(queueMigration, /after update of refund_status on public\.payments/);
  assert.match(queueMigration, /after update of financials_finalized_at on public\.reservation_cancellations/);
  assert.match(queueMigration, /v_cancellation\.cancelled_by_role = 'renter'/);
  assert.match(queueMigration, /v_cancellation\.cancelled_by_role = 'owner'/);
});

test("notification provider failure cannot roll back a completed Stripe refund", () => {
  assert.doesNotMatch(cancelSource, /sendPaidCancellationEmail/);
  assert.match(cancelSource, /return jsonResponse\(existingResponse\)/);
  assert.match(cancelSource, /return jsonResponse\(responseBody\)/);
  assert.match(cancelSource, /admin\.rpc\("finalize_paid_reservation_cancellation_refund"/);
});
