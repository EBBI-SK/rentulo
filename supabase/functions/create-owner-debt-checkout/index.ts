import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RentuloDenoRuntime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: {
    get(name: string): string | undefined;
  };
};

type CheckoutSessionResponse = {
  id?: string;
  url?: string | null;
  payment_intent?: string | { id?: string } | null;
  error?: {
    message?: string;
    type?: string;
  };
};

const denoRuntime = (
  globalThis as typeof globalThis & { Deno: RentuloDenoRuntime }
).Deno;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function normalizedSiteUrl(value: string): string | null {
  try {
    const parsed = new URL(value);

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }

    return parsed.origin + parsed.pathname.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function paymentIntentId(value: CheckoutSessionResponse["payment_intent"]): string | null {
  if (typeof value === "string" && value) {
    return value;
  }

  if (value && typeof value === "object" && typeof value.id === "string") {
    return value.id;
  }

  return null;
}

denoRuntime.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = denoRuntime.env.get("SUPABASE_URL");
  const anonKey = denoRuntime.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = denoRuntime.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKey = denoRuntime.env.get("STRIPE_SECRET_KEY");
  const siteUrl = normalizedSiteUrl(denoRuntime.env.get("SITE_URL") || "");

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !stripeSecretKey || !siteUrl) {
    console.error("create-owner-debt-checkout: missing server configuration");
    return jsonResponse({ error: "Missing server configuration" }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!accessToken) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
  const actor = userData.user;

  if (userError || !actor) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let payload: { debt_id?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const debtId = String(payload.debt_id || "").trim();

  if (!debtId) {
    return jsonResponse({ error: "Invalid request" }, 400);
  }

  const { data: debt, error: debtError } = await admin
    .from("owner_cancellation_debts")
    .select(
      "id, owner_id, amount_minor, currency, status, stripe_checkout_session_id, stripe_payment_intent_id",
    )
    .eq("id", debtId)
    .single();

  if (debtError || !debt) {
    return jsonResponse({ error: "Owner cancellation debt not found" }, 404);
  }

  if (actor.id !== debt.owner_id) {
    return jsonResponse({ error: "Only the owner can pay this debt" }, 403);
  }

  if (debt.status !== "open") {
    return jsonResponse({ error: "Owner cancellation debt is not payable" }, 409);
  }

  const amountMinor = Number(debt.amount_minor);

  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || debt.currency !== "czk") {
    console.error("create-owner-debt-checkout: invalid debt payment snapshot", debt.id);
    return jsonResponse({ error: "Owner cancellation debt data is invalid" }, 409);
  }

  const checkoutParams = new URLSearchParams();
  checkoutParams.set("mode", "payment");
  checkoutParams.set("success_url", `${siteUrl}/moje-nabidky.html?debt_payment=success`);
  checkoutParams.set("cancel_url", `${siteUrl}/moje-nabidky.html?debt_payment=cancelled`);
  checkoutParams.set("client_reference_id", debt.id);
  checkoutParams.set("line_items[0][price_data][currency]", "czk");
  checkoutParams.set(
    "line_items[0][price_data][product_data][name]",
    "Rentulo - uhrada nakladu storna",
  );
  checkoutParams.set("line_items[0][price_data][unit_amount]", String(amountMinor));
  checkoutParams.set("line_items[0][quantity]", "1");
  checkoutParams.set("metadata[payment_kind]", "owner_cancellation_debt");
  checkoutParams.set("metadata[owner_cancellation_debt_id]", debt.id);
  checkoutParams.set("metadata[owner_id]", actor.id);
  checkoutParams.set(
    "payment_intent_data[metadata][payment_kind]",
    "owner_cancellation_debt",
  );
  checkoutParams.set(
    "payment_intent_data[metadata][owner_cancellation_debt_id]",
    debt.id,
  );
  checkoutParams.set("payment_intent_data[metadata][owner_id]", actor.id);

  if (actor.email) {
    checkoutParams.set("customer_email", actor.email);
  }

  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `rentulo-owner-debt-checkout-${debt.id}`,
    },
    body: checkoutParams,
  });

  const checkoutSession = (await stripeResponse
    .json()
    .catch(() => ({}))) as CheckoutSessionResponse;

  if (!stripeResponse.ok) {
    console.error(
      "create-owner-debt-checkout: Stripe rejected checkout creation",
      stripeResponse.status,
      checkoutSession.error?.type || "unknown_error",
      checkoutSession.error?.message || "",
    );
    return jsonResponse({ error: "Payment provider rejected checkout creation" }, 502);
  }

  if (!checkoutSession.id || !checkoutSession.url) {
    console.error("create-owner-debt-checkout: Stripe response is missing checkout identifiers");
    return jsonResponse({ error: "Payment provider returned an invalid checkout" }, 502);
  }

  const intentId = paymentIntentId(checkoutSession.payment_intent);
  const paymentUpdate: Record<string, string> = {
    stripe_checkout_session_id: checkoutSession.id,
    payment_requested_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (intentId) {
    if (debt.stripe_payment_intent_id && debt.stripe_payment_intent_id !== intentId) {
      console.error("create-owner-debt-checkout: Stripe PaymentIntent does not match debt", debt.id);
      return jsonResponse({ error: "Payment provider returned an inconsistent checkout" }, 409);
    }
    paymentUpdate.stripe_payment_intent_id = intentId;
  }

  const saved = await admin
    .from("owner_cancellation_debts")
    .update(paymentUpdate)
    .eq("id", debt.id)
    .eq("owner_id", actor.id)
    .eq("status", "open")
    .select("id")
    .maybeSingle();

  if (saved.error || !saved.data) {
    console.error(
      "create-owner-debt-checkout: debt checkout session update failed",
      saved.error?.message || "debt is no longer open",
    );
    return jsonResponse({ error: "Debt payment session could not be saved" }, 409);
  }

  return jsonResponse({ url: checkoutSession.url });
});
