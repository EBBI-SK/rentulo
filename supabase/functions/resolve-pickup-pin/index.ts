import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rentalHandoverOpen } from "../_shared/prague-rental-window.mjs";

type RentuloDenoRuntime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};

type ReservationRow = {
  id: string;
  renter_id: string;
  owner_id: string;
  status: string;
  start_date: string;
  end_date: string;
  pickup_time: string | null;
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

type LookupAttemptResult = {
  status?: string;
  attempt_id?: string | null;
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

function lookupAttemptError(state: LookupAttemptResult | null): Response | null {
  if (state?.status === "locked" && state.locked_until) {
    return jsonResponse({
      error: "PIN entry is temporarily locked",
      code: "locked",
      locked_until: state.locked_until,
      attempts_remaining: 0,
    }, 429);
  }
  if (state?.status === "busy" || state?.status === "stale") {
    // A temporary overlap must not invalidate the existing browser handoff.
    const response = jsonResponse({
      error: "PIN verification is temporarily unavailable; retry shortly",
      code: "pin_verification_busy",
    }, 503);
    response.headers.set("Retry-After", "1");
    return response;
  }
  if (state?.status !== "completed") {
    return jsonResponse({ error: "PIN could not be verified" }, 500);
  }
  return null;
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
  const ownerId = actor.id;

  let payload: { pin?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const pin = String(payload.pin || "").trim();
  if (!/^\d{6}$/.test(pin)) return jsonResponse({ error: "Invalid request" }, 400);

  const beginResult = await admin.rpc("begin_owner_pickup_pin_attempt", {
    p_owner_id: ownerId,
  });
  if (beginResult.error) {
    console.error("resolve-pickup-pin: attempt could not be started", beginResult.error.message);
    return jsonResponse({ error: "PIN could not be verified" }, 500);
  }

  const started = firstRow<LookupAttemptResult>(beginResult.data);
  if (started?.status !== "started" || !started.attempt_id) {
    return lookupAttemptError(started) || jsonResponse({ error: "PIN could not be verified" }, 500);
  }
  const attemptId = started.attempt_id;
  let attemptFinished = false;

  async function finishAttempt(outcome: "success" | "failure" | "cancelled"): Promise<LookupAttemptResult | null> {
    const result = await admin.rpc("finish_owner_pickup_pin_attempt", {
      p_owner_id: ownerId,
      p_attempt_id: attemptId,
      p_outcome: outcome,
    });
    if (result.error) {
      console.error("resolve-pickup-pin: attempt could not be finished", result.error.message);
      return null;
    }
    const state = firstRow<LookupAttemptResult>(result.data);
    attemptFinished = Boolean(state && ["completed", "locked", "stale"].includes(state.status || ""));
    return state;
  }

  async function finishWithoutFailure(body: unknown, status: number): Promise<Response> {
    return lookupAttemptError(await finishAttempt("cancelled")) || jsonResponse(body, status);
  }

  try {
    const { data: reservations, error: reservationsError } = await admin
      .from("reservations")
      .select("id, renter_id, owner_id, status, start_date, end_date, pickup_time")
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
    let matchedOutsideRentalPeriod = false;
    for (const reservation of ownerReservations) {
      const payment = paymentByReservation.get(reservation.id);
      if (!payment || !isEligiblePayment(payment, reservation)) continue;
      const expectedPin = await createPickupPin(pickupPinSecret, reservation.id, payment.id);
      if (!timingSafeTextEqual(pin, expectedPin)) continue;
      if (rentalHandoverOpen(reservation.start_date, reservation.end_date, reservation.pickup_time)) {
        matches.push(reservation.id);
      } else {
        matchedOutsideRentalPeriod = true;
      }
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
        return await finishWithoutFailure({ error: "Pickup is already confirmed", code: "pickup_already_confirmed" }, 409);
      }

      if (reservationSecurity?.locked_until && new Date(reservationSecurity.locked_until).getTime() > Date.now()) {
        return await finishWithoutFailure({
          error: "PIN entry is temporarily locked",
          code: "locked",
          locked_until: reservationSecurity.locked_until,
          attempts_remaining: 0,
        }, 429);
      }

      const matched = ownerReservations.find((reservation) => reservation.id === matches[0]);
      if (!matched || !rentalHandoverOpen(matched.start_date, matched.end_date, matched.pickup_time)) {
        return await finishWithoutFailure({
          error: "The PIN can be used from two hours before scheduled pickup until scheduled return",
          code: "pickup_wrong_day",
        }, 409);
      }

      const blocked = lookupAttemptError(await finishAttempt("success"));
      if (blocked) return blocked;

      // The PIN may expire while the database finalizes the attempt.
      if (!rentalHandoverOpen(matched.start_date, matched.end_date, matched.pickup_time)) {
        return jsonResponse({
          error: "The PIN can be used from two hours before scheduled pickup until scheduled return",
          code: "pickup_wrong_day",
        }, 409);
      }
      return jsonResponse({ reservation_id: matches[0], status: "verified" });
    }

    if (matches.length > 1) {
      console.error("resolve-pickup-pin: ambiguous PIN collision for owner", actor.id);
      return await finishWithoutFailure({ error: "PIN is ambiguous", code: "ambiguous_pin" }, 409);
    }

    if (matchedOutsideRentalPeriod) {
      return await finishWithoutFailure({
        error: "The PIN can be used from two hours before scheduled pickup until scheduled return",
        code: "pickup_wrong_day",
      }, 409);
    }

    const state = await finishAttempt("failure");
    const blocked = lookupAttemptError(state);
    if (blocked) return blocked;
    return jsonResponse({
      error: "Incorrect PIN",
      code: "invalid_pin",
      attempts_remaining: Math.max(0, Number(state?.attempts_remaining ?? 0)),
    }, 409);
  } catch (error) {
    console.error("resolve-pickup-pin: lookup failed", error instanceof Error ? error.message : "Unexpected error");
    return jsonResponse({ error: "PIN could not be verified" }, 500);
  } finally {
    // Operational failures do not count as a wrong PIN. If cleanup itself fails,
    // the short lease expires and any late result is rejected by the database.
    if (!attemptFinished) {
      try {
        await finishAttempt("cancelled");
      } catch {
        console.error("resolve-pickup-pin: attempt cleanup failed");
      }
    }
  }
});
