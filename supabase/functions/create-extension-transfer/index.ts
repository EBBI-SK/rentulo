import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveExtensionStripeEnvironment } from "../_shared/extension-checkout-recovery.mjs";

type Runtime = { serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined } };
type StripeObject = { id?: string; amount?: number; amount_refunded?: number; livemode?: boolean;
  currency?: string; paid?: boolean; captured?: boolean; refunded?: boolean;
  type?: string; payouts_enabled?: boolean; capabilities?: { transfers?: string };
  payment_intent?: string | { id?: string }; balance_transaction?: string | { id?: string };
  source?: string | { id?: string }; destination?: string | { id?: string };
  source_transaction?: string | { id?: string }; transfer_group?: string;
  metadata?: Record<string,string>; error?: { type?: string; message?: string; code?: string } };
type StripeList = { object?: string; data?: StripeObject[]; has_more?: boolean;
  error?: { type?: string; message?: string } };
type Claim = { extension_id: string; reservation_id: string; amount_total: number;
  owner_payout: number; stripe_charge_id: string; stripe_payment_intent_id: string;
  attempt_count: number };
const runtime = (globalThis as typeof globalThis & { Deno: Runtime }).Deno;
const encoder = new TextEncoder();
function safeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a); const y = encoder.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0; for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
function objectId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") return value.id;
  return null;
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json", "Cache-Control": "no-store",
  } });
}
function retryable(status: number, error?: StripeObject["error"]): boolean {
  return [408,425,429].includes(status) || status >= 500 || error?.code === "balance_insufficient";
}
function transferAmount(settled: number, owner: number, paid: number): number | null {
  if (![settled,owner,paid].every(Number.isSafeInteger) || settled <= 0 ||
      owner <= 0 || paid <= 0 || owner > paid) return null;
  const amount = Number((BigInt(settled) * BigInt(owner) + BigInt(paid)/2n)/BigInt(paid));
  return Number.isSafeInteger(amount) && amount > 0 && amount <= settled ? amount : null;
}

