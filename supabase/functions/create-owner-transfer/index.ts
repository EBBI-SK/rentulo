import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RentuloDenoRuntime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};

type StripeAccountResponse = {
  id?: string;
  payouts_enabled?: boolean;
  capabilities?: { transfers?: string };
  error?: { message?: string; type?: string };
};

type StripeChargeResponse = {
  id?: string;
  amount?: number;
  amount_refunded?: number;
  currency?: string;
  paid?: boolean;
  captured?: boolean;
  refunded?: boolean;
  payment_intent?: string | { id?: string } | null;
  error?: { message?: string; type?: string };
};

type StripeTransferResponse = {
  id?: string;
  amount?: number;
  currency?: string;
  destination?: string | { id?: string } | null;
  source_transaction?: string | { id?: string } | null;
  transfer_group?: string | null;
  error?: { message?: string; type?: string };
};

const denoRuntime = (globalThis as typeof globalThis & { Deno: RentuloDenoRuntime }).Deno;
const encoder = new TextEncoder();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function timingSafeTextEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;

  let diff = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    diff |= leftBytes[index] ^ rightBytes[index];
  }
  return diff === 0;
}

function objectId(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" && id ? id : null;
  }
  return null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

denoRuntime.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = denoRuntime.env.get("SUPABASE_URL");
  const serviceRoleKey = denoRuntime.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKey = denoRuntime.env.get("STRIPE_SECRET_KEY");

  if (!supabaseUrl || !serviceRoleKey || !stripeSecretKey) {
    console.error("create-owner-transfer: missing server configuration");
    return jsonResponse({ error: "Missing server configuration" }, 500);
  }

  // Internal-only endpoint. It is intentionally not callable with a normal user JWT.
  // A later trusted pickup-confirmation backend will invoke it after PIN verification.
  const authHeader = req.headers.get("Authorization") || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken || !timingSafeTextEqual(accessToken, serviceRoleKey)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let payload: { reservation_id?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const reservationId = String(payload.reservation_id || "").trim();
  if (!isUuid(reservationId)) return jsonResponse({ error: "Invalid request" }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const paymentResult = await admin
    .from("payments")
    .select(
      "id, reservation_id, payer_id, owner_id, amount_total, platform_fee_amount, owner_payout, provider, status, currency, stripe_amount_total_minor, stripe_payment_intent_id, stripe_payment_intent_status, stripe_charge_id, stripe_transfer_id, stripe_transfer_amount_minor, transfer_status, refund_status, stripe_refund_amount_minor",
    )
    .eq("reservation_id", reservationId)
    .single();

  if (paymentResult.error || !paymentResult.data) {
    return jsonResponse({ error: "Payment not found" }, 404);
  }
  const payment = paymentResult.data;

  const reservationResult = await admin
    .from("reservations")
    .select("id, owner_id, renter_id, total_price, platform_fee_amount, owner_payout, status")
    .eq("id", reservationId)
    .single();

  if (reservationResult.error || !reservationResult.data) {
    return jsonResponse({ error: "Reservation not found" }, 404);
  }
  const reservation = reservationResult.data;

  if (
    payment.reservation_id !== reservation.id ||
    payment.owner_id !== reservation.owner_id ||
    payment.payer_id !== reservation.renter_id ||
    payment.provider !== "stripe" ||
    payment.status !== "paid" ||
    payment.currency !== "czk" ||
    payment.stripe_payment_intent_status !== "succeeded" ||
    !payment.stripe_payment_intent_id ||
    !payment.stripe_charge_id ||
    !["picked_up", "returned"].includes(reservation.status)
  ) {
    return jsonResponse({ error: "Transfer is not allowed for this reservation" }, 409);
  }

  if (
    Number(payment.amount_total) !== Number(reservation.total_price) ||
    Number(payment.platform_fee_amount) !== Number(reservation.platform_fee_amount) ||
    Number(payment.owner_payout) !== Number(reservation.owner_payout) ||
    Number(payment.platform_fee_amount) + Number(payment.owner_payout) !== Number(payment.amount_total)
  ) {
    return jsonResponse({ error: "Payment snapshot does not match reservation" }, 409);
  }

  const transferAmountMinor = Number(payment.owner_payout) * 100;
  if (
    !Number.isSafeInteger(transferAmountMinor) ||
    transferAmountMinor <= 0 ||
    Number(payment.stripe_amount_total_minor) !== Number(payment.amount_total) * 100 ||
    transferAmountMinor > Number(payment.stripe_amount_total_minor)
  ) {
    return jsonResponse({ error: "Transfer amount is invalid" }, 409);
  }

  if (payment.refund_status !== "not_requested" || Number(payment.stripe_refund_amount_minor) !== 0) {
    return jsonResponse({ error: "Transfer is blocked by refund state" }, 409);
  }

  if (payment.stripe_transfer_id) {
    if (
      payment.transfer_status === "succeeded" &&
      Number(payment.stripe_transfer_amount_minor) === transferAmountMinor
    ) {
      return jsonResponse({
        transfer_id: payment.stripe_transfer_id,
        amount_minor: transferAmountMinor,
        status: "succeeded",
        existing: true,
      });
    }
    return jsonResponse({ error: "Existing transfer state is inconsistent" }, 409);
  }

  if (payment.transfer_status !== "not_created") {
    return jsonResponse({ error: "Transfer is already being processed" }, 409);
  }

  const profileResult = await admin
    .from("profiles")
    .select("id, stripe_connected_account_id, stripe_connect_status, stripe_connect_transfers_enabled")
    .eq("id", payment.owner_id)
    .single();

  if (profileResult.error || !profileResult.data?.stripe_connected_account_id) {
    return jsonResponse({ error: "Owner payout account is not configured" }, 409);
  }
  const profile = profileResult.data;

  if (profile.stripe_connect_status !== "ready" || profile.stripe_connect_transfers_enabled !== true) {
    return jsonResponse({ error: "Owner payout account is not ready" }, 409);
  }

  const accountId = profile.stripe_connected_account_id;
  const accountResponse = await fetch(
    `https://api.stripe.com/v1/accounts/${encodeURIComponent(accountId)}`,
    { headers: { Authorization: `Bearer ${stripeSecretKey}` } },
  );
  const account = (await accountResponse.json().catch(() => ({}))) as StripeAccountResponse;

  if (
    !accountResponse.ok ||
    account.id !== accountId ||
    account.capabilities?.transfers !== "active" ||
    account.payouts_enabled !== true
  ) {
    console.error(
      "create-owner-transfer: connected account is not ready",
      accountResponse.status,
      account.error?.type || "unknown_error",
      account.error?.message || "",
    );
    return jsonResponse({ error: "Owner payout account is not ready" }, 409);
  }

  const chargeResponse = await fetch(
    `https://api.stripe.com/v1/charges/${encodeURIComponent(payment.stripe_charge_id)}`,
    { headers: { Authorization: `Bearer ${stripeSecretKey}` } },
  );
  const charge = (await chargeResponse.json().catch(() => ({}))) as StripeChargeResponse;
  const chargePaymentIntentId = objectId(charge.payment_intent);

  if (
    !chargeResponse.ok ||
    charge.id !== payment.stripe_charge_id ||
    charge.paid !== true ||
    charge.captured !== true ||
    charge.refunded === true ||
    Number(charge.amount_refunded || 0) !== 0 ||
    charge.currency !== "czk" ||
    Number(charge.amount) !== Number(payment.stripe_amount_total_minor) ||
    chargePaymentIntentId !== payment.stripe_payment_intent_id
  ) {
    console.error(
      "create-owner-transfer: source charge validation failed",
      chargeResponse.status,
      charge.error?.type || "unknown_error",
      charge.error?.message || "",
    );
    return jsonResponse({ error: "Source payment is not eligible for transfer" }, 409);
  }

  const transferGroup = `rentulo_reservation_${reservation.id}`;
  const params = new URLSearchParams();
  params.set("amount", String(transferAmountMinor));
  params.set("currency", "czk");
  params.set("destination", accountId);
  params.set("source_transaction", payment.stripe_charge_id);
  params.set("transfer_group", transferGroup);
  params.set("metadata[payment_id]", payment.id);
  params.set("metadata[reservation_id]", reservation.id);
  params.set("metadata[owner_id]", payment.owner_id);

  const transferResponse = await fetch("https://api.stripe.com/v1/transfers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `rentulo-owner-transfer-${payment.id}`,
    },
    body: params,
  });

  const transfer = (await transferResponse.json().catch(() => ({}))) as StripeTransferResponse;
  const destinationId = objectId(transfer.destination);
  const sourceTransactionId = objectId(transfer.source_transaction);

  if (
    !transferResponse.ok ||
    !transfer.id ||
    Number(transfer.amount) !== transferAmountMinor ||
    transfer.currency !== "czk" ||
    destinationId !== accountId ||
    sourceTransactionId !== payment.stripe_charge_id ||
    transfer.transfer_group !== transferGroup
  ) {
    console.error(
      "create-owner-transfer: Stripe transfer creation failed",
      transferResponse.status,
      transfer.error?.type || "unknown_error",
      transfer.error?.message || "",
    );
    return jsonResponse({ error: "Owner transfer could not be created" }, 502);
  }

  const recorded = await admin.rpc("record_stripe_owner_transfer", {
    p_payment_id: payment.id,
    p_reservation_id: reservation.id,
    p_stripe_transfer_id: transfer.id,
    p_transfer_amount_minor: transferAmountMinor,
  });

  if (recorded.error) {
    // The Stripe request uses a stable idempotency key. A retry will retrieve the
    // same transfer from Stripe and can safely retry the database recording step.
    console.error("create-owner-transfer: transfer recording failed", recorded.error.message);
    return jsonResponse({ error: "Owner transfer could not be recorded" }, 500);
  }

  return jsonResponse({
    transfer_id: transfer.id,
    amount_minor: transferAmountMinor,
    status: "succeeded",
    existing: false,
  });
});
