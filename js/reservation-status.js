const RESERVATION_STATUS_PENDING = "pending";
const RESERVATION_STATUS_APPROVED = "approved";
const RESERVATION_STATUS_PAID = "paid";
const RESERVATION_STATUS_PICKED_UP = "picked_up";
const RESERVATION_STATUS_RETURNED = "returned";
const RESERVATION_STATUS_REJECTED = "rejected";
const RESERVATION_STATUS_CANCELLED = "cancelled";
const RESERVATION_STATUS_COMPLETED = "completed";
const RESERVATION_STATUS_EXPIRED = "expired";
const LEGACY_RESERVATION_STATUS_PENDING = "Čeká na potvrzení";
const LEGACY_RESERVATION_STATUS_APPROVED = "Čeká na platbu";
const LEGACY_RESERVATION_STATUS_PAID = "Zaplaceno";
const LEGACY_RESERVATION_STATUS_PICKED_UP = "Vyzvednuto";
const LEGACY_RESERVATION_STATUS_RETURNED = "Vráceno";
const LEGACY_RESERVATION_STATUS_REJECTED = "Odmítnuto";
const LEGACY_RESERVATION_STATUS_CANCELLED = "Zrušeno";
const LEGACY_RESERVATION_STATUS_COMPLETED = "Dokončeno";
const OPEN_RESERVATION_STATUSES = [
  RESERVATION_STATUS_PENDING,
  RESERVATION_STATUS_APPROVED,
  RESERVATION_STATUS_PAID,
  RESERVATION_STATUS_PICKED_UP,
  LEGACY_RESERVATION_STATUS_PENDING,
  LEGACY_RESERVATION_STATUS_APPROVED,
  LEGACY_RESERVATION_STATUS_PAID,
  LEGACY_RESERVATION_STATUS_PICKED_UP
];

const CLOSED_RESERVATION_STATUSES = [
  RESERVATION_STATUS_RETURNED,
  RESERVATION_STATUS_REJECTED,
  RESERVATION_STATUS_CANCELLED,
  RESERVATION_STATUS_COMPLETED,
  RESERVATION_STATUS_EXPIRED,
  LEGACY_RESERVATION_STATUS_RETURNED,
  LEGACY_RESERVATION_STATUS_REJECTED,
  LEGACY_RESERVATION_STATUS_CANCELLED,
  LEGACY_RESERVATION_STATUS_COMPLETED
];

function normalizeReservationStatus(status) {
  const normalizedStatus = String(status || "").trim();

  const statusMap = {
    [LEGACY_RESERVATION_STATUS_PENDING]: RESERVATION_STATUS_PENDING,
    [LEGACY_RESERVATION_STATUS_APPROVED]: RESERVATION_STATUS_APPROVED,
    [LEGACY_RESERVATION_STATUS_PAID]: RESERVATION_STATUS_PAID,
    [LEGACY_RESERVATION_STATUS_PICKED_UP]: RESERVATION_STATUS_PICKED_UP,
    [LEGACY_RESERVATION_STATUS_RETURNED]: RESERVATION_STATUS_RETURNED,
    [LEGACY_RESERVATION_STATUS_REJECTED]: RESERVATION_STATUS_REJECTED,
    [LEGACY_RESERVATION_STATUS_CANCELLED]: RESERVATION_STATUS_CANCELLED,
    [LEGACY_RESERVATION_STATUS_COMPLETED]: RESERVATION_STATUS_COMPLETED,
    canceled: RESERVATION_STATUS_CANCELLED,
    declined: RESERVATION_STATUS_REJECTED
  };

  return statusMap[normalizedStatus] || normalizedStatus;
}

function reservationStatusTranslate(key, fallback) {
  if (typeof window.rentuloTranslate === "function") {
    return window.rentuloTranslate(key);
  }

  return fallback;
}

function getReservationStatusText(status) {
  const normalizedStatus = normalizeReservationStatus(status);

  if (normalizedStatus === RESERVATION_STATUS_PENDING) {
    return reservationStatusTranslate("reservation.status.pending", "Čeká na potvrzení");
  }

  if (normalizedStatus === RESERVATION_STATUS_APPROVED) {
    return reservationStatusTranslate("reservation.status.approved", "Čeká na platbu");
  }

  if (normalizedStatus === RESERVATION_STATUS_PAID) {
    return reservationStatusTranslate("reservation.status.paid", "Zaplaceno");
  }

  if (normalizedStatus === RESERVATION_STATUS_PICKED_UP) {
    return reservationStatusTranslate("reservation.status.pickedUp", "Vyzvednuto");
  }

  if (normalizedStatus === RESERVATION_STATUS_RETURNED) {
    return reservationStatusTranslate("reservation.status.returned", "Vráceno");
  }

  if (normalizedStatus === RESERVATION_STATUS_REJECTED) {
    return reservationStatusTranslate("reservation.status.rejected", "Odmítnuto");
  }

  if (normalizedStatus === RESERVATION_STATUS_CANCELLED) {
    return reservationStatusTranslate("reservation.status.cancelled", "Zrušeno");
  }

  if (normalizedStatus === RESERVATION_STATUS_COMPLETED) {
    return reservationStatusTranslate("reservation.status.completed", "Dokončeno");
  }

  if (normalizedStatus === RESERVATION_STATUS_EXPIRED) {
    return reservationStatusTranslate("reservation.status.expired", "Vypršela lhůta");
  }

  return status || reservationStatusTranslate("reservation.status.pending", "Čeká na potvrzení");
}
function getReservationStatus(reservation) {
  if (!reservation) {
    return RESERVATION_STATUS_PENDING;
  }

  return normalizeReservationStatus(reservation.status);
}
function isOpenReservationStatus(status) {
  const normalizedStatus = normalizeReservationStatus(status);

  return OPEN_RESERVATION_STATUSES.includes(normalizedStatus);
}
function isClosedReservationStatus(status) {
  const normalizedStatus = normalizeReservationStatus(status);

  return CLOSED_RESERVATION_STATUSES.includes(normalizedStatus);
}

function isBlockingReservationStatus(status) {
  return isOpenReservationStatus(status);
}
