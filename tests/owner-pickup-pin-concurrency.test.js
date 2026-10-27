"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");
const { createHmac, webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "supabase/functions/resolve-pickup-pin/index.ts"), "utf8");
const script = stripTypeScriptTypes(source.replace(/^import .*;\s*$/gm, ""));
const sql = fs.readFileSync(path.join(root, "supabase/migrations/20261027151000_atomic_owner_pickup_pin_attempts.sql"), "utf8");
const OWNER = "11111111-1111-4111-8111-111111111111";
const ATTEMPT = "22222222-2222-4222-8222-222222222222";
const SECRET = "unit-test-pickup-secret-at-least-32-characters";
const NOW = Date.parse("2026-11-12T10:00:00Z");
const reservation = {
  id: "33333333-3333-4333-8333-333333333333",
  renter_id: "44444444-4444-4444-8444-444444444444",
  owner_id: OWNER, status: "paid",
  start_date: "2026-11-12", end_date: "2026-11-13", pickup_time: "10:00:00",
};
const payment = {
  id: "55555555-5555-4555-8555-555555555555",
  reservation_id: reservation.id, payer_id: reservation.renter_id, owner_id: OWNER,
  provider: "stripe", status: "paid", currency: "czk",
  stripe_payment_intent_id: "pi_test", stripe_payment_intent_status: "succeeded",
  stripe_charge_id: "ch_test", refund_status: "not_requested", stripe_refund_amount_minor: 0,
};
const GOOD_PIN = String(createHmac("sha256", SECRET)
  .update(`rentulo-pickup-v1:${reservation.id}:${payment.id}`)
  .digest().readUInt32BE(0) % 1_000_000).padStart(6, "0");
const BAD_PIN = GOOD_PIN === "000000" ? "000001" : "000000";
const ok = data => ({ data, error: null });
const started = () => ok([{ status: "started", attempt_id: ATTEMPT, attempts_remaining: 3 }]);
const completed = () => ok([{ status: "completed", attempts_remaining: 3, locked_until: null }]);

