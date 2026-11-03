const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('supabase/functions/monitor-reservation-notifications-prod/index.ts');
const workflow = read('.github/workflows/rentulo-prod-notification-monitor.yml');
const runbook = read('docs/BOD11_PROD_NOTIFICATION_MONITOR.md');
const prodUrl = 'https://tfvgxrdjrpicgtvovehl.supabase.co';
const testUrl = 'https://vspposovhdgvbeukoivh.supabase.co';
const secret = 'S'.repeat(128);

function alert(key, generation = 1) {
  return {
    alert_key: key,
    claim_token: `claim-${key}`,
    alert_generation: generation,
    issue_kind: key === 'worker-stale' ? 'worker_stale' : 'dead',
    reservation_number: key === 'worker-stale' ? null : 'R-000001',
    detail: 'Bezpecny technicky test',
  };
}

async function invoke({
  alerts = [], url = prodUrl, method = 'POST', providedSecret = secret,
  configuredSecret = secret, resendKey = 'resend-prod-test', serviceKey = 'service-prod-test',
  providerStatus = 200, providerThrows = false, rpcError = false, ackError = false,
} = {}) {
  let handler;
  const rpcCalls = [];
  const externalCalls = [];
  const environment = {
    SUPABASE_URL: url,
    RENTULO_PROD_MONITOR_SECRET: configuredSecret,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    RESEND_API_KEY: resendKey,
  };
  const admin = {
    rpc(name, payload) {
      return {
        abortSignal() {
          rpcCalls.push({ name, payload });
          if (rpcError) return Promise.resolve({ error: { message: 'mock outage' }, data: null });
          if (name === 'claim_reservation_notification_monitor_alerts') {
            return Promise.resolve({ data: alerts, error: null });
          }
          if (name === 'finish_reservation_notification_monitor_alert') {
            return Promise.resolve({ data: !ackError, error: null });
          }
          throw new Error(`Unexpected RPC ${name}`);
        },
      };
    },
  };
  const context = vm.createContext({
    Deno: {
      serve(fn) { handler = fn; },
      env: { get(name) { return environment[name]; } },
    },
    createClient() { return admin; },
    crypto: webcrypto,
    Response, AbortSignal, TextEncoder,
    fetch: async (endpoint, options) => {
      externalCalls.push({ endpoint, options });
      if (providerThrows) throw new Error('provider timeout');
      return new Response(JSON.stringify({ id: 'resend-mock-id' }), { status: providerStatus });
    },
    console: { error() {} },
  });
  const js = stripTypeScriptTypes(source.replace(/^import .*;\s*$/gm, ''));
  vm.runInContext(js, context, { timeout: 1500 });
  const headers = {};
  if (providedSecret !== null) headers['x-rentulo-monitor-secret'] = providedSecret;
  const response = await handler(new Request('https://monitor.invalid/', { method, headers }));
  return { status: response.status, body: await response.json(), rpcCalls, externalCalls };
}

test('PROD monitor uses a separate fail-closed endpoint, not the TEST monitor', async () => {
  assert.match(source, /PROD_SUPABASE_URL = "https:\/\/tfvgxrdjrpicgtvovehl\.supabase\.co"/);
  assert.match(source, /url !== PROD_SUPABASE_URL/);
  assert.match(source, /RENTULO_PROD_MONITOR_SECRET/);
  assert.match(source, /x-rentulo-monitor-secret/);
  assert.doesNotMatch(source, /rentulo-test-monitor-support-v2/);
  assert.doesNotMatch(source, /send-reservation-email/);
  const testProject = await invoke({ url: testUrl });
  assert.equal(testProject.status, 403);
  assert.equal(testProject.rpcCalls.length, 0);
  assert.equal(testProject.externalCalls.length, 0);
});

test('PROD monitor rejects unauthorized, missing or short secrets before database access', async () => {
  for (const options of [
    { providedSecret: 'wrong' },
    { providedSecret: null },
    { configuredSecret: 'a'.repeat(10) },
  ]) {
    const result = await invoke(options);
    assert.equal(result.status, 401);
    assert.equal(result.rpcCalls.length, 0);
    assert.equal(result.externalCalls.length, 0);
  }
  const wrongMethod = await invoke({ method: 'GET' });
  assert.equal(wrongMethod.status, 405);
});

