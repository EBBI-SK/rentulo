"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const sql = read('supabase/migrations/20261021110000_bod03b_exceptional_settlement_TEST.sql');
const edge = read('supabase/functions/process-dispute-refunds/index.ts');
const ownerEdge = read('supabase/functions/create-owner-transfer/index.ts');
const terms = read('js/i18n.js');

const claim = {
  settlement_id: '11111111-1111-4111-8111-111111111111',
  claim_token: '22222222-2222-4222-8222-222222222222',
  reservation_id: '33333333-3333-4333-8333-333333333333',
  payment_id: '44444444-4444-4444-8444-444444444444',
  stripe_charge_id: 'ch_1TEST123',
  stripe_payment_intent_id: 'pi_1TEST123',
  stripe_amount_minor: 10000,
  prior_refund_id: null,
};
const validCharge = {
  id: claim.stripe_charge_id, paid: true, captured: true, currency: 'czk',
  payment_intent: claim.stripe_payment_intent_id, amount: 10000, amount_refunded: 0,
};
function refund(id = 're_1TEST123') {
  return {
    id, charge: claim.stripe_charge_id, payment_intent: claim.stripe_payment_intent_id,
    amount: 10000, currency: 'czk', status: 'succeeded',
    metadata: { reservation_dispute_settlement_id: claim.settlement_id },
  };
}

async function runWorker({
  url = 'https://vspposovhdgvbeukoivh.supabase.co',
  stripeKey = 'sk_test_123', secret = 'x'.repeat(80), validSecret = true,
  rows = [claim], refunds = [], charge = validCharge, postStatus = 200,
  resultStatus = 'succeeded',
} = {}) {
  let handler;
  const rpcCalls = [], calls = [];
  const admin = {
    async rpc(name, params) {
      rpcCalls.push({ name, params });
      if (name === 'bod03b_verify_refund_cron_secret') return { data: validSecret, error: null };
      if (name === 'bod03b_claim_due_refunds') return { data: rows, error: null };
      if (name === 'bod03b_record_refund_result') return { data: resultStatus, error: null };
      if (name === 'bod03b_record_refund_error') return { data: params.p_manual_review ? 'manual_review' : 'authorized', error: null };
      throw Error(`Unexpected RPC ${name}`);
    },
  };
  const environment = {
    SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'service-test', STRIPE_SECRET_KEY: stripeKey,
  };
  const context = vm.createContext({
    Deno: { serve(fn) { handler = fn; }, env: { get(name) { return environment[name]; } } },
    createClient: () => admin,
    Response, Request, AbortSignal, URLSearchParams,
    console: { error() {} },
    async fetch(endpoint, options = {}) {
      calls.push({ endpoint: String(endpoint), options });
      if (String(endpoint).includes('/v1/charges/')) return new Response(JSON.stringify(charge));
      if (String(endpoint).includes('/v1/refunds?')) return new Response(JSON.stringify({ data: refunds, has_more: false }));
      if (String(endpoint) === 'https://api.stripe.com/v1/refunds' && options.method === 'POST') {
        const params = new URLSearchParams(String(options.body));
        return new Response(JSON.stringify({
          ...refund(), metadata: { reservation_dispute_settlement_id: params.get('metadata[reservation_dispute_settlement_id]') },
        }), { status: postStatus });
      }
      throw Error(`Unexpected Stripe endpoint ${endpoint}`);
    },
  });
  vm.runInContext(stripTypeScriptTypes(edge.replace(/^import .*;\s*$/gm, '')), context, { timeout: 1000 });
  const response = await handler(new Request('https://test.invalid', {
    method: 'POST', headers: { 'x-rentulo-dispute-cron-secret': secret },
  }));
  return { status: response.status, body: await response.json(), rpcCalls, calls };
}

test('03B: SQL authorization is Owner-only, TEST-only, incident-backed and cannot fake returned', () => {
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /BOD03B: TEST Supabase required; PROD forbidden/);
  assert.match(sql, /platform_admin_assert\(p_admin_reason\)/);
  assert.match(sql, /status <> 'picked_up'/);
  assert.match(sql, /reservation_return_incidents/);
  assert.match(sql, /platform_incidents/);
  assert.match(sql, /'joint_agreement','binding_order'/);
  assert.match(sql, /'owner_full_payout','renter_full_refund'/);
  assert.match(sql, /immutable/);
  assert.match(sql, /reservation_id uuid NOT NULL UNIQUE/);
  assert.match(sql, /payment_id uuid NOT NULL UNIQUE/);
  assert.doesNotMatch(sql, /UPDATE public\.reservations\s+(?:r\s+)?SET\s+status/i);
  assert.doesNotMatch(sql, /transfer_status\s*=\s*'succeeded'\s*,\s*refund_status\s*=\s*'succeeded'/i);
});

