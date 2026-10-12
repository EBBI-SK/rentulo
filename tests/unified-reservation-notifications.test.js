"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20261012100000_unify_reservation_notification_outbox.sql");
const cron = read("supabase/migrations/20261012101000_schedule_notification_worker.sql");
const worker = read("supabase/functions/process-reservation-notifications/index.ts");
const settings = read("js/settings-page.js");
const settingsHtml = read("nastaveni.html");
const i18n = read("js/i18n.js");

// Test real pure copy and normalization functions rather than mirroring logic.
const sms = import("../supabase/functions/_shared/notification-sms.mjs");

test("phone numbers normalize to E.164 or fail closed", async () => {
  const { phoneToE164 } = await sms;
  assert.equal(phoneToE164("777 123 456"), "+420777123456");
  assert.equal(phoneToE164("+420 777-123-456"), "+420777123456");
  assert.equal(phoneToE164("00421 905 123 456"), "+421905123456");
  for (const invalid of ["", "123", "420777123456", "++420777123456", "abcdef", "+000"])
    assert.equal(phoneToE164(invalid), null, `invalid ${invalid}`);
});

test("four selected SMS event categories have short ASCII text in all five languages", async () => {
  const { smsMessage } = await sms;
  for (const lang of ["cs", "sk", "en", "de", "pl"]) {
    for (const event of ["new_request", "approved", "paid", "cancelled", "paid_cancelled"]) {
      const body = smsMessage(event, lang, "R-000014");
      assert.equal(typeof body, "string", `${lang} / ${event}`);
      assert.match(body, /Rentulo:.*R-000014/);
      assert.ok(body.length <= 160);
      assert.match(body, /^[\x20-\x7E]+$/);
      assert.doesNotMatch(body.toLowerCase(), /\bpin\b/);
    }
    assert.equal(smsMessage("returned", lang, "R-000014"), null);
    assert.equal(smsMessage("approved", lang, "not-a-reference"), null);
  }
});

