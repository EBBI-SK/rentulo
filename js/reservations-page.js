const RESERVATIONS_LOCALES = {
  cs: "cs-CZ",
  sk: "sk-SK",
  en: "en-GB",
  de: "de-DE",
  pl: "pl-PL"
};

const RESERVATION_SCHEDULE_COPY = {
  cs: { pickup: "Převzetí", return: "Vrácení", at: "v" },
  sk: { pickup: "Prevzatie", return: "Vrátenie", at: "o" },
  en: { pickup: "Pickup", return: "Return", at: "at" },
  de: { pickup: "Abholung", return: "Rückgabe", at: "um" },
  pl: { pickup: "Odbiór", return: "Zwrot", at: "o" }
};

function reservationsTranslate(key, fallback, values) {
  let text = typeof window.rentuloTranslate === "function"
    ? window.rentuloTranslate(key)
    : fallback;

  if (text === key) {
    text = fallback;
  }

  if (values && typeof values === "object") {
    Object.keys(values).forEach(function (name) {
      text = String(text).replaceAll("{" + name + "}", String(values[name]));
    });
  }

  return text;
}

function getReservationsLocale() {
  const language = typeof window.getRentuloLanguage === "function"
    ? window.getRentuloLanguage()
    : "cs";

  return RESERVATIONS_LOCALES[language] || RESERVATIONS_LOCALES.cs;
}

function formatReservationsNumber(value) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return String(value === undefined || value === null ? "" : value);
  }

  return numberValue.toLocaleString(getReservationsLocale());
}

function formatReservationsMoney(value) {
  return formatReservationsNumber(value) + " Kč";
}

function formatReservationsDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString(getReservationsLocale());
}

function formatReservationsDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString(getReservationsLocale());
}

function getReservationScheduleCopy() {
  const language = typeof window.getRentuloLanguage === "function"
    ? window.getRentuloLanguage()
    : "cs";

  return RESERVATION_SCHEDULE_COPY[language] || RESERVATION_SCHEDULE_COPY.cs;
}

function formatReservationsTime(value) {
  const match = String(value || "").match(
    /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/
  );

  return match ? match[1] + ":" + match[2] : "";
}

