/*
  BOD 13: Reservation notifications are generated transactionally in Supabase
  and processed by the central worker. No email/SMS is sent from the browser.

  Compatibility shim for older TEST page bundles that still call the former
  helper after a reservation transition. The database outbox is the source of
  truth; this shim does not issue a network request or mutate a reservation.
*/
async function apiSendReservationEmail() {
  return { ok: true, queued: true };
}

window.apiSendReservationEmail = apiSendReservationEmail;
