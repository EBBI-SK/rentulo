'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const sql = read('supabase/migrations/20261102160000_bod8_2_extension_outcome_emails_TEST.sql');
const source = read('supabase/functions/send-reservation-email/index.ts');
const worker = read('supabase/functions/process-reservation-notifications/index.ts');
const policy = import('../supabase/functions/_shared/notification-email-policy.mjs');
const ownerId = '11111111-1111-4111-8111-111111111111';
const renterId = '22222222-2222-4222-8222-222222222222';
const reservationId = '33333333-3333-4333-8333-333333333333';
const firstExtensionId = '44444444-4444-4444-8444-444444444444';
const secondExtensionId = '55555555-5555-4555-8555-555555555555';

async function runEmail({
  language = 'cs', currentStatus = 'approved', extensionId = firstExtensionId,
  recipientId = ownerId, outboxLinked = true, existingEmail = 'none',
  claimed = true, isServiceRole = true, parentStatus = 'picked_up',
  event = 'extension_approved', paidAtPresent = true, paymentIntentPresent = true,
  chargePresent = true,
} = {}) {
  let handler;
  const calls = [];
  const sentEmails = [];
  const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { shouldDeliverReservationEmail } = await policy;
  const profile = { id: recipientId, email: recipientId === ownerId ? 'owner@example.test' : 'renter@example.test',
    full_name: recipientId === ownerId ? 'Owner' : 'Renter',
    preferred_language: language, email_notifications: false };
  const reservation = { id: reservationId, offer_id: 'offer-id', owner_id: ownerId,
    renter_id: renterId, offer_name: 'Vrtačka', start_date: '2026-11-01',
    end_date: '2026-11-05', pickup_time: '10:00:00', status: parentStatus,
    reservation_number: 'R-000101', expires_at: null };
  const extension = { id: extensionId, reservation_id: reservationId,
    owner_id: ownerId, renter_id: renterId, status: currentStatus,
    previous_end_date: '2026-11-05', new_end_date: '2026-11-10',
    amount_total: 750, currency: 'czk', approval_deadline_at: deadline,
    payment_deadline_at: deadline, paid_at: paidAtPresent ? new Date().toISOString() : null,
    stripe_payment_intent_id: paymentIntentPresent ? 'pi_valid123' : null,
    stripe_charge_id: chargePresent ? 'ch_valid123' : null };
  const legacyEmail = { id: 'email-log-existing', status: existingEmail,
    created_at: '2026-01-01T00:00:00Z' };

  const entries = [];
  const admin = {
    from(table) {
      const q = { table, filters: [], mutation: null, insertData: null, selectColumns: null };
      const query = {
        select(columns) { q.selectColumns = columns; return this; },
        eq(key, value) { q.filters.push([key, value]); return this; },
        is(key, value) { q.filters.push([key, value]); return this; },
        in(key, ids) { q.filters.push([key, ids]); return this; },
        insert(data) { q.mutation = 'insert'; q.insertData = data; return this; },
        update(data) { q.mutation = 'update'; q.insertData = data; return this; },
        single() { return Promise.resolve(result()); },
        maybeSingle() { return Promise.resolve(result()); },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      function result() {
        calls.push({ table, filters: q.filters, mutation: q.mutation, data: q.insertData,
          selectColumns: q.selectColumns });
        if (table === 'reservation_notification_deliveries') {
          if (!event.startsWith('extension_') && q.selectColumns.includes('extension_id')) {
            return { data: null, error: { code: '42703' } }; // PROD column is absent.
          }
          return { data: claimed ? {
            id: 'claimed-mail', ...(event.startsWith('extension_')
              ? { extension_id: outboxLinked ? extensionId : null } : {}),
          } : null, error: null };
        }
        if (table === 'reservations') return { data: reservation, error: null };
        if (table === 'reservation_extensions') return { data: extension, error: null };
        if (table === 'offers') return { data: { offer_number: 'N-000101' }, error: null };
        if (table === 'profiles') return { data: [profile], error: null };
        if (table === 'reservation_email_deliveries' && q.mutation === 'insert') {
          entries.push(q.insertData);
          if (!event.startsWith('extension_') && 'extension_id' in q.insertData) {
            return { data: null, error: { code: '42703' } }; // PROD column is absent.
          }
          if (existingEmail !== 'none') return { data: null, error: { code: '23505' } };
          return { data: { id: 'email-log-new' }, error: null };
        }
        if (table === 'reservation_email_deliveries' && q.mutation === 'update') {
          return { data: { id: 'email-log-existing' }, error: null };
        }
        if (table === 'reservation_email_deliveries') return { data: legacyEmail, error: null };
        throw Error(`Unexpected DB query on ${table}`);
      }
      return query;
    },
  };
  const serverConfig = {
    SUPABASE_URL: 'https://vspposovhdgvbeukoivh.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
    SUPABASE_ANON_KEY: 'anon-key', RESEND_API_KEY: 'resend-key',
    EMAIL_FROM: 'Rentulo <support@rentulo.com>', SITE_URL: 'https://rentulo.eu',
  };
  const context = vm.createContext({
    Deno: { serve(fn) { handler = fn; }, env: { get(k) { return serverConfig[k]; } } },
    createClient(_url, key) {
      if (key !== serverConfig.SUPABASE_SERVICE_ROLE_KEY) {
        return { auth: { async getUser() { return { data: { user: { id: renterId } }, error: null }; } } };
      }
      return admin;
    },
    shouldDeliverReservationEmail,
    pragueRentalInstant() { return null; },
    fetch: async (url, options) => {
      assert.equal(url, 'https://api.resend.com/emails');
      sentEmails.push(options);
      return new Response(JSON.stringify({ id: 'resend-test-id' }), { status: 200 });
    },
    Response, Request, URL, TextEncoder, AbortSignal,
    console: { error() {} },
  });
  const executable = stripTypeScriptTypes(source.replace(/^import .*;\s*$/gm, ''));
  vm.runInContext(executable, context, { timeout: 2000 });
  const payload = { reservation_id: reservationId, event };
  if (claimed) {
    payload.recipient_id = recipientId;
    payload.notification_delivery_id = 'claimed-mail';
  }
  const response = await handler(new Request('https://rentulo.eu/functions/v1/send-reservation-email', {
    method: 'POST',
    headers: { Authorization: `Bearer ${isServiceRole ? serverConfig.SUPABASE_SERVICE_ROLE_KEY : 'user-token'}` },
    body: JSON.stringify(payload),
  }));
  return { status: response.status, body: await response.json(), calls, sentEmails, entries };
}


test('BOD 8.2: guard SQL is TEST-only and cannot affect PROD', () => {
  assert.match(sql, /rentulo_project_url/);
  assert.match(sql, /https:\/\/vspposovhdgvbeukoivh\.supabase\.co/);
  assert.doesNotMatch(sql, /tfvgxrdjrpicgtvovehl/);
  assert.match(sql, /after update of status on public\.reservation_extensions/);
  assert.match(sql, /old\.status is not distinct from new\.status/);
  assert.match(sql, /new\.status not in \('approved','rejected','paid','expired'\)/);
  assert.match(sql, /new\.owner_id <> new\.renter_id/);
  assert.match(sql, /new\.renter_id, 'email'/);
  assert.match(sql, /new\.owner_id, 'email'/);
  assert.match(sql, /on conflict do nothing/g);
  for (const event of ['extension_approved', 'extension_rejected', 'extension_paid', 'extension_expired']) {
    assert.match(sql, new RegExp(`'${event}'`));
    assert.match(worker, new RegExp(`"${event}"`));
  }
  assert.match(sql, /extension_id is not null and channel = 'email'/);
  assert.match(sql, /extension_id is null/);
  assert.match(sql, /revoke all on function public\.queue_extension_outcome_email\(\)/);
  assert.doesNotMatch(sql, /net\.http_post|cron\.schedule|api\.resend\.com|bulkgate/);
});

test('BOD 8.2: no accidental retroactive email and no untrusted SMS', () => {
  assert.doesNotMatch(sql, /insert into public\.reservation_notification_deliveries\s*\([^)]*\)\s*select/i);
  assert.doesNotMatch(read('supabase/functions/_shared/notification-sms.mjs'), /extension_(approved|rejected|paid|expired)/);
  const backfill = read('docs/sql/BOD08_2_BACKFILL_R000048_TEST.sql');
  assert.match(backfill, /R-000048/);
  assert.match(backfill, /e\.status = 'approved'/);
  assert.match(backfill, /e\.payment_deadline_at > clock_timestamp\(\)/);
  assert.match(backfill, /on conflict do nothing/);
  assert.match(backfill, /rentulo_project_url/);
});

