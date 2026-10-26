import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Server-only Cron: 24h reminders and financially safe reservation expiration.
// A possibly payable Stripe session always blocks automatic release.
type Runtime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};
const runtime = (globalThis as typeof globalThis & { Deno: Runtime }).Deno;
const DB_TIMEOUT = 4000;
const STRIPE_TIMEOUT = 5000;
const BATCH_SIZE = 6;
const CONCURRENCY = 3;

type Due = { reservation_id: string; reservation_status: "pending" | "approved" };
type Payment = {
  id: string;
  provider: string;
  status: string;
  provider_payment_id: string | null;
  checkout_attempt_started_at: string | null;
  checkout_inflight_started_at: string | null;
};
type StripeSession = {
  id?: string;
  status?: string;
  payment_status?: string;
  mode?: string;
  currency?: string;
  client_reference_id?: string;
  metadata?: { reservation_id?: string; payment_id?: string };
  payment_intent?: string | { id?: string } | null;
};
type Outcome = "expired" | "blocked" | "changed";
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function stripeRequest(
  secret: string, path: string, method = "GET", idempotencyKey?: string,
): Promise<{ ok: boolean; status: number; value: StripeSession }> {
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${secret}` };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
      method, headers, signal: AbortSignal.timeout(STRIPE_TIMEOUT),
    });
    return {
      ok: response.ok, status: response.status,
      value: await response.json().catch(() => ({})) as StripeSession,
    };
  } catch {
    return { ok: false, status: 0, value: {} };
  }
}

async function expireStripeCheckout(
  secret: string, sessionId: string, reservationId: string, paymentId: string,
): Promise<{ safe: boolean; reason: string }> {
  if (!/^cs_(test_|live_)[A-Za-z0-9]+$/.test(sessionId)) {
    return { safe: false, reason: "Invalid stored Checkout ID" };
  }
  const path = `checkout/sessions/${encodeURIComponent(sessionId)}`;
  let response = await stripeRequest(secret, path);
  if (!response.ok) return { safe: false, reason: `Stripe lookup failed (${response.status})` };

  function matches(s: StripeSession) {
    return s.id === sessionId && s.mode === "payment" && s.currency === "czk" &&
      s.client_reference_id === reservationId &&
      s.metadata?.reservation_id === reservationId &&
      s.metadata?.payment_id === paymentId;
  }
  if (!matches(response.value)) {
    return { safe: false, reason: "Checkout metadata mismatch" };
  }
  if (response.value.status === "open") {
    response = await stripeRequest(secret, `${path}/expire`, "POST", `rentulo-expire-${sessionId}`);
    if (!response.ok) {
      return { safe: false, reason: `Stripe checkout expiry refused (${response.status})` };
    }
  }
  const session = response.value;
  if (!matches(session) || session.status !== "expired" || session.payment_status !== "unpaid") {
    return { safe: false, reason: "Checkout already completed or payment unknown" };
  }
  const intentId = typeof session.payment_intent === "string"
    ? session.payment_intent : session.payment_intent?.id;
  if (intentId) {
    if (!/^pi_[A-Za-z0-9]+$/.test(intentId)) {
      return { safe: false, reason: "Invalid associated PaymentIntent" };
    }
    const intent = await stripeRequest(secret, `payment_intents/${encodeURIComponent(intentId)}`);
    if (!intent.ok || intent.value.status !== "canceled") {
      return { safe: false, reason: "PaymentIntent not confirmed canceled" };
    }
  }
  return { safe: true, reason: "" };
}

runtime.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const projectUrl = (runtime.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
  const roleKey = runtime.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const stripeKey = runtime.env.get("STRIPE_SECRET_KEY") || "";
  const suppliedSecret = request.headers.get("x-rentulo-cron-secret") || "";
  if (!projectUrl || !roleKey || suppliedSecret.length < 64) {
    return json({ error: "Unauthorized" }, 401);
  }
  const admin = createClient(projectUrl, roleKey);
  let verified;
  try {
    verified = await admin.rpc("verify_reservation_notification_cron_secret", {
      p_secret: suppliedSecret,
    }).abortSignal(AbortSignal.timeout(DB_TIMEOUT));
  } catch {
    return json({ error: "Unauthorized" }, 401);
  }
  if (verified.error || verified.data !== true) return json({ error: "Unauthorized" }, 401);

  const summary = { reminders: 0, expired: 0, blocked: 0, changed: 0 };
  let reminders;
  try {
    reminders = await admin.rpc("queue_expiry_reminders", { p_limit: 40 })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT));
  } catch {
    return json({ error: "Reminder queue unavailable" }, 500);
  }
  if (reminders.error) return json({ error: "Reminder queue unavailable" }, 500);
  summary.reminders = Number(reminders.data) || 0;

  let due;
  try {
    due = await admin.rpc("list_due_reservation_expirations", { p_limit: BATCH_SIZE })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT));
  } catch {
    return json({ error: "Expiration queue unavailable" }, 500);
  }
  if (due.error || !Array.isArray(due.data)) return json({ error: "Expiration queue unavailable" }, 500);

  async function block(id: string, reason: string): Promise<Outcome> {
    console.error("expire-reservations: manual review", id, reason);
    try {
      const result = await admin.rpc("note_reservation_expiration_issue", {
        p_reservation_id: id, p_reason: reason,
      }).abortSignal(AbortSignal.timeout(DB_TIMEOUT));
      if (result.error) console.error("expire-reservations: issue log failed", result.error.message);
    } catch {
      console.error("expire-reservations: issue log unavailable", id);
    }
    return "blocked";
  }

  async function processOne(item: Due): Promise<Outcome> {
    const id = item.reservation_id;
    let records;
    try {
      records = await admin.from("payments")
        .select("id,provider,status,provider_payment_id,checkout_attempt_started_at,checkout_inflight_started_at")
        .eq("reservation_id", id).limit(2)
        .abortSignal(AbortSignal.timeout(DB_TIMEOUT));
    } catch {
      return await block(id, "Payment lookup timeout");
    }
    if (records.error || !Array.isArray(records.data) || records.data.length > 1) {
      return await block(id, "Payment lookup inconsistent");
    }
    const payment = (records.data[0] || null) as Payment | null;
    let sessionId: string | null = null;
    if (payment) {
      if (payment.provider !== "stripe" || payment.status !== "pending") {
        return await block(id, "Payment state not safely payable");
      }
      if (payment.checkout_inflight_started_at) {
        return await block(id, "Checkout provider operation is still in flight or ambiguous");
      }
      sessionId = String(payment.provider_payment_id || "").trim() || null;
      if (!sessionId && payment.checkout_attempt_started_at) {
        return await block(id, "Checkout creation outcome unknown");
      }
      if (sessionId) {
        if (!stripeKey) return await block(id, "Stripe credentials unavailable");
        const result = await expireStripeCheckout(stripeKey, sessionId, id, payment.id);
        if (!result.safe) return await block(id, result.reason);
      }
    }
    let release;
    try {
      release = await admin.rpc("expire_unpaid_reservation", {
        p_reservation_id: id,
        p_verified_expired_session_id: sessionId,
      }).abortSignal(AbortSignal.timeout(DB_TIMEOUT));
    } catch {
      return await block(id, "Atomic reservation release timed out");
    }
    if (release.error) return await block(id, "Atomic reservation release failed");
    if (release.data !== true) return "changed";
    // Clear any older manual-review record after successful release.
    await admin.from("reservation_expiration_issues").delete().eq("reservation_id", id)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT));
    return "expired";
  }

  const pending: Due[] = due.data;
  let cursor = 0;
  async function drain() {
    while (cursor < pending.length) {
      const item = pending[cursor++];
      let outcome: Outcome;
      try { outcome = await processOne(item); }
      catch { outcome = await block(item.reservation_id, "Worker error"); }
      summary[outcome]++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => drain()));
  return json({ ok: true, ...summary });
});
