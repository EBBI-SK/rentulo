"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const policy = read("supabase/migrations/20261012171000_reservation_expiration_policy.sql");
const enumMigration = read("supabase/migrations/20261012170000_add_expired_reservation_status.sql");
const schedule = read("supabase/migrations/20261012172000_schedule_reservation_expiration.sql");
const checkout = read("supabase/functions/create-checkout-session/index.ts");
const worker = read("supabase/functions/expire-reservations/index.ts");
const email = read("supabase/functions/send-reservation-email/index.ts");
const mainWorker = read("supabase/functions/process-reservation-notifications/index.ts");
const i18n = read("js/i18n.js");

test("new enum is committed separately, old TEST reservations remain untouched", () => {
  assert.match(enumMigration, /alter type public\.reservation_status add value if not exists 'expired';/);
  assert.doesNotMatch(policy, /update public\.reservations\s+set\s+expires_at/i);
  assert.match(policy, /new\.expires_at := least\(now\(\) \+ interval '24 hours', v_pickup_at\)/);
  assert.match(policy, /PICKUP_TIME_PASSED/);
  assert.match(policy, /old\.status = 'pending' and new\.status = 'approved'/);
  assert.match(policy, /new\.approved_at := now\(\)/);
  assert.match(policy, /new\.expires_at := least\(now\(\) \+ interval '24 hours', v_pickup_at\)/);
  assert.match(policy, /new\.expiry_reason := case when old\.status = 'pending'/);
});

test("trusted database expiration checks pending/approved, Stripe, and checkout in-flight atomically", () => {
  assert.match(policy, /create or replace function public\.expire_unpaid_reservation/);
  assert.match(policy, /auth\.role\(\) <> 'service_role'/);
  assert.match(policy, /current_setting\('app\.reservation_expiration_authorized', true\)/);
  assert.match(policy, /r\.status in \('pending', 'approved'\)/);
  assert.match(policy, /r\.expires_at <= now\(\)/);
  assert.match(policy, /p\.status <> 'pending'/);
  assert.match(policy, /p\.checkout_inflight_started_at is not null/);
  assert.match(policy, /p\.checkout_attempt_started_at is not null/);
  assert.match(policy, /p\.provider_payment_id.*p_verified_expired_session_id/s);
  assert.match(policy, /revoke all on function public\.expire_unpaid_reservation/);
});

test("Stripe checkout creation is claimed BEFORE external request; in-flight operation is durable", () => {
  assert.match(policy, /checkout_attempt_started_at timestamptz/);
  assert.match(policy, /checkout_inflight_started_at timestamptz/);
  assert.match(policy, /select \* into v_payment from public\.payments[\s\S]*for update/);
  assert.match(policy, /v_reservation\.status <> 'approved'/);
  assert.match(policy, /checkout_inflight_started_at = now\(\)/);
  assert.match(policy, /function public\.finish_reservation_checkout_attempt/);
  const claimIndex = checkout.indexOf('admin.rpc("mark_reservation_checkout_started"');
  const stripeIndex = checkout.indexOf('fetch("https://api.stripe.com/v1/checkout/sessions",');
  assert.ok(claimIndex > 0 && stripeIndex > claimIndex);
  assert.match(checkout, /finishCheckoutAttempt\(previousSessionId\)/);
  assert.match(checkout, /finishCheckoutAttempt\(checkoutSession\.id\)/);
});

test("cron and reminders are Vault-authenticated, no unconfigured URL and no automatic SMS", () => {
  assert.match(schedule, /'\*\/5 \* \* \* \*'/);
  assert.match(schedule, /rentulo_notification_cron_secret/);
  assert.match(schedule, /rentulo_project_url/);
  assert.match(schedule, /expire-reservations/);
  assert.match(worker, /verify_reservation_notification_cron_secret/);
  assert.match(policy, /new\.status = 'expired'/);
  assert.match(policy, /queue_expiry_reminders/);
  assert.match(policy, /expires_at <= now\(\) \+ interval '4 hours'/);
  assert.match(policy, /expiry_reminder_pending/);
  assert.match(policy, /expiry_reminder_approved/);
  assert.match(policy, /expired_pending/);
  assert.match(policy, /expired_approved/);
  assert.match(policy, /new\.owner_id, false/);
  assert.match(policy, /new\.renter_id, false/);
  assert.match(mainWorker, /expiry_reminder_pending/);
  assert.match(mainWorker, /expired_approved/);
});

