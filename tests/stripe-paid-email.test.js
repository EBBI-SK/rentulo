"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const WEBHOOK_PATH = path.join(
  PROJECT_ROOT,
  "supabase",
  "functions",
  "stripe-webhook",
  "index.ts"
);
const EMAIL_FUNCTION_PATH = path.join(
  PROJECT_ROOT,
  "supabase",
  "functions",
  "send-reservation-email",
  "index.ts"
);

function readWebhook() {
  return fs.readFileSync(WEBHOOK_PATH, "utf8");
}

function readEmailFunction() {
  return fs.readFileSync(EMAIL_FUNCTION_PATH, "utf8");
}

test("Stripe webhook sends the paid email only after trusted payment completion", () => {
  const source = readWebhook();

  assert.match(
    source,
    /fetch\(`\$\{supabaseUrl\}\/functions\/v1\/send-reservation-email`,[\s\S]*Authorization:\s*`Bearer \$\{serviceRoleKey\}`[\s\S]*apikey:\s*serviceRoleKey[\s\S]*reservation_id:\s*reservationId[\s\S]*event:\s*"paid"/
  );

  const completionIndex = source.indexOf(
    'admin.rpc("complete_stripe_payment_from_webhook"'
  );
  const emailIndex = source.indexOf("await sendPaidReservationEmail(");
  const finalizedIndex = source.indexOf(
    'const finalized = await updateEventStatus(admin, stripeEventId, "processed"'
  );

  assert.ok(completionIndex >= 0, "Trusted payment completion RPC must exist");
  assert.ok(
    emailIndex > completionIndex,
    "Paid email must be requested only after payment completion succeeds"
  );
  assert.ok(
    finalizedIndex > emailIndex,
    "Webhook event must be finalized only after the paid email request succeeds"
  );

  assert.match(
    source,
    /if \(!paidEmail\.ok\) \{[\s\S]*updateEventStatus\(admin, stripeEventId, "failed"[\s\S]*return jsonResponse\(\{ error: "Paid reservation email failed" \}, 500\)/
  );
});

test("reservation email function allows service role only for paid events and preserves user authorization", () => {
  const source = readEmailFunction();

  assert.match(
    source,
    /const isServiceRoleCall = authHeader === `Bearer \$\{serviceRoleKey\}`;/
  );
  assert.match(
    source,
    /if \(isServiceRoleCall && event !== "paid"\) \{[\s\S]*Service role is only allowed for paid email events[\s\S]*403/
  );
  assert.match(source, /if \(!isServiceRoleCall\) \{[\s\S]*auth\.getUser\(\)/);
  assert.match(
    source,
    /!isServiceRoleCall &&[\s\S]*ownerEvents\.includes\(event\)[\s\S]*renterEvents\.includes\(event\)/
  );
  assert.match(
    source,
    /if \(event === "new_request" \|\| event === "paid"\) \{[\s\S]*recipientIds = \[reservation\.owner_id\]/
  );
});

test("paid email delivery remains idempotent and failed provider deliveries can be retried", () => {
  const source = readEmailFunction();

  assert.match(source, /from\("reservation_email_deliveries"\)[\s\S]*\.insert\(/);
  assert.match(source, /logError\.code !== "23505"/);
  assert.match(
    source,
    /select\("id, status"\)[\s\S]*\.eq\("reservation_id", reservation\.id\)[\s\S]*\.eq\("event_type", event\)[\s\S]*\.eq\("recipient_id", profile\.id\)/
  );
  assert.match(
    source,
    /if \(existingDelivery\.status !== "failed"\) \{[\s\S]*status: "duplicate"[\s\S]*continue;/
  );
  assert.match(
    source,
    /status:\s*"sending"[\s\S]*provider_message_id:\s*null[\s\S]*error_message:\s*null[\s\S]*sent_at:\s*null/
  );
  assert.match(
    source,
    /if \(!resendResponse\.ok\) \{[\s\S]*status: "failed"[\s\S]*Email provider rejected the message/
  );
});