test('03B: owner payout is permitted only by an immutable settlement, and tenant-refund path vetoes any transfer', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.bod03b_owner_transfer_allowed/);
  assert.match(sql, /d\.settlement_route='owner_full_payout'/);
  assert.match(sql, /d\.settlement_route='renter_full_refund'/);
  const occur = (sql.match(/public\.bod03b_owner_transfer_allowed\(/g) || []).length;
  assert.ok(occur >= 4, `Expected guard in claims, finalizer and retry candidates, got ${occur}`);
  assert.match(ownerEdge, /admin\.rpc\(\s*"bod03b_owner_transfer_allowed"/);
  assert.match(ownerEdge, /approvedTransfer !== true/);
  assert.match(ownerEdge, /reservation\.status !== "picked_up"/);
  assert.doesNotMatch(ownerEdge, /transfer.*'picked_up'\s*&&\s*true/i);
  assert.match(sql, /status='succeeded', completed_at=clock_timestamp\(\)/);
  assert.match(sql, /'financially_settled_owner'/);
});

test('03B: refunds have separate TEST queue, stable Stripe idempotency and strict grant restrictions', () => {
  for (const rpc of ['bod03b_claim_due_refunds', 'bod03b_record_refund_result',
    'bod03b_record_refund_error', 'bod03b_verify_refund_cron_secret']) {
    assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${rpc}\\(`));
  }
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(sql, /lease_token/);
  assert.match(sql, /attempt_count>=6/);
  assert.match(sql, /ALTER TABLE public\.reservation_dispute_settlements ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON public\.reservation_dispute_settlement_events/);
  assert.match(sql, /rentulo-process-dispute-refunds-every-5-minutes/);
  assert.match(sql, /BOD03B: refund cannot be reconciled against unchanged payment/);
  assert.match(edge, /Idempotency-Key.*rentulo-test-bod03b-full-refund-/s);
  assert.match(edge, /stripeKey\.startsWith\("sk_test_"\)/);
  assert.match(edge, /identifyRefunds/);
  assert.match(edge, /bod03b_record_refund_result/);
  assert.doesNotMatch(edge, /\/v1\/transfers|return_status.*returned|reservation.*update/);
});

test('03B: PROD, weak secrets and live Stripe keys reject prior to any external action', async () => {
  const prod = await runWorker({ url: 'https://tfvgxrdjrpicgtvovehl.supabase.co' });
  assert.equal(prod.status, 403);
  assert.equal(prod.calls.length, 0);
  assert.equal(prod.rpcCalls.length, 0);
  const wrong = await runWorker({ secret: 'bad' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.calls.length, 0);
  const live = await runWorker({ stripeKey: 'sk_live_abc' });
  assert.equal(live.status, 503);
  assert.equal(live.calls.length, 0);
  const unknown = await runWorker({ validSecret: false });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.calls.length, 0);
});

test('03B: idle refund queue is inert, approved full refund is posted exactly once per call', async () => {
  const idle = await runWorker({ rows: [] });
  assert.equal(idle.status, 200);
  assert.equal(idle.body.claimed, 0);
  assert.equal(idle.calls.length, 0);
  const actual = await runWorker();
  assert.equal(actual.status, 200);
  assert.equal(actual.body.succeeded, 1);
  const posts = actual.calls.filter(x => x.options.method === 'POST');
  assert.equal(posts.length, 1);
  const form = new URLSearchParams(String(posts[0].options.body));
  assert.equal(form.get('amount'), '10000');
  assert.equal(form.get('charge'), claim.stripe_charge_id);
  assert.equal(form.get('metadata[reservation_dispute_settlement_id]'), claim.settlement_id);
  assert.match(posts[0].options.headers['Idempotency-Key'], /rentulo-test-bod03b-full-refund-/);
  assert.equal(actual.rpcCalls.at(-1).name, 'bod03b_record_refund_result');
});

test('03B: after a lost Stripe response, existing metadata-matched refund is reconciled; not reissued', async () => {
  const recovered = await runWorker({ refunds: [refund('re_already_created')] });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.succeeded, 1);
  assert.equal(recovered.calls.filter(x => x.options.method === 'POST').length, 0);
  assert.equal(recovered.rpcCalls.at(-1).params.p_stripe_refund_id, 're_already_created');
});

test('03B: conflicting refund blocks a second Stripe POST and requires manual review', async () => {
  const external = refund('re_external');
  external.metadata = { unrelated: 'true' };
  const blocked = await runWorker({ refunds: [external] });
  assert.equal(blocked.status, 200);
  assert.equal(blocked.body.review, 1);
  assert.equal(blocked.calls.filter(x => x.options.method === 'POST').length, 0);
  assert.equal(blocked.rpcCalls.at(-1).name, 'bod03b_record_refund_error');
  assert.equal(blocked.rpcCalls.at(-1).params.p_manual_review, true);
});

test('03B: published financial terms are aligned in all five languages', () => {
  assert.equal((terms.match(/"terms\.section6\.item3":/g) || []).length, 5);
  assert.equal((terms.match(/(?:settlement|vypořádání|vysporiadanie|Abwicklung|rozliczenie)/gi) || []).length > 0, true);
  assert.match(read('obchodni-podminky.html'), /obvyklý podíl majiteli/);
});
