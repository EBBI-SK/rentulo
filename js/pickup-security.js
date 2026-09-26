(function () {
  "use strict";

  const TEXT = {
    cs: {
      pinTitle: "PIN pro převzetí",
      pinHint: "Tento 6místný PIN sdělte majiteli až při osobním předání věci.",
      pinLoading: "Načítám PIN…",
      pinUnavailable: "PIN teď není dostupný. Obnovte stránku a zkuste to znovu.",
      modalTitle: "Potvrdit předání",
      modalText: "Zadejte 6místný PIN od nájemce. Po zadání poslední číslice se předání potvrdí automaticky.",
      pinLabel: "6místný PIN",
      ownerAction: "Zadat PIN a potvrdit předání",
      cancel: "Zrušit",
      invalid: "PIN není správný.",
      remainingOne: "Zbývá 1 pokus.",
      remainingMany: "Zbývají {count} pokusy.",
      locked: "Po 3 chybných pokusech je zadávání na 15 minut zablokované.",
      lockedUntil: "Zkuste to znovu po {time}.",
      verifying: "Ověřuji PIN…",
      success: "Předání potvrzeno.",
      genericError: "Předání se nepodařilo potvrdit. Zkuste to prosím znovu."
    },
    sk: {
      pinTitle: "PIN na prevzatie",
      pinHint: "Tento 6-miestny PIN povedzte majiteľovi až pri osobnom odovzdaní veci.",
      pinLoading: "Načítavam PIN…",
      pinUnavailable: "PIN teraz nie je dostupný. Obnovte stránku a skúste to znova.",
      modalTitle: "Potvrdiť odovzdanie",
      modalText: "Zadajte 6-miestny PIN od nájomcu. Po zadaní poslednej číslice sa odovzdanie potvrdí automaticky.",
      pinLabel: "6-miestny PIN",
      ownerAction: "Zadať PIN a potvrdiť odovzdanie",
      cancel: "Zrušiť",
      invalid: "PIN nie je správny.",
      remainingOne: "Zostáva 1 pokus.",
      remainingMany: "Zostávajú {count} pokusy.",
      locked: "Po 3 chybných pokusoch je zadávanie na 15 minút zablokované.",
      lockedUntil: "Skúste to znova po {time}.",
      verifying: "Overujem PIN…",
      success: "Odovzdanie potvrdené.",
      genericError: "Odovzdanie sa nepodarilo potvrdiť. Skúste to prosím znova."
    },
    en: {
      pinTitle: "Pickup PIN",
      pinHint: "Give this 6-digit PIN to the owner only when the item is physically handed over.",
      pinLoading: "Loading PIN…",
      pinUnavailable: "The PIN is not available right now. Refresh the page and try again.",
      modalTitle: "Confirm handover",
      modalText: "Enter the renter's 6-digit PIN. Handover is confirmed automatically after the last digit.",
      pinLabel: "6-digit PIN",
      ownerAction: "Enter PIN and confirm handover",
      cancel: "Cancel",
      invalid: "The PIN is incorrect.",
      remainingOne: "1 attempt remaining.",
      remainingMany: "{count} attempts remaining.",
      locked: "After 3 incorrect attempts, PIN entry is locked for 15 minutes.",
      lockedUntil: "Try again after {time}.",
      verifying: "Checking PIN…",
      success: "Handover confirmed.",
      genericError: "Handover could not be confirmed. Please try again."
    },
    de: {
      pinTitle: "PIN für die Übergabe",
      pinHint: "Geben Sie diesen 6-stelligen PIN dem Eigentümer erst bei der persönlichen Übergabe des Gegenstands.",
      pinLoading: "PIN wird geladen…",
      pinUnavailable: "Der PIN ist derzeit nicht verfügbar. Laden Sie die Seite neu und versuchen Sie es erneut.",
      modalTitle: "Übergabe bestätigen",
      modalText: "Geben Sie den 6-stelligen PIN des Mieters ein. Nach der letzten Ziffer wird die Übergabe automatisch bestätigt.",
      pinLabel: "6-stelliger PIN",
      ownerAction: "PIN eingeben und Übergabe bestätigen",
      cancel: "Abbrechen",
      invalid: "Der PIN ist nicht korrekt.",
      remainingOne: "1 Versuch verbleibt.",
      remainingMany: "{count} Versuche verbleiben.",
      locked: "Nach 3 falschen Versuchen ist die PIN-Eingabe für 15 Minuten gesperrt.",
      lockedUntil: "Versuchen Sie es nach {time} erneut.",
      verifying: "PIN wird geprüft…",
      success: "Übergabe bestätigt.",
      genericError: "Die Übergabe konnte nicht bestätigt werden. Bitte versuchen Sie es erneut."
    },
    pl: {
      pinTitle: "PIN odbioru",
      pinHint: "Podaj ten 6-cyfrowy PIN właścicielowi dopiero podczas osobistego przekazania przedmiotu.",
      pinLoading: "Ładowanie PIN-u…",
      pinUnavailable: "PIN nie jest teraz dostępny. Odśwież stronę i spróbuj ponownie.",
      modalTitle: "Potwierdź przekazanie",
      modalText: "Wpisz 6-cyfrowy PIN najemcy. Po wpisaniu ostatniej cyfry przekazanie zostanie potwierdzone automatycznie.",
      pinLabel: "6-cyfrowy PIN",
      ownerAction: "Wpisz PIN i potwierdź przekazanie",
      cancel: "Anuluj",
      invalid: "PIN jest nieprawidłowy.",
      remainingOne: "Pozostała 1 próba.",
      remainingMany: "Pozostały {count} próby.",
      locked: "Po 3 błędnych próbach wpisywanie PIN-u jest zablokowane na 15 minut.",
      lockedUntil: "Spróbuj ponownie po {time}.",
      verifying: "Sprawdzam PIN…",
      success: "Przekazanie potwierdzone.",
      genericError: "Nie udało się potwierdzić przekazania. Spróbuj ponownie."
    }
  };

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
    if (!client) {
      return { ok: false, status: 0, data: null };
    }

    const result = await client.functions.invoke(name, { body: body });
    if (!result.error) {
      return { ok: true, status: 200, data: result.data || {} };
    }

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

  let modal = null;
  let modalReservationId = "";
  let modalReturnFocus = null;
  let modalSubmitting = false;

  function ensureModal() {
    if (modal) return modal;

    const wrapper = document.createElement("div");
    wrapper.className = "pickup-confirm-modal";
    wrapper.id = "pickupConfirmModal";
    wrapper.hidden = true;
    wrapper.setAttribute("aria-hidden", "true");
    wrapper.innerHTML = `
      <div class="pickup-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="pickupConfirmTitle" aria-describedby="pickupConfirmDescription">
        <h2 id="pickupConfirmTitle"></h2>
        <p id="pickupConfirmDescription"></p>
        <form id="pickupConfirmForm" novalidate>
          <label class="pickup-pin-label" for="pickupConfirmPin"></label>
          <input id="pickupConfirmPin" class="pickup-pin-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" aria-describedby="pickupConfirmFeedback" />
          <p class="pickup-confirm-feedback" id="pickupConfirmFeedback" role="status" aria-live="polite"></p>
          <div class="pickup-confirm-actions">
            <button type="button" class="pickup-modal-button pickup-modal-cancel" data-pickup-action="cancel"></button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(wrapper);

    wrapper.addEventListener("click", function (event) {
      if (event.target === wrapper || event.target.closest('[data-pickup-action="cancel"]')) {
        closeModal();
      }
    });

    wrapper.querySelector("#pickupConfirmPin").addEventListener("input", function (event) {
      event.target.value = event.target.value.replace(/\D/g, "").slice(0, 6);
      if (/^\d{6}$/.test(event.target.value) && !modalSubmitting) {
        submitPickupPin();
      }
    });

    wrapper.querySelector("#pickupConfirmForm").addEventListener("submit", submitPickupPin);
    modal = wrapper;
    refreshModalText();
    return modal;
  }

  function refreshModalText() {
    if (!modal) return;
    modal.querySelector("#pickupConfirmTitle").textContent = text("modalTitle");
    modal.querySelector("#pickupConfirmDescription").textContent = text("modalText");
    modal.querySelector(".pickup-pin-label").textContent = text("pinLabel");
    modal.querySelector('[data-pickup-action="cancel"]').textContent = text("cancel");
  }

  function openModal(reservationId, returnFocus) {
    const element = ensureModal();
    modalReservationId = reservationId;
    modalReturnFocus = returnFocus || document.activeElement;
    modalSubmitting = false;
    refreshModalText();
    const input = element.querySelector("#pickupConfirmPin");
    input.value = "";
    input.disabled = false;
    element.querySelector("#pickupConfirmFeedback").textContent = "";
    element.querySelector('[data-pickup-action="cancel"]').disabled = false;
    element.hidden = false;
    element.setAttribute("aria-hidden", "false");
    document.body.classList.add("pickup-modal-open");
    setTimeout(function () {
      input.focus();
    }, 0);
  }

  function closeModal() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("pickup-modal-open");
    modalReservationId = "";
    modalSubmitting = false;
    if (modalReturnFocus && modalReturnFocus.isConnected && typeof modalReturnFocus.focus === "function") {
      modalReturnFocus.focus();
    }
    modalReturnFocus = null;
  }

  async function submitPickupPin(event) {
    if (event) event.preventDefault();
    if (!modalReservationId || modalSubmitting) return;

    const input = modal.querySelector("#pickupConfirmPin");
    const feedback = modal.querySelector("#pickupConfirmFeedback");
    const cancelButton = modal.querySelector('[data-pickup-action="cancel"]');
    const pin = input.value.trim();

    if (!/^\d{6}$/.test(pin)) {
      feedback.textContent = text("invalid");
      input.focus();
      return;
    }

    modalSubmitting = true;
    input.disabled = true;
    cancelButton.disabled = true;
    feedback.textContent = text("verifying");

    try {
      const result = await invoke("confirm-pickup", {
        reservation_id: modalReservationId,
        pin: pin
      });

      if (result.ok && result.data && result.data.status === "picked_up") {
        const reservationId = modalReservationId;
        feedback.textContent = text("success");

        if (typeof window.apiSendReservationEmail === "function") {
          try {
            await window.apiSendReservationEmail(reservationId, "picked_up");
          } catch (_error) {
            // Pickup remains confirmed even if the optional notification fails.
          }
        }

        window.setTimeout(function () {
          closeModal();
          setOwnerMessage(text("success"), "success");
          window.location.reload();
        }, 650);
        return;
      }

      const data = result.data || {};
      if (data.code === "locked") {
        const time = formatLockTime(data.locked_until);
        feedback.textContent = time
          ? text("locked") + " " + text("lockedUntil", { time: time })
          : text("locked");
        return;
      }

      if (data.code === "invalid_pin") {
        const remaining = Number(data.attempts_remaining || 0);
        feedback.textContent = text("invalid") + " " + (
          remaining === 1
            ? text("remainingOne")
            : text("remainingMany", { count: remaining })
        );
        input.value = "";
        input.focus();
        return;
      }

      feedback.textContent = text("genericError");
    } finally {
      if (!modal.hidden) {
        input.disabled = false;
        cancelButton.disabled = false;
      }
      modalSubmitting = false;
    }
  }

  function interceptOwnerPickup(event) {
    const button = event.target.closest('[data-offers-action="mark-picked-up"]');
    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const reservationId = button.dataset.reservationId || "";
    if (!reservationId) return;
    openModal(reservationId, button);
  }

  function streamlineOwnerPickupActions() {
    document.querySelectorAll(".simple-offer-record").forEach(function (record) {
      const panel = record.querySelector(":scope > .request-panel");
      if (!panel) return;

      const pickupButtons = Array.from(panel.querySelectorAll('[data-offers-action="mark-picked-up"]'));
      if (!pickupButtons.length) return;

      const ownerActionText = text("ownerAction");
      pickupButtons.forEach(function (button) {
        if (button.textContent !== ownerActionText) {
          button.textContent = ownerActionText;
        }
      });

      const hasOtherImmediateOwnerAction = Boolean(
        panel.querySelector('[data-offers-action="approve-reservation"], [data-offers-action="mark-returned"]')
      );

      if (!hasOtherImmediateOwnerAction) {
        if (!panel.classList.contains("open")) {
          panel.classList.add("open");
        }

        const primary = record.querySelector(':scope > .simple-offer-row > .simple-offer-actions > .offer-primary-button[data-offers-action="open-offer-requests"]');
        if (primary && !primary.hidden) {
          primary.hidden = true;
        }
      }
    });
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
        <span class="pickup-pin-value" aria-label="${escapeHtml(text("pinLabel"))}">${escapeHtml(result.data.pin)}</span>
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
      if (detailRow) {
        row.insertBefore(block, detailRow);
      } else {
        row.appendChild(block);
      }

      loadRenterPin(row, reservationId, block);
    });
  }

  function resetRenterEnhancements() {
    document.querySelectorAll(".pickup-pin-card").forEach(function (element) {
      element.remove();
    });
    document.querySelectorAll('[data-pickup-pin-enhanced="true"]').forEach(function (row) {
      delete row.dataset.pickupPinEnhanced;
    });
    enhanceRenterRows();
  }

  document.addEventListener("click", interceptOwnerPickup, true);
  document.addEventListener("rentuloLanguageChanged", function () {
    refreshModalText();
    resetRenterEnhancements();
    streamlineOwnerPickupActions();
  });

  document.addEventListener("DOMContentLoaded", function () {
    const reservationsList = document.getElementById("reservationsList");
    if (reservationsList) {
      const observer = new MutationObserver(function () {
        enhanceRenterRows();
      });
      observer.observe(reservationsList, { childList: true, subtree: true });
      enhanceRenterRows();
    }

    const offersList = document.getElementById("offersList");
    if (offersList) {
      const observer = new MutationObserver(function () {
        streamlineOwnerPickupActions();
      });
      observer.observe(offersList, { childList: true, subtree: true });
      streamlineOwnerPickupActions();
    }
  });
})();