runtime.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = runtime.env.get("SUPABASE_URL") || "";
  const key = runtime.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const stripeKey = runtime.env.get("STRIPE_SECRET_KEY") || "";
  // Transfers do not need SITE_URL; project and Stripe mode must agree.
  const environment = resolveExtensionStripeEnvironment({ supabaseUrl: url, stripeKey });
  if (!environment) return json({ error: "Extension Stripe environment is not approved" }, 503);
  if (!key) return json({ error: "Missing server configuration" }, 500);
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !safeEqual(token, key)) return json({ error: "Unauthorized" }, 401);
  const payload = await request.json().catch(() => null) as { extension_id?: string } | null;
  const extensionId = String(payload?.extension_id || "");
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(extensionId)) {
    return json({ error: "Invalid extension identifier" }, 400);
  }
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const claimResult = await admin.rpc("claim_reservation_extension_transfer", { p_extension_id: extensionId });
  const claim: Claim | undefined = Array.isArray(claimResult.data) ? claimResult.data[0] : undefined;
  if (claimResult.error || !claim || claim.extension_id !== extensionId ||
      !Number.isSafeInteger(claim.attempt_count) || claim.attempt_count <= 0) {
    return json({ error: "Extension transfer is not ready for processing" }, 409);
  }
  const fail = async (message: string, shouldRetry: boolean, http = 502): Promise<Response> => {
    const result = await admin.rpc("fail_reservation_extension_transfer", {
      p_extension_id: extensionId, p_attempt_count: claim.attempt_count,
      p_error: message, p_retryable: shouldRetry,
    });
    if (result.error) console.error("create-extension-transfer: failure recording error", result.error.message);
    return json({ error: "Extension payout could not be completed" }, http);
  };
  const profileResult = await admin.from("profiles")
    .select("stripe_connected_account_id,stripe_connect_status,stripe_connect_transfers_enabled")
    .eq("id", (await admin.from("reservation_extensions").select("owner_id")
      .eq("id", extensionId).single()).data?.owner_id).single();
  const profile = profileResult.data;
  if (profileResult.error || !profile || !profile.stripe_connected_account_id ||
      profile.stripe_connect_status !== "ready" || profile.stripe_connect_transfers_enabled !== true) {
    return fail("Owner payout account is not ready", true, 409);
  }
  const auth = { Authorization: `Bearer ${stripeKey}` };
  const fetchObject = async (path: string): Promise<{ ok: boolean; status: number; body: StripeObject }> => {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, { headers: auth });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) as StripeObject };
  };
  try {
    const account = await fetchObject(`accounts/${encodeURIComponent(profile.stripe_connected_account_id)}`);
    if (!account.ok) return fail(`Stripe account HTTP ${account.status}`, retryable(account.status, account.body.error));
    if (account.body.id !== profile.stripe_connected_account_id ||
        account.body.capabilities?.transfers !== "active" || account.body.payouts_enabled !== true) {
      return fail("Stripe Connect account cannot accept transfers", true, 409);
    }
    const charge = await fetchObject(`charges/${encodeURIComponent(claim.stripe_charge_id)}`);
    if (!charge.ok) return fail(`Stripe charge HTTP ${charge.status}`, retryable(charge.status, charge.body.error));
    if (charge.body.id !== claim.stripe_charge_id ||
        charge.body.livemode !== environment.liveMode ||
        objectId(charge.body.payment_intent) !== claim.stripe_payment_intent_id ||
        charge.body.paid !== true || charge.body.captured !== true || charge.body.refunded === true ||
        charge.body.amount_refunded !== 0 || charge.body.amount !== claim.amount_total*100 ||
        charge.body.currency !== "czk" || !objectId(charge.body.balance_transaction)) {
      return fail("Stripe extension charge evidence does not match", false, 409);
    }
    const balance = await fetchObject(`balance_transactions/${encodeURIComponent(objectId(charge.body.balance_transaction)!)}`);
    if (!balance.ok) return fail(`Stripe settlement HTTP ${balance.status}`, retryable(balance.status, balance.body.error));
    if (balance.body.id !== objectId(charge.body.balance_transaction) ||
        balance.body.type !== "charge" || objectId(balance.body.source) !== claim.stripe_charge_id ||
        !Number.isSafeInteger(balance.body.amount) || !/^[a-z]{3}$/.test(balance.body.currency || "")) {
      return fail("Stripe extension settlement evidence does not match", false, 409);
    }
    const amountMinor = transferAmount(balance.body.amount!,claim.owner_payout,claim.amount_total);
    if (!amountMinor) return fail("Extension payout amount invalid", false, 409);
    const transferGroup = `rentulo_extension_${extensionId}`;
    const expected = (t: StripeObject): boolean => Boolean(
      t.id && t.livemode === environment.liveMode &&
      t.amount === amountMinor && t.currency === balance.body.currency &&
      objectId(t.destination) === profile.stripe_connected_account_id &&
      objectId(t.source_transaction) === claim.stripe_charge_id &&
      t.transfer_group === transferGroup &&
      t.metadata?.extension_id === extensionId &&
      t.metadata?.reservation_id === claim.reservation_id
    );
    const listResponse = await fetch(`https://api.stripe.com/v1/transfers?${new URLSearchParams({
      transfer_group: transferGroup, limit: "2",
    })}`, { headers: auth });
    const transferList = await listResponse.json().catch(() => ({})) as StripeList;
    if (!listResponse.ok || transferList.object !== "list" || !Array.isArray(transferList.data)) {
      return fail("Stripe existing transfer lookup is unavailable", retryable(listResponse.status));
    }
    if (transferList.has_more || transferList.data.length>1 ||
        (transferList.data.length === 1 && !expected(transferList.data[0]))) {
      return fail("Unexpected Stripe transfer found for extension", false, 409);
    }
    let transfer = transferList.data[0];
    if (!transfer) {
      const params = new URLSearchParams();
      params.set("amount", String(amountMinor));
      params.set("currency", balance.body.currency!);
      params.set("destination", profile.stripe_connected_account_id);
      params.set("source_transaction", claim.stripe_charge_id);
      params.set("transfer_group", transferGroup);
      params.set("metadata[extension_id]",extensionId);
      params.set("metadata[reservation_id]",claim.reservation_id);
      const transferResponse = await fetch("https://api.stripe.com/v1/transfers", {
        method:"POST", headers: { ...auth,
          "Content-Type":"application/x-www-form-urlencoded",
          "Idempotency-Key": `rentulo-extension-transfer-${extensionId}` },
        body: params,
      });
      transfer = await transferResponse.json().catch(() => ({})) as StripeObject;
      if (!transferResponse.ok) {
        return fail(`Stripe transfer failed (${transferResponse.status}): ${transfer.error?.code || "unknown"}`,
          retryable(transferResponse.status,transfer.error));
      }
      if (!expected(transfer)) return fail("Stripe created transfer does not match expected payout",false,409);
    }
    const complete = await admin.rpc("finish_reservation_extension_transfer", {
      p_extension_id: extensionId,p_attempt_count:claim.attempt_count,
      p_stripe_transfer_id: transfer.id,p_transfer_amount_minor: amountMinor,
      p_currency: balance.body.currency,
    });
    if (complete.error || complete.data !== true) {
      console.error("create-extension-transfer: cannot record Stripe transfer", extensionId);
      return json({ error: "Transfer evidence could not be persisted; retry later" }, 503);
    }
    return json({ status: "succeeded", transfer_id: transfer.id });
  } catch (error) {
    return fail(`Stripe request unavailable: ${error instanceof Error ? error.message : String(error)}`,true);
  }
});
