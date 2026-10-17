"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const sql = read("supabase/migrations/20261017233000_return_followup_incident_TEST.sql");
const email = read("supabase/functions/send-reservation-email/index.ts");
const worker = read("supabase/functions/process-reservation-notifications/index.ts");
const shared = read("supabase/functions/_shared/notification-email-policy.mjs");
const frontend = read("js/offers-page.js");
const languages = read("js/i18n.js");
const css = read("css/my-offers.css");

test("return follow-up is TEST-only and new-reservations-only, without no-show or money changes", () => {
  assert.match(sql, /vspposovhdgvbeukoivh\.supabase\.co/);
  assert.match(sql, /return follow-up migration is TEST-only/);
  assert.match(sql, /activated_at timestamptz not null default clock_timestamp\(\)/);
  assert.match(sql, /r\.created_at >= a\.activated_at/g);
  assert.doesNotMatch(sql, /\b(update|insert into)\s+public\.(payments|reservation_cancellations|owner_cancellation_debts)\b/i);
  assert.doesNotMatch(sql, /new\.status\s*=\s*'no_show'/);
  assert.doesNotMatch(sql, /set\s+status\s*=/i);
  assert.match(sql, /r\.status = 'picked_up'/);
  assert.match(sql, /r\.pickup_time is not null/);
});

test("return reminder timing uses PostgreSQL Prague instant, 30m then 2h, no burst on missed Cron", () => {
  assert.match(sql, /\(r\.end_date \+ r\.pickup_time\) at time zone 'Europe\/Prague'/);
  assert.match(sql, /interval '30 minutes'/);
  assert.match(sql, /interval '2 hours'/);
  assert.match(sql, /clock_timestamp\(\) < v_reservation\.return_due \+ interval '2 hours'/);
  assert.match(sql, /return_reminder_30m/);
  assert.match(sql, /return_reminder_2h/);
  assert.match(sql, /for update of r skip locked/);
  assert.match(sql, /rentulo-return-followups-every-minute/);
  assert.match(sql, /session_user <> 'postgres'/);
});

