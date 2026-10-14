// Pure, side-effect-free validation of Stripe's refund list for one existing cancellation.
// An existing cancellation without a saved refund ID must NEVER trigger a new POST /v1/refunds:
// Stripe's idempotency-key guarantee can expire, even if the original refund succeeded.

function objectId(value) {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && typeof value.id === "string") return value.id;
  return null;
}

export function validateExistingCancellationRefundList(list, expected) {
  if (
    !list || list.object !== "list" || list.has_more !== false ||
    !Array.isArray(list.data)
  ) {
    return { refund: null, error: "invalid_or_incomplete_refund_list" };
  }

  // A second refund (even unrelated or manually created) is not safe to ignore.
  if (list.data.length !== 1) {
    return { refund: null, error: list.data.length === 0 ? "refund_not_found" : "multiple_refunds" };
  }

  const refund = list.data[0];
  if (!refund || typeof refund !== "object") {
    return { refund: null, error: "invalid_refund" };
  }

  const metadata = refund.metadata;
  if (
    refund.object !== "refund" ||
    typeof refund.id !== "string" || !/^re_[a-zA-Z0-9]+$/.test(refund.id) ||
    !Number.isSafeInteger(refund.amount) || refund.amount !== expected.amountMinor ||
    refund.currency !== "czk" ||
    objectId(refund.charge) !== expected.chargeId ||
    objectId(refund.payment_intent) !== expected.paymentIntentId ||
    !metadata || typeof metadata !== "object" ||
    metadata.cancellation_id !== expected.cancellationId ||
    metadata.payment_id !== expected.paymentId ||
    metadata.reservation_id !== expected.reservationId ||
    metadata.cancelled_by_role !== expected.actorRole ||
    !["pending", "requires_action", "succeeded", "failed", "canceled"].includes(refund.status)
  ) {
    return { refund: null, error: "refund_evidence_mismatch" };
  }

  return { refund, error: null };
}
