'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const sql = read('supabase/migrations/20261102130000_bod8_1_extension_request_email_TEST.sql');
const source = read('supabase/functions/send-reservation-email/index.ts');
const worker = read('supabase/functions/process-reservation-notifications/index.ts');
const policy = import('../supabase/functions/_shared/notification-email-policy.mjs');

const ownerId = '11111111-1111-4111-8111-111111111111';
const renterId = '22222222-2222-4222-8222-222222222222';
const reservationId = '33333333-3333-4333-8333-333333333333';
const firstExtensionId = '44444444-4444-4444-8444-444444444444';
const secondExtensionId = '55555555-5555-4555-8555-555555555555';

// Run the REAL TypeScript email handler without network I/O, replacing only
// Supabase and Resend transport dependencies. Covers authorization,
// idempotency, real five-language HTML and owner-only recipient selection.
async function runEmail({
  language = 'cs', currentStatus = 'pending', extensionId = firstExtensionId,
  recipientId = ownerId, outboxLinked = true, existingEmail = 'none',
  claimed = true, isServiceRole = true, parentStatus = 'picked_up',
  event = 'extension_requested',
} = {}) {
  let handler;
  const calls = [];
  const sentEmails = [];
  const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { shouldDeliverReservationEmail } = await policy;
  const profile = { id: ownerId, email: 'owner@example.test', full_name: 'Owner',
    preferred_language: language, email_notifications: false };
  const reservation = { id: reservationId, offer_id: 'offer-id', owner_id: ownerId,
    renter_id: renterId, offer_name: 'Vrtačka', start_date: '2026-11-01',
    end_date: '2026-11-05', pickup_time: '10:00:00', status: parentStatus,
    reservation_number: 'R-000101', expires_at: null };
  const extension = { id: extensionId, reservation_id: reservationId,
    owner_id: ownerId, renter_id: renterId, status: currentStatus,
    new_end_date: '2026-11-10', approval_deadline_at: deadline };
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
          if (event !== 'extension_requested' && q.selectColumns.includes('extension_id')) {
            return { data: null, error: { code: '42703' } }; // PROD column is absent.
          }
          return { data: claimed ? {
            id: 'claimed-mail', ...(event === 'extension_requested'
              ? { extension_id: outboxLinked ? extensionId : null } : {}),
          } : null, error: null };
        }
        if (table === 'reservations') return { data: reservation, error: null };
        if (table === 'reservation_extensions') return { data: extension, error: null };
        if (table === 'offers') return { data: { offer_number: 'N-000101' }, error: null };
        if (table === 'profiles') return { data: [profile], error: null };
        if (table === 'reservation_email_deliveries' && q.mutation === 'insert') {
          entries.push(q.insertData);
          if (event !== 'extension_requested' && 'extension_id' in q.insertData) {
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

test('TEST-only migration uses existing queues, guarded DB trigger and extension-specific uniqueness', () => {
  assert.match(sql, /rentulo_project_url/);
  assert.match(sql, /https:\/\/vspposovhdgvbeukoivh\.supabase\.co/);
  assert.doesNotMatch(sql, /tfvgxrdjrpicgtvovehl\.supabase\.co/);
  assert.match(sql, /after insert on public\.reservation_extensions/);
  assert.match(sql, /new\.status = 'pending'/);
  assert.match(sql, /new\.owner_id, 'email'/);
  assert.match(sql, /create unique index rno_extension_event_unique/);
  assert.match(sql, /create unique index red_extension_event_unique/);
  assert.match(sql, /where extension_id is not null/g);
  assert.match(sql, /where extension_id is null/g);
  assert.match(sql, /on conflict do nothing/g);
  assert.match(sql, /event_type = 'extension_requested' and extension_id is not null and channel = 'email'/);
  assert.match(sql, /revoke all on function public\.queue_extension_request_owner_email\(\)/);
  assert.doesNotMatch(sql, /cron\.schedule|net\.http_post|https:\/\/api\.resend\.com|https:\/\/portal\.bulkgate\.com/);
});

test('both old reservation uniqueness constraints are replaced; all legacy event scopes remain', () => {
  assert.match(sql, /pg_constraint c/);
  assert.match(sql, /drop constraint %I/);
  assert.match(sql, /rno_legacy_event_unique/);
  assert.match(sql, /red_legacy_event_unique/);
  const legacy = read('supabase/migrations/20261017233000_return_followup_incident_TEST.sql');
  const re = /'([a-z_]+)'/g;
  const current = legacy.match(/add constraint reservation_notification_deliveries_event_type_check[\s\S]*?\);/)?.[0] || '';
  const required = [...current.matchAll(re)].map(x => x[1]);
  for (const event of required) assert.match(sql, new RegExp(`'${event}'`));
  assert.match(sql, /extension_requested/);
});

test('extension requests are essential emails, never SMS', async () => {
  const { shouldDeliverReservationEmail } = await policy;
  assert.equal(shouldDeliverReservationEmail('extension_requested', 'owner@example.test', false), true);
  assert.equal(shouldDeliverReservationEmail('extension_requested', '', true), false);
  // New outcome emails are essential after the separate BOD 8.2 rollout.
  assert.equal(shouldDeliverReservationEmail('extension_approved', 'owner@example.test', true), true);
  assert.match(worker, /\| "extension_requested"/);
  const smsSource = read('supabase/functions/_shared/notification-sms.mjs');
  assert.doesNotMatch(smsSource, /extension_requested/);
});

for (const [language, subject, dateLabel, action] of [
  ['cs', 'Nová žádost o prodloužení', 'Požadované datum vrácení', 'Otevřít Moje nabídky →'],
  ['sk', 'Nová žiadosť o predĺženie', 'Požadovaný dátum vrátenia', 'Otvoriť Moje ponuky →'],
  ['en', 'New rental extension request', 'Requested return date', 'Open My listings →'],
  ['de', 'Neue Anfrage zur Mietverlängerung', 'Gewünschtes Rückgabedatum', 'Meine Angebote öffnen →'],
  ['pl', 'Nowa prośba o przedłużenie', 'Proponowana data zwrotu', 'Otwórz Moje oferty →'],
]) {
  test(`claimed extension email renders in ${language} with owner action and new return date`, async () => {
    const out = await runEmail({ language });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.results?.[0]?.status, 'sent');
    assert.equal(out.sentEmails.length, 1);
    const email = JSON.parse(out.sentEmails[0].body);
    assert.ok(email.subject.includes(subject));
    assert.equal(email.to.length, 1);
    assert.equal(email.to[0], 'owner@example.test');
    assert.ok(email.html.includes(dateLabel));
    assert.match(email.html, /(?:10\.\s*11\.\s*2026|Nov(?:ember)? 10, 2026|10\/11\/2026)/); // Requested date, not the original fifth.
    assert.ok(email.html.includes(`>${action}</a>`));
    assert.match(email.html, /href="https:\/\/rentulo\.eu\/moje-nabidky\.html"/);
    assert.match(email.html, /R-000101/);
    assert.match(email.html, /N-000101/);
    assert.equal(out.entries[0].extension_id, firstExtensionId);
    assert.equal(out.sentEmails[0].headers['Idempotency-Key'], 'rentulo-email-log-new');
  });
}

