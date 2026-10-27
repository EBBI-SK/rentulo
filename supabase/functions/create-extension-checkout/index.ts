import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeStripeCheckoutLocale } from "../_shared/stripe-checkout-language.mjs";

type Runtime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};
type Session = {
  id?: string; url?: string; status?: string; payment_status?: string;
  mode?: string; currency?: string; amount_total?: number;
  client_reference_id?: string; expires_at?: number;
  metadata?: { reservation_id?: string; extension_id?: string; payment_kind?: string };
  error?: { message?: string; type?: string };
};
const runtime = (globalThis as typeof globalThis & { Deno: Runtime }).Deno;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

runtime.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = runtime.env.get("SUPABASE_URL") || "";
  const anon = runtime.env.get("SUPABASE_ANON_KEY") || "";
  const serviceRole = runtime.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const stripeKey = runtime.env.get("STRIPE_SECRET_KEY") || "";
  const siteUrl = runtime.env.get("SITE_URL") || "";
  // V1: do not accidentally construct LIVE sessions from this TEST-only release.
  if (url !== "https://vspposovhdgvbeukoivh.supabase.co" ||
      siteUrl.replace(/\/+$/, "") !== "https://rentulo.eu") {
    return json({ error: "Extension checkout is TEST-only" }, 503);
  }
  if (!anon || !serviceRole || !stripeKey) return json({ error: "Missing server configuration" }, 500);
  const authorization = request.headers.get("Authorization") || "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false } });
  const { data: user, error: userError } = await userClient.auth.getUser(accessToken);
  if (userError || !user.user) return json({ error: "Unauthorized" }, 401);
  const payload = await request.json().catch(() => null) as { extension_id?: string; locale?: string } | null;
  const extensionId = String(payload?.extension_id || "").trim();
  if (!isUuid(extensionId)) return json({ error: "Invalid extension" }, 400);
  const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const claim = await admin.rpc("claim_reservation_extension_checkout", {
    p_extension_id: extensionId, p_renter_id: user.user.id,
    p_locale: normalizeStripeCheckoutLocale(payload?.locale),
  });
  if (claim.error || claim.data !== true) return json({ error: "Extension cannot be paid" }, 409);
  const extensionResult = await admin.from("reservation_extensions")
    .select("id,reservation_id,renter_id,owner_id,previous_end_date,new_end_date,amount_total,status,checkout_started_at,payment_deadline_at,stripe_checkout_locale,stripe_checkout_session_id")
    .eq("id", extensionId).single();
  const extension = extensionResult.data;
  if (extensionResult.error || !extension || extension.renter_id !== user.user.id ||
      extension.status !== "approved" || !Number.isSafeInteger(extension.amount_total) ||
      extension.amount_total <= 0 || !extension.checkout_started_at) {
    return json({ error: "Extension checkout data is invalid" }, 409);
  }
  const reservationResult = await admin.from("reservations")
    .select("id,renter_id,owner_id,offer_name,status,end_date")
    .eq("id", extension.reservation_id).single();
  const reservation = reservationResult.data;
  if (reservationResult.error || !reservation || reservation.renter_id !== extension.renter_id ||
      reservation.owner_id !== extension.owner_id ||
      reservation.status !== "picked_up" ||
      reservation.end_date !== extension.previous_end_date) {
    return json({ error: "Reservation is no longer extensible" }, 409);
  }
  const expectedAmount = extension.amount_total * 100;
  const validateSession = (session: Session): boolean =>
    session.mode === "payment" && session.currency === "czk" &&
    session.amount_total === expectedAmount && session.client_reference_id === extension.id &&
    session.metadata?.extension_id === extension.id &&
    session.metadata?.reservation_id === extension.reservation_id &&
    session.metadata?.payment_kind === "reservation_extension";
  const existingId = extension.stripe_checkout_session_id;
  if (existingId) {
    if (!/^cs_(test_|live_)[A-Za-z0-9]+$/.test(existingId)) {
      return json({ error: "Invalid existing checkout reference" }, 409);
    }
    const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(existingId)}`,
      { headers: { Authorization: `Bearer ${stripeKey}` } });
    const session = await response.json().catch(() => ({})) as Session;
    if (!response.ok || session.id !== existingId || !validateSession(session)) {
      return json({ error: "Existing checkout could not be verified" }, 502);
    }
    if (session.status === "open" && session.payment_status === "unpaid" && session.url) {
      return json({ url: session.url });
    }
    if (session.status === "expired" && session.payment_status === "unpaid") {
      const expired = await admin.rpc("expire_reservation_extension_checkout", {
        p_extension_id: extension.id, p_session_id: existingId,
      });
      if (expired.error || expired.data !== true) return json({ error: "Checkout expiry could not be recorded" }, 503);
      return json({ error: "Checkout expired. Request a new extension." }, 409);
    }
    return json({ error: "Payment is processing; do not pay again" }, 409);
  }
  const now = Math.floor(Date.now() / 1000);
  const deadline = Math.floor(new Date(extension.payment_deadline_at).getTime() / 1000);
  const expiry = Math.min(deadline, now + 23 * 3600);
  if (!Number.isFinite(deadline) || expiry < now + 31 * 60) {
    return json({ error: "Extension payment deadline is too close" }, 409);
  }
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("locale", extension.stripe_checkout_locale || "cs");
  params.set("expires_at", String(expiry));
  params.set("success_url", `${siteUrl}/moje-rezervace.html?extension_payment=success`);
  params.set("cancel_url", `${siteUrl}/moje-rezervace.html?extension_payment=cancelled`);
  params.set("client_reference_id", extension.id);
  params.set("line_items[0][price_data][currency]", "czk");
  params.set("line_items[0][price_data][product_data][name]", `${reservation.offer_name || "Rentulo"} – prodloužení pronájmu`);
  params.set("line_items[0][price_data][product_data][description]", `${extension.previous_end_date} - ${extension.new_end_date}`);
  params.set("line_items[0][price_data][unit_amount]", String(expectedAmount));
  params.set("line_items[0][quantity]", "1");
  params.set("metadata[payment_kind]", "reservation_extension");
  params.set("metadata[extension_id]", extension.id);
  params.set("metadata[reservation_id]", extension.reservation_id);
  params.set("payment_intent_data[metadata][payment_kind]", "reservation_extension");
  params.set("payment_intent_data[metadata][extension_id]", extension.id);
  params.set("payment_intent_data[metadata][reservation_id]", extension.reservation_id);
  params.set("payment_intent_data[transfer_group]", `rentulo_extension_${extension.id}`);
  if (user.user.email) params.set("customer_email", user.user.email);
  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST", headers: {
      Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `rentulo-extension-checkout-${extension.id}`,
    }, body: params,
  });
  const session = await stripeResponse.json().catch(() => ({})) as Session;
  if (!stripeResponse.ok || !session.id || !session.url || !validateSession(session) ||
      !session.expires_at) {
    console.error("create-extension-checkout: Stripe session unavailable", stripeResponse.status, session.error?.type);
    return json({ error: "Stripe checkout unavailable; payment has not been confirmed" }, 502);
  }
  const record = await admin.rpc("record_reservation_extension_checkout", {
    p_extension_id: extension.id, p_renter_id: user.user.id,
    p_session_id: session.id, p_expires_at: new Date(session.expires_at * 1000).toISOString(),
  });
  if (record.error || record.data !== true) {
    console.error("create-extension-checkout: checkout session could not be persisted", extension.id);
    return json({ error: "Checkout session could not be confirmed; do not pay again" }, 503);
  }
  return json({ url: session.url });
});