function formatReservationScheduleValue(dateValue, timeValue) {
  const dateText = formatReservationsDate(dateValue);
  const timeText = formatReservationsTime(timeValue);

  if (!timeText) {
    return dateText;
  }

  return dateText + " " + getReservationScheduleCopy().at + " " + timeText;
}

  const PLATFORM_FEE_PERCENT = 10;
    let supabaseReservations = [];
    let reservationsLoadState = "idle";
    let reservationsNoticeTimer = null;

    function showReservationsNotice(message, type = "success") {
      const notice = document.getElementById("reservationsNotice");

      if (!notice) {
        return;
      }

      if (reservationsNoticeTimer) {
        window.clearTimeout(reservationsNoticeTimer);
      }

      const isError = type === "error";

      notice.textContent = message;
      notice.classList.toggle("error", isError);
      notice.setAttribute("role", isError ? "alert" : "status");
      notice.hidden = false;
      reservationsNoticeTimer = window.setTimeout(function () {
        notice.hidden = true;
        reservationsNoticeTimer = null;
      }, 4500);
    }

    async function sendReservationEmailSafely(reservationId, eventType) {
      if (!reservationId || !eventType) {
        return;
      }

      if (typeof window.apiSendReservationEmail === "function") {
        await window.apiSendReservationEmail(reservationId, eventType);
        return;
      }

      const supabaseClient = getSupabaseClient();

      if (!supabaseClient) {
        console.warn("E-mailové upozornění nebylo odesláno: Supabase není dostupný.");
        return;
      }

      try {
        const { error } = await supabaseClient.functions.invoke(
          "send-reservation-email",
          {
            body: {
              reservation_id: reservationId,
              event: eventType
            }
          }
        );

        if (error) {
          console.warn("E-mailové upozornění se nepodařilo odeslat:", error);
        }
      } catch (error) {
        console.warn("E-mailové upozornění se nepodařilo odeslat:", error);
      }
    }

    function getSafeReservationStatusText(status) {
      if (normalizeReservationStatus(status) === RESERVATION_STATUS_PICKED_UP) {
        return reservationsTranslate("reservations.status.pickedUp", "Převzato");
      }

      if (typeof getReservationStatusText === "function") {
        return getReservationStatusText(status);
      }

      if (normalizeReservationStatus(status) === RESERVATION_STATUS_PENDING) {
        return "Čeká na potvrzení";
      }

      if (normalizeReservationStatus(status) === RESERVATION_STATUS_APPROVED) {
        return "Čeká na platbu";
      }

      if (
  normalizeReservationStatus(status) ===
  RESERVATION_STATUS_PAID
) {
  return "Zaplaceno";
}

      if (normalizeReservationStatus(status) === RESERVATION_STATUS_PICKED_UP) {
        return "Vyzvednuto";
      }

      if (normalizeReservationStatus(status) === RESERVATION_STATUS_RETURNED) {
        return "Vráceno";
      }

      if (normalizeReservationStatus(status) === RESERVATION_STATUS_REJECTED) {
        return "Odmítnuto";
      }

      if (
  normalizeReservationStatus(status) ===
  RESERVATION_STATUS_CANCELLED
) {
  return "Zrušeno";
}

      return status || "Čeká na potvrzení";
    }

    function normalizeSupabaseReservation(row) {
      return {
        id: row.id,
        reservationId: row.id,

        offerId: row.offer_id,
        toolId: row.offer_id,

        ownerId: row.owner_id,
        renterId: row.renter_id,

        toolName: row.offer_name || "",
offerName: row.offer_name || "",

category: row.category || reservationsTranslate("reservations.fallback.other", "Ostatní"),
        city: row.city || "",

        pricePerDay: Number(row.price_per_day || 0),
        price: Number(row.price_per_day || 0),

        startDate: row.start_date || row.date_from,
        endDate: row.end_date || row.date_to,
        dateFrom: row.start_date || row.date_from,
        dateTo: row.end_date || row.date_to,
        pickupTime: row.pickup_time || "",

        totalDays: Number(row.total_days || row.days || 0),
        days: Number(row.total_days || row.days || 0),
        totalPrice: Number(row.total_price || 0),

        platformFeePercent: Number(row.platform_fee_percent || PLATFORM_FEE_PERCENT),
        platformFeeAmount: Number(row.platform_fee_amount || 0),
        ownerPayout: Number(row.owner_payout || 0),

        renterName: row.renter_name || "",
        renterEmail: row.renter_email || "",
        renterPhone: row.renter_phone || "",

        ownerName: row.owner_name || "",
        ownerEmail: row.owner_email || "",
        ownerPhone: row.owner_phone || "",

        pickupPhone: row.pickup_phone || row.owner_phone || "",
        pickupStreet: row.pickup_street || "",
        pickupCity: row.pickup_city || row.city || "",
        pickupPostalCode: row.pickup_postal_code || "",
        pickupFullAddress: row.pickup_full_address || "",
        pickupNote: row.pickup_note || "",
pickupLatitude:
  row.pickup_latitude !== null &&
  row.pickup_latitude !== undefined &&
  Number.isFinite(Number(row.pickup_latitude))
    ? Number(row.pickup_latitude)
    : null,

pickupLongitude:
  row.pickup_longitude !== null &&
  row.pickup_longitude !== undefined &&
  Number.isFinite(Number(row.pickup_longitude))
    ? Number(row.pickup_longitude)
    : null,
        status: row.status || "pending",
        statusText: getSafeReservationStatusText(row.status || "pending"),

        contactVisibleAfterPayment: Boolean(row.contact_visible_after_payment),

        paidAt: row.paid_at || "",
        paymentProviderStatus: row.payment_provider_status || "",

        createdAt: row.created_at || "",
        updatedAt: row.updated_at || "",

        photoUrl: row.photo_url || "",
        photo_url: row.photo_url || "",

        source: "supabase"
      };
    }

    async function loadMyReservationsFromSupabase(supabaseUser) {
      const supabaseClient = getSupabaseClient();

      if (!supabaseClient) {
        reservationsLoadState = "error";
        return [];
      }

      if (!supabaseUser) {
        reservationsLoadState = "redirecting";
        window.location.href = "prihlaseni.html";
        return [];
      }

      if (typeof window.getRentuloReservationsData !== "function") {
        reservationsLoadState = "error";
        console.error("Shared reservation data loader is unavailable.");
        return [];
      }

      const { data: reservationsData, error } =
        await window.getRentuloReservationsData();

      if (error) {
        console.error(error);
        reservationsLoadState = "error";
        return [];
      }

const data = Array.isArray(reservationsData)
  ? reservationsData.filter(function (reservation) {
      return reservation.renter_id === supabaseUser.id;
    })
  : [];

      reservationsLoadState = "ready";

      return Array.isArray(data)
        ? data.map(normalizeSupabaseReservation)
        : [];
    }

    function getSafeReservationStatus(reservation) {
      if (typeof getReservationStatus === "function") {
        return getReservationStatus(reservation);
      }

      return reservation.status || "pending";
    }

    function getSafeReservationToolName(reservation) {
      return (
        reservation.offer_name ||
        reservation.toolName ||
        reservation.offerName ||
        reservationsTranslate("reservations.fallback.item", "Věc")
      );
    }

    function getSafeReservationDateFrom(reservation) {
      if (typeof getReservationDateFrom === "function") {
        return getReservationDateFrom(reservation);
      }

      return reservation.startDate || reservation.dateFrom || "";
    }

    function getSafeReservationDateTo(reservation) {
      if (typeof getReservationDateTo === "function") {
        return getReservationDateTo(reservation);
      }

      return reservation.endDate || reservation.dateTo || "";
    }

    function getSafeReservationOfferId(reservation) {
      if (typeof getReservationOfferId === "function") {
        return getReservationOfferId(reservation);
      }

      return reservation.offerId || reservation.toolId || "";
    }

    function getSafeReservationTotalPrice(reservation) {
      if (typeof getReservationTotalPrice === "function") {
        return getReservationTotalPrice(reservation);
      }

      const totalPrice = Number(reservation.totalPrice || 0);

      if (totalPrice > 0) {
        return totalPrice;
      }

      const days = Number(reservation.totalDays || reservation.days || 0);
      const pricePerDay = Number(reservation.pricePerDay || reservation.price || 0);

      return days * pricePerDay;
    }

    function safeIsOpenReservationStatus(status) {
      return isOpenReservationStatus(status);
    }

    function getSafeReservationContactVisible(status) {
      return getReservationContactVisible(status);
    }

    function isMapUsefulForStatus(status) {
      const normalizedStatus = normalizeReservationStatus(status);

return (
  normalizedStatus === RESERVATION_STATUS_PAID ||
  normalizedStatus === RESERVATION_STATUS_PICKED_UP
);
    }

    function getReservationOwnerName(reservation) {
      return (
        reservation.owner_name ||
        reservation.ownerName ||
        reservation.owner ||
        reservationsTranslate("reservations.fallback.owner", "Majitel")
      );
    }

    function getPickupAddress(reservation) {
      return (
        reservation.pickupFullAddress ||
        [reservation.pickupStreet, reservation.pickupCity, reservation.pickupPostalCode].filter(Boolean).join(", ") ||
        [reservation.ownerStreet, reservation.ownerCity, reservation.ownerPostalCode].filter(Boolean).join(", ")
      );
    }

    function getPickupPhone(reservation) {
      return reservation.pickupPhone || reservation.ownerPhone || "";
    }

    function getPickupCity(reservation) {
      return reservation.pickupCity || reservation.ownerCity || reservation.city || "-";
    }

    function getMapUrl(address, latitude, longitude) {
  const hasCoordinates =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude);

  const destination = hasCoordinates
    ? `${latitude},${longitude}`
    : address;

  return "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent(destination);
}

    function getReservationPhoto(reservation) {
      if (!reservation) {
        return "";
      }

      return (
        reservation.photoUrl ||
        reservation.photo_url ||
        reservation.image ||
        ""
      );
    }

    function renderToolThumb(reservation) {
      const toolName = getSafeReservationToolName(reservation);
      const photo = getReservationPhoto(reservation);

      if (photo) {
        return `
          <div class="tool-thumb tool-image">
            <img src="${escapeHtml(photo)}" alt="${escapeHtml(toolName)}" loading="lazy" decoding="async">
          </div>
        `;
      }
      return `
        <div class="tool-thumb tool-image">⌁</div>
      `;
    }

    function renderEmptyState() {
      document.getElementById("reservationsList").innerHTML = `
        <section class="account-empty-state">
          <h2>${escapeHtml(reservationsTranslate("reservations.empty.title", "Zatím nemáte žádné rezervace."))}</h2>
          <p>${escapeHtml(reservationsTranslate("reservations.empty.description", "Najděte věc ve svém okolí a pošlete první žádost o půjčení."))}</p>
        </section>
      `;
    }

    function renderLoadingState() {
      document.getElementById("reservationsList").innerHTML = `
        <section class="account-empty-state">
          <h2>${escapeHtml(reservationsTranslate("reservations.loading.title", "Načítám rezervace..."))}</h2>
          <p>${escapeHtml(reservationsTranslate("reservations.loading.description", "Chvíli strpení, načítáme vaše rezervace ze Supabase."))}</p>
        </section>
      `;
    }

    function renderLoadErrorState() {
      document.getElementById("reservationsList").innerHTML = `
        <section class="account-empty-state">
          <h2>${escapeHtml(reservationsTranslate("reservations.loadError.title", "Rezervace se nepodařilo načíst."))}</h2>
          <p>${escapeHtml(reservationsTranslate("reservations.loadError.description", "Obnovte stránku nebo zkuste načtení znovu."))}</p>
          <button class="reservation-primary-action" type="button" data-reservations-action="retry-load">
            ${escapeHtml(reservationsTranslate("reservations.loadError.retry", "Zkusit znovu"))}
          </button>
        </section>
      `;
    }

    async function retryLoadReservations() {
      reservationsLoadState = "loading";
      renderLoadingState();

      if (typeof window.invalidateRentuloReservationsData === "function") {
        window.invalidateRentuloReservationsData();
      }

      const verifiedUser = await window.rentuloAuthGuard.requireUser();

      if (!verifiedUser) {
        return;
      }

      supabaseReservations = await loadMyReservationsFromSupabase(verifiedUser);

      if (typeof window.refreshRentuloNotificationBadge === "function") {
        await window.refreshRentuloNotificationBadge();
      }

      if (reservationsLoadState === "ready") {
        renderReservations();
      } else if (reservationsLoadState === "error") {
        renderLoadErrorState();
      }
    }

    let reservationCancelModalResolve = null;
    let reservationCancelModalReservation = null;
    let reservationCancelModalReturnFocus = null;

    function getReservationCancelModalElements() {
      return {
        overlay: document.getElementById("reservationCancelModal"),
        title: document.getElementById("reservationCancelModalTitle"),
        description: document.getElementById("reservationCancelModalDescription"),
        keepButton: document.querySelector('[data-reservations-cancel-modal-action="keep"]'),
        confirmButton: document.querySelector('[data-reservations-cancel-modal-action="confirm"]')
      };
    }

    function refreshReservationCancelModalText() {
      if (!reservationCancelModalReservation) {
        return;
      }

      const elements = getReservationCancelModalElements();
      const startDate = formatReservationsDate(
        getSafeReservationDateFrom(reservationCancelModalReservation)
      );
      const endDate = formatReservationsDate(
        getSafeReservationDateTo(reservationCancelModalReservation)
      );

      if (elements.title) {
        elements.title.textContent = reservationsTranslate(
          "reservations.cancelModal.title",
          "Zrušit rezervaci?"
        );
      }

      if (elements.description) {
        elements.description.textContent = reservationsTranslate(
          "reservations.cancelModal.description",
          "Opravdu chcete tuto rezervaci zrušit? Termín {startDate} – {endDate} se znovu uvolní.",
          { startDate: startDate, endDate: endDate }
        );
      }

      if (elements.keepButton) {
        elements.keepButton.textContent = reservationsTranslate(
          "reservations.cancelModal.keep",
          "Ponechat rezervaci"
        );
      }

      if (elements.confirmButton) {
        elements.confirmButton.textContent = reservationsTranslate(
          "reservations.cancel",
          "Zrušit rezervaci"
        );
      }
    }

    function closeReservationCancelModal(confirmed) {
      const elements = getReservationCancelModalElements();

      if (!elements.overlay || elements.overlay.hidden) {
        return;
      }

      if (elements.overlay.contains(document.activeElement)) {
        const activeElement = document.activeElement;

        if (activeElement && typeof activeElement.blur === "function") {
          activeElement.blur();
        }
      }

      elements.overlay.hidden = true;
      elements.overlay.setAttribute("aria-hidden", "true");
      document.body.classList.remove("reservation-modal-open");

      const resolve = reservationCancelModalResolve;
      const returnFocus = reservationCancelModalReturnFocus;

      reservationCancelModalResolve = null;
      reservationCancelModalReservation = null;
      reservationCancelModalReturnFocus = null;

      if (resolve) {
        resolve(Boolean(confirmed));
      }

      if (!confirmed && returnFocus && returnFocus.isConnected && typeof returnFocus.focus === "function") {
        requestAnimationFrame(function () {
          if (returnFocus.isConnected) {
            returnFocus.focus();
          }
        });
      }
    }

    function openReservationCancelModal(reservation) {
      const elements = getReservationCancelModalElements();

      if (!elements.overlay) {
        console.error("Reservation cancellation modal is missing.");
        return Promise.resolve(false);
      }

      reservationCancelModalReservation = reservation;
      reservationCancelModalReturnFocus = document.activeElement;
      refreshReservationCancelModalText();

      elements.overlay.hidden = false;
      elements.overlay.setAttribute("aria-hidden", "false");
      document.body.classList.add("reservation-modal-open");

      return new Promise(function (resolve) {
        reservationCancelModalResolve = resolve;

        requestAnimationFrame(function () {
          if (elements.keepButton) {
            elements.keepButton.focus();
          }
        });
      });
    }

    function initializeReservationCancelModal() {
      const elements = getReservationCancelModalElements();

      if (!elements.overlay) {
        return;
      }

      elements.overlay.addEventListener("click", function (event) {
        const actionButton = event.target.closest(
          "[data-reservations-cancel-modal-action]"
        );

        if (actionButton) {
          closeReservationCancelModal(
            actionButton.dataset.reservationsCancelModalAction === "confirm"
          );
          return;
        }

        if (event.target === elements.overlay) {
          closeReservationCancelModal(false);
        }
      });

      document.addEventListener("keydown", function (event) {
        if (elements.overlay.hidden) {
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          closeReservationCancelModal(false);
          return;
        }

        if (event.key !== "Tab") {
          return;
        }

        const focusable = [elements.keepButton, elements.confirmButton].filter(Boolean);

        if (focusable.length < 2) {
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      });
    }

    let reservationPaymentModalResolve = null;
    let reservationPaymentModalReturnFocus = null;

    function getReservationPaymentModalElements() {
      return {
        overlay: document.getElementById("reservationPaymentModal"),
        title: document.getElementById("reservationPaymentModalTitle"),
        description: document.getElementById("reservationPaymentModalDescription"),
        cancelButton: document.querySelector('[data-reservations-payment-modal-action="cancel"]'),
        confirmButton: document.querySelector('[data-reservations-payment-modal-action="confirm"]')
      };
    }

    function refreshReservationPaymentModalText() {
      const elements = getReservationPaymentModalElements();

      if (elements.title) {
        elements.title.textContent = reservationsTranslate(
          "reservations.paymentModal.title",
          "Potvrdit testovac\u00ed platbu?"
        );
      }

      if (elements.description) {
        elements.description.textContent = reservationsTranslate(
          "reservations.paymentModal.description",
          "Jde o testovac\u00ed platbu. Po potvrzen\u00ed bude rezervace ozna\u010dena jako zaplacen\u00e1."
        );
      }

      if (elements.cancelButton) {
        elements.cancelButton.textContent = reservationsTranslate(
          "reservations.paymentModal.cancel",
          "Zp\u011bt"
        );
      }

      if (elements.confirmButton) {
        elements.confirmButton.textContent = reservationsTranslate(
          "reservations.paymentModal.confirm",
          "Potvrdit platbu"
        );
      }
    }

    function closeReservationPaymentModal(confirmed) {
      const elements = getReservationPaymentModalElements();

      if (!elements.overlay || elements.overlay.hidden) {
        return;
      }

      if (elements.overlay.contains(document.activeElement)) {
        const activeElement = document.activeElement;

        if (activeElement && typeof activeElement.blur === "function") {
          activeElement.blur();
        }
      }

      elements.overlay.hidden = true;
      elements.overlay.setAttribute("aria-hidden", "true");
      document.body.classList.remove("reservation-modal-open");

      const resolve = reservationPaymentModalResolve;
      const returnFocus = reservationPaymentModalReturnFocus;

      reservationPaymentModalResolve = null;
      reservationPaymentModalReturnFocus = null;

      if (resolve) {
        resolve(Boolean(confirmed));
      }

      if (!confirmed && returnFocus && returnFocus.isConnected && typeof returnFocus.focus === "function") {
        requestAnimationFrame(function () {
          if (returnFocus.isConnected) {
            returnFocus.focus();
          }
        });
      }
    }

    function openReservationPaymentModal() {
      const elements = getReservationPaymentModalElements();

      if (!elements.overlay) {
        console.error("Payment confirmation modal is missing.");
        return Promise.resolve(false);
      }

      reservationPaymentModalReturnFocus = document.activeElement;
      refreshReservationPaymentModalText();

      elements.overlay.hidden = false;
      elements.overlay.setAttribute("aria-hidden", "false");
      document.body.classList.add("reservation-modal-open");

      return new Promise(function (resolve) {
        reservationPaymentModalResolve = resolve;

        requestAnimationFrame(function () {
          if (elements.cancelButton) {
            elements.cancelButton.focus();
          }
        });
      });
    }

    function initializeReservationPaymentModal() {
      const elements = getReservationPaymentModalElements();

      if (!elements.overlay) {
        return;
      }

      elements.overlay.addEventListener("click", function (event) {
        const actionButton = event.target.closest(
          "[data-reservations-payment-modal-action]"
        );

        if (actionButton) {
          closeReservationPaymentModal(
            actionButton.dataset.reservationsPaymentModalAction === "confirm"
          );
          return;
        }

        if (event.target === elements.overlay) {
          closeReservationPaymentModal(false);
        }
      });

      document.addEventListener("keydown", function (event) {
        if (elements.overlay.hidden) {
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          closeReservationPaymentModal(false);
          return;
        }

        if (event.key !== "Tab") {
          return;
        }

        const focusable = [elements.cancelButton, elements.confirmButton].filter(Boolean);

        if (focusable.length < 2) {
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      });
    }

    async function cancelReservation(reservationId) {
      const supabaseClient = getSupabaseClient();

      if (!supabaseClient) {
        showReservationsNotice(reservationsTranslate("reservations.error.supabase", "Služba je dočasně nedostupná. Obnovte stránku."), "error");
        return;
      }

      const supabaseUser = await getCurrentSupabaseUser();

      if (!supabaseUser) {
        showReservationsNotice(reservationsTranslate("reservations.error.loginCancel", "Pro zrušení rezervace se musíte znovu přihlásit."), "error");
        window.location.href = "prihlaseni.html";
        return;
      }

      const reservation = supabaseReservations.find(function (item) {
        return String(item.id || item.reservationId) === String(reservationId);
      });

      if (!reservation) {
        showReservationsNotice(reservationsTranslate("reservations.error.notFound", "Rezervace nebyla nalezena."), "error");
        return;
      }

      const normalizedStatus = normalizeReservationStatus(
        getSafeReservationStatus(reservation)
      );

      if (
        normalizedStatus !== RESERVATION_STATUS_PENDING &&
        normalizedStatus !== RESERVATION_STATUS_APPROVED
      ) {
        showReservationsNotice(reservationsTranslate("reservations.error.cannotCancel", "Tuto rezervaci už nelze běžně zrušit."), "error");
        return;
      }

      const confirmed = await openReservationCancelModal(reservation);

      if (!confirmed) {
        return;
      }

      const { error } = await supabaseClient
  .rpc("change_my_reservation_status", {
    p_reservation_id: reservationId,
    p_new_status: "cancelled"
  });

      if (error) {
        console.error("Rezervaci se nepodařilo zrušit:", error);
        showReservationsNotice(reservationsTranslate("reservations.error.cancel", "Rezervaci se nepodařilo zrušit. Zkuste to prosím znovu."), "error");
        return;
      }

      await sendReservationEmailSafely(reservationId, "cancelled");
      await retryLoadReservations();

      showReservationsNotice(
        reservationsTranslate(
          "reservations.success.cancelled",
          "Rezervace byla zrušena a přesunuta do Historie."
        )
      );
    }

    async function payReservation(reservationId) {
      const supabaseClient = getSupabaseClient();

      if (!supabaseClient) {
        showReservationsNotice(reservationsTranslate("reservations.error.supabase", "Služba je dočasně nedostupná. Obnovte stránku."), "error");
        return;
      }

      const supabaseUser = await getCurrentSupabaseUser();

      if (!supabaseUser) {
        showReservationsNotice(reservationsTranslate("reservations.error.loginPay", "Pro zaplacení se musíte znovu přihlásit."), "error");
        window.location.href = "prihlaseni.html";
        return;
      }

      const confirmPayment = await openReservationPaymentModal();

      if (!confirmPayment) {
        return;
      }

      const { data: paidReservations, error } = await supabaseClient
  .rpc("mark_my_reservation_paid_test", {
    p_reservation_id: reservationId
  });

const data = Array.isArray(paidReservations)
  ? paidReservations[0] || null
  : paidReservations || null;

      if (error) {
        console.error(error);
        showReservationsNotice(reservationsTranslate("reservations.error.payment", "Platbu se nepodařilo dokončit. Zkuste to prosím znovu."), "error");
        return;
      }

      

        

      if (data) {
        await sendReservationEmailSafely(reservationId, "paid");
      }

      await retryLoadReservations();

      if (reservationsLoadState === "ready") {
        openReservationDetail(reservationId);
      }
    }

    function openReservationDetail(reservationId) {
      setTimeout(function () {
        const detail = document.getElementById("reservation-detail-" + reservationId);

        if (detail) {
          detail.classList.add("open");
        }

        const button = document.getElementById("detail-toggle-" + reservationId);

        if (button) {
          button.textContent = reservationsTranslate("reservations.hideDetail", "Skrýt detail");
        }
      }, 0);
    }

    function toggleReservationDetail(reservationId, button) {
      const detail = document.getElementById("reservation-detail-" + reservationId);

      if (!detail) {
        return;
      }

      const isOpen = detail.classList.contains("open");

      if (isOpen) {
        detail.classList.remove("open");
        button.textContent = reservationsTranslate("home.mapOpenDetail", "Zobrazit detail");
        return;
      }

      detail.classList.add("open");
      button.textContent = reservationsTranslate("reservations.hideDetail", "Skrýt detail");
    }

    function renderPaymentBox(reservation, status) {
      if (normalizeReservationStatus(status) === RESERVATION_STATUS_APPROVED) {
        return `
          <div class="payment-box waiting">
            <strong>${escapeHtml(reservationsTranslate("reservations.payment.platformTitle", "Platba přes provozovatele platformy"))}</strong>
            ${escapeHtml(reservationsTranslate("reservations.payment.testInfo", "Kliknutím na tlačítko Zaplatit provedete testovací platbu."))}
          </div>
        `;
      }

      if (getSafeReservationContactVisible(status)) {
        const paymentTitle = reservationsTranslate(
          "reservations.payment.accepted",
          "Platba byla přijata"
        );
        const paymentStatus =
          reservation.paymentProviderStatus === "paid_test"
            ? reservationsTranslate("reservations.payment.statusPaidTest", "Testovací platba")
            : reservationsTranslate("reservations.payment.statusPaid", "Zaplaceno");

        return `
          <div class="payment-box paid">
            <strong>${escapeHtml(paymentTitle)}</strong>
            <div class="payment-lines">
              <span>${escapeHtml(paymentStatus)}</span>
              <span>${escapeHtml(reservationsTranslate("reservations.payment.paidAt", "Zaplaceno"))}: ${escapeHtml(formatReservationsDateTime(reservation.paidAt))}</span>
            </div>
          </div>
        `;
      }

      return "";
    }

    function renderReservationStateBox(reservation, status) {
      if (normalizeReservationStatus(status) === RESERVATION_STATUS_PENDING) {
        return "";
      }

      if (normalizeReservationStatus(status) === RESERVATION_STATUS_APPROVED) {
        return `
          <div class="reservation-state-box active">
            <strong>${escapeHtml(reservationsTranslate("reservations.state.approvedTitle", "žádost je potvrzená"))}</strong>
            ${escapeHtml(reservationsTranslate("reservations.state.approvedText", "Teď můžete dokončit platbu. Po zaplacení se zobrazí jméno majitele, telefon a přesná adresa."))}
          </div>
        `;
      }

      if (normalizeReservationStatus(status) === RESERVATION_STATUS_PAID) {
        return `
          <div class="reservation-state-box active">
            <strong>${escapeHtml(reservationsTranslate("reservations.state.paidTitle", "Zaplaceno – domluvte se s majitelem na předání"))}</strong>
            ${escapeHtml(reservationsTranslate("reservations.state.paidText", "Kontaktujte majitele a domluvte si přesný čas vyzvednutí."))}
          </div>
        `;
      }

      if (normalizeReservationStatus(status) === RESERVATION_STATUS_PICKED_UP) {
        return `
          <div class="reservation-state-box active">
            <strong>${escapeHtml(reservationsTranslate("reservations.state.pickedTitle", "Věc byla převzata"))}</strong>
            ${escapeHtml(reservationsTranslate("reservations.state.pickedText", "Půjčení právě probíhá."))}
          </div>
        `;
      }

      return "";
    }

    function renderContactBox(reservation, status) {
      const address = getPickupAddress(reservation);
      const phone = getPickupPhone(reservation);
      const pickupLatitude = reservation.pickupLatitude;
      const pickupLongitude = reservation.pickupLongitude;
      const hasPickupCoordinates =
        Number.isFinite(pickupLatitude) &&
        Number.isFinite(pickupLongitude);
      const pickupMapUrl =
        isMapUsefulForStatus(status) &&
        (hasPickupCoordinates || address)
          ? getMapUrl(address, pickupLatitude, pickupLongitude)
          : "";

      if (!getSafeReservationContactVisible(status)) {
        return `
          <div class="contact-box hidden">
            <strong>${escapeHtml(reservationsTranslate("reservations.contact.hiddenTitle", "Kontaktní údaje budou dostupné po zaplacení"))}</strong>
            ${escapeHtml(reservationsTranslate("reservations.contact.hiddenText", "Jméno majitele, telefon a přesná adresa se zobrazí po zaplacení rezervace."))}
          </div>
        `;
      }

      const contactTitle = reservationsTranslate(
        "reservations.contact.pickupTitle",
        "Údaje pro vyzvednutí"
      );

      return `
        <div class="contact-box visible">
          <strong>${contactTitle}</strong>
          <div class="contact-lines">
            <span>${escapeHtml(reservationsTranslate("reservations.ownerLabel", "Majitel"))}: ${escapeHtml(getReservationOwnerName(reservation))}</span>
            <span>${escapeHtml(reservationsTranslate("reservations.contact.phone", "Telefon"))}: ${escapeHtml(phone || reservationsTranslate("reservations.contact.phoneMissing", "Telefon není uložen"))}</span>
            <span>${escapeHtml(reservationsTranslate("reservations.contact.address", "Adresa"))}: ${escapeHtml(address || reservationsTranslate("reservations.contact.addressMissing", "Adresa není uložená"))}</span>
            ${reservation.pickupNote ? `<span>${escapeHtml(reservationsTranslate("reservations.contact.note", "Poznámka"))}: ${escapeHtml(reservation.pickupNote)}</span>` : ""}
          </div>
          ${pickupMapUrl ? `
            <a class="small-button light contact-map-link" href="${escapeHtml(pickupMapUrl)}" target="_blank" rel="noopener noreferrer">
              <span aria-hidden="true">📍</span>
              ${escapeHtml(reservationsTranslate("reservations.openPickupMap", "Otevřít mapu vyzvednutí"))}
            </a>
          ` : ""}
        </div>
      `;
    }

    function renderReservationDetailActions(reservation, status) {
      const normalizedStatus = normalizeReservationStatus(status);

      if (
        normalizedStatus !== RESERVATION_STATUS_PENDING &&
        normalizedStatus !== RESERVATION_STATUS_APPROVED
      ) {
        return "";
      }

      const reservationId = reservation.id || reservation.reservationId;

      return `
        <div class="reservation-detail-actions">
          <button
            type="button"
            class="small-button reservation-cancel-action"
            data-reservations-action="cancel"
            data-reservation-id="${escapeHtml(reservationId)}"
          >
            ${escapeHtml(reservationsTranslate("reservations.cancel", "Zrušit rezervaci"))}
          </button>
        </div>
      `;
    }

    function renderReservationDetailPanel(reservation) {
      const status = getSafeReservationStatus(reservation);

      const totalPrice = getSafeReservationTotalPrice(reservation);
      const normalizedStatus = normalizeReservationStatus(status);
      const paymentStatusText = getSafeReservationContactVisible(status)
        ? reservationsTranslate("reservations.payment.paidLower", "zaplaceno")
        : normalizedStatus === RESERVATION_STATUS_APPROVED
          ? reservationsTranslate("reservations.payment.waitingLower", "čeká na platbu")
          : reservationsTranslate("reservations.payment.pendingLower", "dostupná po schválení");
      const scheduleCopy = getReservationScheduleCopy();
      const pickupSchedule = formatReservationScheduleValue(
        getSafeReservationDateFrom(reservation),
        reservation.pickupTime
      );
      const returnSchedule = formatReservationScheduleValue(
        getSafeReservationDateTo(reservation),
        reservation.pickupTime
      );

      return `
        <div class="reservation-detail-panel">
          <div class="detail-grid">
            <div class="info-box">
              <span>${escapeHtml(
                getSafeReservationContactVisible(status)
                  ? reservationsTranslate("reservations.payment.totalPaid", "Celkem zaplaceno")
                  : reservationsTranslate("reservations.detail.total", "Celkem k platbě")
              )}</span>
              <strong>${escapeHtml(formatReservationsMoney(totalPrice))}</strong>
            </div>

            <div class="info-box">
              <span>${escapeHtml(reservationsTranslate("reservations.detail.payment", "Platba"))}</span>
              <strong>${escapeHtml(paymentStatusText)}</strong>
            </div>

            <div class="info-box reservation-schedule-pickup">
              <span>${escapeHtml(scheduleCopy.pickup)}</span>
              <strong>${escapeHtml(pickupSchedule)}</strong>
            </div>

            <div class="info-box reservation-schedule-return">
              <span>${escapeHtml(scheduleCopy.return)}</span>
              <strong>${escapeHtml(returnSchedule)}</strong>
            </div>
          </div>

          ${renderReservationStateBox(reservation, status)}

          ${renderPaymentBox(reservation, status)}

          ${renderContactBox(reservation, status)}

          ${renderReservationDetailActions(reservation, status)}
        </div>
      `;
    }

    function renderReservationCard(reservation) {
      const status = getSafeReservationStatus(reservation);
      const normalizedStatus = normalizeReservationStatus(status);
      const statusText = getSafeReservationStatusText(status);

      const toolName = getSafeReservationToolName(reservation);
      const city = getPickupCity(reservation);

      const startDate = getSafeReservationDateFrom(reservation);
      const endDate = getSafeReservationDateTo(reservation);
      const totalPrice = getSafeReservationTotalPrice(reservation);
      const reservationId = reservation.id || reservation.reservationId;
      const offerId = getSafeReservationOfferId(reservation);
      const isPaymentRequired = normalizedStatus === RESERVATION_STATUS_APPROVED;
      const isPriority = (
        isPaymentRequired ||
        normalizedStatus === RESERVATION_STATUS_PAID ||
        normalizedStatus === RESERVATION_STATUS_PICKED_UP
      );

      const paymentAction = isPaymentRequired
        ? `
          <button class="reservation-primary-action orange" type="button" data-reservations-action="pay" data-reservation-id="${escapeHtml(reservationId)}">
            ${escapeHtml(reservationsTranslate("reservations.pay", "Zaplatit"))}
          </button>
        `
        : "";

      const detailAction = `
        <button class="reservation-primary-action" id="detail-toggle-${escapeHtml(reservationId)}" type="button" data-reservations-action="toggle-detail" data-reservation-id="${escapeHtml(reservationId)}">
          ${escapeHtml(reservationsTranslate("home.mapOpenDetail", "Zobrazit detail"))}
        </button>
      `;

      const offerDetailAction = offerId
        ? `
          <a class="reservation-primary-action offer-detail-link" href="detail.html?id=${encodeURIComponent(offerId)}">
            ${escapeHtml(reservationsTranslate("reservations.offerDetail", "Detail nabídky"))}
          </a>
        `
        : "";

      return `
  <article class="simple-reservation-row ${isPriority ? "priority" : ""}">
    <div class="simple-reservation-main">
      ${renderToolThumb(reservation)}

      <div class="simple-reservation-info">
        <strong>${escapeHtml(toolName)}</strong>
        <span>${escapeHtml(city)}</span>
      </div>
    </div>

    <div class="simple-reservation-date">
      ${escapeHtml(formatReservationsDate(startDate))} – ${escapeHtml(formatReservationsDate(endDate))}
    </div>

    <div class="simple-reservation-price">
      ${escapeHtml(formatReservationsMoney(totalPrice))}
    </div>

    <div class="simple-reservation-status status-${escapeHtml(String(normalizedStatus).toLowerCase())}">
      ${escapeHtml(statusText)}
    </div>

    <div class="simple-reservation-actions">
      ${paymentAction}
      ${detailAction}
      ${offerDetailAction}
    </div>

    <div
      class="detail-row"
      id="reservation-detail-${escapeHtml(reservationId)}"
    >
      ${renderReservationDetailPanel(reservation)}
    </div>
  </article>
`;
    }

    function renderReservationList(reservations) {
      return `
        <div class="reservation-card-list active-list">
          ${reservations.map(function (reservation) {
            return renderReservationCard(reservation);
          }).join("")}
        </div>
      `;
    }

    function renderReservationSection(reservations, emptyText) {
      const content = reservations.length
        ? renderReservationList(reservations)
        : `<p class="section-empty-note">${escapeHtml(emptyText)}</p>`;

      return `
        <section class="reservation-section active">
          ${content}
        </section>
      `;
    }

    function renderReservations() {
      const reservations = supabaseReservations;

      if (!reservations.length) {
        renderEmptyState();
        return;
      }

      const sortedReservations = reservations.slice().sort(function (a, b) {
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      });

      const activeReservations = sortedReservations.filter(function (reservation) {
        return safeIsOpenReservationStatus(getSafeReservationStatus(reservation));
      });

      document.getElementById("reservationsList").innerHTML =
        renderReservationSection(
          activeReservations,
          reservationsTranslate("reservations.activeEmpty", "Nemáte žádné aktivní rezervace. Dokončené, zrušené a odmítnuté záznamy najdete v Historii.")
        );
    }

    async function initializeReservationsPage() {
      const verifiedUser = await window.rentuloAuthGuard.requireUser();

      if (!verifiedUser) {
        return;
      }

      renderLoadingState();
      reservationsLoadState = "loading";

      supabaseReservations = await loadMyReservationsFromSupabase(verifiedUser);

      if (reservationsLoadState === "ready") {
        renderReservations();
      } else if (reservationsLoadState === "error") {
        renderLoadErrorState();
      }
    }

    function captureReservationsUiState() {
      const openDetailIds = Array.from(
        document.querySelectorAll("#reservationsList .detail-row.open[id]")
      ).map(function (element) {
        return element.id;
      });

      return {
        openDetailIds: openDetailIds
      };
    }

    function restoreReservationsUiState(state) {
      if (!state) {
        return;
      }

      state.openDetailIds.forEach(function (detailId) {
        const detail = document.getElementById(detailId);

        if (!detail) {
          return;
        }

        detail.classList.add("open");

        const reservationId = detailId.replace("reservation-detail-", "");
        const button = document.getElementById("detail-toggle-" + reservationId);

        if (button) {
          button.textContent = reservationsTranslate("reservations.hideDetail", "Skrýt detail");
        }
      });
    }

    function rerenderReservationsForLanguageChange() {
      const uiState = captureReservationsUiState();
      renderReservations();
      restoreReservationsUiState(uiState);
    }
    async function handleReservationsActionClick(event) {
      const actionButton = event.target.closest("[data-reservations-action]");

      if (!actionButton) {
        return;
      }
      const action = actionButton.dataset.reservationsAction;
      const reservationId = actionButton.dataset.reservationId;

      if (action === "retry-load") {
        if (actionButton.dataset.busy === "true") {
          return;
        }

        actionButton.dataset.busy = "true";
        actionButton.disabled = true;

        try {
          await retryLoadReservations();
        } finally {
          if (actionButton.isConnected) {
            delete actionButton.dataset.busy;
            actionButton.disabled = false;
          }
        }

        return;
      }

      if (!reservationId) {
        return;
      }

      const mutationActions = new Set(["pay", "cancel"]);
      const isMutationAction = mutationActions.has(action);

      if (isMutationAction && actionButton.dataset.busy === "true") {
        return;
      }

      if (isMutationAction) {
        actionButton.dataset.busy = "true";
        actionButton.disabled = true;
      }

      try {
        if (action === "pay") {
          await payReservation(reservationId);
          return;
        }

        if (action === "cancel") {
          await cancelReservation(reservationId);
          return;
        }

        if (action === "toggle-detail") {
          toggleReservationDetail(reservationId, actionButton);
        }
      } finally {
        if (isMutationAction && actionButton.isConnected) {
          delete actionButton.dataset.busy;
          actionButton.disabled = false;
        }
      }
    }

    document.addEventListener("click", handleReservationsActionClick);
    document.addEventListener("DOMContentLoaded", function () {
      initializeReservationCancelModal();
      initializeReservationPaymentModal();
      initializeReservationsPage();
    });

    document.addEventListener("rentuloLanguageChanged", function () {
      refreshReservationCancelModalText();
      refreshReservationPaymentModalText();

      if (reservationsLoadState === "loading") {
        renderLoadingState();
      } else if (reservationsLoadState === "error") {
        renderLoadErrorState();
      } else if (reservationsLoadState === "ready") {
        rerenderReservationsForLanguageChange();
      }
    });