test('new outcome emails are essential for every user preference', async () => {
  const { shouldDeliverReservationEmail } = await policy;
  for (const event of ['extension_approved','extension_rejected','extension_paid','extension_expired']) {
    assert.equal(shouldDeliverReservationEmail(event, 'person@example.test', false), true);
    assert.equal(shouldDeliverReservationEmail(event, null, true), false);
  }
});

const languages = [
  ['cs', 'Prodlou', 'Doplatek', 'Otevřít Moje rezervace →', 'Otevřít Moje nabídky →', 'Prodloužení pronájmu zaplaceno'],
  ['sk', 'Pred', 'Doplatok', 'Otvoriť Moje rezervácie →', 'Otvoriť Moje ponuky →', 'Predĺženie prenájmu zaplatené'],
  ['en', 'Extension', 'Additional payment', 'Open My reservations →', 'Open My listings →', 'Rental extension payment confirmed'],
  ['de', 'Verl', 'Nachzahlung', 'Meine Buchungen öffnen →', 'Meine Angebote öffnen →', 'Mietverlängerung bezahlt'],
  ['pl', 'Przed', 'Dop', 'Otwórz Moje rezerwacje →', 'Otwórz Moje oferty →', 'Przedłużenie najmu opłacone'],
];
for (const [language, prefix, priceLabel, renterAction, ownerAction, paidSubject] of languages) {
  test(`BOD 8.2 approved renders action and CZK top-up (${language})`, async () => {
    const output = await runEmail({ event: 'extension_approved', language, currentStatus: 'approved', recipientId: renterId });
    assert.equal(output.status, 200, JSON.stringify(output.body));
    assert.equal(output.body.results?.[0]?.status, 'sent');
    assert.equal(output.entries[0].extension_id, firstExtensionId);
    const message = JSON.parse(output.sentEmails[0].body);
    assert.equal(message.to[0], 'renter@example.test');
    assert.ok(message.subject.includes(prefix));
    assert.ok(message.html.includes(priceLabel));
    assert.ok(message.html.includes(`>${renterAction}</a>`));
    assert.match(message.html, /href="https:\/\/rentulo\.eu\/moje-rezervace\.html"/);
    assert.match(message.html, /750[,.]00|750[,.]00|750\s/);
    assert.match(message.html, /Praha/);
    assert.match(message.html, /R-000101/);
  });
  test(`BOD 8.2 rejected reminds the renter of the ORIGINAL return date (${language})`, async () => {
    const output = await runEmail({ event: 'extension_rejected', language, currentStatus: 'rejected', recipientId: renterId });
    assert.equal(output.status, 200, JSON.stringify(output.body));
    const message = JSON.parse(output.sentEmails[0].body);
    assert.ok(message.html.includes(`>${renterAction}</a>`));
    assert.match(message.html, /href="https:\/\/rentulo\.eu\/moje-rezervace\.html"/);
    assert.match(message.html, /(?:5\.\s*11\.\s*2026|5\/11\/2026|Nov(?:ember)? 5, 2026)/);
    assert.match(message.html, /R-000101/);
    assert.equal(message.to[0], 'renter@example.test');
    assert.equal(output.entries[0].event_type, 'extension_rejected');
  });
  test(`BOD 8.2 paid reaches the RENTER with confirmed new date (${language})`, async () => {
    const output = await runEmail({ event: 'extension_paid', language, currentStatus: 'paid', recipientId: renterId });
    assert.equal(output.status, 200, JSON.stringify(output.body));
    const message = JSON.parse(output.sentEmails[0].body);
    assert.equal(message.subject, paidSubject);
    assert.ok(message.html.includes(`>${renterAction}</a>`));
    assert.match(message.html, /(?:10\.\s*11\.\s*2026|10\/11\/2026|Nov(?:ember)? 10, 2026)/);
    assert.ok(message.html.includes(priceLabel));
    assert.equal(message.to[0], 'renter@example.test');
  });
  test(`BOD 8.2 paid reaches OWNER (not renter) with same new return date (${language})`, async () => {
    const output = await runEmail({ event: 'extension_paid', language, currentStatus: 'paid', recipientId: ownerId });
    assert.equal(output.status, 200, JSON.stringify(output.body));
    const message = JSON.parse(output.sentEmails[0].body);
    assert.equal(message.subject, paidSubject);
    assert.ok(message.html.includes(`>${ownerAction}</a>`));
    assert.match(message.html, /href="https:\/\/rentulo\.eu\/moje-nabidky\.html"/);
    assert.match(message.html, /(?:10\.\s*11\.\s*2026|10\/11\/2026|Nov(?:ember)? 10, 2026)/);
    assert.equal(message.to[0], 'owner@example.test');
  });
  test(`BOD 8.2 expired reminds renter of original return date (${language})`, async () => {
    const output = await runEmail({ event: 'extension_expired', language, currentStatus: 'expired', recipientId: renterId });
    assert.equal(output.status, 200, JSON.stringify(output.body));
    const message = JSON.parse(output.sentEmails[0].body);
    assert.ok(message.html.includes(`>${renterAction}</a>`));
    assert.match(message.html, /href="https:\/\/rentulo\.eu\/moje-rezervace\.html"/);
    assert.match(message.html, /(?:5\.\s*11\.\s*2026|5\/11\/2026|Nov(?:ember)? 5, 2026)/);
    assert.equal(message.to[0], 'renter@example.test');
  });
}

