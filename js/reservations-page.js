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

function reservationsExpirationText(reason) {
  if (reason === "owner_no_response") {
    return reservationsTranslate("reservations.expiration.ownerExpired", "Majitel žádost nepotvrdil včas.");
  }
  if (reason === "payment_timeout") {
    return reservationsTranslate("reservations.expiration.paymentExpired", "Platbu jste nedokončili včas.");
  }
  return reservationsTranslate("reservations.expiration.unknown", "Lhůta vypršela. Důvod není k dispozici.");
}

  const PLATFORM_FEE_PERCENT = 10;
    let supabaseReservations = [];
    let reservationsLoadState = "idle";
    let reservationsNoticeTimer = null;

    // Stripe's return URL is not proof of payment. Only the server's reservation
    // status (updated by the trusted Stripe webhook) can confirm a payment.
    const STRIPE_CHECKOUT_PENDING_KEY = "rentuloPendingStripeCheckout";
    const STRIPE_RETURN_POLL_DELAY_MS = 2000;
    const STRIPE_RETURN_MAX_POLLS = 30;
    const STRIPE_RETURN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
    const STRIPE_RETURN_TEXT = {
      cs: {
        checking: "Ověřujeme dokončení platby. Prosím, neplaťte znovu.",
        checkingShort: "Ověřujeme platbu",
        confirmed: "Platba byla potvrzena. Rezervace je zaplacená.",
        delayed: "Potvrzení platby trvá déle. Neplaťte znovu. Zkuste později zkontrolovat stav nebo kontaktujte podporu.",
        unavailable: "Stav platby se nepodařilo potvrdit. Neplaťte znovu a kontaktujte podporu."
      },
      sk: {
        checking: "Overujeme dokončenie platby. Prosím, neplaťte znova.",
        checkingShort: "Overujeme platbu",
        confirmed: "Platba bola potvrdená. Rezervácia je zaplatená.",
        delayed: "Potvrdenie platby trvá dlhšie. Neplaťte znova. Skontrolujte stav neskôr alebo kontaktujte podporu.",
        unavailable: "Stav platby sa nepodarilo potvrdiť. Neplaťte znova a kontaktujte podporu."
      },
      en: {
        checking: "We are verifying your payment. Please do not pay again.",
        checkingShort: "Verifying payment",
        confirmed: "Payment confirmed. Your booking is paid.",
        delayed: "Payment confirmation is taking longer. Do not pay again. Check later or contact support.",
        unavailable: "We could not verify the payment status. Do not pay again; contact support."
      },
      de: {
        checking: "Wir prüfen Ihre Zahlung. Bitte zahlen Sie nicht erneut.",
        checkingShort: "Zahlung wird geprüft",
        confirmed: "Zahlung bestätigt. Die Buchung ist bezahlt.",
        delayed: "Die Zahlungsbestätigung dauert länger. Bitte zahlen Sie nicht erneut. Prüfen Sie den Status später oder kontaktieren Sie den Support.",
        unavailable: "Der Zahlungsstatus konnte nicht bestätigt werden. Bitte zahlen Sie nicht erneut und kontaktieren Sie den Support."
      },
      pl: {
        checking: "Sprawdzamy płatność. Nie płać ponownie.",
        checkingShort: "Sprawdzamy płatność",
        confirmed: "Płatność potwierdzona. Rezerwacja jest opłacona.",
        delayed: "Potwierdzenie płatności trwa dłużej. Nie płać ponownie. Sprawdź stan później lub skontaktuj się z pomocą.",
        unavailable: "Nie udało się potwierdzić płatności. Nie płać ponownie i skontaktuj się z pomocą."
      }
    };
    let stripeReturnVerification = null;

    function stripeReturnText(key) {
      const language = typeof window.getRentuloLanguage === "function"
        ? window.getRentuloLanguage()
        : "cs";
      return (STRIPE_RETURN_TEXT[language] || STRIPE_RETURN_TEXT.cs)[key];
    }

    function clearStripePendingCheckout() {
      try {
        window.sessionStorage.removeItem(STRIPE_CHECKOUT_PENDING_KEY);
      } catch (_) {
        // Browsers may disable sessionStorage; the confirmation flow still stays safe.
      }
    }

    function storeStripePendingCheckout(reservationId, userId) {
      try {
        window.sessionStorage.setItem(STRIPE_CHECKOUT_PENDING_KEY, JSON.stringify({
          reservationId: String(reservationId),
          userId: String(userId),
          startedAt: Date.now()
        }));
      } catch (_) {
        // A blocked storage API must never prevent Stripe Checkout.
      }
    }

    function readStripeReturnVerification(verifiedUser) {
      const params = new URLSearchParams(window.location.search);
      const paymentResult = params.get("payment");
      if (paymentResult === "cancelled") {
        clearStripePendingCheckout();
        return null;
      }
      if (paymentResult !== "success") {
        return null;
      }

      let reservationId = null;
      try {
        const pending = JSON.parse(window.sessionStorage.getItem(STRIPE_CHECKOUT_PENDING_KEY) || "null");
        const age = Date.now() - Number(pending && pending.startedAt);
        if (pending && pending.userId === verifiedUser.id &&
            typeof pending.reservationId === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pending.reservationId) &&
            age >= 0 && age < STRIPE_RETURN_MAX_AGE_MS) {
          reservationId = pending.reservationId;
        }
      } catch (_) {
        // Unknown checkout: refresh all reservations, but never claim payment success.
      }
      return { reservationId: reservationId, polls: 0 };
    }

    function stripeReturnBlocksAction(reservationId) {
      return Boolean(stripeReturnVerification && (
        !stripeReturnVerification.reservationId ||
        String(stripeReturnVerification.reservationId) === String(reservationId)
      ));
    }

    function showStripeReturnNotice(key, isError = false) {
      const notice = document.getElementById("reservationsNotice");
      if (!notice) return;
      if (reservationsNoticeTimer) {
        window.clearTimeout(reservationsNoticeTimer);
        reservationsNoticeTimer = null;
      }
      notice.textContent = stripeReturnText(key);
      notice.classList.toggle("error", isError);
      notice.classList.toggle("processing", !isError);
      notice.setAttribute("role", isError ? "alert" : "status");
      notice.hidden = false;
    }

    function removeStripeReturnQuery() {
      if (!window.history || typeof window.history.replaceState !== "function") return;
      const url = new URL(window.location.href);
      url.searchParams.delete("payment");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }

    function getVerifiedStripeReturnStatus() {
      if (!stripeReturnVerification || !stripeReturnVerification.reservationId) return "unknown";
      const reservation = supabaseReservations.find(function (item) {
        return String(item.id || item.reservationId) === stripeReturnVerification.reservationId;
      });
      if (!reservation) return "unknown";
      const status = normalizeReservationStatus(getSafeReservationStatus(reservation));
      if ([RESERVATION_STATUS_PAID, RESERVATION_STATUS_PICKED_UP,
           RESERVATION_STATUS_RETURNED, RESERVATION_STATUS_NO_SHOW].includes(status)) return "confirmed";
      if ([RESERVATION_STATUS_CANCELLED, RESERVATION_STATUS_EXPIRED,
           RESERVATION_STATUS_REJECTED].includes(status)) return "unavailable";
      return "pending";
    }

    function finishStripeReturnVerification(result) {
      stripeReturnVerification = null;
      clearStripePendingCheckout();
      removeStripeReturnQuery();
      renderReservations();
      if (result === "confirmed") {
        showReservationsNotice(stripeReturnText("confirmed"));
      } else {
        showStripeReturnNotice("unavailable", true);
      }
    }

    function scheduleStripeReturnPoll(verifiedUser) {
      if (!stripeReturnVerification) return;
      if (stripeReturnVerification.polls >= STRIPE_RETURN_MAX_POLLS) {
        // Keep the Pay action blocked: the webhook may still be processing.
        showStripeReturnNotice("delayed", true);
        return;
      }
      window.setTimeout(function () {
        void pollStripeReturnVerification(verifiedUser);
      }, STRIPE_RETURN_POLL_DELAY_MS);
    }

    async function pollStripeReturnVerification(verifiedUser) {
      if (!stripeReturnVerification) return;
      stripeReturnVerification.polls += 1;
      if (typeof window.invalidateRentuloReservationsData === "function") {
        window.invalidateRentuloReservationsData();
      }
      const refreshed = await loadMyReservationsFromSupabase(verifiedUser);
      if (!stripeReturnVerification) return;
      if (reservationsLoadState === "ready") {
        supabaseReservations = refreshed;
        const status = getVerifiedStripeReturnStatus();
        if (status === "confirmed" || status === "unavailable") {
          finishStripeReturnVerification(status);
          return;
        }
        renderReservations();
      }
      scheduleStripeReturnPoll(verifiedUser);
    }

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
      notice.classList.toggle("processing", false);
      notice.setAttribute("role", isError ? "alert" : "status");
      notice.hidden = false;
      reservationsNoticeTimer = window.setTimeout(function () {
        notice.hidden = true;
        reservationsNoticeTimer = null;
      }, 4500);
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
        reservationNumber: row.reservation_number || "",
        offerNumber: row.offer_number || "",

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
        expiresAt: row.expires_at || "",
        approvedAt: row.approved_at || "",
        expiredAt: row.expired_at || "",
        expiryReason: row.expiry_reason || "",

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

      // Extension rows are read through a participant-scoped RPC. Missing
      // migration or permission failure must not silently show wrong totals.
      const extensionsResult = await supabaseClient.rpc("get_my_reservation_extensions");
      if (extensionsResult.error || !Array.isArray(extensionsResult.data)) {
        console.error("Reservation extensions could not be loaded", extensionsResult.error);
        reservationsLoadState = "error";
        return [];
      }
      reservationsLoadState = "ready";
      return RentuloReservationExtensions.attachPaidExtensions(
        Array.isArray(data) ? data.map(normalizeSupabaseReservation) : [],
        extensionsResult.data
      );
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
    let reservationCancelModalQuote = null;
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
      const normalizedStatus = normalizeReservationStatus(
        getSafeReservationStatus(reservationCancelModalReservation)
      );
      const isPaidCancellation =
        normalizedStatus === RESERVATION_STATUS_PAID &&
        reservationCancelModalQuote;
      const startDate = formatReservationsDate(
        getSafeReservationDateFrom(reservationCancelModalReservation)
      );
      const endDate = formatReservationsDate(
        getSafeReservationDateTo(reservationCancelModalReservation)
      );

      if (elements.title) {
        elements.title.textContent = normalizedStatus === RESERVATION_STATUS_PENDING
          ? reservationsTranslate("reservations.pendingWithdraw.title", "Vzít žádost zpět?")
          : isPaidCancellation
          ? reservationsTranslate(
              "reservations.cancelPaid.title",
              "Zrušit zaplacenou rezervaci?"
            )
          : reservationsTranslate(
              "reservations.cancelModal.title",
              "Zrušit rezervaci?"
            );
      }

      if (elements.description) {
        elements.description.textContent = normalizedStatus === RESERVATION_STATUS_PENDING
          ? reservationsTranslate("reservations.pendingWithdraw.description", "Žádost dosud nebyla schválena ani zaplacena. Po jejím stažení se termín znovu uvolní.")
          : isPaidCancellation
          ? reservationsTranslate(
              "reservations.cancelPaid.renterDescription",
              "Zaplaceno: {paymentAmount}. Skutečné náklady Stripe: {externalCost}. Vrátíme vám: {refundAmount} na původní platební metodu. Rentulo si za storno neúčtuje vlastní poplatek; odečte se pouze skutečný externí náklad Stripe.",
              {
                paymentAmount: formatPaidCancellationMinorMoney(
                  reservationCancelModalQuote.payment_amount_minor
                ),
                externalCost: formatPaidCancellationMinorMoney(
                  reservationCancelModalQuote.external_cost_amount_minor
                ),
                refundAmount: formatPaidCancellationMinorMoney(
                  reservationCancelModalQuote.refund_amount_minor
                )
              }
            )
          : reservationsTranslate(
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
        elements.confirmButton.textContent = normalizedStatus === RESERVATION_STATUS_PENDING
          ? reservationsTranslate("reservations.pendingWithdraw.action", "Vzít žádost zpět")
          : isPaidCancellation
          ? reservationsTranslate(
              "reservations.cancelPaid.confirm",
              "Zrušit a vrátit platbu"
            )
          : reservationsTranslate(
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
      reservationCancelModalQuote = null;
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

    function openReservationCancelModal(reservation, quote) {
      const elements = getReservationCancelModalElements();

      if (!elements.overlay) {
        console.error("Reservation cancellation modal is missing.");
        return Promise.resolve(false);
      }

      reservationCancelModalReservation = reservation;
      reservationCancelModalQuote = quote || null;
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

    let reservationPaymentModalAmount = null;
    let reservationPaymentModalResolve = null;
    let reservationPaymentModalReturnFocus = null;

    function getReservationPaymentModalElements() {
      return {
        overlay: document.getElementById("reservationPaymentModal"),
        title: document.getElementById("reservationPaymentModalTitle"),
        description: document.getElementById("reservationPaymentModalDescription"),
        noShowWarning: document.getElementById("reservationPaymentModalNoShowWarning"),
        amount: document.getElementById("reservationPaymentModalAmount"),
        noShowTermsLink: document.getElementById("reservationPaymentModalTermsLink"),
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

      if (elements.amount) {
        elements.amount.textContent = reservationPaymentModalAmount === null ? "" :
          formatReservationsMoney(reservationPaymentModalAmount);
      }

      if (elements.noShowWarning) {
        elements.noShowWarning.textContent = reservationsTranslate(
          "reservations.paymentModal.noShowWarningShort",
          "PIN lze použít 2 hodiny před převzetím až do sjednaného vrácení. Při nevyzvednutí se platba automaticky nevrací; oprávněný problém můžete reklamovat."
        );
      }

      if (elements.noShowTermsLink) {
        elements.noShowTermsLink.textContent = reservationsTranslate(
          "reservations.paymentModal.noShowTermsLink",
          "Podrobnosti: nevyzvednutí věci v obchodních podmínkách"
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

    function openReservationPaymentModal(amount) {
      reservationPaymentModalAmount = amount;
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
        normalizedStatus !== RESERVATION_STATUS_APPROVED &&
        normalizedStatus !== RESERVATION_STATUS_PAID
      ) {
        showReservationsNotice(reservationsTranslate("reservations.error.cannotCancel", "Tuto rezervaci už nelze běžně zrušit."), "error");
        return;
      }

      if (!isReservationCancellationWindowOpen(reservation)) {
        showReservationsNotice(getReservationCancellationCutoffText(), "error");
        renderReservations();
        return;
      }

      if (normalizedStatus === RESERVATION_STATUS_PAID) {
        const previewResult = await requestPaidReservationCancellation(
          supabaseClient,
          reservationId,
          "preview"
        );

        if (previewResult.error || !previewResult.data) {
          console.error("Náhled storna zaplacené rezervace se nepodařilo načíst:", previewResult.error);
          showReservationsNotice(
            reservationsTranslate(
              "reservations.cancelPaid.previewError",
              "Přesné vyúčtování storna se nepodařilo načíst. Zkuste to prosím znovu."
            ),
            "error"
          );
          return;
        }

        const confirmed = await openReservationCancelModal(
          reservation,
          previewResult.data
        );

        if (!confirmed) {
          return;
        }

        if (!isReservationCancellationWindowOpen(reservation)) {
          showReservationsNotice(getReservationCancellationCutoffText(), "error");
          renderReservations();
          return;
        }

        const confirmResult = await requestPaidReservationCancellation(
          supabaseClient,
          reservationId,
          "confirm"
        );

        if (confirmResult.error || !confirmResult.data) {
          console.error("Storno zaplacené rezervace se nepodařilo dokončit:", confirmResult.error);
          showReservationsNotice(
            reservationsTranslate(
              "reservations.cancelPaid.confirmError",
              "Storno se nepodařilo dokončit. Zkuste to prosím znovu; opakovaný pokus nevytvoří druhý refund."
            ),
            "error"
          );
          return;
        }

        await retryLoadReservations();

        showReservationsNotice(
          reservationsTranslate(
            "reservations.cancelPaid.renterSuccess",
            "Rezervace byla zrušena. Stripe zpracovává vrácení {refundAmount} na původní platební metodu.",
            {
              refundAmount: formatPaidCancellationMinorMoney(
                confirmResult.data.refund_amount_minor
              )
            }
          )
        );
        return;
      }

      const confirmed = await openReservationCancelModal(reservation);

      if (!confirmed) {
        return;
      }

      if (!isReservationCancellationWindowOpen(reservation)) {
        showReservationsNotice(getReservationCancellationCutoffText(), "error");
        renderReservations();
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

      const reservationToPay = supabaseReservations.find(function (item) {
        return String(item.id || item.reservationId) === String(reservationId);
      });
      if (!reservationToPay) {
        showReservationsNotice(reservationsTranslate("reservations.error.notFound", "Rezervace nebyla nalezena."), "error");
        return;
      }
      const confirmPayment = await openReservationPaymentModal(getSafeReservationTotalPrice(reservationToPay));

      if (!confirmPayment) {
        return;
      }

      const { data, error } = await supabaseClient.functions.invoke(
        "create-checkout-session",
        {
          body: {
            reservation_id: reservationId,
            locale: typeof window.getRentuloLanguage === "function"
              ? window.getRentuloLanguage()
              : "cs"
          }
        }
      );

      if (error) {
        console.error("Stripe Checkout se nepodařilo vytvořit:", error);
        showReservationsNotice(reservationsTranslate("reservations.error.payment", "Platbu se nepodařilo dokončit. Zkuste to prosím znovu."), "error");
        return;
      }

      const checkoutUrl = data && typeof data.url === "string"
        ? data.url.trim()
        : "";

      if (!checkoutUrl) {
        console.error("Stripe Checkout nevrátil platnou URL.");
        showReservationsNotice(reservationsTranslate("reservations.error.payment", "Platbu se nepodařilo dokončit. Zkuste to prosím znovu."), "error");
        return;
      }

      storeStripePendingCheckout(reservationId, supabaseUser.id);
      window.location.href = checkoutUrl;
    }

    async function requestRentalExtension(reservationId) {
      const dateInput = document.getElementById("extension-date-" + reservationId);
      if (!dateInput || !dateInput.value || !dateInput.checkValidity()) {
        if (dateInput) dateInput.reportValidity();
        return;
      }
      const client = getSupabaseClient();
      const result = await client.rpc("request_reservation_extension", {
        p_reservation_id: reservationId, p_new_end_date: dateInput.value,
      });
      if (result.error || !result.data) {
        console.error("Extension request failed", result.error);
        showReservationsNotice(extensionText("error"), "error");
        return;
      }
      await retryLoadReservations();
      showReservationsNotice(extensionText("requested"));
    }

    async function payRentalExtension(extensionId) {
      const client = getSupabaseClient();
      const { data, error } = await client.functions.invoke("create-extension-checkout", {
        body: { extension_id: extensionId,
          locale: typeof window.getRentuloLanguage === "function" ? window.getRentuloLanguage() : "cs" },
      });
      if (error || !data || typeof data.url !== "string" ||
          !/^https:\/\/checkout\.stripe\.com\//.test(data.url)) {
        // Non-2xx Edge Function responses arrive in error.context as a
        // Response, not necessarily in data. Do not label a busy payment failed.
        let code = data && typeof data.code === "string" ? data.code : "";
        if (!code && error && error.context && typeof error.context.json === "function") {
          try {
            const details = await error.context.json();
            code = details && typeof details.code === "string" ? details.code : "";
          } catch (_parseError) { /* Generic localized fallback below. */ }
        }
        const label = code === "checkout_busy" ? "paymentBusy"
          : code === "payment_deadline" ? "deadlineElapsed"
          : code === "checkout_retry" ? "checkoutRetry" : "error";
        console.error("Stripe extension checkout failed", code || error);
        showReservationsNotice(extensionText(label), "error");
        if (code === "payment_deadline") await retryLoadReservations();
        return;
      }
      // The redirect query itself is not payment evidence. Keep the exact
      // extension identifier so the return page cannot confirm another rental.
      try {
        window.sessionStorage.setItem("rentuloPendingExtensionCheckout", extensionId);
      } catch (_storageError) {
        // Payment can continue; missing local state simply prevents a false
        // confirmation banner. The database is always authoritative.
      }
      window.location.href = data.url;
    }

    function openRentalExtensionForm(reservationId) {
      const detail = document.getElementById("reservation-detail-" + reservationId);
      const form = document.getElementById("extension-form-" + reservationId);
      if (!detail || !form) return;
      detail.classList.add("open");
      form.hidden = false;
      const button = document.getElementById("detail-toggle-" + reservationId);
      if (button) button.textContent = reservationsTranslate("reservations.hideDetail", "Skrýt detail");
      const date = form.querySelector('input[type="date"]');
      if (date) date.focus();
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

    function renderRenterReservationCancellationAction(reservation) {
      if (stripeReturnBlocksAction(reservation.id || reservation.reservationId) &&
          normalizeReservationStatus(getSafeReservationStatus(reservation)) === RESERVATION_STATUS_APPROVED) {
        return "";
      }
      if (!canRenterCancelReservation(reservation)) {
        return "";
      }

      const reservationId = reservation.id || reservation.reservationId;
      const isPending = normalizeReservationStatus(getSafeReservationStatus(reservation)) === RESERVATION_STATUS_PENDING;
      const label = isPending
        ? reservationsTranslate("reservations.pendingWithdraw.action", "Vzít žádost zpět")
        : reservationsTranslate("reservations.cancel", "Zrušit rezervaci");
      const cutoff = isPending ? null : getReservationCancellationCutoffAt(reservation);
      const explanation = getReservationCancellationCutoffText();

      if (cutoff && !isReservationCancellationWindowOpen(reservation)) {
        return ""; // No action is available; explain the rule in the reservation detail.
      }

      const cutoffAttribute = cutoff
        ? ` data-cancel-cutoff="${cutoff.getTime()}"`
        : "";

      return `
        <div class="reservation-cancel-action-stack">
          <button
            class="reservation-primary-action reservation-cancel-action"
            type="button"
            data-reservations-action="cancel"
            data-reservation-id="${escapeHtml(reservationId)}"${cutoffAttribute}
          >
            ${escapeHtml(label)}
          </button>
        </div>
      `;
    }

    function formatReservationExpiry(value) {
      if (!value) return "";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      const lang = typeof window.getRentuloLanguage === "function"
        ? window.getRentuloLanguage() : "cs";
      const locales = { cs: "cs-CZ", sk: "sk-SK", en: "en-GB", de: "de-DE", pl: "pl-PL" };
      return new Intl.DateTimeFormat(locales[lang] || "cs-CZ", {
        dateStyle: "short", timeStyle: "short", timeZone: "Europe/Prague"
      }).format(date);
    }

    function renderReservationDeadline(reservation, status) {
      const normalized = normalizeReservationStatus(status);
      if (normalized !== RESERVATION_STATUS_PENDING &&
          normalized !== RESERVATION_STATUS_APPROVED) return "";
      if (!reservation.expiresAt) return ""; // grandfathered TEST reservations
      const deadlineText = formatReservationExpiry(reservation.expiresAt);
      if (!deadlineText) return "";
      const passed = new Date(reservation.expiresAt).getTime() <= Date.now();
      const key = passed ? "reservations.expiration.review" :
        normalized === RESERVATION_STATUS_PENDING
          ? "reservations.expiration.ownerDeadline" : "reservations.expiration.paymentDeadline";
      const label = passed ? "Lhůta uplynula – ověřujeme stav" :
        normalized === RESERVATION_STATUS_PENDING ? "Schválit do" : "Zaplatit do";
      return `<small class="reservation-expiration-note">${escapeHtml(reservationsTranslate(key, label))}: ${escapeHtml(deadlineText)}</small>`;
    }

    function extensionText(key) {
      return RentuloReservationExtensions.t(key);
    }

    function latestReservationExtension(reservation) {
      const rows = reservation.extensions || [];
      return rows.length ? rows[rows.length - 1] : null;
    }

    function canRequestAnotherExtension(reservation) {
      const status = normalizeReservationStatus(getSafeReservationStatus(reservation));
      const latest = latestReservationExtension(reservation);
      if (status !== RESERVATION_STATUS_PICKED_UP) return false;
      if (latest && ["pending","approved"].includes(latest.status)) return false;
      // The authoritative Europe/Prague return cutoff is validated in the
      // database under the offer advisory lock (including daylight saving).
      return true;
    }

    function renderRentalExtensionPanel(reservation) {
      const id = String(reservation.id);
      const extension = latestReservationExtension(reservation);
      const safeId = escapeHtml(id);
      const allowed = canRequestAnotherExtension(reservation);
      const minDate = RentuloReservationExtensions.nextDate(getSafeReservationDateTo(reservation));
      const pending = extension && extension.status === "pending";
      const approved = extension && extension.status === "approved";
      const active = pending || approved;
      const info = extension ? `
        <p class="reservation-extension-state"><strong>${escapeHtml(extensionText(extension.status))}</strong>
          · ${escapeHtml(extensionText("until"))}: ${escapeHtml(formatReservationsDate(extension.new_end_date))}
          · ${escapeHtml(extensionText("extra"))}: ${escapeHtml(formatReservationsMoney(extension.amount_total))}
        </p>
      ` : "";
      const pay = approved ? `
        <small>${escapeHtml(extensionText("deadline"))}: ${escapeHtml(formatReservationExpiry(extension.payment_deadline_at))}</small>
      ` : "";
      const form = allowed ? `
        <div class="reservation-extension-form" id="extension-form-${safeId}" hidden>
          <label for="extension-date-${safeId}">${escapeHtml(extensionText("newReturn"))}</label>
          <input id="extension-date-${safeId}" data-extension-date="${safeId}" type="date"
            min="${escapeHtml(minDate)}" required>
          <button class="reservation-primary-action" type="button"
            data-reservations-action="request-extension" data-reservation-id="${safeId}">
            ${escapeHtml(extensionText("submit"))}</button>
          <small>${escapeHtml(extensionText("priceInfo"))}</small>
        </div>` : "";
      if (!active && !allowed && !extension) return "";
      return `<section class="reservation-extension-panel" aria-label="${escapeHtml(extensionText("extend"))}">
        ${info}${pay}${form}
      </section>`;
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
      const deadlineNote = renderReservationDeadline(reservation, normalizedStatus);
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
            ${reservation.reservationNumber ? `<div class="info-box"><span>${escapeHtml(reservationsTranslate("reference.reservation", "Číslo rezervace"))}</span><strong>${escapeHtml(reservation.reservationNumber)}</strong></div>` : ""}
            ${reservation.offerNumber ? `<div class="info-box"><span>${escapeHtml(reservationsTranslate("reference.offer", "Číslo nabídky"))}</span><strong>${escapeHtml(reservation.offerNumber)}</strong></div>` : ""}
          </div>

          ${deadlineNote ? `<p class="reservation-expiration-note">${deadlineNote}</p>` : ""}
          ${normalizedStatus === RESERVATION_STATUS_EXPIRED ? `<p class="reservation-expiration-note">${escapeHtml(reservationsExpirationText(reservation.expiryReason))}</p>` : ""}
          ${renderReservationStateBox(reservation, status)}

          ${renderPaymentBox(reservation, status)}

          ${renderContactBox(reservation, status)}
          ${typeof renderRentalExtensionPanel === "function" ? renderRentalExtensionPanel(reservation) : ""}
        </div>
      `;
    }

    function renderReservationCard(reservation) {
      const status = getSafeReservationStatus(reservation);
      const normalizedStatus = normalizeReservationStatus(status);
      const reservationId = reservation.id || reservation.reservationId;
      const waitingForStripe = normalizedStatus === RESERVATION_STATUS_APPROVED &&
        stripeReturnBlocksAction(reservationId);
      const statusText = waitingForStripe
        ? stripeReturnText("checkingShort")
        : getSafeReservationStatusText(status);

      const toolName = getSafeReservationToolName(reservation);
      const city = getPickupCity(reservation);

      const startDate = getSafeReservationDateFrom(reservation);
      const endDate = getSafeReservationDateTo(reservation);
      const totalPrice = getSafeReservationTotalPrice(reservation);
      const isPaymentRequired = canRenterPayReservation(reservation);
      const isPriority = (
        isPaymentRequired ||
        normalizedStatus === RESERVATION_STATUS_PAID ||
        normalizedStatus === RESERVATION_STATUS_PICKED_UP
      );

      const paymentAction = isPaymentRequired && !waitingForStripe
        ? `
          <button class="reservation-primary-action orange" type="button" data-reservations-action="pay" data-reservation-id="${escapeHtml(reservationId)}">
            ${escapeHtml(reservationsTranslate("reservations.pay", "Zaplatit"))}
          </button>
        `
        : "";

      const cancellationAction = renderRenterReservationCancellationAction(reservation);
      const latestExtension = latestReservationExtension(reservation);
      const awaitingExtensionPayment = latestExtension && latestExtension.status === "approved";
      const extensionDeadline = awaitingExtensionPayment
        ? formatReservationExpiry(latestExtension.payment_deadline_at) : "";
      const extensionPaymentNote = awaitingExtensionPayment ? `
        <small class="reservation-extension-payment-note">
          ${escapeHtml(extensionText("paymentDue"))}${extensionDeadline
            ? ` · ${escapeHtml(extensionText("deadline"))}: ${escapeHtml(extensionDeadline)}` : ""}
        </small>` : "";
      const extensionPaymentAction = awaitingExtensionPayment ? `
        <button class="reservation-primary-action orange" type="button"
          data-reservations-action="pay-extension"
          data-reservation-id="${escapeHtml(reservationId)}"
          data-extension-id="${escapeHtml(latestExtension.id)}">
          ${escapeHtml(extensionText("pay"))} ${escapeHtml(formatReservationsMoney(latestExtension.amount_total))}
        </button>` : "";
      const extensionAction = canRequestAnotherExtension(reservation) ? `
        <button class="reservation-primary-action" type="button" data-reservations-action="open-extension"
          data-reservation-id="${escapeHtml(reservationId)}">${escapeHtml(extensionText("extend"))}</button>
      ` : "";

      const detailAction = `
        <button class="reservation-primary-action" id="detail-toggle-${escapeHtml(reservationId)}" type="button" data-reservations-action="toggle-detail" data-reservation-id="${escapeHtml(reservationId)}">
          ${escapeHtml(reservationsTranslate("home.mapOpenDetail", "Zobrazit detail"))}
        </button>
      `;

      return `
  <article class="simple-reservation-row ${isPriority ? "priority" : ""}" data-pickup-date="${escapeHtml(startDate)}" data-pickup-end-date="${escapeHtml(endDate)}" data-pickup-time="${escapeHtml(reservation.pickupTime || '')}">
    <div class="simple-reservation-main">
      ${renderToolThumb(reservation)}

      <div class="simple-reservation-info">
        <strong>${escapeHtml(toolName)}</strong>
        <span>${escapeHtml(city)}${reservation.reservationNumber ? ` · ${escapeHtml(reservationsTranslate("reference.reservation", "Číslo rezervace"))}: ${escapeHtml(reservation.reservationNumber)}` : ""}</span>
        ${renderReservationDeadline(reservation, normalizedStatus)}
        ${extensionPaymentNote}
      </div>
    </div>

    <div class="simple-reservation-date">
      ${escapeHtml(formatReservationsDate(startDate))} – ${escapeHtml(formatReservationsDate(endDate))}
        ${reservation.pickupTime ? `<small class="reservation-pickup-time">${escapeHtml(reservationsTranslate("reservations.pickupTimeShort", "Převzetí"))}: ${escapeHtml(formatReservationsTime(reservation.pickupTime))}</small>` : ""}
    </div>

    <div class="simple-reservation-price">
      ${escapeHtml(formatReservationsMoney(totalPrice))}
    </div>

    <div class="simple-reservation-status status-${escapeHtml(waitingForStripe ? "processing" : String(normalizedStatus).toLowerCase())}">
      ${escapeHtml(statusText)}
    </div>

    <div class="simple-reservation-actions">
      ${paymentAction}
      ${cancellationAction}
      ${extensionPaymentAction}
      ${extensionAction}
      <div class="reservation-detail-action-group">
        ${detailAction}
      </div>
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

      const extensionPaymentReturn = new URLSearchParams(window.location.search).get("extension_payment");
      if (extensionPaymentReturn === "success") {
        showReservationsNotice(extensionText("checking"));
      } else if (extensionPaymentReturn === "cancelled") {
        showReservationsNotice(extensionText("cancelled"));
      }
      stripeReturnVerification = readStripeReturnVerification(verifiedUser);
      if (stripeReturnVerification) {
        showStripeReturnNotice("checking");
        // Shared navigation may have prefetched stale reservations before return.
        if (typeof window.invalidateRentuloReservationsData === "function") {
          window.invalidateRentuloReservationsData();
        }
      }
      renderLoadingState();
      reservationsLoadState = "loading";

      supabaseReservations = await loadMyReservationsFromSupabase(verifiedUser);

      if (reservationsLoadState === "ready") {
        if (stripeReturnVerification) {
          const status = getVerifiedStripeReturnStatus();
          if (status === "confirmed" || status === "unavailable") {
            finishStripeReturnVerification(status);
            return;
          }
        }
        renderReservations();
      } else if (reservationsLoadState === "error") {
        renderLoadErrorState();
      }
      if (stripeReturnVerification) {
        scheduleStripeReturnPoll(verifiedUser);
      }
      if (extensionPaymentReturn === "success") {
        // Re-read server evidence after redirect. URL parameters never imply
        // a paid extension; the webhook alone changes the agreed return date.
        let attempts = 0;
        const verify = async function () {
          attempts += 1;
          await retryLoadReservations();
          let requestedExtensionId = "";
          try {
            requestedExtensionId = window.sessionStorage.getItem("rentuloPendingExtensionCheckout") || "";
          } catch (_storageError) { /* Show the server state without asserting a payment. */ }
          const confirmed = requestedExtensionId && supabaseReservations.some(function (r) {
            return (r.extensions || []).some(function (e) {
              return e.id === requestedExtensionId && e.status === "paid";
            });
          });
          if (confirmed) {
            showReservationsNotice(extensionText("paid"));
            try { window.sessionStorage.removeItem("rentuloPendingExtensionCheckout"); }
            catch (_storageError) { /* Storage may be unavailable. */ }
            window.history.replaceState(null,"",window.location.pathname);
          } else if (attempts < 15) {
            window.setTimeout(verify,2000);
          } else {
            showReservationsNotice(extensionText("checking"));
            window.history.replaceState(null,"",window.location.pathname);
          }
        };
        window.setTimeout(verify,2000);
      } else if (extensionPaymentReturn === "cancelled") {
        try { window.sessionStorage.removeItem("rentuloPendingExtensionCheckout"); }
        catch (_storageError) { /* Storage may be unavailable. */ }
        window.history.replaceState(null,"",window.location.pathname);
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

      if (action === "open-extension") {
        openRentalExtensionForm(reservationId);
        return;
      }
      const mutationActions = new Set(["pay", "cancel", "request-extension", "pay-extension"]);
      const isMutationAction = mutationActions.has(action);

      if (isMutationAction && actionButton.dataset.busy === "true") {
        return;
      }

      if (isMutationAction) {
        actionButton.dataset.busy = "true";
        actionButton.disabled = true;
      }

      try {
        if (action === "request-extension") {
          await requestRentalExtension(reservationId);
          return;
        }
        if (action === "pay-extension") {
          await payRentalExtension(actionButton.dataset.extensionId);
          return;
        }
        if (action === "pay") {
          if (stripeReturnBlocksAction(reservationId)) {
            showStripeReturnNotice("checking");
            return;
          }
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
