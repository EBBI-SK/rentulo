// BOD 12 / P1-3 (TEST): transactional reservation email policy.
// A disabled optional email preference must NOT hide time-sensitive actions,
// booking outcomes, payment confirmation, or verified refund/debt accounting.
// Keep this allowlist explicit: new events require an intentional classification.
const ESSENTIAL_EVENTS = new Set([
  "new_request",              // Owner must decide before the 24-hour deadline.
  "approved",                 // Renter must pay before the next 24-hour deadline.
  "rejected",                 // Renter must know the request has been declined.
  "cancelled",                // Participants must know dates were released.
  "paid",                     // Payment confirmation / unlocked contacts.
  "paid_cancelled",           // Verified refund and any owner debt details.
  "expiry_reminder_pending",  // Deadline and potential loss of reservation.
  "expiry_reminder_approved",
  "expired_pending",          // Booking expired / dates released.
  "expired_approved",
  "no_show",               // Paid booking closed, dates released, no refund and automatic payout.
]);

// Informational status updates, not deadlines or financial receipts.
const OPTIONAL_EVENTS = new Set(["picked_up", "returned"]);

/**
 * @param {string} event
 * @param {string | null | undefined} recipientEmail
 * @param {boolean | null | undefined} emailNotifications
 * @returns {boolean}
 */
export function shouldDeliverReservationEmail(event, recipientEmail, emailNotifications) {
  if (typeof recipientEmail !== "string" || !recipientEmail.trim()) return false;
  if (ESSENTIAL_EVENTS.has(event)) return true;
  if (OPTIONAL_EVENTS.has(event)) return emailNotifications !== false;
  // Fail closed if a new event was not deliberately classified.
  return false;
}