test('cannot forge or direct-send extension decisions without worker claim', async () => {
  for (const input of [
    { claimed: false, isServiceRole: true },
    { claimed: false, isServiceRole: false },
    { outboxLinked: false },
    { recipientId: ownerId },
  ]) {
    const output = await runEmail({ event: 'extension_approved', currentStatus: 'approved', recipientId: renterId, ...input });
    assert.equal(output.status, 403, JSON.stringify(output.body));
    assert.equal(output.sentEmails.length, 0);
  }
  const wrongPaidRecipient = await runEmail({ event: 'extension_paid', currentStatus: 'paid', recipientId: '99999999-9999-4999-8999-999999999999' });
  assert.equal(wrongPaidRecipient.status, 403);
  assert.equal(wrongPaidRecipient.sentEmails.length, 0);
});

test('stale approval email is not sent after payment, expiry or after its parent return', async () => {
  for (const args of [{ currentStatus: 'paid' }, { currentStatus: 'expired' }, { parentStatus: 'returned' }]) {
    const output = await runEmail({ event: 'extension_approved', recipientId: renterId, ...args });
    assert.equal(output.status, 200);
    assert.equal(output.body.results?.[0]?.status, 'skipped');
    assert.equal(output.sentEmails.length, 0);
  }
});

test('no fake paid email if Stripe payment finalizer evidence is incomplete', async () => {
  for (const args of [{ paidAtPresent: false }, { paymentIntentPresent: false }, { chargePresent: false }]) {
    const output = await runEmail({ event: 'extension_paid', currentStatus: 'paid', recipientId: renterId, ...args });
    assert.equal(output.status, 409);
    assert.equal(output.sentEmails.length, 0);
  }
});

test('extension outcomes deduplicate per extension, event and recipient', async () => {
  const first = await runEmail({ event: 'extension_approved', recipientId: renterId, extensionId: firstExtensionId });
  const second = await runEmail({ event: 'extension_approved', recipientId: renterId, extensionId: secondExtensionId });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.notEqual(first.entries[0].extension_id, second.entries[0].extension_id);
  const duplicate = await runEmail({ event: 'extension_approved', recipientId: renterId, existingEmail: 'sent' });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.results?.[0]?.status, 'duplicate');
  assert.equal(duplicate.sentEmails.length, 0);
  assert.ok(duplicate.calls.some(c => c.table === 'reservation_email_deliveries' &&
    c.filters.some(([key, val]) => key === 'extension_id' && val === firstExtensionId)));
});
