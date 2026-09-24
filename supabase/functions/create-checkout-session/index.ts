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
    console.error("create-checkout-session: missing server configuration");
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

  let payload: { reservation_id?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const reservationId = String(payload.reservation_id || "").trim();

  if (!reservationId) {
    return jsonResponse({ error: "Invalid request" }, 400);
  }

  const { data: reservation, error: reservationError } = await admin
    .from("reservations")
    .select(
      "id, owner_id, renter_id, offer_name, start_date, end_date, total_price, platform_fee_amount, owner_payout, status",
    )
    .eq("id", reservationId)
    .single();

  if (reservationError || !reservation) {
    return jsonResponse({ error: "Reservation not found" }, 404);
  }

  if (actor.id !== reservation.renter_id) {
    return jsonResponse({ error: "Only the renter can pay this reservation" }, 403);
  }

  if (reservation.status !== "approved") {
    return jsonResponse({ error: "Reservation is not ready for payment" }, 409);
  }

  const totalPrice = Number(reservation.total_price);
  const platformFeeAmount = Number(reservation.platform_fee_amount);
  const ownerPayout = Number(reservation.owner_payout);

  if (
    !Number.isInteger(totalPrice) ||
    totalPrice <= 0 ||
    !Number.isInteger(platformFeeAmount) ||
    platformFeeAmount < 0 ||
    !Number.isInteger(ownerPayout) ||
    ownerPayout < 0 ||
    platformFeeAmount + ownerPayout !== totalPrice
  ) {
    console.error("create-checkout-session: invalid reservation payment snapshot", reservation.id);
    return jsonResponse({ error: "Reservation payment data is invalid" }, 409);
  }

  const stripeAmountTotalMinor = totalPrice * 100;

  let { data: payment, error: paymentLookupError } = await admin
    .from("payments")
    .select(
      "id, reservation_id, payer_id, owner_id, amount_total, platform_fee_amount, owner_payout, provider, provider_payment_id, status, currency, stripe_amount_total_minor, stripe_payment_intent_id",
    )
    .eq("reservation_id", reservation.id)
    .maybeSingle();

  if (paymentLookupError) {
    console.error("create-checkout-session: payment lookup failed", paymentLookupError.message);
    return jsonResponse({ error: "Payment lookup failed" }, 500);
  }

  if (!payment) {
    const insertResult = await admin
      .from("payments")
      .insert({
        reservation_id: reservation.id,
        payer_id: actor.id,
        owner_id: reservation.owner_id,
        amount_total: totalPrice,
        platform_fee_amount: platformFeeAmount,
        owner_payout: ownerPayout,
        provider: "stripe",
        provider_payment_id: "",
        status: "pending",
        currency: "czk",
        stripe_amount_total_minor: stripeAmountTotalMinor,
      })
      .select(
        "id, reservation_id, payer_id, owner_id, amount_total, platform_fee_amount, owner_payout, provider, provider_payment_id, status, currency, stripe_amount_total_minor, stripe_payment_intent_id",
      )
      .single();

    payment = insertResult.data;

    if (insertResult.error) {
      if (insertResult.error.code !== "23505") {
        console.error("create-checkout-session: payment insert failed", insertResult.error.message);
        return jsonResponse({ error: "Payment creation failed" }, 500);
      }

      const retryLookup = await admin
        .from("payments")
        .select(
          "id, reservation_id, payer_id, owner_id, amount_total, platform_fee_amount, owner_payout, provider, provider_payment_id, status, currency, stripe_amount_total_minor, stripe_payment_intent_id",
        )
        .eq("reservation_id", reservation.id)
        .single();

      if (retryLookup.error || !retryLookup.data) {
        console.error(
          "create-checkout-session: concurrent payment lookup failed",
          retryLookup.error?.message || "missing payment",
        );
        return jsonResponse({ error: "Payment creation failed" }, 500);
      }

      payment = retryLookup.data;
    }
  }

  if (!payment) {
    return jsonResponse({ error: "Payment creation failed" }, 500);
  }

  if (
    payment.reservation_id !== reservation.id ||
    payment.payer_id !== actor.id ||
    payment.owner_id !== reservation.owner_id ||
    Number(payment.amount_total) !== totalPrice ||
    Number(payment.platform_fee_amount) !== platformFeeAmount ||
    Number(payment.owner_payout) !== ownerPayout ||
    payment.provider !== "stripe" ||
    payment.status !== "pending" ||
    payment.currency !== "czk" ||
    Number(payment.stripe_amount_total_minor) !== stripeAmountTotalMinor
  ) {
    console.error("create-checkout-session: existing payment does not match reservation", payment.id);
    return jsonResponse({ error: "Payment is not in a payable state" }, 409);
  }

  const checkoutParams = new URLSearchParams();
  checkoutParams.set("mode", "payment");
  checkoutParams.set("success_url", `${siteUrl}/moje-rezervace.html?payment=success`);
  checkoutParams.set("cancel_url", `${siteUrl}/moje-rezervace.html?payment=cancelled`);
  checkoutParams.set("client_reference_id", reservation.id);
  checkoutParams.set("line_items[0][price_data][currency]", "czk");
  checkoutParams.set(
    "line_items[0][price_data][product_data][name]",
    reservation.offer_name || "Rentulo pronajem",
  );
  checkoutParams.set(
    "line_items[0][price_data][product_data][description]",
    `${reservation.start_date} - ${reservation.end_date}`,
  );
  checkoutParams.set(
    "line_items[0][price_data][unit_amount]",
    String(stripeAmountTotalMinor),
  );
  checkoutParams.set("line_items[0][quantity]", "1");
  checkoutParams.set("metadata[reservation_id]", reservation.id);
  checkoutParams.set("metadata[payment_id]", payment.id);
  checkoutParams.set("payment_intent_data[metadata][reservation_id]", reservation.id);
  checkoutParams.set("payment_intent_data[metadata][payment_id]", payment.id);
  checkoutParams.set(
    "payment_intent_data[transfer_group]",
    `rentulo_reservation_${reservation.id}`,
  );

  if (actor.email) {
    checkoutParams.set("customer_email", actor.email);
  }

  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `rentulo-checkout-${payment.id}`,
    },
    body: checkoutParams,
  });

  const checkoutSession = (await stripeResponse
    .json()
    .catch(() => ({}))) as CheckoutSessionResponse;

  if (!stripeResponse.ok) {
    console.error(
      "create-checkout-session: Stripe rejected checkout creation",
      stripeResponse.status,
      checkoutSession.error?.type || "unknown_error",
      checkoutSession.error?.message || "",
    );
    return jsonResponse({ error: "Payment provider rejected checkout creation" }, 502);
  }

  if (!checkoutSession.id || !checkoutSession.url) {
    console.error("create-checkout-session: Stripe response is missing checkout identifiers");
    return jsonResponse({ error: "Payment provider returned an invalid checkout" }, 502);
  }

  const intentId = paymentIntentId(checkoutSession.payment_intent);
  const paymentUpdate: Record<string, string> = {
    provider_payment_id: checkoutSession.id,
    updated_at: new Date().toISOString(),
  };

  if (intentId) {
    paymentUpdate.stripe_payment_intent_id = intentId;
  }

  const { error: paymentUpdateError } = await admin
    .from("payments")
    .update(paymentUpdate)
    .eq("id", payment.id);

  if (paymentUpdateError) {
    console.error("create-checkout-session: payment session update failed", paymentUpdateError.message);
    return jsonResponse({ error: "Payment session could not be saved" }, 500);
  }

  return jsonResponse({ url: checkoutSession.url });
});