test("only an authorized owner may file a real non-return report after +2h", () => {
  assert.match(sql, /v_reservation\.owner_id/); // record locked from owner-specific query
  assert.match(sql, /r\.owner_id = auth\.uid\(\)/);
  assert.match(sql, /auth\.uid\(\) is null/);
  assert.match(sql, /v_reservation\.status <> 'picked_up'/);
  assert.match(sql, /clock_timestamp\(\) < \(/);
  assert.match(sql, /p_description text/);
  assert.match(sql, /char_length\(v_description\) not between 15 and 500/);
  assert.match(sql, /reservation_id uuid primary key references public\.reservations/);
  assert.match(sql, /RETURN_REPORT_ALREADY_EXISTS/);
  assert.match(sql, /report_my_reservation_not_returned\(uuid, text\)\s*to authenticated/);
  assert.match(sql, /revoke all on public\.reservation_return_incidents from public, anon, authenticated/);
  assert.doesNotMatch(sql, /grant (?:select|insert|update) on public\.reservation_return_incidents to authenticated/i);
});

test("incident report makes exactly one transactional renter email, and return auto-closes case", () => {
  assert.match(sql, /perform public\.queue_reservation_notification\(\s*v_reservation\.id, 'return_not_received', v_reservation\.renter_id, false/);
  assert.match(sql, /old\.status = 'picked_up' and new\.status = 'returned'/);
  assert.match(sql, /set resolved_at = clock_timestamp\(\), resolution = 'confirmed_returned'/);
  assert.match(sql, /trg_close_return_incident_on_confirmed_return/);
  assert.match(sql, /where i\.reservation_id = new\.id and i\.resolved_at is null/);
  assert.match(sql, /unique|primary key/);
  assert.match(sql, /d\.event_type = 'return_reminder_30m'/);
  assert.match(sql, /d\.event_type = 'return_reminder_2h'/);
  assert.match(sql, /not exists \(\s*select 1 from public\.reservation_return_incidents i/);
});

test("existing outbox worker remains email-only for these events, not SMS", async () => {
  for (const event of ["return_reminder_30m", "return_reminder_2h", "return_not_received"]) {
    assert.match(worker, new RegExp(`"${event}"`));
    assert.match(email, new RegExp(`"${event}"`));
    assert.match(sql, new RegExp(`'${event}'`));
    assert.match(shared, new RegExp(`"${event}"`));
  }
  const { shouldDeliverReservationEmail } = await import("../supabase/functions/_shared/notification-email-policy.mjs");
  for (const event of ["return_reminder_30m", "return_reminder_2h", "return_not_received"]) {
    assert.equal(shouldDeliverReservationEmail(event, "recipient@example.com", false), true);
  }
  assert.match(sql, /v_reservation\.owner_id, false/);
  assert.match(sql, /v_reservation\.renter_id, false/);
  assert.match(email, /!isServiceRoleCall && isReturnEvent/);
  assert.match(email, /if \(isWorkerDelivery && isReturnEvent\)/);
  assert.match(email, /reservation\.status !== "picked_up"/);
  assert.match(email, /issue !== null/);
  assert.match(email, /!issue \|\| issue\.resolved_at/);
  assert.match(email, /pragueRentalInstant\(reservation\.end_date, reservation\.pickup_time\)/);
});

test("owner UI uses server eligibility and explicit textarea dialog, with 5-language copy", () => {
  assert.match(frontend, /supabaseClient\.rpc\("get_my_return_followup_overview"\)/);
  assert.match(frontend, /ownerReturnFollowupOverview\.set/);
  assert.match(frontend, /followup && followup\.canReport/);
  assert.match(frontend, /openReturnIssueModal\(\)/);
  assert.match(frontend, /supabaseClient\.rpc\("report_my_reservation_not_returned"/);
  assert.match(frontend, /data-offers-action="report-return-missing"/);
  assert.match(frontend, /markReservationReturned/);
  assert.match(frontend, /returnIssueModalInput/);
  assert.match(css, /\.return-issue-modal-input/);
  assert.doesNotMatch(frontend, /window\.prompt\(/);
  assert.doesNotMatch(frontend, /owner_unavailable/);
  const keys = ["action", "reported", "title", "description", "label", "cancel", "confirm", "successTitle"];
  for (const key of keys) {
    assert.equal((languages.match(new RegExp(`"offers\\.returnIssue\\.${key}":`, "g")) || []).length, 5, key);
  }
  const templates = email.slice(email.indexOf("const templates:"), email.indexOf("const expiredOwnerIntros:"));
  for (const lang of ["cs", "sk", "en", "de", "pl"]) {
    assert.match(templates, new RegExp(`\\b${lang}: \\{`));
  }
  for (const event of ["return_reminder_30m", "return_reminder_2h", "return_not_received"]) {
    assert.equal((templates.match(new RegExp(`\\b${event}:`, "g")) || []).length, 5, event);
  }
});

test("shared Prague window helper respects exact return and DST edge cases", async () => {
  const { pragueRentalInstant } = await import("../supabase/functions/_shared/prague-rental-window.mjs");
  assert.equal(new Date(pragueRentalInstant("2026-10-25", "02:30:00")).toISOString(), "2026-10-25T01:30:00.000Z");
  assert.equal(new Date(pragueRentalInstant("2026-03-29", "02:30:00")).toISOString(), "2026-03-29T01:30:00.000Z");
  const deadline = pragueRentalInstant("2026-11-13", "10:00:00");
  assert.equal(new Date(deadline + 30 * 60000).toISOString(), "2026-11-13T09:30:00.000Z");
  assert.equal(new Date(deadline + 2 * 3600000).toISOString(), "2026-11-13T11:00:00.000Z");
});
