import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RentuloDenoRuntime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};

type ReservationRow = {
  id: string;
  renter_id: string;
  owner_id: string;
  status: string;
};

type PaymentRow = {
  id: string;
  reservation_id: string;
  payer_id: string;
  owner_id: string;
  provider: string;
  status: string;
  currency: string;
  stripe_payment_intent_id: string | null;
  stripe_payment_intent_status: string | null;
  stripe_charge_id: string | null;
  refund_status: string | null;
  stripe_refund_amount_minor: number | null;
};

type FailedAttemptResult = {
  failed_attempts?: number;
  attempts_remaining?: number;
  locked_until?: string | null;
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

function isEligiblePayment(payment: PaymentRow, reservation: ReservationRow): boolean {
  return Boolean(
    payment.reservation_id === reservation.id &&
    payment.payer_id === reservation.renter_id &&
    payment.owner_id === reservation.owner_id &&
    payment.provider === "stripe" &&
    payment.status === "paid" &&
    payment.currency === "czk" &&
    payment.stripe_payment_intent_status === "succeeded" &&
    payment.stripe_payment_intent_id &&
    payment.stripe_charge_id &&
    payment.refund_status === "not_requested" &&
    Number(payment.stripe_refund_amount_minor || 0) === 0
  );
}

denoRuntime.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = denoRuntime.env.get("SUPABASE_URL");
  const anonKey = denoRuntime.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = denoRuntime.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const pickupPinSecret = denoRuntime.env.get("PICKUP_PIN_SECRET");

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !pickupPinSecret || pickupPinSecret.length < 32) {
    console.error("resolve-pickup-pin: missing or invalid server configuration");
    return jsonResponse({ error: "Missing server configuration" }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return jsonResponse({ error: "Unauthorized" }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
  const actor = userData.user;
  if (userError || !actor) return jsonResponse({ error: "Unauthorized" }, 401);

  let payload: { pin?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const pin = String(payload.pin || "").trim();
  if (!/^\d{6}$/.test(pin)) return jsonResponse({ error: "Invalid request" }, 400);

  const { data: lookupSecurity, error: securityError } = await admin
    .from("owner_pickup_pin_security")
    .select("failed_attempts, locked_until")
    .eq("owner_id", actor.id)
    .maybeSingle();

  if (securityError) {
    console.error("resolve-pickup-pin: security state could not be loaded", securityError.message);
    return jsonResponse({ error: "PIN could not be verified" }, 500);
  }

  if (lookupSecurity?.locked_until && new Date(lookupSecurity.locked_until).getTime() > Date.now()) {
    return jsonResponse({
      error: "PIN entry is temporarily locked",
      code: "locked",
      locked_until: lookupSecurity.locked_until,
      attempts_remaining: 0,
    }, 429);
  }

  const { data: reservations, error: reservationsError } = await admin
    .from("reservations")
    .select("id, renter_id, owner_id, status")
    .eq("owner_id", actor.id)
    .eq("status", "paid");

  if (reservationsError) {
    console.error("resolve-pickup-pin: reservations could not be loaded", reservationsError.message);
    return jsonResponse({ error: "PIN could not be verified" }, 500);
  }

  const ownerReservations = (reservations || []) as ReservationRow[];
  const reservationIds = ownerReservations.map((reservation) => reservation.id);
  let payments: PaymentRow[] = [];

  if (reservationIds.length) {
    const paymentResult = await admin
      .from("payments")
      .select("id, reservation_id, payer_id, owner_id, provider, status, currency, stripe_payment_intent_id, stripe_payment_intent_status, stripe_charge_id, refund_status, stripe_refund_amount_minor")
      .in("reservation_id", reservationIds);

    if (paymentResult.error) {
      console.error("resolve-pickup-pin: payments could not be loaded", paymentResult.error.message);
      return jsonResponse({ error: "PIN could not be verified" }, 500);
    }
    payments = (paymentResult.data || []) as PaymentRow[];
  }

  const paymentByReservation = new Map<string, PaymentRow>();
  for (const payment of payments) paymentByReservation.set(payment.reservation_id, payment);

  const matches: string[] = [];
  for (const reservation of ownerReservations) {
    const payment = paymentByReservation.get(reservation.id);
    if (!payment || !isEligiblePayment(payment, reservation)) continue;
    const expectedPin = await createPickupPin(pickupPinSecret, reservation.id, payment.id);
    if (timingSafeTextEqual(pin, expectedPin)) matches.push(reservation.id);
  }

  if (matches.length === 1) {
    const { data: reservationSecurity, error: reservationSecurityError } = await admin
      .from("reservation_pickup_security")
      .select("locked_until, confirmed_at")
      .eq("reservation_id", matches[0])
      .maybeSingle();

    if (reservationSecurityError) {
      console.error("resolve-pickup-pin: reservation security state could not be loaded", reservationSecurityError.message);
      return jsonResponse({ error: "PIN could not be verified" }, 500);
    }

    if (reservationSecurity?.confirmed_at) {
      return jsonResponse({ error: "Pickup is already confirmed", code: "pickup_already_confirmed" }, 409);
    }

    if (reservationSecurity?.locked_until && new Date(reservationSecurity.locked_until).getTime() > Date.now()) {
      return jsonResponse({
        error: "PIN entry is temporarily locked",
        code: "locked",
        locked_until: reservationSecurity.locked_until,
        attempts_remaining: 0,
      }, 429);
    }

    const resetResult = await admin
      .from("owner_pickup_pin_security")
      .delete()
      .eq("owner_id", actor.id);
    if (resetResult.error) {
      console.error("resolve-pickup-pin: successful lookup state could not be reset", resetResult.error.message);
      return jsonResponse({ error: "PIN could not be verified" }, 500);
    }

    return jsonResponse({ reservation_id: matches[0], status: "verified" });
  }

  if (matches.length > 1) {
    console.error("resolve-pickup-pin: ambiguous PIN collision for owner", actor.id);
    return jsonResponse({ error: "PIN is ambiguous", code: "ambiguous_pin" }, 409);
  }

  const attemptResult = await admin.rpc("register_failed_owner_pickup_pin", {
    p_owner_id: actor.id,
  });

  if (attemptResult.error) {
    console.error("resolve-pickup-pin: failed attempt could not be recorded", attemptResult.error.message);
    return jsonResponse({ error: "PIN could not be verified" }, 500);
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
});
