const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const migration = read('supabase/migrations/20261013100000_monitor_reservation_notifications_TEST.sql');
const monitor = read('supabase/functions/monitor-reservation-notifications/index.ts');
const worker = read('supabase/functions/process-reservation-notifications/index.ts');
const workflow = read('.github/workflows/rentulo-test-notification-monitor.yml');

const expectedTestUrl = 'https://vspposovhdgvbeukoivh.supabase.co';
const secret = 'a'.repeat(80);

function alert(key, generation = 1) {
  return {
    alert_key: key, claim_token: `claim-${key}`, alert_generation: generation,
    issue_kind: key === 'worker-stale' ? 'worker_stale' : 'dead',
    reservation_number: key === 'worker-stale' ? null : 'R-000026',
    detail: 'Testovacia chyba',
  };
}

async function invokeMonitor({
  alerts = [], url = expectedTestUrl, providedSecret = secret,
  environmentSecret = secret, apiKey = 'test-resend-key',
  providerStatus = 200, providerThrows = false,
  rpcError = false, ackError = false, method = 'POST',
} = {}) {
  let handler;
  const rpcCalls = [];
  const externalCalls = [];
  const environment = {
    SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: 'service-test-key',
    RENTULO_MONITOR_SECRET: environmentSecret,
    RESEND_API_KEY: apiKey,
    EMAIL_FROM: 'Rentulo <rentulo@rentulo.com>',
  };
  const admin = {
    rpc(name, payload) {
      return {
        abortSignal() {
          rpcCalls.push({ name, payload });
          if (rpcError) return Promise.resolve({ data: null, error: { message: 'test' } });
          if (name === 'claim_reservation_notification_monitor_alerts') {
            return Promise.resolve({ data: alerts, error: null });
          }
          if (name === 'finish_reservation_notification_monitor_alert') {
            return Promise.resolve({ data: !ackError, error: null });
          }
          throw new Error(`Unexpected RPC: ${name}`);
        },
      };
    },
  };
  const context = vm.createContext({
    Deno: { serve(fn) { handler = fn; }, env: { get(key) { return environment[key]; } } },
    createClient() { return admin; },
    crypto: webcrypto,
    Response, AbortSignal, TextEncoder,
    fetch: async (endpoint, options) => {
      externalCalls.push({ endpoint, options });
      if (providerThrows) throw new Error('simulated timeout');
      return new Response(JSON.stringify({ id: 'resend-test-id' }), { status: providerStatus });
    },
    console: { error() {} },
  });
  const js = stripTypeScriptTypes(monitor.replace(/^import .*;\s*$/gm, ''));
  vm.runInContext(js, context, { timeout: 1000 });
  const response = await handler(new Request('https://monitor.invalid/', {
    method,
    headers: { 'x-rentulo-monitor-secret': providedSecret },
  }));
  return {
    status: response.status, body: await response.json(), rpcCalls, externalCalls,
  };
}

test('P1-4: monitor database is server-only, and RPCs are service-role guarded', () => {
  assert.match(migration, /enable row level security/g);
  assert.equal((migration.match(/enable row level security;/g) || []).length, 2);
  assert.match(migration, /record_reservation_notification_worker_success/);
  assert.match(migration, /claim_reservation_notification_monitor_alerts/);
  assert.match(migration, /finish_reservation_notification_monitor_alert/);
  assert.equal((migration.match(/if auth\.role\(\) <> 'service_role' then/g) || []).length, 3);
  assert.match(migration, /revoke all on public\.reservation_notification_monitor_alerts from public, anon, authenticated/);
  assert.match(migration, /revoke all on public\.reservation_notification_worker_health from public, anon, authenticated/);
  assert.doesNotMatch(migration, /cron\.schedule|net\.http_post/);
});

test('P1-4: monitor detects dead, delayed, stuck, missing heartbeat, and avoids duplicates', () => {
  assert.match(migration, /d\.status = 'dead'/);
  assert.match(migration, /d\.next_attempt_at < v_checked_at - interval '10 minutes'/);
  assert.match(migration, /coalesce\(d\.lease_until, d\.updated_at\) < v_checked_at - interval '3 minutes'/);
  assert.match(migration, /last_success_at >= v_checked_at - interval '8 minutes'/);
  assert.match(migration, /on conflict on constraint reservation_notification_monitor_alerts_pkey do update/);
  assert.match(migration, /generation = case when not a\.active then a\.generation \+ 1 else a\.generation end/);
  assert.match(migration, /sent_at = case when not a\.active then null else a\.sent_at end/);
  assert.match(migration, /a\.active and a\.sent_at is null/);
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /a\.claim_token = p_claim_token/);
  assert.match(migration, /a\.generation = p_generation/);
  assert.match(migration, /least\(3600, 60 \* power/);
});

