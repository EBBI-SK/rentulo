(function () {
  "use strict";

  const TEXT = {
    cs: {
      pinTitle: "PIN pro převzetí",
      pinHint: "Tento 6místný PIN sdělte majiteli až při osobním předání věci.",
      pinLoading: "Načítám PIN…",
      pinUnavailable: "PIN teď není dostupný. Obnovte stránku a zkuste to znovu.",
      handoffTitle: "Předáváte věc nájemci?",
      handoffText: "Zadejte 6místný PIN od nájemce. Rentulo najde správnou rezervaci za vás.",
      handoffOpen: "Zadat PIN",
      handoffCancel: "Zrušit",
      handoffInput: "6místný PIN",
      verifying: "Ověřuji PIN…",
      invalid: "PIN není správný.",
      remainingOne: "Zbývá 1 pokus.",
      remainingMany: "Zbývají {count} pokusy.",
      locked: "Po 3 chybných pokusech je zadávání na 15 minut zablokované.",
      lockedUntil: "Zkuste to znovu po {time}.",
      matched: "PIN ověřen. Níže zkontrolujte rezervaci a potvrďte předání.",
      showReservations: "Zobrazit rezervace",
      confirmAction: "Potvrdit předání",
      matchedNote: "PIN je správný. Zkontrolujte údaje rezervace a potvrďte předání věci.",
      confirming: "Potvrzuji předání…",
      success: "Předáno. Rezervace pokračuje až do vrácení věci.",
      genericError: "Předání se nepodařilo potvrdit. Zkuste to prosím znovu."
    },
    sk: {
      pinTitle: "PIN na prevzatie",
      pinHint: "Tento 6-miestny PIN povedzte majiteľovi až pri osobnom odovzdaní veci.",
      pinLoading: "Načítavam PIN…",
      pinUnavailable: "PIN teraz nie je dostupný. Obnovte stránku a skúste to znova.",
      handoffTitle: "Odovzdávate vec nájomcovi?",
      handoffText: "Zadajte 6-miestny PIN od nájomcu. Rentulo nájde správnu rezerváciu za vás.",
      handoffOpen: "Zadať PIN",
      handoffCancel: "Zrušiť",
      handoffInput: "6-miestny PIN",
      verifying: "Overujem PIN…",
      invalid: "PIN nie je správny.",
      remainingOne: "Zostáva 1 pokus.",
      remainingMany: "Zostávajú {count} pokusy.",
      locked: "Po 3 chybných pokusoch je zadávanie na 15 minút zablokované.",
      lockedUntil: "Skúste to znova po {time}.",
      matched: "PIN je overený. Nižšie skontrolujte rezerváciu a potvrďte odovzdanie.",
      showReservations: "Zobraziť rezervácie",
      confirmAction: "Potvrdiť odovzdanie",
      matchedNote: "PIN je správny. Skontrolujte údaje rezervácie a potvrďte odovzdanie veci.",
      confirming: "Potvrdzujem odovzdanie…",
      success: "Odovzdané. Rezervácia pokračuje až do vrátenia veci.",
      genericError: "Odovzdanie sa nepodarilo potvrdiť. Skúste to prosím znova."
    },
    en: {
      pinTitle: "Pickup PIN",
      pinHint: "Give this 6-digit PIN to the owner only when the item is physically handed over.",
      pinLoading: "Loading PIN…",
      pinUnavailable: "The PIN is not available right now. Refresh the page and try again.",
      handoffTitle: "Handing an item to the renter?",
      handoffText: "Enter the renter's 6-digit PIN. Rentulo will find the correct reservation for you.",
      handoffOpen: "Enter PIN",
      handoffCancel: "Cancel",
      handoffInput: "6-digit PIN",
      verifying: "Checking PIN…",
      invalid: "The PIN is incorrect.",
      remainingOne: "1 attempt remaining.",
      remainingMany: "{count} attempts remaining.",
      locked: "After 3 incorrect attempts, PIN entry is locked for 15 minutes.",
      lockedUntil: "Try again after {time}.",
      matched: "PIN verified. Check the reservation below and confirm the handover.",
      showReservations: "View reservations",
      confirmAction: "Confirm handover",
      matchedNote: "The PIN is correct. Check the reservation details and confirm the handover.",
      confirming: "Confirming handover…",
      success: "Handed over. The reservation now continues until the item is returned.",
      genericError: "Handover could not be confirmed. Please try again."
    },
    de: {
      pinTitle: "PIN für die Übergabe",
      pinHint: "Geben Sie diesen 6-stelligen PIN dem Eigentümer erst bei der persönlichen Übergabe des Gegenstands.",
      pinLoading: "PIN wird geladen…",
      pinUnavailable: "Der PIN ist derzeit nicht verfügbar. Laden Sie die Seite neu und versuchen Sie es erneut.",
      handoffTitle: "Übergeben Sie einen Gegenstand?",
      handoffText: "Geben Sie den 6-stelligen PIN des Mieters ein. Rentulo findet die richtige Reservierung.",
      handoffOpen: "PIN eingeben",
      handoffCancel: "Abbrechen",
      handoffInput: "6-stelliger PIN",
      verifying: "PIN wird geprüft…",
      invalid: "Der PIN ist nicht korrekt.",
      remainingOne: "1 Versuch verbleibt.",
      remainingMany: "{count} Versuche verbleiben.",
      locked: "Nach 3 falschen Versuchen ist die PIN-Eingabe für 15 Minuten gesperrt.",
      lockedUntil: "Versuchen Sie es nach {time} erneut.",
      matched: "PIN bestätigt. Prüfen Sie unten die Reservierung und bestätigen Sie die Übergabe.",
      showReservations: "Reservierungen anzeigen",
      confirmAction: "Übergabe bestätigen",
      matchedNote: "Der PIN ist korrekt. Prüfen Sie die Reservierungsdaten und bestätigen Sie die Übergabe.",
      confirming: "Übergabe wird bestätigt…",
      success: "Übergeben. Die Reservierung läuft nun bis zur Rückgabe weiter.",
      genericError: "Die Übergabe konnte nicht bestätigt werden. Bitte versuchen Sie es erneut."
    },
    pl: {
      pinTitle: "PIN odbioru",
      pinHint: "Podaj ten 6-cyfrowy PIN właścicielowi dopiero podczas osobistego przekazania przedmiotu.",
      pinLoading: "Ładowanie PIN-u…",
      pinUnavailable: "PIN nie jest teraz dostępny. Odśwież stronę i spróbuj ponownie.",
      handoffTitle: "Przekazujesz przedmiot najemcy?",
      handoffText: "Wpisz 6-cyfrowy PIN najemcy. Rentulo znajdzie właściwą rezerwację.",
      handoffOpen: "Wpisz PIN",
      handoffCancel: "Anuluj",
      handoffInput: "6-cyfrowy PIN",
      verifying: "Sprawdzam PIN…",
      invalid: "PIN jest nieprawidłowy.",
      remainingOne: "Pozostała 1 próba.",
      remainingMany: "Pozostały {count} próby.",
      locked: "Po 3 błędnych próbach wpisywanie PIN-u jest zablokowane na 15 minut.",
      lockedUntil: "Spróbuj ponownie po {time}.",
      matched: "PIN zweryfikowany. Sprawdź rezerwację poniżej i potwierdź przekazanie.",
      showReservations: "Pokaż rezerwacje",
      confirmAction: "Potwierdź przekazanie",
      matchedNote: "PIN jest prawidłowy. Sprawdź dane rezerwacji i potwierdź przekazanie przedmiotu.",
      confirming: "Potwierdzam przekazanie…",
      success: "Przekazano. Rezerwacja trwa teraz do momentu zwrotu przedmiotu.",
      genericError: "Nie udało się potwierdzić przekazania. Spróbuj ponownie."
    }
  };

  let verifiedReservationId = "";
  let verifiedPin = "";
  let confirmingPickup = false;

  function language() {
    const value = typeof window.getRentuloLanguage === "function"
      ? window.getRentuloLanguage()
      : document.documentElement.lang || "cs";
    return Object.prototype.hasOwnProperty.call(TEXT, value) ? value : "cs";
  }

  function text(key, values) {
    let value = TEXT[language()][key] || TEXT.cs[key] || key;
    if (values) {
      Object.keys(values).forEach(function (name) {
        value = value.replaceAll("{" + name + "}", String(values[name]));
      });
    }
    return value;
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function getClient() {
    return typeof window.getSupabaseClient === "function"
      ? window.getSupabaseClient()
      : null;
  }

  async function invoke(name, body) {
    const client = getClient();
    if (!client) return { ok: false, status: 0, data: null };

    const result = await client.functions.invoke(name, { body: body });
    if (!result.error) return { ok: true, status: 200, data: result.data || {} };

    let payload = null;
    let status = 0;
    try {
      if (result.error.context) {
        status = Number(result.error.context.status || 0);
        if (typeof result.error.context.clone === "function") {
          payload = await result.error.context.clone().json();
        } else if (typeof result.error.context.json === "function") {
          payload = await result.error.context.json();
        }
      }
    } catch (_error) {
      payload = null;
    }

    return { ok: false, status: status, data: payload };
  }

  function formatLockTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  function setOwnerMessage(message, tone) {
    const element = document.getElementById("accountMessage");
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("error", tone === "error");
    element.classList.add("active");
  }

  function getHandoffElements() {
    return {
      wrapper: document.getElementById("pickupHandoffEntry"),
      title: document.getElementById("pickupHandoffTitle"),
      description: document.getElementById("pickupHandoffDescription"),
      openButton: document.getElementById("pickupHandoffOpen"),
      form: document.getElementById("pickupHandoffForm"),
      input: document.getElementById("pickupHandoffPin"),
      cancelButton: document.getElementById("pickupHandoffCancel"),
      feedback: document.getElementById("pickupHandoffFeedback")
    };
  }

  function refreshHandoffText() {
    const elements = getHandoffElements();
    if (!elements.wrapper) return;
    if (elements.title) elements.title.textContent = text("handoffTitle");
    if (elements.description) elements.description.textContent = text("handoffText");
    if (elements.openButton) elements.openButton.textContent = text("handoffOpen");
    if (elements.cancelButton) elements.cancelButton.textContent = text("handoffCancel");
    if (elements.input) elements.input.setAttribute("aria-label", text("handoffInput"));
  }

  function clearVerifiedReservation() {
    verifiedReservationId = "";
    verifiedPin = "";
    document.querySelectorAll(".pickup-matched-reservation").forEach(function (card) {
      card.classList.remove("pickup-matched-reservation");
    });
    document.querySelectorAll(".pickup-verified-note").forEach(function (note) { note.remove(); });
  }

  function updateOwnerPickupButtons() {
    const buttons = Array.from(document.querySelectorAll('[data-offers-action="mark-picked-up"]'));
    const elements = getHandoffElements();

    buttons.forEach(function (button) {
      const reservationId = button.dataset.reservationId || "";
      const isVerified = Boolean(verifiedReservationId && reservationId === verifiedReservationId);
      const shouldBeHidden = !isVerified;
      if (button.hidden !== shouldBeHidden) button.hidden = shouldBeHidden;
      if (isVerified) {
        const label = text("confirmAction");
        if (button.textContent !== label) button.textContent = label;
        button.classList.add("pickup-confirm-ready");
      } else {
        button.classList.remove("pickup-confirm-ready");
      }
    });

    document.querySelectorAll(".simple-offer-record").forEach(function (record) {
      const panel = record.querySelector(":scope > .request-panel");
      const primary = record.querySelector(':scope > .simple-offer-row > .simple-offer-actions > [data-offers-action="open-offer-requests"]');
      if (!panel || !primary) return;

      const hasPickup = Boolean(panel.querySelector('[data-offers-action="mark-picked-up"]'));
      const hasOtherOwnerAction = Boolean(panel.querySelector('[data-offers-action="approve-reservation"], [data-offers-action="reject-reservation"]'));
      if (hasPickup && !hasOtherOwnerAction) {
        const label = text("showReservations");
        if (primary.textContent !== label) primary.textContent = label;
        primary.classList.remove("urgent");
      }
    });

    if (elements.wrapper) {
      const shouldBeHidden = buttons.length === 0;
      if (elements.wrapper.hidden !== shouldBeHidden) elements.wrapper.hidden = shouldBeHidden;
    }
  }

  function openHandoffForm() {
    const elements = getHandoffElements();
    if (!elements.form || !elements.input || !elements.openButton) return;
    clearVerifiedReservation();
    updateOwnerPickupButtons();
    elements.openButton.hidden = true;
    elements.form.hidden = false;
    elements.input.value = "";
    elements.input.disabled = false;
    if (elements.cancelButton) elements.cancelButton.disabled = false;
    if (elements.feedback) {
      elements.feedback.textContent = "";
      elements.feedback.classList.remove("success");
    }
    setTimeout(function () { elements.input.focus(); }, 0);
  }

  function closeHandoffForm() {
    const elements = getHandoffElements();
    if (!elements.form || !elements.openButton) return;
    elements.form.hidden = true;
    elements.openButton.hidden = false;
    if (elements.feedback) {
      elements.feedback.textContent = "";
      elements.feedback.classList.remove("success");
    }
  }

  function showMatchedReservation(reservationId) {
    const button = document.querySelector('[data-offers-action="mark-picked-up"][data-reservation-id="' + CSS.escape(reservationId) + '"]');
    if (!button) return false;

    const card = button.closest(".request-card");
    const panel = button.closest(".request-panel");
    if (!card || !panel) return false;

    panel.classList.add("open");
    card.classList.add("pickup-matched-reservation");

    let note = card.querySelector(":scope > .pickup-verified-note");
    if (!note) {
      note = document.createElement("div");
      note.className = "pickup-verified-note";
      card.insertBefore(note, card.firstChild);
    }
    note.textContent = text("matchedNote");

    updateOwnerPickupButtons();
    setTimeout(function () {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      button.focus({ preventScroll: true });
    }, 0);
    return true;
  }

  async function resolveHandoffPin() {
    const elements = getHandoffElements();
    if (!elements.input || !elements.feedback) return;
    const pin = elements.input.value.trim();
    if (!/^\d{6}$/.test(pin) || elements.form?.dataset.submitting === "true") return;

    elements.form.dataset.submitting = "true";
    elements.input.disabled = true;
    if (elements.cancelButton) elements.cancelButton.disabled = true;
    elements.feedback.textContent = text("verifying");
    elements.feedback.classList.remove("success");

    try {
      const result = await invoke("resolve-pickup-pin", { pin: pin });
      const data = result.data || {};

      if (result.ok && data.status === "verified" && data.reservation_id) {
        verifiedReservationId = String(data.reservation_id);
        verifiedPin = pin;
        elements.feedback.textContent = text("matched");
        elements.feedback.classList.add("success");
        if (!showMatchedReservation(verifiedReservationId)) {
          clearVerifiedReservation();
          elements.feedback.classList.remove("success");
          elements.feedback.textContent = text("genericError");
          return;
        }
        return;
      }

      if (data.code === "locked") {
        const time = formatLockTime(data.locked_until);
        elements.feedback.textContent = time
          ? text("locked") + " " + text("lockedUntil", { time: time })
          : text("locked");
        return;
      }

      if (data.code === "invalid_pin") {
        const remaining = Number(data.attempts_remaining || 0);
        elements.feedback.textContent = text("invalid") + " " + (
          remaining === 1 ? text("remainingOne") : text("remainingMany", { count: remaining })
        );
        elements.input.value = "";
        return;
      }

      elements.feedback.textContent = text("genericError");
    } finally {
      if (elements.form && elements.form.isConnected) {
        elements.form.dataset.submitting = "false";
        if (!verifiedReservationId) {
          elements.input.disabled = false;
          if (elements.cancelButton) elements.cancelButton.disabled = false;
          elements.input.focus();
        }
      }
    }
  }

  async function confirmVerifiedPickup(button) {
    if (confirmingPickup) return;
    const reservationId = button.dataset.reservationId || "";
    if (!reservationId || reservationId !== verifiedReservationId || !/^\d{6}$/.test(verifiedPin)) return;

    confirmingPickup = true;
    button.disabled = true;
    button.textContent = text("confirming");

    try {
      const result = await invoke("confirm-pickup", {
        reservation_id: reservationId,
        pin: verifiedPin
      });

      if (result.ok && result.data && result.data.status === "picked_up") {
        if (typeof window.apiSendReservationEmail === "function") {
          try {
            await window.apiSendReservationEmail(reservationId, "picked_up");
          } catch (_error) {
            // Pickup remains confirmed even if the optional notification fails.
          }
        }
        setOwnerMessage(text("success"), "success");
        window.setTimeout(function () { window.location.reload(); }, 500);
        return;
      }

      const data = result.data || {};
      if (data.code === "locked") {
        const time = formatLockTime(data.locked_until);
        setOwnerMessage(time ? text("locked") + " " + text("lockedUntil", { time: time }) : text("locked"), "error");
      } else {
        setOwnerMessage(text("genericError"), "error");
      }
    } finally {
      confirmingPickup = false;
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = text("confirmAction");
      }
    }
  }

  function interceptOwnerPickup(event) {
    const button = event.target.closest('[data-offers-action="mark-picked-up"]');
    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const reservationId = button.dataset.reservationId || "";
    if (reservationId === verifiedReservationId && verifiedPin) {
      confirmVerifiedPickup(button);
      return;
    }

    const elements = getHandoffElements();
    if (elements.wrapper) elements.wrapper.scrollIntoView({ behavior: "smooth", block: "center" });
    openHandoffForm();
  }

  async function loadRenterPin(row, reservationId, block) {
    const result = await invoke("get-pickup-pin", { reservation_id: reservationId });
    if (!row.isConnected || !block.isConnected) return;

    if (!result.ok || !result.data || !/^\d{6}$/.test(String(result.data.pin || ""))) {
      block.innerHTML = `<strong>${escapeHtml(text("pinTitle"))}</strong><span>${escapeHtml(text("pinUnavailable"))}</span>`;
      return;
    }

    block.innerHTML = `
      <div class="pickup-pin-copy">
        <strong>${escapeHtml(text("pinTitle"))}</strong>
        <span class="pickup-pin-value" aria-label="${escapeHtml(text("pinTitle"))}">${escapeHtml(result.data.pin)}</span>
      </div>
      <p>${escapeHtml(text("pinHint"))}</p>
    `;
  }

  function enhanceRenterRows() {
    document.querySelectorAll(".simple-reservation-row").forEach(function (row) {
      const paidStatus = row.querySelector(".simple-reservation-status.status-paid");
      if (!paidStatus || row.dataset.pickupPinEnhanced === "true") return;

      const detailButton = row.querySelector('[data-reservations-action="toggle-detail"][data-reservation-id]');
      const reservationId = detailButton ? detailButton.dataset.reservationId || "" : "";
      if (!reservationId) return;

      row.dataset.pickupPinEnhanced = "true";
      const block = document.createElement("section");
      block.className = "pickup-pin-card";
      block.setAttribute("aria-live", "polite");
      block.innerHTML = `<strong>${escapeHtml(text("pinTitle"))}</strong><span>${escapeHtml(text("pinLoading"))}</span>`;

      const detailRow = row.querySelector(".detail-row");
      if (detailRow) row.insertBefore(block, detailRow);
      else row.appendChild(block);

      loadRenterPin(row, reservationId, block);
    });
  }

  function resetRenterEnhancements() {
    document.querySelectorAll(".pickup-pin-card").forEach(function (element) { element.remove(); });
    document.querySelectorAll('[data-pickup-pin-enhanced="true"]').forEach(function (row) {
      delete row.dataset.pickupPinEnhanced;
    });
    enhanceRenterRows();
  }

  function initializeHandoffEntry() {
    const elements = getHandoffElements();
    if (!elements.wrapper) return;

    refreshHandoffText();
    if (elements.openButton) elements.openButton.addEventListener("click", openHandoffForm);
    if (elements.cancelButton) elements.cancelButton.addEventListener("click", closeHandoffForm);
    if (elements.input) {
      elements.input.addEventListener("input", function (event) {
        event.target.value = event.target.value.replace(/\D/g, "").slice(0, 6);
        if (/^\d{6}$/.test(event.target.value)) resolveHandoffPin();
      });
    }
  }

  let ownerPickupRefreshScheduled = false;
  function scheduleOwnerPickupRefresh() {
    if (ownerPickupRefreshScheduled) return;
    ownerPickupRefreshScheduled = true;
    window.requestAnimationFrame(function () {
      ownerPickupRefreshScheduled = false;
      updateOwnerPickupButtons();
      if (verifiedReservationId) showMatchedReservation(verifiedReservationId);
    });
  }

  document.addEventListener("click", interceptOwnerPickup, true);
  document.addEventListener("rentuloLanguageChanged", function () {
    refreshHandoffText();
    resetRenterEnhancements();
    scheduleOwnerPickupRefresh();
  });

  document.addEventListener("DOMContentLoaded", function () {
    initializeHandoffEntry();

    const reservationsList = document.getElementById("reservationsList");
    if (reservationsList) {
      const observer = new MutationObserver(function () { enhanceRenterRows(); });
      observer.observe(reservationsList, { childList: true, subtree: true });
      enhanceRenterRows();
    }

    const offersList = document.getElementById("offersList");
    if (offersList) {
      const observer = new MutationObserver(scheduleOwnerPickupRefresh);
      observer.observe(offersList, { childList: true, subtree: true });
      scheduleOwnerPickupRefresh();
    }
  });
})();
