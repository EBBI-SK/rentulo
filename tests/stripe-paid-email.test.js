"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (filename) => fs.readFileSync(path.join(root, filename), "utf8");
const webhook = read("supabase/functions/stripe-webhook/index.ts");
const email = read("supabase/functions/send-reservation-email/index.ts");
const migration = read("supabase/migrations/20261012100000_unify_reservation_notification_outbox.sql");

// BOD 13: the payment commit creates the notification queue entry atomically.
// Stripe's signed event must never fail merely because Resend is unavailable.
test("Stripe payment completion queues its notification in the database instead of blocking on an email", () => {
  const completed = webhook.indexOf('admin.rpc("complete_stripe_payment_from_webhook"');
  const finalized = webhook.indexOf('const finalized = await updateEventStatus(admin, stripeEventId, "processed"');
  assert.ok(completed >= 0 && finalized > completed);
  assert.doesNotMatch(webhook, /sendPaidReservationEmail/);
  assert.doesNotMatch(webhook, /Paid reservation email failed/);
  assert.match(migration, /when 'paid' then 'paid'/);
  assert.match(migration, /after update of status on public\.reservations/);
  assert.match(migration, /v_recipient := new\.owner_id/);
  assert.match(migration, /perform public\.queue_reservation_notification\(/);
});

test("email worker calls are bound to a real claimed delivery and browser authorization remains intact", () => {
  assert.match(email, /const isServiceRoleCall = authHeader === `Bearer \$\{serviceRoleKey\}`;/);
  assert.match(email, /isWorkerDelivery = isServiceRoleCall/);
  assert.match(email, /from\("reservation_notification_deliveries"\)/);
  assert.match(email, /\.eq\("channel", "email"\)/);
  assert.match(email, /\.eq\("status", "sending"\)/);
  assert.match(email, /Only the trusted notification worker can select recipients/);
  assert.match(email, /Service role requires a claimed delivery for non-payment email events/);
  assert.match(email, /!isServiceRoleCall && event === "paid_cancelled"/);
  assert.match(email, /if \(!isServiceRoleCall\) \{[\s\S]*auth\.getUser\(\)/);
  assert.match(email, /ownerEvents\.includes\(event\)[\s\S]*renterEvents\.includes\(event\)/);
});

test("Resend idempotency is stable across retries and a fresh in-progress delivery is not falsely reported sent", () => {
  assert.match(email, /from\("reservation_email_deliveries"\)[\s\S]*\.insert\(/);
  assert.match(email, /logError\.code !== "23505"/);
  assert.match(email, /if \(existingDelivery\.status === "sent"\)[\s\S]*status: "duplicate"/);
  assert.match(email, /if \(existingDelivery\.status === "sending" &&[\s\S]*status: "in_progress"/);
  assert.match(email, /"Idempotency-Key": `rentulo-\$\{logRow\.id\}`/);
  assert.match(email, /status:\s*"failed"[\s\S]*Email provider rejected the message/);
  assert.match(email, /status: "sent"[\s\S]*provider_message_id:/);
});
