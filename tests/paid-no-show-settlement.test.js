"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const db = read("supabase/migrations/20261015161000_paid_no_show_settlement_TEST.sql");
const enumMigration = read("supabase/migrations/20261015160000_add_paid_no_show_status.sql");
const edge = read("supabase/functions/create-owner-transfer/index.ts");
const email = read("supabase/functions/send-reservation-email/index.ts");

function isolatedLiteral(name) {
  const begin = email.indexOf(`const ${name}:`);
  assert.ok(begin >= 0, `Missing ${name}`);
  const assignment = email.indexOf("= {", begin);
  const end = email.indexOf("\n};", assignment);
  assert.ok(assignment >= 0 && end > assignment);
  return vm.runInNewContext(`(${email.slice(assignment + 2, end + 2)})`);
}

function history(language) {
  const ctx = vm.createContext({
    window: { getRentuloLanguage: () => language },
    document: { documentElement: { lang: language }, addEventListener() {} },
    escapeHtml: String,
  });
  vm.runInContext(read("js/i18n.js"), ctx);
  vm.runInContext(read("js/reservation-status.js"), ctx);
  vm.runInContext(read("js/history-i18n.js"), ctx);
  vm.runInContext(read("js/history-page.js"), ctx);
  return {
    status: (s) => vm.runInContext(`getReservationStatusText(${JSON.stringify(s)})`, ctx),
    closed: (s) => vm.runInContext(`isClosedReservationStatus(${JSON.stringify(s)})`, ctx),
    open: (s) => vm.runInContext(`isOpenReservationStatus(${JSON.stringify(s)})`, ctx),
    historical: (s) => vm.runInContext(`historyIsHistorical({status: ${JSON.stringify(s)}})`, ctx),
    review: (s) => vm.runInContext(`historyCanReview({status: ${JSON.stringify(s)}})`, ctx),
    reason: (role) => vm.runInContext(
      `historyNoShowReasonText({status: "no_show"}, ${JSON.stringify(role)})`, ctx
    ),
    detail: (role) => vm.runInContext(
      `historyRenderDetail({id:"id-79",owner_id:"owner",renter_id:"renter",status:"no_show",start_date:"2026-10-17",end_date:"2026-10-18",total_price:250,reservation_number:"R-000079",offer_number:"N-000002"}, ${JSON.stringify(role)})`, ctx
    ),
  };
}

test("no-show is a separately committed paid-reservation status", () => {
  assert.match(enumMigration, /alter type public\.reservation_status add value if not exists 'no_show'/);
  assert.match(db, /old\.status = 'paid'[\s\S]{0,110}new\.status = 'no_show'/);
  assert.match(db, /current_setting\('app\.no_show_authorized', true\) = 'on'/);
  assert.match(db, /session_user = 'postgres'/);
  assert.doesNotMatch(db, /auth\.role\(\) = 'authenticated'[\s\S]{0,120}no_show/);
});