function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// Execute the actual Edge handler. Only its Supabase transport is replaced;
// real HMAC and the shared Prague rental-window helper still run.
async function harness(options = {}) {
  const { rentalHandoverOpen } = await import("../supabase/functions/_shared/prague-rental-window.mjs");
  let handler;
  let now = options.now ?? NOW;
  const calls = { rpc: [], reads: [], signatures: 0 };
  const admin = {
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      if (options.rpc) return options.rpc(name, args);
      return name === "begin_owner_pickup_pin_attempt" ? started() : completed();
    },
    from(table) {
      const query = {
        table, filters: [], columns: "",
        select(columns) { this.columns = columns; return this; },
        eq(column, value) { this.filters.push([column, value]); return this; },
        in(column, values) { this.filters.push([column, values]); return this; },
        maybeSingle() { return this; },
        then(resolve, reject) {
          return Promise.resolve().then(async () => {
            calls.reads.push({ table, filters: this.filters, columns: this.columns });
            if (options.read) {
              const result = await options.read(table);
              if (result !== undefined) return result;
            }
            if (table === "reservations") return ok(options.reservations || [reservation]);
            if (table === "payments") return ok([payment]);
            if (table === "reservation_pickup_security") return ok(options.reservationSecurity || null);
            throw new Error(`Unexpected table access: ${table}`);
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const TestDate = class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  vm.runInNewContext(script, {
    Deno: {
      serve(callback) { handler = callback; },
      env: { get: name => ({
        SUPABASE_URL: "https://test.invalid", SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: "service", PICKUP_PIN_SECRET: SECRET,
      })[name] },
    },
    createClient: (_url, key) => key === "service" ? admin : {
      auth: { getUser: async () => ({ data: { user: options.unauthorized ? null : { id: OWNER } }, error: null }) },
    },
    rentalHandoverOpen: (start, end, time) => rentalHandoverOpen(start, end, time, new Date(now)),
    crypto: { subtle: {
      importKey: (...args) => webcrypto.subtle.importKey(...args),
      sign: (...args) => { calls.signatures += 1; return webcrypto.subtle.sign(...args); },
    } },
    Request, Response, TextEncoder, Date: TestDate,
    console: { error() {} },
  });
  return {
    calls,
    setNow(value) { now = value; },
    async request(pin = GOOD_PIN) {
      const response = await handler(new Request("https://test.invalid/resolve-pickup-pin", {
        method: "POST", headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      }));
      return { status: response.status, data: await response.json(), headers: response.headers };
    },
  };
}

test("concurrent owner requests do not inspect reservations or guess PINs without admission", async () => {
  const entered = gate(), release = gate();
  let active = false;
  const app = await harness({
    rpc(name, args) {
      if (name === "begin_owner_pickup_pin_attempt") {
        if (active) return ok([{ status: "busy" }]);
        active = true;
        return started();
      }
      assert.equal(args.p_attempt_id, ATTEMPT);
      assert.equal(args.p_outcome, "success");
      active = false;
      return completed();
    },
    async read(table) {
      if (table === "reservations") { entered.resolve(); await release.promise; }
    },
  });
  const first = app.request();
  await entered.promise;
  const overlapping = await Promise.all(Array.from({ length: 8 }, () => app.request(BAD_PIN)));
  assert.ok(overlapping.every(result => result.status === 503));
  assert.ok(overlapping.every(result => result.data.code === "pin_verification_busy"));
  assert.equal(app.calls.reads.length, 1);
  assert.equal(app.calls.signatures, 0);
  release.resolve();
  assert.deepEqual((await first).data, { reservation_id: reservation.id, status: "verified" });
  assert.equal(app.calls.signatures, 1);
});

test("a delayed correct PIN cannot override the lock returned by the finalizer", async () => {
  const lockedUntil = new Date(NOW + 15 * 60_000).toISOString();
  const app = await harness({ rpc(name, args) {
    if (name === "begin_owner_pickup_pin_attempt") return started();
    assert.equal(args.p_outcome, "success");
    return ok([{ status: "locked", attempts_remaining: 0, locked_until: lockedUntil }]);
  } });
  const result = await app.request();
  assert.equal(result.status, 429);
  assert.equal(result.data.locked_until, lockedUntil);
  assert.equal(result.data.reservation_id, undefined);
  assert.equal(app.calls.rpc.length, 2);
});

test("stale completion suppresses correct, incorrect and expired PIN results", async () => {
  for (const [pin, now] of [[GOOD_PIN, NOW], [BAD_PIN, NOW], [GOOD_PIN, Date.parse("2026-11-13T09:00:00Z")]]) {
    const app = await harness({ now, rpc: name => name === "begin_owner_pickup_pin_attempt"
      ? started() : ok([{ status: "stale" }]) });
    const result = await app.request(pin);
    assert.equal(result.status, 503);
    assert.equal(result.data.code, "pin_verification_busy");
    assert.equal(result.data.reservation_id, undefined);
    assert.equal(result.data.attempts_remaining, undefined);
  }
});

test("wrong PIN responses use database counts and the third failure's lock", async () => {
  const lockedUntil = new Date(NOW + 15 * 60_000).toISOString();
  let failure = 0;
  const app = await harness({ rpc(name, args) {
    if (name === "begin_owner_pickup_pin_attempt") return started();
    assert.equal(args.p_outcome, "failure");
    failure += 1;
    return ok([{ status: failure === 3 ? "locked" : "completed",
      attempts_remaining: 3 - failure, locked_until: failure === 3 ? lockedUntil : null }]);
  } });
  for (const remaining of [2, 1, 0]) {
    const result = await app.request(BAD_PIN);
    assert.equal(result.status, remaining ? 409 : 429);
    assert.equal(result.data.attempts_remaining, remaining);
    assert.equal(result.data.code, remaining ? "invalid_pin" : "locked");
  }
});

test("active lock blocks all PIN work and unauthenticated requests cannot acquire attempts", async () => {
  const app = await harness({ rpc: () => ok([{ status: "locked", locked_until: new Date(NOW + 60_000).toISOString() }]) });
  assert.equal((await app.request()).status, 429);
  assert.equal(app.calls.reads.length, 0);
  assert.equal(app.calls.signatures, 0);
  const unauthenticated = await harness({ unauthorized: true });
  assert.equal((await unauthenticated.request()).status, 401);
  assert.equal(unauthenticated.calls.rpc.length, 0);
});

test("database read failures cancel the current lease without claiming PIN success or failure", async () => {
  for (const failedTable of ["reservations", "payments", "reservation_pickup_security"]) {
    const app = await harness({ read: table => table === failedTable
      ? { data: null, error: { message: "simulated database failure" } } : undefined });
    assert.equal((await app.request()).status, 500);
    assert.equal(app.calls.rpc.length, 2);
    assert.equal(app.calls.rpc[1].args.p_outcome, "cancelled");
    assert.equal(app.calls.rpc[1].args.p_attempt_id, ATTEMPT);
  }
});

test("failed admission/finalization never publishes a match and cleanup uses only its token", async () => {
  for (const phase of ["begin_owner_pickup_pin_attempt", "finish_owner_pickup_pin_attempt"]) {
    const app = await harness({ rpc: name => name === phase
      ? { data: null, error: { message: "simulated RPC failure" } }
      : started() });
    const result = await app.request();
    assert.equal(result.status, 500);
    assert.equal(result.data.reservation_id, undefined);
    if (phase === "begin_owner_pickup_pin_attempt") assert.equal(app.calls.reads.length, 0);
    else assert.equal(app.calls.rpc.at(-1).args.p_outcome, "cancelled");
  }
});

test("neutral PIN outcomes finalize the lease without resetting the failure count", async () => {
  for (const options of [
    { now: Date.parse("2026-11-13T09:00:00Z") },
    { reservationSecurity: { confirmed_at: "2026-11-12T09:30:00Z" } },
    { reservationSecurity: { locked_until: new Date(NOW + 60_000).toISOString() } },
    { reservations: [reservation, reservation] }, // force the collision branch
  ]) {
    const app = await harness(options);
    const result = await app.request();
    assert.ok([409, 429].includes(result.status));
    assert.equal(app.calls.rpc[1].args.p_outcome, "cancelled");
    assert.equal(result.data.reservation_id, undefined);
  }
});

test("a correct PIN cannot be returned after its Prague deadline passes during finalization", async () => {
  let app;
  app = await harness({ now: Date.parse("2026-11-13T08:59:59Z"), rpc(name) {
    if (name === "begin_owner_pickup_pin_attempt") return started();
    app.setNow(Date.parse("2026-11-13T09:00:00Z"));
    return completed();
  } });
  const result = await app.request();
  assert.equal(result.status, 409);
  assert.equal(result.data.code, "pickup_wrong_day");
  assert.equal(result.data.reservation_id, undefined);
});

test("both attempt RPCs are server-only and share the legacy owner lock", () => {
  for (const signature of ["begin_owner_pickup_pin_attempt(uuid)", "finish_owner_pickup_pin_attempt(uuid, uuid, text)"]) {
    assert.ok(sql.includes(`revoke all on function public.${signature} from public, anon, authenticated;`));
    assert.ok(sql.includes(`grant execute on function public.${signature} to service_role;`));
  }
  assert.equal((sql.match(/auth\.role\(\) is distinct from 'service_role'/g) || []).length, 2);
  assert.equal((sql.match(/pg_advisory_xact_lock\(hashtextextended\(p_owner_id::text, 0\)\)/g) || []).length, 2);
  assert.match(sql, /revoke delete on table public\.owner_pickup_pin_security from service_role/);
  assert.doesNotMatch(sql, /PICKUP_PIN_SECRET|\bpin\s+(text|integer)/i);
});