test("five languages show expired status and deadlines, expiry goes to history", () => {
  for (const key of [
    '"reservation.status.expired"', '"reservations.expiration.ownerDeadline"',
    '"reservations.expiration.paymentDeadline"', '"reservations.expiration.review"',
    '"reservations.expiration.ownerExpired"', '"reservations.expiration.paymentExpired"',
  ]) assert.equal(i18n.split(key).length - 1, 5, key);
  assert.match(read("js/history-page.js"), /"expired",/);
  assert.match(read("js/reservation-status.js"), /RESERVATION_STATUS_EXPIRED/);
  assert.match(read("js/reservations-page.js"), /renderReservationDeadline/);
  assert.match(read("js/offers-page.js"), /renderOwnerRequestDeadline/);
  assert.match(email, /expiry_reminder_pending/);
  assert.match(email, /event\.startsWith\("expiry_reminder_"\)/);
  assert.match(email, /reservation\.expires_at\).*getTime\(\) <= Date\.now\(\)/s);
});

function testHarness({ payments = [], stripe = {}, due = true, expectedExpiration = true } = {}) {
  const calls = { rpc: [], stripe: [], issue: [] };
  let handler;
  const reservationId = "11111111-1111-4111-8111-111111111111";
  const paymentId = "22222222-2222-4222-8222-222222222222";
  const sessionId = "cs_test_abc123";
  const baseSession = {
    id: sessionId,
    status: "open",
    payment_status: "unpaid",
    mode: "payment",
    currency: "czk",
    client_reference_id: reservationId,
    metadata: { reservation_id: reservationId, payment_id: paymentId },
    payment_intent: null,
  };
  const chain = (value) => ({ abortSignal: async () => value });
  const client = {
    rpc(name, args) {
      calls.rpc.push({ name, args });
      switch (name) {
        case "verify_reservation_notification_cron_secret": return chain({ data: true, error: null });
        case "queue_expiry_reminders": return chain({ data: 1, error: null });
        case "list_due_reservation_expirations": return chain({ data: due ? [
          { reservation_id: reservationId, reservation_status: "approved" },
        ] : [], error: null });
        case "note_reservation_expiration_issue": calls.issue.push(args.p_reason); return chain({ data: null, error: null });
        case "expire_unpaid_reservation": return chain({ data: expectedExpiration, error: null });
        default: throw new Error(`Unexpected RPC ${name}`);
      }
    },
    from(name) {
      if (name === "payments") return {
        select() { return this; }, eq() { return this; }, limit() { return this; },
        abortSignal: async () => ({ data: payments, error: null }),
      };
      if (name === "reservation_expiration_issues") return {
        delete() { return this; }, eq() { return this; }, abortSignal: async () => ({ data: null, error: null }),
      };
      throw new Error(`Unexpected table ${name}`);
    },
  };
  const runtime = {
    env: { get(name) {
      return { SUPABASE_URL: "https://vspposovhdgvbeukoivh.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role", STRIPE_SECRET_KEY: "sk_test_abc" }[name];
    } },
    serve(fn) { handler = fn; },
  };
  // Node 22 ships its own TypeScript type stripper. CI needs no added npm
  // dependency, and we run the actual worker body against mocked providers.
  const compiled = stripTypeScriptTypes(
    worker.replace(/^import \{ createClient \} from .*?;\n/m,
      'const { createClient } = require("supabase-client-mock");\n'),
    { mode: "strip" },
  );
  const ctx = {
    console: { error() {} },
    module: { exports: {} }, exports: {},
    require: () => ({ createClient() { return client; } }),
    globalThis: null,
    AbortSignal, Response, URL, Date, JSON, Array, Number, String, Promise,
    fetch: async (url, opts) => {
      calls.stripe.push({ url, method: opts.method });
      const isExpire = url.endsWith("/expire");
      const isIntent = url.includes("/payment_intents/");
      const value = isIntent ? { status: stripe.intentStatus || "succeeded" } :
        isExpire ? (stripe.afterExpire || { ...baseSession, status: "expired" }) :
        (stripe.session || baseSession);
      const status = isExpire && stripe.expireRejected ? 409 : 200;
      return new Response(JSON.stringify(value), { status });
    },
  };
  ctx.globalThis = Object.assign(ctx, { Deno: runtime });
  vm.runInNewContext(compiled, ctx, { filename: "expire-reservations/index.ts" });
  const request = (secret = "s".repeat(64)) => new Request("https://test.example/", {
    method: "POST", headers: { "x-rentulo-cron-secret": secret },
  });
  return { handler, request, calls, reservationId, paymentId, sessionId, baseSession };
}

test("runtime: no checkout releases unpaid approved reservation and queues reminder", async () => {
  const h = testHarness();
  const response = await h.handler(h.request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, reminders: 1, expired: 1, blocked: 0, changed: 0 });
  assert.equal(h.calls.stripe.length, 0);
  assert.equal(h.calls.rpc.filter(c => c.name === "expire_unpaid_reservation").length, 1);
});

