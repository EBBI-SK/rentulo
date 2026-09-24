



function getReservationOfferId(reservation) {
  if (!reservation) {
    return "";
  }

  return reservation.offer_id || reservation.offerId || reservation.toolId || "";
}













/*
  Dostupnosť ponúk sa už nemá počítať z localStorage.

  Aktuálny stav ponuky sa má načítať priamo zo Supabase:
  - vysledky.html používa otvorené rezervácie z tabuľky reservations,
  - detail.html kontroluje otvorenú rezerváciu v tabuľke reservations.

  Tieto staré funkcie nechávame iba kvôli kompatibilite so stránkami,
  ktoré ich ešte môžu volať. Už však nesiahajú do lokálnych rezervácií.
*/

function isOfferCurrentlyReserved(offer) {
  if (!offer) {
    return false;
  }

  if (offer.isReserved === true) {
    return true;
  }

  if (offer.hasOpenReservation === true) {
    return true;
  }

  if (offer.reserved === true) {
    return true;
  }

  return false;
}

function getReservationDateFrom(reservation) {
  if (!reservation) {
    return "";
  }

  return reservation.start_date || reservation.startDate || reservation.dateFrom || "";
}

function getReservationDateTo(reservation) {
  if (!reservation) {
    return "";
  }

  return reservation.end_date || reservation.endDate || reservation.dateTo || "";
}

function getReservationTotalPrice(reservation) {
  if (!reservation) {
    return 0;
  }

  return Number(
    reservation.total_price ||
    reservation.totalPrice ||
    reservation.price ||
    reservation.pricePerDay ||
    0
  );
}

function getReservationContactVisible(status) {
  const normalizedStatus = normalizeReservationStatus(status);

  return (
    normalizedStatus === RESERVATION_STATUS_PAID ||
    normalizedStatus === RESERVATION_STATUS_PICKED_UP ||
    normalizedStatus === RESERVATION_STATUS_RETURNED
  );
}

function canOwnerApproveReservation(reservation) {
  return getReservationStatus(reservation) === RESERVATION_STATUS_PENDING;
}

function canOwnerRejectReservation(reservation) {
  return getReservationStatus(reservation) === RESERVATION_STATUS_PENDING;
}

function canRenterPayReservation(reservation) {
  return getReservationStatus(reservation) === RESERVATION_STATUS_APPROVED;
}

function canRenterCancelReservation(reservation) {
  const status = getReservationStatus(reservation);

  return (
    status === RESERVATION_STATUS_PENDING ||
    status === RESERVATION_STATUS_APPROVED
  );
}

function canOwnerCancelReservation(reservation) {
  return getReservationStatus(reservation) === RESERVATION_STATUS_APPROVED;
}

function canOwnerConfirmPickedUpReservation(reservation) {
  return getReservationStatus(reservation) === RESERVATION_STATUS_PAID;
}

function canOwnerConfirmReturnedReservation(reservation) {
  return getReservationStatus(reservation) === RESERVATION_STATUS_PICKED_UP;
}

const RESERVATION_CANCEL_CUTOFF_COPY = {
  cs: "Rezervaci lze zrušit pouze více než 6 hodin před převzetím.",
  sk: "Rezerváciu možno zrušiť iba viac ako 6 hodín pred prevzatím.",
  en: "This reservation can only be cancelled more than 6 hours before pickup.",
  de: "Diese Reservierung kann nur mehr als 6 Stunden vor der Abholung storniert werden.",
  pl: "Rezerwację można anulować tylko ponad 6 godzin przed odbiorem."
};

function getReservationCancellationCutoffAt(reservation) {
  if (!reservation) {
    return null;
  }

  const value =
    reservation.cancellation_cutoff_at ||
    reservation.cancellationCutoffAt ||
    "";

  if (!value) {
    return null;
  }

  const cutoff = new Date(value);

  return Number.isNaN(cutoff.getTime()) ? null : cutoff;
}

function isReservationCancellationWindowOpen(reservation, nowValue) {
  if (
    !canRenterCancelReservation(reservation) &&
    !canOwnerCancelReservation(reservation)
  ) {
    return false;
  }

  const cutoff = getReservationCancellationCutoffAt(reservation);

  if (!cutoff) {
    return true;
  }

  const now = nowValue instanceof Date
    ? nowValue
    : new Date(nowValue === undefined ? Date.now() : nowValue);

  if (Number.isNaN(now.getTime())) {
    return false;
  }

  return now.getTime() < cutoff.getTime();
}

function getReservationCancellationCutoffText() {
  const language = typeof window !== "undefined" && typeof window.getRentuloLanguage === "function"
    ? window.getRentuloLanguage()
    : "cs";

  return RESERVATION_CANCEL_CUTOFF_COPY[language] || RESERVATION_CANCEL_CUTOFF_COPY.cs;
}

