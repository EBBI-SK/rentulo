import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RentuloDenoRuntime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};

type CancellationAction = "preview" | "confirm";
type RefundStatus = "pending" | "requires_action" | "succeeded" | "failed" | "canceled";

type CancellationContext = {
  reservation_id: string;
  payment_id: string;
  actor_role: "renter" | "owner";
  payment_amount_minor: number;
  currency: "czk";
  stripe_payment_intent_id: string;
  stripe_charge_id: string;
  refund_status: string;
  stripe_refund_id: string | null;
  stripe_refund_amount_minor: number;
  transfer_status: string;
  stripe_transfer_id: string | null;
  cancellation_id: string | null;
  refund_policy: string | null;
  cancellation_refund_amount_minor: number | null;
  cancellation_external_cost_amount_minor: number | null;
  cancellation_financials_finalized_at: string | null;
  cancelled_at: string | null;
  cancellation_cutoff_at: string | null;
  owner_debt_id: string | null;
  owner_debt_due_at: string | null;
};

type StripeChargeResponse = {
  id?: string;
  amount?: number;
  amount_refunded?: number;
  balance_transaction?: string | { id?: string } | null;
  currency?: string;
  paid?: boolean;
  captured?: boolean;
  refunded?: boolean;
  payment_intent?: string | { id?: string } | null;
  error?: { message?: string; type?: string };
};

type StripeBalanceTransactionResponse = {
  id?: string;
  amount?: number;
  fee?: number;
  currency?: string;
  exchange_rate?: number | null;
  source?: string | { id?: string } | null;
  type?: string;
  error?: { message?: string; type?: string };
};

type StripeRefundResponse = {
  id?: string;
  amount?: number;
  balance_transaction?: string | { id?: string } | null;
  charge?: string | { id?: string } | null;
  currency?: string;
  status?: string;
  error?: { message?: string; type?: string };
};

type Quote = {
  paymentAmountMinor: number;
  externalCostAmountMinor: number;
  refundAmountMinor: number;
  currency: "czk";
  chargeBalanceTransactionId: string;
  chargeBalanceAmountMinor: number;
  chargeBalanceCurrency: "czk" | "eur";
  providerFeeAmountMinor: number;
  providerFeeCurrency: "czk" | "eur";
  providerExchangeRate: number;
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

function objectId(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" && id ? id : null;
  }
  return null;
}

function integer(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) ? numberValue : null;
}

function allowedRefundStatus(value: unknown): RefundStatus | null {
  return value === "pending" || value === "requires_action" || value === "succeeded" ||
      value === "failed" || value === "canceled"
    ? value
    : null;
}

function calculateExternalCostMinor(
  providerFeeMinor: number,
  paymentAmountMinor: number,
  settlementAmountMinor: number,
): number | null {
  if (
    !Number.isSafeInteger(providerFeeMinor) || providerFeeMinor < 0 ||
    !Number.isSafeInteger(paymentAmountMinor) || paymentAmountMinor <= 0 ||
    !Number.isSafeInteger(settlementAmountMinor) || settlementAmountMinor <= 0
  ) {
    return null;
  }

  if (providerFeeMinor === 0) return 0;

  const numerator = BigInt(providerFeeMinor) * BigInt(paymentAmountMinor);
  const denominator = BigInt(settlementAmountMinor);
  const rounded = (numerator + denominator / 2n) / denominator;
  const result = Number(rounded);

  return Number.isSafeInteger(result) && result >= 0 && result <= paymentAmountMinor
    ? result
    : null;
}

function calculateRefundAmountMinor(
  actorRole: "renter" | "owner",
  paymentAmountMinor: number,
  externalCostAmountMinor: number,
): number | null {
  if (
    !Number.isSafeInteger(paymentAmountMinor) || paymentAmountMinor <= 0 ||
    !Number.isSafeInteger(externalCostAmountMinor) || externalCostAmountMinor < 0 ||
    externalCostAmountMinor > paymentAmountMinor
  ) {
    return null;
  }

  const refundAmountMinor = actorRole === "renter"
    ? paymentAmountMinor - externalCostAmountMinor
    : paymentAmountMinor;

  return refundAmountMinor > 0 ? refundAmountMinor : null;
}

