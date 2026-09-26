import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RentuloDenoRuntime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};

const denoRuntime = (globalThis as typeof globalThis & { Deno: RentuloDenoRuntime }).Deno;

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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function createPickupPin(secret: string, reservationId: string, paymentId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const message = `rentulo-pickup-v1:${reservationId}:${paymentId}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
  );
  const value = (
    ((signature[0] << 24) >>> 0) |
    (signature[1] << 16) |
    (signature[2] << 8) |
    signature[3]
  ) >>> 0;

  return String(value % 1_000_000).padStart(6, "0");
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
  const pickupPinSecret = denoRuntime.env.get("PICKUP_PIN_SECRET");

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !pickupPinSecret || pickupPinSecret.length < 32) {
    console.error("get-pickup-pin: missing or invalid server configuration");
    return jsonResponse({ error: "Missing server configuration" }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!accessToken) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
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
  if (!isUuid(reservationId)) {
    return jsonResponse({ error: "Invalid request" }, 400);
  }

  const { data: reservation, error: reservationError } = await admin
    .from("reservations")
    .select("id, renter_id, owner_id, status")
    .eq("id", reservationId)
    .single();

  if (reservationError || !reservation) {
    return jsonResponse({ error: "Reservation not found" }, 404);
  }

  if (reservation.renter_id !== actor.id) {
    return jsonResponse({ error: "Only the renter can view this PIN" }, 403);
  }

  if (reservation.status !== "paid") {
    return jsonResponse({ error: "Pickup PIN is not available", code: "pin_unavailable" }, 409);
  }

  const { data: payment, error: paymentError } = await admin
    .from("payments")
    .select("id, reservation_id, payer_id, owner_id, provider, status, currency, stripe_payment_intent_id, stripe_payment_intent_status, stripe_charge_id, refund_status, stripe_refund_amount_minor")
    .eq("reservation_id", reservation.id)
    .single();

  if (
    paymentError ||
    !payment ||
    payment.reservation_id !== reservation.id ||
    payment.payer_id !== reservation.renter_id ||
    payment.owner_id !== reservation.owner_id ||
    payment.provider !== "stripe" ||
    payment.status !== "paid" ||
    payment.currency !== "czk" ||
    payment.stripe_payment_intent_status !== "succeeded" ||
    !payment.stripe_payment_intent_id ||
    !payment.stripe_charge_id ||
    payment.refund_status !== "not_requested" ||
    Number(payment.stripe_refund_amount_minor || 0) !== 0
  ) {
    console.error("get-pickup-pin: payment is not eligible", reservation.id);
    return jsonResponse({ error: "Pickup PIN is not available", code: "pin_unavailable" }, 409);
  }

  const { data: security } = await admin
    .from("reservation_pickup_security")
    .select("confirmed_at")
    .eq("reservation_id", reservation.id)
    .maybeSingle();

  if (security?.confirmed_at) {
    return jsonResponse({ error: "Pickup PIN is no longer valid", code: "pin_used" }, 409);
  }

  const pin = await createPickupPin(pickupPinSecret, reservation.id, payment.id);
  return jsonResponse({ reservation_id: reservation.id, pin });
});
