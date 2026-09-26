import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RentuloDenoRuntime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};

type FailedAttemptResult = {
  failed_attempts?: number;
  attempts_remaining?: number;
  locked_until?: string | null;
};

type PickupResult = {
  id?: string;
  status?: string;
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

function timingSafeTextEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;

  let diff = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    diff |= leftBytes[index] ^ rightBytes[index];
  }
  return diff === 0;
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

function firstRow<T>(value: T[] | T | null): T | null {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
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
    console.error("confirm-pickup: missing or invalid server configuration");
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

  let payload: { reservation_id?: string; pin?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const reservationId = String(payload.reservation_id || "").trim();
  const pin = String(payload.pin || "").trim();

  if (!isUuid(reservationId) || !/^\d{6}$/.test(pin)) {
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

  if (reservation.owner_id !== actor.id) {
    return jsonResponse({ error: "Only the owner can confirm pickup" }, 403);
  }

  if (reservation.status !== "paid") {
    return jsonResponse({ error: "Reservation is not ready for pickup", code: "pickup_unavailable" }, 409);
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
    console.error("confirm-pickup: payment is not eligible", reservation.id);
    return jsonResponse({ error: "Reservation is not ready for pickup", code: "pickup_unavailable" }, 409);
  }

  const { data: security } = await admin
    .from("reservation_pickup_security")
    .select("failed_attempts, locked_until, confirmed_at")
    .eq("reservation_id", reservation.id)
    .maybeSingle();

  if (security?.confirmed_at) {
    return jsonResponse({ error: "Pickup is already confirmed", code: "pickup_already_confirmed" }, 409);
  }

  if (security?.locked_until && new Date(security.locked_until).getTime() > Date.now()) {
    return jsonResponse({
      error: "PIN entry is temporarily locked",
      code: "locked",
      locked_until: security.locked_until,
      attempts_remaining: 0,
    }, 429);
  }

  const expectedPin = await createPickupPin(pickupPinSecret, reservation.id, payment.id);

  if (!timingSafeTextEqual(pin, expectedPin)) {
    const attemptResult = await admin.rpc("register_failed_pickup_pin", {
      p_reservation_id: reservation.id,
      p_owner_id: actor.id,
    });

    if (attemptResult.error) {
      console.error("confirm-pickup: failed attempt could not be recorded", attemptResult.error.message);
      return jsonResponse({ error: "Pickup PIN could not be verified" }, 500);
    }

    const state = firstRow<FailedAttemptResult>(attemptResult.data as FailedAttemptResult[] | FailedAttemptResult | null);
    const lockedUntil = state?.locked_until || null;
    const attemptsRemaining = Number(state?.attempts_remaining ?? 0);

    if (lockedUntil && new Date(lockedUntil).getTime() > Date.now()) {
      return jsonResponse({
        error: "PIN entry is temporarily locked",
        code: "locked",
        locked_until: lockedUntil,
        attempts_remaining: 0,
      }, 429);
    }

    return jsonResponse({
      error: "Incorrect PIN",
      code: "invalid_pin",
      attempts_remaining: Math.max(0, attemptsRemaining),
    }, 409);
  }

  const pickupResult = await admin.rpc("confirm_reservation_pickup", {
    p_reservation_id: reservation.id,
    p_owner_id: actor.id,
  });

  if (pickupResult.error) {
    const message = pickupResult.error.message || "";
    if (/temporarily locked/i.test(message)) {
      const latestState = await admin
        .from("reservation_pickup_security")
        .select("locked_until")
        .eq("reservation_id", reservation.id)
        .maybeSingle();

      return jsonResponse({
        error: "PIN entry is temporarily locked",
        code: "locked",
        locked_until: latestState.data?.locked_until || null,
        attempts_remaining: 0,
      }, 429);
    }

    console.error("confirm-pickup: reservation confirmation failed", pickupResult.error.message);
    return jsonResponse({ error: "Pickup could not be confirmed" }, 409);
  }

  const confirmed = firstRow<PickupResult>(pickupResult.data as PickupResult[] | PickupResult | null);
  if (!confirmed || confirmed.status !== "picked_up") {
    console.error("confirm-pickup: database returned an invalid pickup result");
    return jsonResponse({ error: "Pickup could not be confirmed" }, 500);
  }

  let transferStatus = "pending";
  try {
    const transferResponse = await fetch(`${supabaseUrl}/functions/v1/create-owner-transfer`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reservation_id: reservation.id }),
    });

    const transferBody = await transferResponse.json().catch(() => ({}));
    if (transferResponse.ok && transferBody?.status === "succeeded") {
      transferStatus = "succeeded";
    } else {
      console.error(
        "confirm-pickup: owner transfer will require retry",
        transferResponse.status,
        transferBody?.error || "unknown_error",
      );
    }
  } catch (error) {
    console.error(
      "confirm-pickup: owner transfer request failed and will require retry",
      error instanceof Error ? error.message : String(error),
    );
  }

  return jsonResponse({
    reservation_id: reservation.id,
    status: "picked_up",
    pin_consumed: true,
    transfer_status: transferStatus,
  });
});
