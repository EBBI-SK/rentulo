"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");

const source = fs.readFileSync(path.join(
  __dirname, "..", "supabase", "functions", "send-reservation-email", "index.ts",
), "utf8");
const policy = import("../supabase/functions/_shared/notification-email-policy.mjs");
const ownerId = "11111111-1111-4111-8111-111111111111";
const renterId = "22222222-2222-4222-8222-222222222222";
const reservationId = "33333333-3333-4333-8333-333333333333";

async function sendEmail({ language = "cs", event = "approved", expiresAt = "2026-11-16T09:00:00Z" } = {}) {
  let handler;
  const sentEmails = [];
  const { shouldDeliverReservationEmail } = await policy;
  const reservation = {
    id: reservationId, offer_id: "offer-id", owner_id: ownerId, renter_id: renterId,
    offer_name: "Vrtačka", start_date: "2026-11-17", end_date: "2026-11-20",
    pickup_time: "10:00:00", status: event === "paid" ? "paid" : "approved",
    reservation_number: "R-000050", expires_at: expiresAt,
  };
  const profile = {
    id: event === "paid" ? ownerId : renterId,
    email: "renter@example.test", full_name: "Test User",
    preferred_language: language, email_notifications: false,
  };
  const config = {
    SUPABASE_URL: "https://vspposovhdgvbeukoivh.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
    SUPABASE_ANON_KEY: "anon-key",
    RESEND_API_KEY: "resend-key",
    SITE_URL: "https://rentulo.eu",
  };
  const admin = {
    from(table) {
      const q = { mutation: "read", cols: "", payload: null };
      const builder = {
        select(cols) { q.cols = cols; return this; },
        eq() { return this; },
        in() { return this; },
        insert(row) { q.mutation = "insert"; q.payload = row; return this; },
        update(row) { q.mutation = "update"; q.payload = row; return this; },
        single() { return Promise.resolve(result()); },
        maybeSingle() { return Promise.resolve(result()); },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      function result() {
        if (table === "reservation_notification_deliveries") {
          assert.equal(q.cols, "id"); // no TEST-only extension column for ordinary email
          return { data: { id: "claimed-email" }, error: null };
        }
        if (table === "reservations") {
          assert.ok(q.cols.includes("expires_at"));
          return { data: reservation, error: null };
        }
        if (table === "offers") return { data: { offer_number: "N-000005" }, error: null };
        if (table === "profiles") return { data: [profile], error: null };
        if (table === "reservation_email_deliveries" && q.mutation === "insert") {
          assert.equal(q.payload.event_type, event);
          return { data: { id: "email-log-new" }, error: null };
        }
        if (table === "reservation_email_deliveries" && q.mutation === "update") {
          return { data: { id: "email-log-new" }, error: null };
        }
        throw new Error(`Unexpected DB access: ${table}`);
      }
      return builder;
    },
  };
  const context = vm.createContext({
    Deno: { serve(fn) { handler = fn; }, env: { get(key) { return config[key]; } } },
    createClient(_url, key) {
      assert.equal(key, config.SUPABASE_SERVICE_ROLE_KEY);
      return admin;
    },
    shouldDeliverReservationEmail,
    pragueRentalInstant() { return null; },
    fetch: async (url, options) => {
      assert.equal(url, "https://api.resend.com/emails");
      sentEmails.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ id: "resend-test-id" }), { status: 200 });
    },
    Response, Request, URL, TextEncoder, AbortSignal,
    console: { error() {} },
  });
  vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*;\s*$/gm, "")), context, { timeout: 2000 });
  const response = await handler(new Request("https://rentulo.eu/functions/v1/send-reservation-email", {
    method: "POST", headers: { Authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}` },
    body: JSON.stringify({
      reservation_id: reservationId, event,
      recipient_id: profile.id, notification_delivery_id: "claimed-email",
    }),
  }));
  assert.equal(response.status, 200, await response.text());
  assert.equal(sentEmails.length, 1);
  return sentEmails[0];
}

for (const [language, label, warning, expectedDate, expectedAt] of [
  ["cs", "Zaplaťte nejpozději", "Pokud platbu nedokončíte včas, rezervace vyprší.", "16. 11. 2026", "v"],
  ["sk", "Zaplaťte najneskôr", "Ak platbu nedokončíte včas, rezervácia vyprší.", "16. 11. 2026", "o"],
  ["en", "Pay by", "If you do not complete payment on time, the reservation will expire.", "16/11/2026", "at"],
  ["de", "Bitte zahlen Sie spätestens am", "Wenn Sie die Zahlung nicht rechtzeitig abschließen, verfällt die Reservierung.", "16.11.2026", "um"],
  ["pl", "Zapłać najpóźniej", "Jeśli nie dokonasz płatności na czas, rezerwacja wygaśnie.", "16.11.2026", "o"],
]) {
  test(`approved email displays the DB payment deadline in ${language}`, async () => {
    const mail = await sendEmail({ language });
    assert.ok(mail.html.includes(label));
    assert.ok(mail.html.includes(warning));
    assert.ok(mail.html.includes(`${label} ${expectedDate} ${expectedAt} 10:00 (Praha).`));
    assert.equal(mail.html.split(label).length, 2, "deadline appears once");
    assert.ok(mail.html.indexOf(label) > mail.html.indexOf("Vrtačka"));
    assert.ok(mail.html.indexOf(label) < mail.html.indexOf("R-000050"));
    assert.match(mail.html, /background:#f4faf7/);
    assert.match(mail.html, /href="https:\/\/rentulo.eu\/moje-rezervace.html\?reservation=33333333-3333-4333-8333-333333333333"/);
    assert.match(mail.html, /<a [^>]+>[^<]+<\/a>/);
    assert.equal(mail.reply_to, "rentulo@rentulo.com");
  });
}

for (const expiresAt of [null, "", "invalid-date"]) {
  test(`approved email omits untrustworthy deadline ${JSON.stringify(expiresAt)}`, async () => {
    const mail = await sendEmail({ expiresAt });
    assert.doesNotMatch(mail.html, /Zaplaťte nejpozději|Pokud platbu nedokončíte včas/);
    assert.ok(mail.html.includes("R-000050"));
    assert.ok(mail.html.includes("Zaplatit rezervaci"));
  });
}

test("only the approved event receives the new deadline callout", async () => {
  const mail = await sendEmail({ event: "paid" });
  assert.doesNotMatch(mail.html, /Zaplaťte nejpozději|Pokud platbu nedokončíte včas/);
  assert.match(mail.html, /Zobrazit rezervaci/);
});

test("Prague summer daylight saving time is applied to UTC deadline", async () => {
  const mail = await sendEmail({ expiresAt: "2026-07-01T08:00:00Z" });
  assert.ok(mail.html.includes("1. 7. 2026 v 10:00 (Praha)"));
  assert.doesNotMatch(mail.html, /v 08:00 \(Praha\)/);
});