test("runtime: open Stripe session must be expired and confirmed before dates release", async () => {
  const h = testHarness({ payments: [{ id: "22222222-2222-4222-8222-222222222222", provider: "stripe",
    status: "pending", provider_payment_id: "cs_test_abc123", checkout_attempt_started_at: "2026-01-01", checkout_inflight_started_at: null }] });
  const response = await h.handler(h.request());
  assert.equal((await response.json()).expired, 1);
  assert.equal(h.calls.stripe.length, 2);
  assert.equal(h.calls.stripe[0].method, "GET");
  assert.equal(h.calls.stripe[1].method, "POST");
  const release = h.calls.rpc.find(c => c.name === "expire_unpaid_reservation");
  assert.equal(release.args.p_verified_expired_session_id, h.sessionId);
});

test("runtime: completed Checkout holds dates for delayed webhook", async () => {
  const h = testHarness({ payments: [{ id: "22222222-2222-4222-8222-222222222222", provider: "stripe",
    status: "pending", provider_payment_id: "cs_test_abc123", checkout_attempt_started_at: "2026-01-01", checkout_inflight_started_at: null }],
    stripe: { session: { id: "cs_test_abc123", status: "complete", payment_status: "unpaid", mode: "payment", currency: "czk",
      client_reference_id: "11111111-1111-4111-8111-111111111111", metadata: { reservation_id: "11111111-1111-4111-8111-111111111111", payment_id: "22222222-2222-4222-8222-222222222222" } } } });
  assert.equal((await (await h.handler(h.request())).json()).blocked, 1);
  assert.equal(h.calls.stripe.length, 1);
  assert.equal(h.calls.rpc.some(x => x.name === "expire_unpaid_reservation"), false);
  assert.equal(h.calls.issue.length, 1);
});

test("runtime: ambiguous creation without stored session never releases dates", async () => {
  const h = testHarness({ payments: [{ id: "22222222-2222-4222-8222-222222222222", provider: "stripe",
    status: "pending", provider_payment_id: "", checkout_attempt_started_at: "2026-01-01", checkout_inflight_started_at: null }] });
  assert.equal((await (await h.handler(h.request())).json()).blocked, 1);
  assert.equal(h.calls.stripe.length, 0);
  assert.equal(h.calls.rpc.some(x => x.name === "expire_unpaid_reservation"), false);
});

test("runtime: in-flight checkout replacement blocks expiry despite old session ID", async () => {
  const h = testHarness({ payments: [{ id: "22222222-2222-4222-8222-222222222222", provider: "stripe",
    status: "pending", provider_payment_id: "cs_test_abc123", checkout_attempt_started_at: "2026-01-01", checkout_inflight_started_at: "2026-01-01" }] });
  assert.equal((await (await h.handler(h.request())).json()).blocked, 1);
  assert.equal(h.calls.stripe.length, 0);
  assert.equal(h.calls.rpc.some(x => x.name === "expire_unpaid_reservation"), false);
});

test("runtime: Stripe expiry HTTP rejection never releases a completed checkout", async () => {
  const h = testHarness({ payments: [{ id: "22222222-2222-4222-8222-222222222222", provider: "stripe",
    status: "pending", provider_payment_id: "cs_test_abc123", checkout_attempt_started_at: null, checkout_inflight_started_at: null }],
    stripe: { expireRejected: true } });
  assert.equal((await (await h.handler(h.request())).json()).blocked, 1);
  assert.equal(h.calls.rpc.some(x => x.name === "expire_unpaid_reservation"), false);
});

test("runtime: Stripe expired session with successful PaymentIntent remains blocked", async () => {
  const h = testHarness({ payments: [{ id: "22222222-2222-4222-8222-222222222222", provider: "stripe",
    status: "pending", provider_payment_id: "cs_test_abc123", checkout_attempt_started_at: null, checkout_inflight_started_at: null }],
    stripe: { session: { id: "cs_test_abc123", status: "expired", payment_status: "unpaid", mode: "payment", currency: "czk",
      client_reference_id: "11111111-1111-4111-8111-111111111111", metadata: { reservation_id: "11111111-1111-4111-8111-111111111111", payment_id: "22222222-2222-4222-8222-222222222222" }, payment_intent: "pi_testabc" } } });
  assert.equal((await (await h.handler(h.request())).json()).blocked, 1);
  assert.equal(h.calls.rpc.some(x => x.name === "expire_unpaid_reservation"), false);
});

test("runtime: Cron endpoint rejects unauthenticated callers before database operations", async () => {
  const h = testHarness();
  const response = await h.handler(new Request("https://test.example", { method: "POST" }));
  assert.equal(response.status, 401);
  assert.equal(h.calls.rpc.length, 0);
});
