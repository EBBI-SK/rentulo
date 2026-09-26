(function () {
  "use strict";

  const TEXT = {
    cs: {
      pinTitle: "PIN pro převzetí",
      pinHint: "Tento 6místný PIN sdělte majiteli až při osobním předání věci.",
      pinLoading: "Načítám PIN…",
      pinUnavailable: "PIN teď není dostupný. Obnovte stránku a zkuste to znovu.",
      ownerAction: "Předat věc",
      ownerGuide: "Při předání budete potřebovat 6místný PIN od nájemce.",
      inlineTitle: "Zadejte 6místný PIN od nájemce",
      inlineHint: "Po zadání poslední číslice se předání potvrdí automaticky.",
      cancel: "Zrušit",
      invalid: "PIN není správný.",
      remainingOne: "Zbývá 1 pokus.",
      remainingMany: "Zbývají {count} pokusy.",
      locked: "Po 3 chybných pokusech je zadávání na 15 minut zablokované.",
      lockedUntil: "Zkuste to znovu po {time}.",
      verifying: "Ověřuji PIN…",
      success: "Předáno. Rezervace pokračuje až do vrácení věci.",
      genericError: "Předání se nepodařilo potvrdit. Zkuste to prosím znovu."
    },
    sk: {
      pinTitle: "PIN na prevzatie",
      pinHint: "Tento 6-miestny PIN povedzte majiteľovi až pri osobnom odovzdaní veci.",
      pinLoading: "Načítavam PIN…",
      pinUnavailable: "PIN teraz nie je dostupný. Obnovte stránku a skúste to znova.",
      ownerAction: "Odovzdať vec",
      ownerGuide: "Pri odovzdaní budete potrebovať 6-miestny PIN od nájomcu.",
      inlineTitle: "Zadajte 6-miestny PIN od nájomcu",
      inlineHint: "Po zadaní poslednej číslice sa odovzdanie potvrdí automaticky.",
      cancel: "Zrušiť",
      invalid: "PIN nie je správny.",
      remainingOne: "Zostáva 1 pokus.",
      remainingMany: "Zostávajú {count} pokusy.",
      locked: "Po 3 chybných pokusoch je zadávanie na 15 minút zablokované.",
      lockedUntil: "Skúste to znova po {time}.",
      verifying: "Overujem PIN…",
      success: "Odovzdané. Rezervácia pokračuje až do vrátenia veci.",
      genericError: "Odovzdanie sa nepodarilo potvrdiť. Skúste to prosím znova."
    },
    en: {
      pinTitle: "Pickup PIN",
      pinHint: "Give this 6-digit PIN to the owner only when the item is physically handed over.",
      pinLoading: "Loading PIN…",
      pinUnavailable: "The PIN is not available right now. Refresh the page and try again.",
      ownerAction: "Hand over item",
      ownerGuide: "At handover you will need the renter's 6-digit PIN.",
      inlineTitle: "Enter the renter's 6-digit PIN",
      inlineHint: "Handover is confirmed automatically after the last digit.",
      cancel: "Cancel",
      invalid: "The PIN is incorrect.",
      remainingOne: "1 attempt remaining.",
      remainingMany: "{count} attempts remaining.",
      locked: "After 3 incorrect attempts, PIN entry is locked for 15 minutes.",
      lockedUntil: "Try again after {time}.",
      verifying: "Checking PIN…",
      success: "Handed over. The reservation now continues until the item is returned.",
      genericError: "Handover could not be confirmed. Please try again."
    },
    de: {
      pinTitle: "PIN für die Übergabe",
      pinHint: "Geben Sie diesen 6-stelligen PIN dem Eigentümer erst bei der persönlichen Übergabe des Gegenstands.",
      pinLoading: "PIN wird geladen…",
      pinUnavailable: "Der PIN ist derzeit nicht verfügbar. Laden Sie die Seite neu und versuchen Sie es erneut.",
      ownerAction: "Gegenstand übergeben",
      ownerGuide: "Bei der Übergabe benötigen Sie den 6-stelligen PIN des Mieters.",
      inlineTitle: "6-stelligen PIN des Mieters eingeben",
      inlineHint: "Nach der letzten Ziffer wird die Übergabe automatisch bestätigt.",
      cancel: "Abbrechen",
      invalid: "Der PIN ist nicht korrekt.",
      remainingOne: "1 Versuch verbleibt.",
      remainingMany: "{count} Versuche verbleiben.",
      locked: "Nach 3 falschen Versuchen ist die PIN-Eingabe für 15 Minuten gesperrt.",
      lockedUntil: "Versuchen Sie es nach {time} erneut.",
      verifying: "PIN wird geprüft…",
      success: "Übergeben. Die Reservierung läuft nun bis zur Rückgabe weiter.",
      genericError: "Die Übergabe konnte nicht bestätigt werden. Bitte versuchen Sie es erneut."
    },
    pl: {
      pinTitle: "PIN odbioru",
      pinHint: "Podaj ten 6-cyfrowy PIN właścicielowi dopiero podczas osobistego przekazania przedmiotu.",
      pinLoading: "Ładowanie PIN-u…",
      pinUnavailable: "PIN nie jest teraz dostępny. Odśwież stronę i spróbuj ponownie.",
      ownerAction: "Przekaż przedmiot",
      ownerGuide: "Przy przekazaniu potrzebny będzie 6-cyfrowy PIN najemcy.",
      inlineTitle: "Wpisz 6-cyfrowy PIN najemcy",
      inlineHint: "Po wpisaniu ostatniej cyfry przekazanie zostanie potwierdzone automatycznie.",
      cancel: "Anuluj",
      invalid: "PIN jest nieprawidłowy.",
      remainingOne: "Pozostała 1 próba.",
      remainingMany: "Pozostały {count} próby.",
      locked: "Po 3 błędnych próbach wpisywanie PIN-u jest zablokowane na 15 minut.",
      lockedUntil: "Spróbuj ponownie po {time}.",
      verifying: "Sprawdzam PIN…",
      success: "Przekazano. Rezerwacja trwa teraz do momentu zwrotu przedmiotu.",
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

  function closeInlineForms(exceptCard) {
    document.querySelectorAll(".pickup-inline-confirm").forEach(function (form) {
      const card = form.closest(".request-card");
      if (card !== exceptCard) form.remove();
    });
  }

  function buildInlineForm(card, reservationId, returnFocus) {
    closeInlineForms(card);
    let form = card.querySelector(":scope > .pickup-inline-confirm");
    if (form) {
      const input = form.querySelector(".pickup-inline-input");
      if (input) input.focus();
      return;
    }

    form = document.createElement("section");
    form.className = "pickup-inline-confirm";
    form.dataset.reservationId = reservationId;
    form.innerHTML = `
      <div class="pickup-inline-copy">
        <strong>${escapeHtml(text("inlineTitle"))}</strong>
        <span>${escapeHtml(text("inlineHint"))}</span>
      </div>
      <div class="pickup-inline-entry">
        <input class="pickup-inline-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" aria-label="${escapeHtml(text("inlineTitle"))}" />
        <button type="button" class="pickup-inline-cancel">${escapeHtml(text("cancel"))}</button>
      </div>
      <p class="pickup-inline-feedback" role="status" aria-live="polite"></p>
    `;

    const row = card.querySelector(":scope > .request-row");
    const detail = card.querySelector(":scope > .request-detail");
    if (detail) card.insertBefore(form, detail);
    else if (row && row.nextSibling) card.insertBefore(form, row.nextSibling);
    else card.appendChild(form);

    const input = form.querySelector(".pickup-inline-input");
    const cancel = form.querySelector(".pickup-inline-cancel");

    cancel.addEventListener("click", function () {
      form.remove();
      if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === "function") {
        returnFocus.focus();
      }
    });

    input.addEventListener("input", function (event) {
      event.target.value = event.target.value.replace(/\D/g, "").slice(0, 6);
      if (/^\d{6}$/.test(event.target.value) && form.dataset.submitting !== "true") {
        submitInlinePickup(form, returnFocus);
      }
    });

    setTimeout(function () { input.focus(); }, 0);
  }

  async function submitInlinePickup(form, returnFocus) {
    const reservationId = form.dataset.reservationId || "";
    if (!reservationId || form.dataset.submitting === "true") return;

    const input = form.querySelector(".pickup-inline-input");
    const cancel = form.querySelector(".pickup-inline-cancel");
    const feedback = form.querySelector(".pickup-inline-feedback");
    const pin = input.value.trim();
    if (!/^\d{6}$/.test(pin)) return;

    form.dataset.submitting = "true";
    input.disabled = true;
    cancel.disabled = true;
    feedback.textContent = text("verifying");

    try {
      const result = await invoke("confirm-pickup", { reservation_id: reservationId, pin: pin });

      if (result.ok && result.data && result.data.status === "picked_up") {
        feedback.classList.add("success");
        feedback.textContent = text("success");

        if (typeof window.apiSendReservationEmail === "function") {
          try {
            await window.apiSendReservationEmail(reservationId, "picked_up");
          } catch (_error) {
            // Pickup remains confirmed even if the optional notification fails.
          }
        }

        window.setTimeout(function () {
          setOwnerMessage(text("success"), "success");
          window.location.reload();
        }, 700);
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
          remaining === 1 ? text("remainingOne") : text("remainingMany", { count: remaining })
        );
        input.value = "";
        input.focus();
        return;
      }

      feedback.textContent = text("genericError");
    } finally {
      if (form.isConnected && !feedback.classList.contains("success")) {
        input.disabled = false;
        cancel.disabled = false;
        form.dataset.submitting = "false";
      }
    }
  }

  function interceptOwnerPickup(event) {
    const button = event.target.closest('[data-offers-action="mark-picked-up"]');
    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const reservationId = button.dataset.reservationId || "";
    const card = button.closest(".request-card");
    if (!reservationId || !card) return;
    buildInlineForm(card, reservationId, button);
  }

  function streamlineOwnerPickupActions() {
    document.querySelectorAll(".simple-offer-record").forEach(function (record) {
      const panel = record.querySelector(":scope > .request-panel");
      if (!panel) return;

      const pickupButtons = Array.from(panel.querySelectorAll('[data-offers-action="mark-picked-up"]'));
      if (!pickupButtons.length) return;

      const ownerActionText = text("ownerAction");
      pickupButtons.forEach(function (button) {
        if (button.textContent !== ownerActionText) button.textContent = ownerActionText;
      });

      const info = record.querySelector(":scope > .simple-offer-row .simple-offer-info");
      if (info) {
        let guide = info.querySelector(":scope > .pickup-owner-guide");
        if (!guide) {
          guide = document.createElement("span");
          guide.className = "pickup-owner-guide";
          info.appendChild(guide);
        }
        if (guide.textContent !== text("ownerGuide")) guide.textContent = text("ownerGuide");
      }

      const primary = record.querySelector(':scope > .simple-offer-row > .simple-offer-actions > .offer-primary-button[data-offers-action="open-offer-requests"]');
      if (primary && !panel.classList.contains("open")) {
        primary.classList.add("pickup-primary-handover");
        primary.setAttribute("aria-label", ownerActionText);
        primary.style.setProperty("--pickup-action-label", '"' + ownerActionText.replaceAll('"', "") + '"');
      } else if (primary) {
        primary.classList.remove("pickup-primary-handover");
        primary.removeAttribute("aria-label");
        primary.style.removeProperty("--pickup-action-label");
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

  document.addEventListener("click", interceptOwnerPickup, true);
  document.addEventListener("rentuloLanguageChanged", function () {
    document.querySelectorAll(".pickup-inline-confirm").forEach(function (form) { form.remove(); });
    resetRenterEnhancements();
    streamlineOwnerPickupActions();
  });

  document.addEventListener("DOMContentLoaded", function () {
    const reservationsList = document.getElementById("reservationsList");
    if (reservationsList) {
      const observer = new MutationObserver(function () { enhanceRenterRows(); });
      observer.observe(reservationsList, { childList: true, subtree: true });
      enhanceRenterRows();
    }

    const offersList = document.getElementById("offersList");
    if (offersList) {
      const observer = new MutationObserver(function () { streamlineOwnerPickupActions(); });
      observer.observe(offersList, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
      streamlineOwnerPickupActions();
    }
  });
})();
