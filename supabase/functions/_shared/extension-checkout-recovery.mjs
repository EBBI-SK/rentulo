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
