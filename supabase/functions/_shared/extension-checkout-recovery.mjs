// Pure Stripe decision helpers shared with the targeted Node tests.
// A Session must match the expected amount, extension and reservation before
// its status can release a payment/date hold.
export function classifyExtensionCheckoutSession(session, expected) {
  if (!session || session.id !== expected.sessionId || session.mode !== "payment" ||
      session.currency !== "czk" || session.amount_total !== expected.amountMinor ||
      session.client_reference_id !== expected.extensionId ||
      session.metadata?.payment_kind !== "reservation_extension" ||
      session.metadata?.extension_id !== expected.extensionId ||
      session.metadata?.reservation_id !== expected.reservationId) {
    return "invalid";
  }
  if (session.status === "open" && session.payment_status === "unpaid" &&
      typeof session.url === "string" && /^https:\/\/checkout\.stripe\.com\//.test(session.url)) {
    return "reuse";
  }
  if (session.status === "expired" && session.payment_status === "unpaid") {
    return "verified_expired";
  }
  return "processing";
}

// Stripe does not cache a validation error before endpoint execution. Other
// failures (including idempotency conflicts, HTTP 500 and lost responses) may
// hide a created Session, so NEVER rotate their idempotency key.
export function isDefiniteCheckoutCreationRejection(status, stripeError) {
  return status === 400 && stripeError?.type === "invalid_request_error" &&
    stripeError.code !== "idempotency_key_in_use";
}


// Build the identical Stripe v1 request in BOTH renter and internal recovery.
// A stale response must never cause a different body to reuse this key.
export function extensionCheckoutIdempotencyKey(attemptId) {
  return `rentulo-extension-checkout-${attemptId}`;
}

export function buildExtensionCheckoutParams(input) {
  const params = new URLSearchParams();
  const expiration = Math.floor(new Date(input.checkoutExpiresAt).getTime() / 1000);
  params.set("mode", "payment");
  params.set("locale", input.locale);
  params.set("expires_at", String(expiration));
  params.set("success_url", `${input.siteUrl}/moje-rezervace.html?extension_payment=success`);
  params.set("cancel_url", `${input.siteUrl}/moje-rezervace.html?extension_payment=cancelled`);
  params.set("client_reference_id", input.extensionId);
  params.set("line_items[0][price_data][currency]", "czk");
  params.set("line_items[0][price_data][product_data][name]", `${input.offerName} \u2013 prodlou\u017een\u00ed pron\u00e1jmu`);
  params.set("line_items[0][price_data][product_data][description]", `${input.previousEndDate} - ${input.newEndDate}`);
  params.set("line_items[0][price_data][unit_amount]", String(input.amountMinor));
  params.set("line_items[0][quantity]", "1");
  params.set("metadata[payment_kind]", "reservation_extension");
  params.set("metadata[extension_id]", input.extensionId);
  params.set("metadata[reservation_id]", input.reservationId);
  // The attempt id makes a Stripe read-only search provably attributable.
  params.set("metadata[checkout_attempt_id]", input.attemptId);
  params.set("payment_intent_data[metadata][payment_kind]", "reservation_extension");
  params.set("payment_intent_data[metadata][extension_id]", input.extensionId);
  params.set("payment_intent_data[metadata][reservation_id]", input.reservationId);
  params.set("payment_intent_data[metadata][checkout_attempt_id]", input.attemptId);
  params.set("payment_intent_data[transfer_group]", `rentulo_extension_${input.extensionId}`);
  if (input.customerEmail) params.set("customer_email", input.customerEmail);
  return params;
}

// Stripe v1 may prune idempotency keys after 24h. Keep TWO hours of margin.
// Also require enough time for Stripe's minimum 30-minute Checkout lifetime.
export function mayRetrySameCheckoutAttempt(createdAtMs, expiresAtMs, nowMs) {
  return Number.isFinite(createdAtMs) && Number.isFinite(expiresAtMs) &&
    Number.isFinite(nowMs) && nowMs >= createdAtMs &&
    nowMs < createdAtMs + 22 * 60 * 60 * 1000 &&
    expiresAtMs > nowMs + 31 * 60 * 1000;
}

// Used only for Stripe sessions found via read-only search or idempotent retry.
// Never trust extension_id alone: require attempt, creation window, amount,
// dates and a verified non-payable or payable Checkout status.
export function classifyRecoveredCheckoutSession(session, expected) {
  if (!session || session.livemode !== false ||
      !/^cs_test_[A-Za-z0-9]+$/.test(session.id || "") ||
      session.metadata?.checkout_attempt_id !== expected.attemptId ||
      session.expires_at !== expected.expiresAtUnix ||
      !Number.isInteger(session.created) ||
      session.created < expected.createdAfterUnix ||
      session.created > expected.expiresAtUnix) return "invalid";
  const state = classifyExtensionCheckoutSession(session, {
    sessionId: session.id, amountMinor: expected.amountMinor,
    extensionId: expected.extensionId, reservationId: expected.reservationId,
  });
  if (state === "reuse" || state === "verified_expired") return state;
  if (state === "processing" && session.status === "complete" &&
      (session.payment_status === "paid" || session.payment_status === "unpaid")) {
    return "processing";
  }
  return "invalid";
}


// Strictly read-only Stripe search for a Session whose POST response was lost.
// No match is NOT evidence of no payment. Never free the payment/date hold.
export async function findRecoveredCheckoutSession(stripeKey, expected, requester = fetch) {
  let cursor = null;
  const matches = [];
  for (let page = 0; page < 3; page += 1) {
    const query = new URLSearchParams({ limit: "100" });
    query.set("created[gte]", String(expected.createdAfterUnix));
    query.set("created[lte]", String(expected.expiresAtUnix));
    if (cursor) query.set("starting_after", cursor);
    let response;
    try {
      response = await requester(`https://api.stripe.com/v1/checkout/sessions?${query}`, {
        headers: { Authorization: `Bearer ${stripeKey}` },
        signal: AbortSignal.timeout(12_000),
      });
    } catch (_) { return { status: "incomplete" }; }
    if (!response.ok) return { status: "incomplete" };
    const body = await response.json().catch(() => null);
    if (!body || !Array.isArray(body.data) || typeof body.has_more !== "boolean") {
      return { status: "incomplete" };
    }
    for (const session of body.data) {
      const state = classifyRecoveredCheckoutSession(session, expected);
      if (state !== "invalid") matches.push({ session, state });
      if (matches.length > 1) return { status: "ambiguous" };
    }
    if (!body.has_more) {
      return matches.length === 1 ? { status: "matched", ...matches[0] } : { status: "none" };
    }
    const lastId = body.data.at(-1)?.id;
    if (!lastId || lastId === cursor) return { status: "incomplete" };
    cursor = lastId;
  }
  return { status: "incomplete" };
}
