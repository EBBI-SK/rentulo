import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// RENTULO V1 BOD03B: TEST-only, dedicated cron secret; NO browser or PROD access.
// Processes only the immutable, Owner-approved full-refund decision. It never
// modifies reservations.status and never instructs a Stripe owner transfer.
type Runtime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};
const deno = (globalThis as typeof globalThis & { Deno: Runtime }).Deno;
const TEST_URL = "https://vspposovhdgvbeukoivh.supabase.co";
const MAX_BATCH = 2;
const TIMEOUT_MS = 12000;

type Claim = {
  settlement_id: string;
  claim_token: string;
  reservation_id: string;
  payment_id: string;
  stripe_charge_id: string;
  stripe_payment_intent_id: string;
  stripe_amount_minor: number;
  prior_refund_id: string | null;
};
type StripeCharge = {
  id?: string;
  amount?: number;
  amount_refunded?: number;
  currency?: string;
  paid?: boolean;
  captured?: boolean;
  payment_intent?: string | { id?: string } | null;
  error?: { type?: string };
};
type StripeRefund = {
  id?: string;
  amount?: number;
  currency?: string;
  charge?: string | { id?: string } | null;
  payment_intent?: string | { id?: string } | null;
  status?: string;
  metadata?: Record<string, string>;
  error?: { type?: string };
};
type StripeRefundList = {
  data?: StripeRefund[];
  has_more?: boolean;
  error?: { type?: string };
};
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
function objectId(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}
function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function safeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}
function isRefundStatus(value: unknown): value is string {
  return ["pending", "requires_action", "succeeded", "failed", "canceled"].includes(String(value));
}
async function getStripe<T>(url: string, key: string): Promise<{ data: T; ok: boolean; status: number }> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { data: await response.json() as T, ok: response.ok, status: response.status };
}

// Reconciliation must be done BEFORE every POST. Stripe idempotency retention
// is not unlimited, so this also protects against a crash after Stripe accepted
// the original refund but before our database could record its Stripe ID.
function identifyRefunds(refunds: StripeRefund[], claim: Claim):
  { refund: StripeRefund | null; conflict: boolean } {
  if (refunds.length === 0) return { refund: null, conflict: false };
  if (refunds.length !== 1) return { refund: null, conflict: true };
  const item = refunds[0];
  const identityMatched = item.metadata?.reservation_dispute_settlement_id === claim.settlement_id;
  if (!identityMatched || (claim.prior_refund_id && item.id !== claim.prior_refund_id)) {
    return { refund: null, conflict: true };
  }
  if (!item.id || !isRefundStatus(item.status) || !safeInt(item.amount) ||
    item.amount !== claim.stripe_amount_minor || item.currency !== "czk" ||
    objectId(item.charge) !== claim.stripe_charge_id ||
    (objectId(item.payment_intent) !== null &&
      objectId(item.payment_intent) !== claim.stripe_payment_intent_id)) {
    return { refund: null, conflict: true };
  }
  return { refund: item, conflict: false };
}

