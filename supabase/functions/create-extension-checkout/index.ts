import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeStripeCheckoutLocale } from "../_shared/stripe-checkout-language.mjs";
import {
  classifyExtensionCheckoutSession, isDefiniteCheckoutCreationRejection,
} from "../_shared/extension-checkout-recovery.mjs";

type Runtime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};
type StripeSession = {
  id?: string; url?: string; status?: string; payment_status?: string;
  mode?: string; currency?: string; amount_total?: number;
  client_reference_id?: string; expires_at?: number;
  metadata?: { reservation_id?: string; extension_id?: string; payment_kind?: string };
  error?: { message?: string; type?: string; code?: string };
};
type CheckoutAttempt = {
  attempt_id: string; checkout_expires_at: string;
  locale: string; offer_name: string; customer_email: string | null;
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
  // BOD 4: keep TEST-only safety guard. LIVE is a separate approved rollout.
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

  // Two iterations at most: reuse a current Session, or reconcile a verified
  // expired/unpaid one and use ONE new attempt while approval remains valid.
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const claim = await admin.rpc("claim_reservation_extension_checkout", {
      p_extension_id: extensionId, p_renter_id: user.user.id,
      p_locale: normalizeStripeCheckoutLocale(payload?.locale),
    });
    if (claim.error || claim.data !== true) {
      return json({ code: "payment_deadline", error: "Extension is not payable" }, 409);
    }
    const extensionResult = await admin.from("reservation_extensions")
      .select("id,reservation_id,renter_id,owner_id,previous_end_date,new_end_date,amount_total,status,checkout_started_at,payment_deadline_at,stripe_checkout_session_id")
      .eq("id", extensionId).single();
    const extension = extensionResult.data;
    if (extensionResult.error || !extension || extension.renter_id !== user.user.id ||
        extension.status !== "approved" || !Number.isSafeInteger(extension.amount_total) ||
        extension.amount_total <= 0 || !extension.checkout_started_at) {
      return json({ code: "payment_deadline", error: "Extension checkout data is invalid" }, 409);
    }
    const reservationResult = await admin.from("reservations")
      .select("id,renter_id,owner_id,offer_name,status,end_date")
      .eq("id", extension.reservation_id).single();
    const reservation = reservationResult.data;
    if (reservationResult.error || !reservation || reservation.renter_id !== extension.renter_id ||
        reservation.owner_id !== extension.owner_id ||
        reservation.status !== "picked_up" ||
        reservation.end_date !== extension.previous_end_date) {
      return json({ code: "payment_deadline", error: "Reservation is no longer extensible" }, 409);
    }
    const expectedAmount = extension.amount_total * 100;
    const existingId = extension.stripe_checkout_session_id;
    if (existingId) {
      if (!/^cs_(test_|live_)[A-Za-z0-9]+$/.test(existingId)) {
        return json({ code: "checkout_busy", error: "Invalid existing checkout reference" }, 409);
      }
      let response: Response;
      try {
        response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(existingId)}`,
          { headers: { Authorization: `Bearer ${stripeKey}` }, signal: AbortSignal.timeout(15_000) });
      } catch (_) {
        return json({ code: "checkout_busy", error: "Existing checkout cannot be verified" }, 503);
      }
      const session = await response.json().catch(() => ({})) as StripeSession;
      if (!response.ok) return json({ code: "checkout_busy", error: "Existing checkout cannot be verified" }, 503);
      const state = classifyExtensionCheckoutSession(session, {
        sessionId: existingId, amountMinor: expectedAmount,
        extensionId: extension.id, reservationId: extension.reservation_id,
      });
      if (state === "reuse") return json({ url: session.url });
      if (state !== "verified_expired") {
        return json({ code: "checkout_busy", error: "Payment is processing or checkout cannot be verified" }, 409);
      }
      // Both the user path and the trusted worker use this same guarded RPC.
      const reconciled = await admin.rpc("expire_reservation_extension_checkout", {
        p_extension_id: extension.id, p_session_id: existingId,
      });
      if (reconciled.error || reconciled.data !== true) {
        return json({ code: "checkout_busy", error: "Checkout reconciliation is pending" }, 409);
      }
      // The RPC keeps approval ONLY when a new Stripe Session has sufficient
      // time. Otherwise it expires the extension and the original date holds.
      continue;
    }

    const prepared = await admin.rpc("prepare_reservation_extension_checkout_attempt", {
      p_extension_id: extension.id, p_renter_id: user.user.id,
      p_offer_name: reservation.offer_name || "Rentulo",
      p_customer_email: user.user.email || null,
    });
    const attempt = (Array.isArray(prepared.data) ? prepared.data[0] : null) as CheckoutAttempt | null;
    if (prepared.error || !attempt || !isUuid(attempt.attempt_id)) {
      return json({ code: "payment_deadline", error: "Checkout cannot be prepared before the payment deadline" }, 409);
    }
    const expiry = Math.floor(new Date(attempt.checkout_expires_at).getTime() / 1000);
    // An unrecorded attempt might have been created by Stripe despite a lost
    // response. Keep its key and snapshot even if it is now too late to retry.
    if (!Number.isFinite(expiry) || expiry <= Math.floor(Date.now() / 1000)) {
      return json({ code: "checkout_busy", error: "Checkout attempt requires verification" }, 409);
    }
    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("locale", attempt.locale);
    params.set("expires_at", String(expiry));
    params.set("success_url", `${siteUrl}/moje-rezervace.html?extension_payment=success`);
    params.set("cancel_url", `${siteUrl}/moje-rezervace.html?extension_payment=cancelled`);
    params.set("client_reference_id", extension.id);
    params.set("line_items[0][price_data][currency]", "czk");
    params.set("line_items[0][price_data][product_data][name]", `${attempt.offer_name} – prodloužení pronájmu`);
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
    if (attempt.customer_email) params.set("customer_email", attempt.customer_email);

    let stripeResponse: Response;
    try {
      stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST", headers: {
          Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": `rentulo-extension-checkout-${attempt.attempt_id}`,
        }, body: params, signal: AbortSignal.timeout(15_000),
      });
    } catch (_) {
      // Unknown outcome: NEVER generate a different attempt/key.
      return json({ code: "checkout_busy", error: "Checkout outcome is unknown; retry the same attempt" }, 503);
    }
    const session = await stripeResponse.json().catch(() => ({})) as StripeSession;
    if (!stripeResponse.ok) {
      if (isDefiniteCheckoutCreationRejection(stripeResponse.status, session.error)) {
        const failed = await admin.rpc("fail_reservation_extension_checkout_attempt", {
          p_extension_id: extension.id, p_renter_id: user.user.id,
          p_attempt_id: attempt.attempt_id,
        });
        if (!failed.error && failed.data === true) {
          return json({ code: "checkout_retry", error: "Stripe rejected checkout before creation; retry" }, 502);
        }
      }
      // A 409, 429, 5xx, parse error or idempotency error is NOT proof that
      // Stripe failed to create the Session. Keep the exact attempt immutable.
      console.error("create-extension-checkout: Stripe response not definitive", stripeResponse.status, session.error?.type);
      return json({ code: "checkout_busy", error: "Stripe checkout outcome requires verification" }, 503);
    }
    const state = classifyExtensionCheckoutSession(session, {
      sessionId: session.id || "", amountMinor: expectedAmount,
      extensionId: extension.id, reservationId: extension.reservation_id,
    });
    if (state !== "reuse" || !session.expires_at || session.expires_at !== expiry) {
      return json({ code: "checkout_busy", error: "Stripe checkout session could not be safely validated" }, 503);
    }
    const record = await admin.rpc("record_reservation_extension_checkout_attempt", {
      p_extension_id: extension.id, p_renter_id: user.user.id,
      p_attempt_id: attempt.attempt_id, p_session_id: session.id,
      p_expires_at: attempt.checkout_expires_at,
    });
    if (record.error || record.data !== true) {
      console.error("create-extension-checkout: checkout session could not be persisted", extension.id);
      return json({ code: "checkout_busy", error: "Checkout session is awaiting reconciliation" }, 503);
    }
    return json({ url: session.url });
  }
  return json({ code: "payment_deadline", error: "Extension payment deadline has elapsed" }, 409);
});