test('PROD monitor fails closed when backend credentials or queue are unavailable', async () => {
  for (const opts of [{ resendKey: '' }, { serviceKey: '' }, { rpcError: true }]) {
    const result = await invoke(opts);
    assert.equal(result.status, 503);
    assert.equal(result.externalCalls.length, 0);
  }
});

test('PROD monitor healthy idle job sends nothing and claims up to five alerts', async () => {
  const idle = await invoke();
  assert.equal(idle.status, 200);
  assert.equal(idle.body.claimed, 0);
  assert.equal(idle.body.sent, 0);
  assert.equal(idle.rpcCalls[0].name, 'claim_reservation_notification_monitor_alerts');
  assert.equal(idle.rpcCalls[0].payload.p_limit, 5);
  assert.equal(idle.externalCalls.length, 0);

  const full = await invoke({ alerts: Array.from({ length: 5 }, (_, i) => alert(`dead:${i}`)) });
  assert.equal(full.status, 200);
  assert.equal(full.body.claimed, 5);
  assert.equal(full.body.sent, 5);
  assert.equal(full.externalCalls.length, 5);
  assert.equal(full.rpcCalls.length, 6);
});

test('PROD monitor routes alerts only to technical support with distinct PROD branding', async () => {
  const result = await invoke({ alerts: [alert('dead:1')] });
  assert.equal(result.status, 200);
  assert.equal(result.body.sent, 1);
  assert.equal(result.externalCalls[0].endpoint, 'https://api.resend.com/emails');
  const body = JSON.parse(result.externalCalls[0].options.body);
  assert.equal(body.from, 'Rentulo Monitoring <support@rentulo.com>');
  assert.deepEqual(body.to, ['support@rentulo.com']);
  assert.equal(body.reply_to, 'support@rentulo.com');
  assert.match(body.subject, /^Rentulo PROD/);
  assert.match(body.text, /R-000001/);
  assert.doesNotMatch(body.text, /Supabase TEST|Rentulo TEST/);
  assert.equal(result.rpcCalls[1].payload.p_sent, true);
});

test('PROD alert email idempotency is stable per generation and isolated from TEST namespace', async () => {
  const first = await invoke({ alerts: [alert('dead:1', 1)] });
  const repeated = await invoke({ alerts: [alert('dead:1', 1)] });
  const second = await invoke({ alerts: [alert('dead:1', 2)] });
  const header = (r) => r.externalCalls[0].options.headers['Idempotency-Key'];
  assert.equal(header(first), header(repeated));
  assert.notEqual(header(first), header(second));
  assert.match(header(first), /^rentulo-alert-[a-f0-9]{64}$/);
});

test('PROD monitor retries failed provider delivery without claiming alert sent', async () => {
  const timeout = await invoke({ alerts: [alert('dead:1')], providerThrows: true });
  assert.equal(timeout.status, 503);
  assert.equal(timeout.body.retried, 1);
  assert.equal(timeout.rpcCalls[1].payload.p_sent, false);
  const failedAck = await invoke({ alerts: [alert('worker-stale')], ackError: true });
  assert.equal(failedAck.status, 503);
  assert.equal(failedAck.body.ack_failures, 1);
});

test('PROD scheduler is independent, default-disabled, main-only and secret-scoped', () => {
  assert.match(workflow, /on:\s*\n\s*workflow_dispatch:\s*\n\s*schedule:/);
  assert.match(workflow, /'2-59\/5 \* \* \* \*'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /vars\.RENTULO_PROD_MONITOR_ENABLED == 'true'/);
  assert.match(workflow, /secrets\.RENTULO_PROD_MONITOR_SECRET/g);
  assert.match(workflow, /tfvgxrdjrpicgtvovehl\.supabase\.co\/functions\/v1\/monitor-reservation-notifications-prod/);
  assert.doesNotMatch(workflow, /vspposovhdgvbeukoivh|RENTULO_TEST_MONITOR_SECRET|cron-job\.org/);
  assert.match(runbook, /TEST nemeníme/);
  assert.match(runbook, /osobitné schválenie|Samostatne schváliť nasadenie/);
});