test("database transaction—not a browser—queues all seven standard email events", () => {
  assert.match(migration, /after insert on public\.reservations/);
  assert.match(migration, /after update of status on public\.reservations/);
  for (const event of ["new_request", "approved", "rejected", "cancelled", "paid", "picked_up", "returned"])
    assert.match(migration, new RegExp(`'${event}'`));
  assert.match(migration, /on conflict \(reservation_id, event_type, recipient_id, channel\) do nothing/);
  assert.match(migration, /new\.status = 'cancelled'/);
  assert.match(migration, /c\.cancellation_kind = 'paid_refund'/);
  assert.match(migration, /v_actor := auth\.uid\(\)/);
  for (const file of ["js/detail-page.js", "js/offers-page.js", "js/reservations-page.js", "js/pickup-security.js"])
    assert.doesNotMatch(read(file), /apiSendReservationEmail\(/, `${file} must not send emails directly`);
  const legacyApi = read("js/api.js");
  assert.doesNotMatch(legacyApi, /functions\.invoke\([\s\S]*send-reservation-email/);
  assert.match(legacyApi, /queued: true/);
});

test("one outbox supports email and SMS with per-recipient deduplication and secure RLS", () => {
  assert.match(migration, /create table if not exists public\.reservation_notification_deliveries/);
  assert.match(migration, /unique \(reservation_id, event_type, recipient_id, channel\)/);
  assert.match(migration, /channel in \('email', 'sms'\)/);
  assert.match(migration, /alter table public\.reservation_notification_deliveries enable row level security/);
  assert.match(migration, /revoke all on public\.reservation_notification_deliveries from public, anon, authenticated/);
  assert.match(migration, /grant all on public\.reservation_notification_deliveries to service_role/);
  assert.match(migration, /p\.sms_notifications is true/);
  assert.match(migration, /sms_notifications boolean not null default false/);
});

test("only the server claims and acknowledges jobs with SKIP LOCKED and a lease token", () => {
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /claim_token = gen_random_uuid\(\)/);
  assert.match(migration, /d\.claim_token = p_claim_token/);
  assert.match(migration, /d\.status = 'sending'/);
  assert.match(migration, /auth\.role\(\) <> 'service_role'/);
  assert.match(migration, /next_attempt_at = case[\s\S]*make_interval/);
  assert.match(worker, /claim_reservation_notification_deliveries/);
  assert.match(worker, /finish_reservation_notification_delivery/);
  assert.match(worker, /claim\.channel === "email"[\s\S]*deliverEmail[\s\S]*deliverSms/);
});

test("Cron uses a Vault secret, has an inert default, and cannot reach an unconfigured URL", () => {
  assert.match(cron, /vault\.create_secret/);
  assert.match(cron, /rentulo_notification_cron_secret/);
  assert.match(cron, /'UNCONFIGURED', 'rentulo_project_url'/);
  assert.match(cron, /cfg\.project_url ~ '\^https:/);
  assert.match(cron, /rentulo-process-reservation-notifications-every-minute/);
  assert.match(worker, /verify_reservation_notification_cron_secret/);
  assert.match(worker, /if \(verified\.error \|\| verified\.data !== true\)/);
});

test("SMS is opt-in, simulated by default and live sends are restricted to TEST allowlist", () => {
  assert.match(worker, /SMS_SEND_MODE/);
  assert.match(worker, /\|\| "disabled"/);
  assert.match(worker, /if \(mode === "dry_run"\) return \{ outcome: "simulated" \}/);
  assert.match(worker, /https:\/\/vspposovhdgvbeukoivh\.supabase\.co/);
  assert.match(worker, /SMS_ALLOWED_NUMBERS/);
  assert.match(worker, /BULKGATE_APPLICATION_TOKEN/);
  assert.match(worker, /https:\/\/portal\.bulkgate\.com\/api\/1\.0\/simple\/transactional/);
  assert.match(worker, /duplicates_check: "on"/);
  assert.match(worker, /Ambiguous SMS timeout; manual review required/);
  assert.match(worker, /sms_notifications/);
});

test("SMS preference is explicitly user-controlled and localized in five languages", () => {
  assert.match(settingsHtml, /id="settingsSmsEnabled"/);
  assert.match(settingsHtml, /id="settingsSaveSmsButton"/);
  assert.match(settings, /sms_notifications: smsEnabled/);
  assert.match(settings, /sms_notifications"/);
  assert.match(settings, /phoneEligibleForSms/);
  assert.equal((i18n.match(/"settings\.smsTitle"/g) || []).length, 5);
  assert.equal((i18n.match(/"settings\.smsOptIn"/g) || []).length, 5);
  assert.match(read("ochrana-osobnich-udaju.html"), /BulkGate/);
});

// BOD 12 / P1-1: run the REAL TS worker handler in a mocked Deno runtime.
// We strip types (Node 22) and replace only its external imports; the queue
// control flow, concurrency limits, and SMS dispatch boundary stay unchanged.
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");
const reliabilityMigration = read("supabase/migrations/20261012150000_harden_reservation_notification_worker.sql");

async function runWorkerHarness({
  jobs = [], mode = "disabled", ackFailureId = null,
  markerAccepted = true, smsTransportFails = false, emailDelayMs = 0,
} = {}) {
  const steps = [];
  const ackCalls = [];
  let activeTransports = 0;
  let maximumActiveTransports = 0;
  let batchLimit = null;
  let handler;
  const envValues = {
    SUPABASE_URL: "https://vspposovhdgvbeukoivh.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-server-role",
    SMS_SEND_MODE: mode,
    SMS_ALLOWED_NUMBERS: "+421905123456",
    BULKGATE_APPLICATION_ID: "1234",
    BULKGATE_APPLICATION_TOKEN: "test-bulkgate-token",
  };

  const admin = {
    rpc(name, args) {
      return {
        abortSignal() {
          steps.push(name);
          if (name === "verify_reservation_notification_cron_secret") return Promise.resolve({ data: true, error: null });
          if (name === "claim_reservation_notification_deliveries") {
            batchLimit = args.p_limit;
            return Promise.resolve({ data: jobs.slice(0, batchLimit), error: null });
          }
          if (name === "mark_reservation_sms_dispatch_started") {
            return Promise.resolve({ data: markerAccepted, error: null });
          }
          if (name === "finish_reservation_notification_delivery") {
            ackCalls.push(args);
            return Promise.resolve({ data: args.p_delivery_id !== ackFailureId, error: null });
          }
          throw Error(`Unexpected RPC ${name}`);
        },
      };
    },
    from(table) {
      return {
        select() { return this; },
        eq() { return this; },
        single() { return this; },
        abortSignal() {
          if (table === "profiles") return Promise.resolve({ data: {
            phone: "+421905123456", preferred_language: "sk", sms_notifications: true,
          }, error: null });
          if (table === "reservations") return Promise.resolve({ data: { reservation_number: "R-000020" }, error: null });
          throw Error(`Unexpected table ${table}`);
        },
      };
    },
  };

  const fetchMock = async (url, options) => {
    if (url.includes("/send-reservation-email")) {
      activeTransports += 1;
      maximumActiveTransports = Math.max(maximumActiveTransports, activeTransports);
      if (emailDelayMs) await new Promise((resolve) => setTimeout(resolve, emailDelayMs));
      activeTransports -= 1;
      return new Response(JSON.stringify({
        ok: true, results: [{ recipient_id: JSON.parse(options.body).recipient_id, status: "sent" }],
      }), { status: 200 });
    }
    if (url.includes("portal.bulkgate.com")) {
      steps.push("bulkgate_api_request");
      if (smsTransportFails) throw new Error("Network failed after the provider boundary");
      return new Response(JSON.stringify({ data: { status: "accepted", sms_id: "sms-test-1" } }), { status: 200 });
    }
    throw Error(`Unexpected transport ${url}`);
  };

  const sourceWithoutImports = worker.replace(/^import .*;\s*$/gm, "");
  const script = stripTypeScriptTypes(sourceWithoutImports);
  const context = vm.createContext({
    Deno: { serve(fn) { handler = fn; }, env: { get(name) { return envValues[name]; } } },
    createClient() { return admin; },
    phoneToE164(value) { return value ? String(value) : null; },
    smsMessage() { return "Rentulo: rezervacia R-000020"; },
    Response,
    AbortSignal,
    fetch: fetchMock,
    console: { error(message) { steps.push(message); } },
  });
  vm.runInContext(script, context, { timeout: 1000 });

  const response = await handler(new Request("https://test.invalid/", {
    method: "POST",
    headers: { "x-rentulo-cron-secret": "x".repeat(80) },
    body: JSON.stringify({ limit: 15 }),
  }));
  return {
    status: response.status, body: await response.json(), ackCalls,
    steps, maximumActiveTransports, batchLimit,
  };
}

function testClaim(index, channel = "email") {
  return {
    delivery_id: `notification-${index}`, claim_token: `claim-${index}`,
    reservation_id: `reservation-${index}`, recipient_id: `recipient-${index}`,
    channel, event_type: "new_request",
  };
}

test("P1-1: timeout budget leaves headroom before Cron's 60-second limit", () => {
  const value = (name) => Number(worker.match(new RegExp(`const ${name} = (\\d+);`))?.[1]);
  const batch = value("MAX_BATCH_SIZE");
  const concurrent = value("MAX_CONCURRENT_DELIVERIES");
  const db = value("DB_TIMEOUT_MS");
  const sms = value("SMS_PROVIDER_TIMEOUT_MS");
  assert.equal(batch, 10);
  assert.equal(concurrent, 5);
  const worstCaseBudget = 2 * db + Math.ceil(batch / concurrent) * (3 * db + sms);
  assert.ok(worstCaseBudget <= 55000, `Cron could time out: ${worstCaseBudget}ms`);
});

test("P1-1: worker caps Cron batch at ten and processes at most five in parallel", async () => {
  const jobs = Array.from({ length: 15 }, (_, i) => testClaim(i));
  const run = await runWorkerHarness({ jobs, emailDelayMs: 15 });
  assert.equal(run.status, 200);
  assert.equal(run.batchLimit, 10, "Cron's old limit 15 must be clamped");
  assert.equal(run.ackCalls.length, 10);
  assert.equal(new Set(run.ackCalls.map((call) => call.p_delivery_id)).size, 10);
  assert.equal(run.maximumActiveTransports, 5);
  assert.equal(run.body.claimed, 10);
  assert.equal(run.body.sent, 10);
  assert.equal(run.body.acknowledgement_failures, 0);
});

test("P1-1: failed acknowledgement does not discard other claimed deliveries", async () => {
  const jobs = Array.from({ length: 10 }, (_, i) => testClaim(i));
  const run = await runWorkerHarness({ jobs, ackFailureId: "notification-3" });
  assert.equal(run.status, 500);
  assert.equal(run.body.acknowledgement_failures, 1);
  assert.equal(run.body.sent, 9);
  assert.equal(run.ackCalls.length, 10, "every claim must get its own acknowledgement attempt");
});

test("P1-1: live SMS only reaches BulkGate AFTER its database dispatch marker", async () => {
  const run = await runWorkerHarness({ jobs: [testClaim(1, "sms")], mode: "live" });
  assert.equal(run.status, 200);
  assert.equal(run.body.sent, 1);
  assert.ok(run.steps.indexOf("mark_reservation_sms_dispatch_started") >= 0);
  assert.ok(run.steps.indexOf("mark_reservation_sms_dispatch_started") < run.steps.indexOf("bulkgate_api_request"));
  assert.equal(run.ackCalls[0].p_provider_message_id, "sms-test-1");
});

test("P1-1: failure to persist SMS dispatch marker prevents ANY provider call", async () => {
  const run = await runWorkerHarness({ jobs: [testClaim(1, "sms")], mode: "live", markerAccepted: false });
  assert.equal(run.status, 200);
  assert.equal(run.body.retried, 1);
  assert.ok(!run.steps.includes("bulkgate_api_request"));
});

test("P1-1: ambiguous SMS transport failure requires manual review, not retry", async () => {
  const run = await runWorkerHarness({ jobs: [testClaim(1, "sms")], mode: "live", smsTransportFails: true });
  assert.equal(run.status, 200);
  assert.equal(run.body.dead, 1);
  assert.equal(run.ackCalls[0].p_outcome, "dead");
  assert.match(run.ackCalls[0].p_error, /manual review required/);
});

test("P1-1: SQL safely recovers abandoned fifth attempts and never reclaims dispatched SMS", () => {
  assert.match(reliabilityMigration, /add column if not exists sms_dispatch_started_at timestamptz/);
  assert.match(reliabilityMigration, /where d\.channel = 'sms' and d\.status = 'sending'/);
  assert.match(reliabilityMigration, /create or replace function public\.mark_reservation_sms_dispatch_started/);
  assert.match(reliabilityMigration, /d\.claim_token = p_claim_token/);
  assert.match(reliabilityMigration, /d\.lease_until > now\(\)/);
  assert.match(reliabilityMigration, /d\.sms_dispatch_started_at is null/);
  assert.match(reliabilityMigration, /d\.attempt_count >= 5/);
  assert.match(reliabilityMigration, /d\.lease_until < now\(\)/);
  assert.match(reliabilityMigration, /d\.channel <> 'sms' or d\.sms_dispatch_started_at is null/);
  assert.match(reliabilityMigration, /Live SMS dispatch outcome unknown; manual review required/);
  assert.match(reliabilityMigration, /when p_outcome = 'retry' and \(/);
  assert.match(reliabilityMigration, /d\.channel = 'sms' and d\.sms_dispatch_started_at is not null/);
  assert.match(reliabilityMigration, /auth\.role\(\) <> 'service_role'/);
  assert.match(reliabilityMigration, /from public, anon, authenticated/);
});