test('P1-4: heartbeat cannot pass before successful queue acknowledgements', () => {
  assert.match(worker, /if \(summary\.acknowledgement_failures > 0\)[\s\S]*?record_reservation_notification_worker_success/);
  assert.match(worker, /HEARTBEAT_TIMEOUT_MS = 2000/);
  assert.match(worker, /p_claimed: summary\.claimed/);
  assert.match(worker, /return json\(\{ error: "Notification heartbeat unavailable" \}, 500\)/);
});

test('P1-4: GitHub watchdog is external, manually gated, TEST-only and every five minutes', () => {
  assert.match(workflow, /cron: '\*\/5 \* \* \* \*'/);
  assert.match(workflow, /vars\.RENTULO_TEST_MONITOR_ENABLED == 'true'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /secrets\.RENTULO_TEST_MONITOR_SECRET/);
  assert.match(workflow, /vspposovhdgvbeukoivh\.supabase\.co/);
  assert.doesNotMatch(workflow, /tfvgxrdjrpicgtvovehl|rentulo-prod|rentulo\.com\/functions/);
});

test('P1-4: monitor blocks PROD and incorrect secrets before any database or email work', async () => {
  const prod = await invokeMonitor({ url: 'https://tfvgxrdjrpicgtvovehl.supabase.co' });
  assert.equal(prod.status, 403);
  assert.equal(prod.rpcCalls.length, 0);
  assert.equal(prod.externalCalls.length, 0);
  const badSecret = await invokeMonitor({ providedSecret: 'wrong'.repeat(16) });
  assert.equal(badSecret.status, 401);
  assert.equal(badSecret.rpcCalls.length, 0);
  assert.equal(badSecret.externalCalls.length, 0);
  const missingEmail = await invokeMonitor({ apiKey: '' });
  assert.equal(missingEmail.status, 503);
  assert.equal(missingEmail.rpcCalls.length, 0);
  assert.equal(missingEmail.externalCalls.length, 0);
});

test('P1-4: idle queue sends nothing; active problem sends limited operational detail', async () => {
  const idle = await invokeMonitor();
  assert.equal(idle.status, 200);
  assert.equal(idle.body.claimed, 0);
  assert.equal(idle.externalCalls.length, 0);
  assert.equal(idle.rpcCalls.length, 1);

  const active = await invokeMonitor({ alerts: [alert('dead:1')] });
  assert.equal(active.status, 200);
  assert.equal(active.body.sent, 1);
  assert.equal(active.externalCalls.length, 1);
  assert.equal(active.externalCalls[0].endpoint, 'https://api.resend.com/emails');
  const payload = JSON.parse(active.externalCalls[0].options.body);
  assert.deepEqual(payload.to, ['ebbi@ebbi.sk']);
  assert.match(payload.subject, /^Rentulo TEST/);
  assert.match(payload.text, /R-000026/);
  assert.match(payload.text, /manuálne|preveriť/);
  assert.equal(active.rpcCalls[1].payload.p_sent, true);
});

test('P1-4: same incident generation uses same Resend idempotency key', async () => {
  const first = await invokeMonitor({ alerts: [alert('dead:1', 1)] });
  const second = await invokeMonitor({ alerts: [alert('dead:1', 1)] });
  const changed = await invokeMonitor({ alerts: [alert('dead:1', 2)] });
  const key = (item) => item.externalCalls[0].options.headers['Idempotency-Key'];
  assert.equal(key(first), key(second));
  assert.notEqual(key(first), key(changed));
  assert.match(key(first), /^rentulo-alert-[a-f0-9]{64}$/);
});

test('P1-4: failed alert mail is marked retry, ambiguous transports are not silently discarded', async () => {
  const failed = await invokeMonitor({ alerts: [alert('dead:1')], providerThrows: true });
  assert.equal(failed.status, 503);
  assert.equal(failed.body.retried, 1);
  assert.equal(failed.rpcCalls[1].payload.p_sent, false);
  assert.match(failed.rpcCalls[1].payload.p_error, /unavailable/);
  const failedAck = await invokeMonitor({ alerts: [alert('worker-stale')], ackError: true });
  assert.equal(failedAck.status, 503);
  assert.equal(failedAck.body.ack_failures, 1);
});

test('P1-4: never attempts to send more than five alert emails per monitor tick', async () => {
  const results = await invokeMonitor({ alerts: Array.from({ length: 5 }, (_, i) => alert(`dead:${i}`)) });
  assert.equal(results.status, 200);
  assert.equal(results.body.claimed, 5);
  assert.equal(results.externalCalls.length, 5);
  assert.equal(results.rpcCalls.length, 6);
  assert.equal(results.rpcCalls[0].payload.p_limit, 5);
});
