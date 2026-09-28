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

test("paid cancellation email event is stored idempotently for both recipients", () => {
  assert.match(migrationSource, /reservation_email_deliveries_event_type_check/i);
  assert.match(migrationSource, /'paid_cancelled'/i);
  assert.match(emailSource, /\| "paid_cancelled";/);
  assert.match(emailSource, /event_type:\s*event/);
  assert.match(emailSource, /recipientIds = Array\.from\(new Set\(\[reservation\.renter_id, reservation\.owner_id\]\)\)/);
  assert.match(emailSource, /existingDelivery\.status !== "failed"/);
});

test("paid cancellation email can only be invoked as a trusted service-role payment event", () => {
  assert.match(emailSource, /isServiceRoleCall && event !== "paid" && event !== "paid_cancelled"/);
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

test("owner cancellation email supports full renter refund plus the exact seven-day owner debt", () => {
  assert.match(emailSource, /owner_full_refund_owner_cost/);
  assert.match(emailSource, /owner_cancellation_debts/);
  assert.match(emailSource, /Skutečné náklady Stripe k úhradě/);
  assert.match(emailSource, /Splatnost/);
  assert.match(emailSource, /formatTimestampDate\(ownerDebt\.due_at, language\)/);
});

test("paid cancellation copy remains available in all five supported languages", () => {
  for (const language of ["cs", "sk", "en", "de", "pl"]) {
    assert.match(emailSource, new RegExp(`\\n  ${language}: \\{`));
  }
  assert.match(emailSource, /Reservation cancelled – payment refund/);
  assert.match(emailSource, /Reservierung storniert – Rückerstattung/);
  assert.match(emailSource, /Rezerwacja anulowana – zwrot płatności/);
});

test("refund endpoint triggers paid cancellation email only after a succeeded finalized refund", () => {
  assert.match(cancelSource, /event:\s*"paid_cancelled"/);
  assert.match(cancelSource, /Authorization:\s*`Bearer \$\{serviceRoleKey\}`/);
  assert.match(cancelSource, /apikey:\s*serviceRoleKey/);
  assert.match(
    cancelSource,
    /context\.refund_status === "succeeded"[\s\S]*sendPaidCancellationEmail\(supabaseUrl, serviceRoleKey, context\.reservation_id\)/
  );
  assert.match(
    cancelSource,
    /refundStatus === "succeeded" && finalized\.financials_finalized_at[\s\S]*sendPaidCancellationEmail\(supabaseUrl, serviceRoleKey, context\.reservation_id\)/
  );
});

test("email failure cannot roll back an already completed Stripe refund", () => {
  assert.match(cancelSource, /Promise<"sent" \| "failed">/);
  assert.match(cancelSource, /return "failed";/);
  assert.match(cancelSource, /return jsonResponse\(\{ \.\.\.responseBody, email_status: emailStatus \}\);/);
});
