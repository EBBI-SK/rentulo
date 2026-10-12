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