test("policy does not retroactively pay overdue TEST bookings from before deployment", () => {
  assert.match(db, /reservation_no_show_activation/);
  assert.match(db, /first_pickup_date/);
  assert.match(db, /\(now\(\) at time zone 'Europe\/Prague'\)::date \+ 1/);
  assert.match(db, /r\.start_date >= a\.first_pickup_date/);
  assert.match(db, /first_reservation_created_at timestamptz not null default now\(\)/);
  assert.match(db, /r\.created_at >= a\.first_reservation_created_at/);
  assert.match(db, /and r\.created_at >= \([\s\S]*?a\.first_reservation_created_at/);
});

test("Prague-local exact scheduled return time gates no-show even during DST changes", async () => {
  const { rentalEndReached } = await import("../supabase/functions/_shared/prague-rental-window.mjs");
  assert.match(db, /clock_timestamp\(\) >= \(\(old\.end_date \+ old\.pickup_time\) at time zone 'Europe\/Prague'\)/);
  assert.match(db, /clock_timestamp\(\) >= \(\(r\.end_date \+ r\.pickup_time\) at time zone 'Europe\/Prague'\)/);
  const cases = [
    ["2026-11-13", "10:00:00", "2026-11-13T08:59:59Z", "2026-11-13T09:00:00Z"],
    ["2026-03-29", "10:00:00", "2026-03-29T07:59:59Z", "2026-03-29T08:00:00Z"],
    ["2026-10-25", "10:00:00", "2026-10-25T08:59:59Z", "2026-10-25T09:00:00Z"],
  ];
  for (const [day, time, before, at] of cases) {
    assert.equal(rentalEndReached(day, time, new Date(before)), false);
    assert.equal(rentalEndReached(day, time, new Date(at)), true);
  }
});

test("cron is minute-based, TEST-only for immediate transfer dispatch, with existing retry fallback", () => {
  assert.match(db, /'rentulo-paid-no-show-every-minute',\s*'\* \* \* \* \*'/);
  assert.match(db, /process_due_reservation_no_shows\(10\)/);
  assert.match(db, /processed\.completed > 0/);
  assert.match(db, /cfg\.project_url = 'https:\/\/vspposovhdgvbeukoivh\.supabase\.co'/);
  assert.match(db, /'rentulo_owner_transfer_retry_cron_secret'/);
  assert.match(db, /\/functions\/v1\/retry-owner-transfers/);
  assert.match(db, /for update of r skip locked/);
  assert.match(db, /for update;/);
  assert.match(db, /and r\.status = 'paid'/);
  assert.match(db, /get diagnostics v_rows = row_count/);
});

test("no-show settlement fails closed before altering any financial state", () => {
  for (const guard of [
    "v_payment_count <> 1", "v_payment.status <> 'paid'", "v_payment.provider <> 'stripe'",
    "v_payment.stripe_payment_intent_status <> 'succeeded'",
    "v_payment.refund_status is distinct from 'not_requested'",
    "v_payment.stripe_refund_amount_minor is distinct from 0",
    "v_payment.transfer_status is distinct from 'not_created'",
    "v_payment.stripe_transfer_id is not null",
    "v_payment.amount_total is distinct from v_reservation.total_price",
    "v_payment.owner_payout is distinct from v_reservation.owner_payout",
    "public.reservation_cancellations c"
  ]) {
    assert.ok(db.includes(guard), guard);
  }
  assert.match(db, /reservation_no_show_issues[\s\S]*?on conflict \(reservation_id\) do update/);
  assert.match(db, /revoke all on function public\.process_due_reservation_no_shows\(integer\)[\s\S]*?from public, anon, authenticated, service_role/);
});

test("owner Stripe transfer is admitted only through existing idempotent claim and record", () => {
  assert.match(edge, /\["picked_up", "returned", "no_show"\]\.includes\(reservation\.status\)/);
  assert.match(db, /v_reservation_status not in \('picked_up', 'returned', 'no_show'\)/);
  assert.match(db, /v_reservation\.status not in \('picked_up', 'returned', 'no_show'\)/);
  assert.match(db, /r\.status in \('picked_up', 'returned', 'no_show'\)/);
  assert.match(edge, /Idempotency-Key.*rentulo-owner-transfer-\$\{payment\.id\}/s);
  assert.match(edge, /payment\.refund_status !== "not_requested"/);
  assert.match(db, /p\.transfer_attempt_count = p_attempt_count/);
});

test("unpaid Stripe transfer on no-show blocks owner account deactivation", () => {
  const checks = db.match(/'no_show'::public\.reservation_status/g) || [];
  assert.equal(checks.length, 2, "both preflight and finalization must check unresolved no-show payout");
  assert.match(db, /Account has unresolved financial obligations/);
});

test("new no-show status is historical, non-blocking and not a successful pickup", () => {
  const h = history("cs");
  assert.equal(h.status("no_show"), "Nevyzvednuto");
  assert.equal(h.closed("no_show"), true);
  assert.equal(h.open("no_show"), false);
  assert.equal(h.historical("no_show"), true);
  assert.equal(h.review("no_show"), false);
  for (const role of ["owner", "renter"]) {
    assert.match(h.detail(role), /R-000079/);
    assert.match(h.detail(role), /Důvod ukončení/);
  }
  const availability = read("supabase/migrations/20260723190000_restrict_public_blocking_reservations.sql");
  assert.doesNotMatch(availability, /no_show/);
});

test("five languages give each participant a distinct explanation and mail", () => {
  const templates = isolatedLiteral("templates");
  const owners = isolatedLiteral("noShowOwnerIntros");
  for (const lang of ["cs", "sk", "en", "de", "pl"]) {
    const h = history(lang);
    const renter = h.reason("renter");
    const owner = h.reason("owner");
    assert.ok(renter.length > 45, `${lang}: renter has complete explanation`);
    assert.ok(owner.length > 45, `${lang}: owner has complete explanation`);
    assert.notEqual(renter, owner, `${lang}: each role needs different copy`);
    assert.ok(h.detail("owner").includes(owner));
    assert.ok(h.detail("renter").includes(renter));
    assert.ok(templates[lang].no_show?.[0]?.length > 5);
    assert.ok(templates[lang].no_show?.[1]?.length > 50);
    assert.ok(owners[lang].length > 50);
    assert.notEqual(templates[lang].no_show[1], owners[lang]);
  }
});

test("exactly two no-show emails are enqueued, delivered as essential and link to history", () => {
  const eventSource = read("supabase/functions/process-reservation-notifications/index.ts");
  const policy = read("supabase/functions/_shared/notification-email-policy.mjs");
  assert.match(db, /queue_reservation_notification\(new\.id, 'no_show', new\.owner_id, false\)/);
  assert.match(db, /queue_reservation_notification\(new\.id, 'no_show', new\.renter_id, false\)/);
  assert.match(read("supabase/migrations/20261012100000_unify_reservation_notification_outbox.sql"), /unique \(reservation_id, event_type, recipient_id, channel\)/);
  assert.match(eventSource, /\| "no_show"/);
  assert.match(policy, /"no_show"/);
  assert.match(email, /const isExpirationNotice = event === "expired_pending" \|\| event === "expired_approved" \|\| event === "no_show"/);
  assert.match(email, /event === "no_show" && reservation\.status !== "no_show"/);
  assert.match(email, /const isExpiryEvent =[\s\S]*?event === "no_show"/);
});