function escapeReservationCancellationText(value) {
  return String(value === undefined || value === null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getReservationCancelButtonText() {
  if (typeof window !== "undefined" && typeof window.reservationsTranslate === "function") {
    return window.reservationsTranslate("reservations.cancel", "Zrušit rezervaci");
  }

  return "Zrušit rezervaci";
}

function renderLockedReservationCancellationAction() {
  const explanation = getReservationCancellationCutoffText();

  return `
    <div class="reservation-detail-actions">
      <button
        type="button"
        class="small-button reservation-cancel-action reservation-cancel-locked"
        disabled
        aria-disabled="true"
        title="${escapeReservationCancellationText(explanation)}"
      >
        ${escapeReservationCancellationText(getReservationCancelButtonText())}
      </button>
      <div class="reservation-cancel-cutoff-note">
        ${escapeReservationCancellationText(explanation)}
      </div>
    </div>
  `;
}

function disableReservationCancellationButton(button) {
  if (!button || button.disabled) {
    return;
  }

  const explanation = getReservationCancellationCutoffText();

  button.disabled = true;
  button.classList.add("reservation-cancel-locked");
  button.setAttribute("aria-disabled", "true");
  button.setAttribute("title", explanation);
  button.removeAttribute("data-reservations-action");

  const actions = button.closest(".reservation-detail-actions");

  if (actions && !actions.querySelector(".reservation-cancel-cutoff-note")) {
    const note = document.createElement("div");
    note.className = "reservation-cancel-cutoff-note";
    note.textContent = explanation;
    actions.appendChild(note);
  }
}

function scheduleReservationCancellationCutoff(button) {
  if (!button || button.disabled) {
    return;
  }

  const cutoffMs = Number(button.dataset.cancelCutoff);

  if (!Number.isFinite(cutoffMs)) {
    return;
  }

  const remaining = cutoffMs - Date.now();

  if (remaining <= 0) {
    disableReservationCancellationButton(button);
    return;
  }

  if (button.dataset.cancelCutoffScheduled === "true") {
    return;
  }

  button.dataset.cancelCutoffScheduled = "true";

  window.setTimeout(function () {
    if (!button.isConnected) {
      return;
    }

    delete button.dataset.cancelCutoffScheduled;

    if (Date.now() >= cutoffMs) {
      disableReservationCancellationButton(button);
      return;
    }

    scheduleReservationCancellationCutoff(button);
  }, Math.min(remaining + 50, 2147483647));
}

function refreshReservationCancellationCutoffs() {
  if (typeof document === "undefined") {
    return;
  }

  document
    .querySelectorAll('[data-reservations-action="cancel"][data-cancel-cutoff]')
    .forEach(scheduleReservationCancellationCutoff);
}

function installReservationCancellationCutoffUi() {
  if (typeof window.normalizeSupabaseReservation === "function") {
    const originalNormalizeSupabaseReservation = window.normalizeSupabaseReservation;

    window.normalizeSupabaseReservation = function (row) {
      const reservation = originalNormalizeSupabaseReservation(row);

      reservation.pickupTime = row && row.pickup_time ? row.pickup_time : "";
      reservation.cancellationCutoffAt = row && row.cancellation_cutoff_at
        ? row.cancellation_cutoff_at
        : "";

      return reservation;
    };
  }

  if (typeof window.renderReservationDetailActions === "function") {
    const originalRenderReservationDetailActions = window.renderReservationDetailActions;

    window.renderReservationDetailActions = function (reservation, status) {
      if (!canRenterCancelReservation(reservation)) {
        return originalRenderReservationDetailActions(reservation, status);
      }

      const cutoff = getReservationCancellationCutoffAt(reservation);

      if (!cutoff) {
        return originalRenderReservationDetailActions(reservation, status);
      }

      if (!isReservationCancellationWindowOpen(reservation)) {
        return renderLockedReservationCancellationAction();
      }

      const html = originalRenderReservationDetailActions(reservation, status);
      const cutoffMs = cutoff.getTime();
      const updatedHtml = html.replace(
        'data-reservations-action="cancel"',
        'data-reservations-action="cancel" data-cancel-cutoff="' + cutoffMs + '"'
      );

      window.setTimeout(refreshReservationCancellationCutoffs, 0);

      return updatedHtml;
    };
  }

  const style = document.createElement("style");
  style.textContent = `
    .small-button.reservation-cancel-action.reservation-cancel-locked,
    .small-button.reservation-cancel-action.reservation-cancel-locked:hover {
      background: #f2f4f3 !important;
      color: #7a8580 !important;
      border-color: #d5dcda !important;
      cursor: not-allowed !important;
      opacity: 0.72;
    }

    .reservation-cancel-cutoff-note {
      width: 100%;
      margin-top: 7px;
      font-size: 12px;
      line-height: 1.35;
      font-weight: 700;
      color: #68746f;
    }
  `;
  document.head.appendChild(style);

  document.addEventListener(
    "click",
    function (event) {
      const button = event.target.closest(
        '[data-reservations-action="cancel"][data-cancel-cutoff]'
      );

      if (!button) {
        return;
      }

      const cutoffMs = Number(button.dataset.cancelCutoff);

      if (!Number.isFinite(cutoffMs) || Date.now() < cutoffMs) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      disableReservationCancellationButton(button);
    },
    true
  );
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  document.addEventListener("DOMContentLoaded", function () {
    installReservationCancellationCutoffUi();
  });
}