test('worker call must be claimed and linked to the exact extension', async () => {
  const noClaim = await runEmail({ claimed: false, isServiceRole: true });
  assert.equal(noClaim.status, 403);
  assert.equal(noClaim.sentEmails.length, 0);
  const userAttempt = await runEmail({ claimed: false, isServiceRole: false });
  assert.equal(userAttempt.status, 403);
  assert.equal(userAttempt.sentEmails.length, 0);
  const missingLink = await runEmail({ outboxLinked: false });
  assert.equal(missingLink.status, 403);
  assert.equal(missingLink.sentEmails.length, 0);
  const invalidRecipient = await runEmail({ recipientId: renterId });
  assert.equal(invalidRecipient.status, 403);
  assert.equal(invalidRecipient.sentEmails.length, 0);
});

test('stale extension request email is skipped, not sent after approval or return', async () => {
  for (const input of [
    { currentStatus: 'approved' },
    { currentStatus: 'expired' },
    { currentStatus: 'rejected' },
    { parentStatus: 'returned' },
  ]) {
    const out = await runEmail(input);
    assert.equal(out.status, 200);
    assert.equal(out.body.results?.[0]?.status, 'skipped');
    assert.equal(out.sentEmails.length, 0);
    assert.equal(out.entries.length, 0);
  }
});

test('each new extension has a distinct email-log deduplication key', async () => {
  const first = await runEmail({ extensionId: firstExtensionId });
  const second = await runEmail({ extensionId: secondExtensionId });
  assert.equal(first.entries[0].extension_id, firstExtensionId);
  assert.equal(second.entries[0].extension_id, secondExtensionId);
  assert.notEqual(first.entries[0].extension_id, second.entries[0].extension_id);
  assert.equal(first.sentEmails.length, 1);
  assert.equal(second.sentEmails.length, 1);
});

test('replayed extension request uses existing logged message, never sends again', async () => {
  const out = await runEmail({ existingEmail: 'sent' });
  assert.equal(out.status, 200);
  assert.equal(out.body.results?.[0]?.status, 'duplicate');
  assert.equal(out.sentEmails.length, 0);
  assert.ok(out.calls.some(x => x.table === 'reservation_email_deliveries' &&
    x.filters.some(([k,v]) => k === 'extension_id' && v === firstExtensionId)));
});

// The PROD project has not received the guarded TEST migration. Legacy event
// sends must not depend on the new columns until PROD has its own rollout.
test('existing reservation emails remain compatible with PROD lacking extension_id columns', async () => {
  const oldEvent = await runEmail({ event: 'new_request', parentStatus: 'pending', outboxLinked: false });
  assert.equal(oldEvent.status, 200, JSON.stringify(oldEvent.body));
  assert.equal(oldEvent.body.results?.[0]?.status, 'sent');
  assert.equal(oldEvent.entries.length, 1);
  assert.equal('extension_id' in oldEvent.entries[0], false);
  const query = oldEvent.calls.find(c => c.table === 'reservation_notification_deliveries');
  assert.equal(query.selectColumns, 'id');
  const repeated = await runEmail({ event: 'new_request', parentStatus: 'pending',
    outboxLinked: false, existingEmail: 'sent' });
  assert.equal(repeated.status, 200, JSON.stringify(repeated.body));
  assert.equal(repeated.body.results?.[0]?.status, 'duplicate');
  assert.equal(repeated.sentEmails.length, 0);
  assert.ok(!repeated.calls.some(c => c.table === 'reservation_email_deliveries' &&
    c.filters.some(([k]) => k === 'extension_id')));
});