async function loadQuote(
  stripeSecretKey: string,
  context: CancellationContext,
): Promise<{ quote: Quote | null; error: string | null; providerStatus?: number }> {
  const chargeResponse = await fetch(
    `https://api.stripe.com/v1/charges/${encodeURIComponent(context.stripe_charge_id)}`,
    { headers: { Authorization: `Bearer ${stripeSecretKey}` } },
  );
  const charge = (await chargeResponse.json().catch(() => ({}))) as StripeChargeResponse;
  const chargePaymentIntentId = objectId(charge.payment_intent);
  const balanceTransactionId = objectId(charge.balance_transaction);
  const chargeAmount = integer(charge.amount);
  const amountRefunded = integer(charge.amount_refunded ?? 0);

  if (
    !chargeResponse.ok ||
    charge.id !== context.stripe_charge_id ||
    charge.paid !== true ||
    charge.captured !== true ||
    charge.currency !== "czk" ||
    chargeAmount !== Number(context.payment_amount_minor) ||
    chargePaymentIntentId !== context.stripe_payment_intent_id ||
    !balanceTransactionId
  ) {
    console.error(
      "cancel-paid-reservation: source charge validation failed",
      chargeResponse.status,
      charge.error?.type || "unknown_error",
      charge.error?.message || "",
    );
    return {
      quote: null,
      error: "Source payment is not eligible for cancellation",
      providerStatus: chargeResponse.status,
    };
  }

  if (
    !context.cancellation_id &&
    (charge.refunded === true || amountRefunded === null || amountRefunded !== 0)
  ) {
    return { quote: null, error: "Source payment already has a refund" };
  }

  const balanceResponse = await fetch(
    `https://api.stripe.com/v1/balance_transactions/${encodeURIComponent(balanceTransactionId)}`,
    { headers: { Authorization: `Bearer ${stripeSecretKey}` } },
  );
  const balance = (
    await balanceResponse.json().catch(() => ({}))
  ) as StripeBalanceTransactionResponse;
  const settlementAmountMinor = integer(balance.amount);
  const providerFeeAmountMinor = integer(balance.fee);
  const balanceSourceId = objectId(balance.source);
  const settlementCurrency = balance.currency === "czk" || balance.currency === "eur"
    ? balance.currency
    : null;

  if (
    !balanceResponse.ok ||
    balance.id !== balanceTransactionId ||
    balance.type !== "charge" ||
    balanceSourceId !== context.stripe_charge_id ||
    settlementAmountMinor === null || settlementAmountMinor <= 0 ||
    providerFeeAmountMinor === null || providerFeeAmountMinor < 0 ||
    !settlementCurrency
  ) {
    console.error(
      "cancel-paid-reservation: source balance transaction validation failed",
      balanceResponse.status,
      balance.error?.type || "unknown_error",
      balance.error?.message || "",
    );
    return {
      quote: null,
      error: "Stripe settlement evidence is not available",
      providerStatus: balanceResponse.status,
    };
  }

  const paymentAmountMinor = Number(context.payment_amount_minor);
  const externalCostAmountMinor = calculateExternalCostMinor(
    providerFeeAmountMinor,
    paymentAmountMinor,
    settlementAmountMinor,
  );

  if (externalCostAmountMinor === null) {
    return { quote: null, error: "Stripe cancellation cost could not be calculated" };
  }

  const refundAmountMinor = calculateRefundAmountMinor(
    context.actor_role,
    paymentAmountMinor,
    externalCostAmountMinor,
  );

  if (refundAmountMinor === null) {
    return { quote: null, error: "Cancellation refund amount is not positive" };
  }

  const stripeExchangeRate = Number(balance.exchange_rate);
  const providerExchangeRate = Number.isFinite(stripeExchangeRate) && stripeExchangeRate > 0
    ? stripeExchangeRate
    : settlementAmountMinor / paymentAmountMinor;

  if (!Number.isFinite(providerExchangeRate) || providerExchangeRate <= 0) {
    return { quote: null, error: "Stripe settlement exchange rate is invalid" };
  }

  return {
    quote: {
      paymentAmountMinor,
      externalCostAmountMinor,
      refundAmountMinor,
      currency: "czk",
      chargeBalanceTransactionId: balanceTransactionId,
      chargeBalanceAmountMinor: settlementAmountMinor,
      chargeBalanceCurrency: settlementCurrency,
      providerFeeAmountMinor,
      providerFeeCurrency: settlementCurrency,
      providerExchangeRate,
    },
    error: null,
  };
}