async function processClaim(
  admin: ReturnType<typeof createClient>, claim: Claim, stripeKey: string,
): Promise<"settled" | "pending" | "review" | "retry"> {
  const recordError = async (message: string, manual = false): Promise<"review" | "retry"> => {
    const { data, error } = await admin.rpc("bod03b_record_refund_error", {
      p_settlement_id: claim.settlement_id,
      p_claim_token: claim.claim_token,
      p_error: message.slice(0, 300),
      p_manual_review: manual,
    });
    if (error) {
      console.error("BOD03B: could not record refund processing issue", error.message);
      return "retry"; // Lease expires; no money is issued by this handler.
    }
    return data === "manual_review" ? "review" : "retry";
  };
  if (!isUuid(claim.settlement_id) || !isUuid(claim.claim_token) ||
      !isUuid(claim.reservation_id) || !isUuid(claim.payment_id) ||
      !safeInt(claim.stripe_amount_minor) || claim.stripe_amount_minor <= 0 ||
      !/^ch_[A-Za-z0-9]+$/.test(claim.stripe_charge_id) ||
      !/^pi_[A-Za-z0-9]+$/.test(claim.stripe_payment_intent_id)) {
    return await recordError("Invalid approved payment reference", true);
  }
  try {
    const verified = await getStripe<StripeCharge>(
      `https://api.stripe.com/v1/charges/${encodeURIComponent(claim.stripe_charge_id)}`,
      stripeKey,
    );
    const charge = verified.data;
    if (!verified.ok) {
      return await recordError(`Stripe source charge HTTP ${verified.status}`,
        verified.status >= 400 && verified.status < 500 && verified.status !== 429);
    }
    if (charge.id !== claim.stripe_charge_id || charge.currency !== "czk" ||
        charge.paid !== true || charge.captured !== true ||
        !safeInt(charge.amount) || charge.amount !== claim.stripe_amount_minor ||
        objectId(charge.payment_intent) !== claim.stripe_payment_intent_id ||
        !safeInt(charge.amount_refunded ?? 0)) {
      return await recordError("Stripe source charge does not match approved payment", true);
    }

    const listed = await getStripe<StripeRefundList>(
      `https://api.stripe.com/v1/refunds?charge=${encodeURIComponent(claim.stripe_charge_id)}&limit=100`,
      stripeKey,
    );
    if (!listed.ok) {
      return await recordError(`Stripe refund lookup HTTP ${listed.status}`,
        listed.status >= 400 && listed.status < 500 && listed.status !== 429);
    }
    if (!Array.isArray(listed.data.data) || listed.data.has_more !== false) {
      return await recordError("Refund list is incomplete or invalid", true);
    }
    const identified = identifyRefunds(listed.data.data, claim);
    if (identified.conflict) {
      return await recordError("Unexpected or partial Stripe refund; manual review", true);
    }
    let refund = identified.refund;
    if (!refund) {
      if (claim.prior_refund_id || (charge.amount_refunded ?? 0) !== 0 || charge.paid !== true) {
        return await recordError("Charge/refund evidence inconsistent; manual review", true);
      }
      const form = new URLSearchParams();
      form.set("charge", claim.stripe_charge_id);
      form.set("amount", String(claim.stripe_amount_minor));
      form.set("metadata[payment_id]", claim.payment_id);
      form.set("metadata[reservation_id]", claim.reservation_id);
      form.set("metadata[reservation_dispute_settlement_id]", claim.settlement_id);
      const response = await fetch("https://api.stripe.com/v1/refunds", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": `rentulo-test-bod03b-full-refund-${claim.settlement_id}`,
        },
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = (await response.json()) as StripeRefund;
      if (!response.ok) {
        return await recordError(`Stripe refund POST HTTP ${response.status}`,
          response.status >= 400 && response.status < 500 && response.status !== 429);
      }
      refund = body;
    }
    const validated = identifyRefunds([refund], claim);
    if (validated.conflict || !validated.refund) {
      return await recordError("Stripe refund receipt does not match approved full amount", true);
    }
    const { data: status, error } = await admin.rpc("bod03b_record_refund_result", {
      p_settlement_id: claim.settlement_id,
      p_claim_token: claim.claim_token,
      p_stripe_refund_id: validated.refund.id,
      p_refund_status: validated.refund.status,
      p_amount_minor: validated.refund.amount,
      p_currency: validated.refund.currency,
      p_charge_id: claim.stripe_charge_id,
    });
    if (error) {
      console.error("BOD03B: Stripe refund exists but database reconciliation failed", error.message);
      return "retry"; // Stable key and list lookup prevent duplicate refund.
    }
    return status === "succeeded" ? "settled"
      : status === "awaiting_refund" ? "pending" : "review";
  } catch (error) {
    console.error("BOD03B: refund transport interrupted", error instanceof Error ? error.name : "unknown");
    return await recordError("Stripe/DB request failed or timed out; retry with reconciliation");
  }
}

deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const supabaseUrl = (deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
  const serviceKey = deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const stripeKey = deno.env.get("STRIPE_SECRET_KEY") || "";
  if (supabaseUrl !== TEST_URL) return json({ error: "TEST environment only" }, 403);
  if (!serviceKey || !stripeKey.startsWith("sk_test_")) {
    return json({ error: "TEST Stripe credentials required" }, 503);
  }
  const secret = req.headers.get("x-rentulo-dispute-cron-secret") || "";
  if (secret.length < 64) return json({ error: "Unauthorized" }, 401);
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authorized, error: verifyError } = await admin.rpc(
    "bod03b_verify_refund_cron_secret", { p_secret: secret },
  );
  if (verifyError || authorized !== true) return json({ error: "Unauthorized" }, 401);
  const { data: rows, error: claimError } = await admin.rpc("bod03b_claim_due_refunds", {
    p_limit: MAX_BATCH,
  });
  if (claimError || !Array.isArray(rows)) {
    console.error("BOD03B: refund claim failed", claimError?.message || "invalid response");
    return json({ error: "Refund queue unavailable" }, 503);
  }
  const stats = { ok: true, claimed: rows.length, succeeded: 0, pending: 0, review: 0, retry: 0 };
  for (const item of rows as Claim[]) {
    const result = await processClaim(admin, item, stripeKey);
    if (result === "settled") stats.succeeded++;
    else if (result === "pending") stats.pending++;
    else if (result === "review") stats.review++;
    else stats.retry++;
  }
  return json(stats, stats.retry ? 503 : 200);
});