function publicQuote(context: CancellationContext, quote: Quote) {
  return {
    reservation_id: context.reservation_id,
    actor_role: context.actor_role,
    refund_policy: context.actor_role === "renter"
      ? "renter_external_cost_deducted"
      : "owner_full_refund_owner_cost",
    payment_amount_minor: quote.paymentAmountMinor,
    external_cost_amount_minor: quote.externalCostAmountMinor,
    refund_amount_minor: quote.refundAmountMinor,
    currency: quote.currency,
    cancellation_cutoff_at: context.cancellation_cutoff_at,
  };
}

denoRuntime.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = denoRuntime.env.get("SUPABASE_URL");
  const anonKey = denoRuntime.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = denoRuntime.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKey = denoRuntime.env.get("STRIPE_SECRET_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !stripeSecretKey) {
    console.error("cancel-paid-reservation: missing server configuration");
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

  let payload: { reservation_id?: string; action?: CancellationAction };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const reservationId = String(payload.reservation_id || "").trim();
  const action = payload.action;

  if (!isUuid(reservationId) || (action !== "preview" && action !== "confirm")) {
    return jsonResponse({ error: "Invalid request" }, 400);
  }

  const contextResult = await admin.rpc("get_paid_reservation_cancellation_context", {
    p_reservation_id: reservationId,
    p_actor_user_id: actor.id,
  });

  if (contextResult.error || !Array.isArray(contextResult.data) || !contextResult.data[0]) {
    const message = contextResult.error?.message || "Paid cancellation context is unavailable";
    if (message.includes("actor does not match")) return jsonResponse({ error: "Forbidden" }, 403);
    if (message.includes("was not found")) return jsonResponse({ error: "Reservation not found" }, 404);
    return jsonResponse({ error: message }, 409);
  }

  const context = contextResult.data[0] as CancellationContext;

  if (action === "preview" && context.cancellation_id) {
    return jsonResponse({ error: "Reservation cancellation is already in progress" }, 409);
  }

  if (
    action === "confirm" &&
    context.cancellation_id &&
    context.cancellation_financials_finalized_at &&
    context.stripe_refund_id &&
    context.cancellation_refund_amount_minor !== null &&
    context.cancellation_external_cost_amount_minor !== null
  ) {
    const existingResponse = {
      reservation_id: context.reservation_id,
      actor_role: context.actor_role,
      refund_policy: context.refund_policy,
      payment_amount_minor: Number(context.payment_amount_minor),
      external_cost_amount_minor: Number(context.cancellation_external_cost_amount_minor),
      refund_amount_minor: Number(context.cancellation_refund_amount_minor),
      currency: "czk",
      cancellation_cutoff_at: context.cancellation_cutoff_at,
      cancellation_id: context.cancellation_id,
      refund_id: context.stripe_refund_id,
      refund_status: context.refund_status,
      owner_debt_id: context.owner_debt_id || null,
      owner_debt_due_at: context.owner_debt_due_at || null,
      existing: true,
    };

    if (context.refund_status === "failed" || context.refund_status === "canceled") {
      return jsonResponse({ ...existingResponse, error: "Stripe refund did not complete" }, 502);
    }

    return jsonResponse(existingResponse);
  }

  const quoteResult = await loadQuote(stripeSecretKey, context);
  if (!quoteResult.quote) {
    return jsonResponse({ error: quoteResult.error || "Cancellation quote failed" }, 409);
  }
  const quote = quoteResult.quote;

  if (action === "preview") {
    return jsonResponse(publicQuote(context, quote));
  }

  let cancellationId = context.cancellation_id;

  if (!cancellationId) {
    const beginResult = await admin.rpc("begin_paid_reservation_cancellation", {
      p_reservation_id: reservationId,
      p_cancelled_by_role: context.actor_role,
      p_cancelled_by_user_id: actor.id,
    });

    if (beginResult.error || !Array.isArray(beginResult.data) || !beginResult.data[0]?.cancellation_id) {
      console.error(
        "cancel-paid-reservation: cancellation start failed",
        beginResult.error?.message || "missing cancellation id",
      );
      return jsonResponse({ error: beginResult.error?.message || "Cancellation could not be started" }, 409);
    }

    cancellationId = String(beginResult.data[0].cancellation_id);
  }

  let refund: StripeRefundResponse;
  let refundResponseStatus = 200;

  if (context.stripe_refund_id) {
    const existingRefundResponse = await fetch(
      `https://api.stripe.com/v1/refunds/${encodeURIComponent(context.stripe_refund_id)}`,
      { headers: { Authorization: `Bearer ${stripeSecretKey}` } },
    );
    refundResponseStatus = existingRefundResponse.status;
    refund = (await existingRefundResponse.json().catch(() => ({}))) as StripeRefundResponse;

    if (!existingRefundResponse.ok) {
      console.error(
        "cancel-paid-reservation: existing refund lookup failed",
        existingRefundResponse.status,
        refund.error?.type || "unknown_error",
        refund.error?.message || "",
      );
      return jsonResponse({ error: "Existing Stripe refund could not be loaded" }, 502);
    }
  } else {
    const refundParams = new URLSearchParams();
    refundParams.set("charge", context.stripe_charge_id);
    refundParams.set("amount", String(quote.refundAmountMinor));
    refundParams.set("metadata[payment_id]", context.payment_id);
    refundParams.set("metadata[reservation_id]", context.reservation_id);
    refundParams.set("metadata[cancellation_id]", cancellationId);
    refundParams.set("metadata[cancelled_by_role]", context.actor_role);

    const stripeRefundResponse = await fetch("https://api.stripe.com/v1/refunds", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": `rentulo-paid-cancellation-${cancellationId}`,
      },
      body: refundParams,
    });
    refundResponseStatus = stripeRefundResponse.status;
    refund = (await stripeRefundResponse.json().catch(() => ({}))) as StripeRefundResponse;

    if (!stripeRefundResponse.ok) {
      console.error(
        "cancel-paid-reservation: Stripe refund creation failed",
        stripeRefundResponse.status,
        refund.error?.type || "unknown_error",
        refund.error?.message || "",
      );
      return jsonResponse({ error: "Payment provider rejected the refund" }, 502);
    }
  }

  const refundId = typeof refund.id === "string" ? refund.id : "";
  const refundStatus = allowedRefundStatus(refund.status);
  const refundAmountMinor = integer(refund.amount);
  const refundChargeId = objectId(refund.charge);
  const refundBalanceTransactionId = objectId(refund.balance_transaction);

  if (
    !refundId || !refundStatus ||
    refundAmountMinor !== quote.refundAmountMinor ||
    refund.currency !== "czk" ||
    refundChargeId !== context.stripe_charge_id
  ) {
    console.error(
      "cancel-paid-reservation: Stripe refund response is inconsistent",
      refundResponseStatus,
      refund.id || "missing_refund_id",
    );
    return jsonResponse({ error: "Payment provider returned an invalid refund" }, 502);
  }

  const finalizeResult = await admin.rpc("finalize_paid_reservation_cancellation_refund", {
    p_cancellation_id: cancellationId,
    p_stripe_refund_id: refundId,
    p_stripe_refund_status: refundStatus,
    p_refund_amount_minor: quote.refundAmountMinor,
    p_stripe_refund_balance_transaction_id: refundBalanceTransactionId,
    p_charge_balance_transaction_id: quote.chargeBalanceTransactionId,
    p_charge_balance_amount_minor: quote.chargeBalanceAmountMinor,
    p_charge_balance_currency: quote.chargeBalanceCurrency,
    p_external_cost_amount_minor: quote.externalCostAmountMinor,
    p_external_cost_provider_amount_minor: quote.providerFeeAmountMinor,
    p_external_cost_provider_currency: quote.providerFeeCurrency,
    p_external_cost_provider_exchange_rate: quote.providerExchangeRate,
  });

  if (finalizeResult.error || !Array.isArray(finalizeResult.data) || !finalizeResult.data[0]) {
    console.error(
      "cancel-paid-reservation: refund finalization failed",
      finalizeResult.error?.message || "missing finalization result",
    );
    return jsonResponse({ error: "Refund was created but could not be saved" }, 500);
  }

  const finalized = finalizeResult.data[0];
  const responseBody = {
    ...publicQuote(context, quote),
    cancellation_id: cancellationId,
    refund_id: refundId,
    refund_status: refundStatus,
    owner_debt_id: finalized.owner_debt_id || null,
    owner_debt_due_at: finalized.owner_debt_due_at || null,
    existing: Boolean(context.cancellation_id),
  };

  if (refundStatus === "failed" || refundStatus === "canceled") {
    return jsonResponse({ ...responseBody, error: "Stripe refund did not complete" }, 502);
  }

  return jsonResponse(responseBody);
});
