(function () {
  "use strict";

  const TEXT = {
    cs: {
      pinTitle: "PIN pro převzetí",
      pinHint: "Tento 6místný PIN sdělte majiteli až při osobním předání věci.",
      pinLoading: "Načítám PIN…",
      pinUnavailable: "PIN teď není dostupný. Obnovte stránku a zkuste to znovu.",
      pinExpired: "Celé zaplacené období již skončilo. PIN není platný.",
      handoffTitle: "Předáváte věc nájemci?",
      handoffText: "Zadejte 6místný PIN od nájemce. Rentulo najde správnou rezervaci za vás.",
      handoffOpen: "Zadat PIN",
      homePinInstructions: "Zadejte 6místný PIN od nájemce. Po ověření se otevře jeho rezervace.",
      verifyPin: "Ověřit PIN",
      closePin: "Zpět",
      verifiedTitle: "PIN ověřen",
      changePin: "Zadat jiný PIN",
      handoffInput: "6místný PIN",
      verifying: "Ověřuji PIN…",
      invalid: "PIN není správný.",
      remainingOne: "Zbývá 1 pokus.",
      remainingMany: "Zbývají {count} pokusy.",
      locked: "Po 3 chybných pokusech je zadávání na 15 minut zablokované.",
      lockedUntil: "Zkuste to znovu po {time}.",
      matched: "PIN ověřen. Zkontrolujte rezervaci a předejte věc.",
      showReservations: "Zobrazit rezervace",
      confirmAction: "Předat věc",
      confirming: "Předávám věc…",
      success: "Předáno. Rezervace pokračuje až do vrácení věci.",
      wrongDay: "PIN lze použít nejdříve 2 hodiny před sjednaným převzetím a nejpozději do sjednaného času vrácení (český čas).",
      tooEarly: "Předání lze potvrdit nejdříve 2 hodiny před sjednaným časem převzetí.",
      genericError: "Předání se nepodařilo potvrdit. Zkuste to prosím znovu."
    },
    sk: {
      pinTitle: "PIN na prevzatie",
      pinHint: "Tento 6-miestny PIN povedzte majiteľovi až pri osobnom odovzdaní veci.",
      pinLoading: "Načítavam PIN…",
      pinUnavailable: "PIN teraz nie je dostupný. Obnovte stránku a skúste to znova.",
      pinExpired: "Celé zaplatené obdobie sa už skončilo. PIN nie je platný.",
      handoffTitle: "Odovzdávate vec nájomcovi?",
      handoffText: "Zadajte 6-miestny PIN od nájomcu. Rentulo nájde správnu rezerváciu za vás.",
      handoffOpen: "Zadať PIN",
      homePinInstructions: "Zadajte 6-miestny PIN od nájomcu. Po overení sa otvorí jeho rezervácia.",
      verifyPin: "Overiť PIN",
      closePin: "Späť",
      verifiedTitle: "PIN overený",
      changePin: "Zadať iný PIN",
      handoffInput: "6-miestny PIN",
      verifying: "Overujem PIN…",
      invalid: "PIN nie je správny.",
      remainingOne: "Zostáva 1 pokus.",
      remainingMany: "Zostávajú {count} pokusy.",
      locked: "Po 3 chybných pokusoch je zadávanie na 15 minút zablokované.",
      lockedUntil: "Skúste to znova po {time}.",
      matched: "PIN je overený. Skontrolujte rezerváciu a odovzdajte vec.",
      showReservations: "Zobraziť rezervácie",
      confirmAction: "Odovzdať vec",
      confirming: "Odovzdávam vec…",
      success: "Odovzdané. Rezervácia pokračuje až do vrátenia veci.",
      wrongDay: "PIN možno použiť najskôr 2 hodiny pred dohodnutým prevzatím a najneskôr do dohodnutého času vrátenia (český čas).",
      tooEarly: "Odovzdanie možno potvrdiť najskôr 2 hodiny pred dohodnutým časom prevzatia.",
      genericError: "Odovzdanie sa nepodarilo potvrdiť. Skúste to prosím znova."
    },
    en: {
      pinTitle: "Pickup PIN",
      pinHint: "Give this 6-digit PIN to the owner only when the item is physically handed over.",
      pinLoading: "Loading PIN…",
      pinUnavailable: "The PIN is not available right now. Refresh the page and try again.",
      pinExpired: "The entire paid rental period has ended. The PIN is no longer valid.",
      handoffTitle: "Handing an item to the renter?",
      handoffText: "Enter the renter's 6-digit PIN. Rentulo will find the correct reservation for you.",
      handoffOpen: "Enter PIN",
      homePinInstructions: "Enter the renter's 6-digit PIN. The matching reservation will open after verification.",
      verifyPin: "Verify PIN",
      closePin: "Back",
      verifiedTitle: "PIN verified",
      changePin: "Enter another PIN",
      handoffInput: "6-digit PIN",
      verifying: "Checking PIN…",
      invalid: "The PIN is incorrect.",
      remainingOne: "1 attempt remaining.",
      remainingMany: "{count} attempts remaining.",
      locked: "After 3 incorrect attempts, PIN entry is locked for 15 minutes.",
      lockedUntil: "Try again after {time}.",
      matched: "PIN verified. Check the reservation and hand over the item.",
      showReservations: "View reservations",
      confirmAction: "Hand over item",
      confirming: "Handing over item…",
      success: "Handed over. The reservation now continues until the item is returned.",
      wrongDay: "The PIN can be used from 2 hours before scheduled pickup until the scheduled return time (Czech time).",
      tooEarly: "Handover can be confirmed no earlier than 2 hours before scheduled pickup.",
      genericError: "Handover could not be confirmed. Please try again."
    },
    de: {
      pinTitle: "PIN für die Übergabe",
      pinHint: "Geben Sie diesen 6-stelligen PIN dem Eigentümer erst bei der persönlichen Übergabe des Gegenstands.",
      pinLoading: "PIN wird geladen…",
      pinUnavailable: "Der PIN ist derzeit nicht verfügbar. Laden Sie die Seite neu und versuchen Sie es erneut.",
      pinExpired: "Der gesamte bezahlte Mietzeitraum ist beendet. Die PIN ist nicht mehr gültig.",
      handoffTitle: "Übergeben Sie einen Gegenstand?",
      handoffText: "Geben Sie den 6-stelligen PIN des Mieters ein. Rentulo findet die richtige Reservierung.",
      handoffOpen: "PIN eingeben",
      homePinInstructions: "Geben Sie die 6-stellige PIN des Mieters ein. Danach öffnet sich die passende Reservierung.",
      verifyPin: "PIN prüfen",
      closePin: "Zurück",
      verifiedTitle: "PIN bestätigt",
      changePin: "Anderen PIN eingeben",
      handoffInput: "6-stelliger PIN",
      verifying: "PIN wird geprüft…",
      invalid: "Der PIN ist nicht korrekt.",
      remainingOne: "1 Versuch verbleibt.",
      remainingMany: "{count} Versuche verbleiben.",
      locked: "Nach 3 falschen Versuchen ist die PIN-Eingabe für 15 Minuten gesperrt.",
      lockedUntil: "Versuchen Sie es nach {time} erneut.",
      matched: "PIN bestätigt. Prüfen Sie die Reservierung und übergeben Sie den Gegenstand.",
      showReservations: "Reservierungen anzeigen",
      confirmAction: "Gegenstand übergeben",
      confirming: "Gegenstand wird übergeben…",
      success: "Übergeben. Die Reservierung läuft nun bis zur Rückgabe weiter.",
      wrongDay: "Die PIN kann ab 2 Stunden vor der vereinbarten Abholzeit bis zur vereinbarten Rückgabezeit verwendet werden (tschechische Zeit).",
      tooEarly: "Die Übergabe kann frühestens 2 Stunden vor der vereinbarten Abholzeit bestätigt werden.",
      genericError: "Die Übergabe konnte nicht bestätigt werden. Bitte versuchen Sie es erneut."
    },
    pl: {
      pinTitle: "PIN odbioru",
      pinHint: "Podaj ten 6-cyfrowy PIN właścicielowi dopiero podczas osobistego przekazania przedmiotu.",
      pinLoading: "Ładowanie PIN-u…",
      pinUnavailable: "PIN nie jest teraz dostępny. Odśwież stronę i spróbuj ponownie.",
      pinExpired: "Cały opłacony okres najmu już minął. PIN jest nieważny.",
      handoffTitle: "Przekazujesz przedmiot najemcy?",
      handoffText: "Wpisz 6-cyfrowy PIN najemcy. Rentulo znajdzie właściwą rezerwację.",
      handoffOpen: "Wpisz PIN",
      homePinInstructions: "Wpisz 6-cyfrowy PIN najemcy. Po weryfikacji otworzy się odpowiednia rezerwacja.",
      verifyPin: "Sprawdź PIN",
      closePin: "Wstecz",
      verifiedTitle: "PIN zweryfikowany",
      changePin: "Wpisz inny PIN",
      handoffInput: "6-cyfrowy PIN",
      verifying: "Sprawdzam PIN…",
      invalid: "PIN jest nieprawidłowy.",
      remainingOne: "Pozostała 1 próba.",
      remainingMany: "Pozostały {count} próby.",
      locked: "Po 3 błędnych próbach wpisywanie PIN-u jest zablokowane na 15 minut.",
      lockedUntil: "Spróbuj ponownie po {time}.",
      matched: "PIN zweryfikowany. Sprawdź rezerwację i przekaż przedmiot.",
      showReservations: "Pokaż rezerwacje",
      confirmAction: "Przekaż przedmiot",
      confirming: "Przekazuję przedmiot…",
      success: "Przekazano. Rezerwacja trwa teraz do momentu zwrotu przedmiotu.",
      wrongDay: "PIN można wykorzystać od 2 godzin przed uzgodnioną godziną odbioru do uzgodnionej godziny zwrotu (czas czeski).",
      tooEarly: "Przekazanie można potwierdzić najwcześniej 2 godziny przed uzgodnioną godziną odbioru.",
      genericError: "Nie udało się potwierdzić przekazania. Spróbuj ponownie."
    }
  };

  let verifiedReservationId = "";
  let verifiedPin = "";
  let confirmingPickup = false;
  let focusedOwnerReservation = false;
  const HANDOFF_SESSION_KEY = "rentuloVerifiedPickupHandoff";
  const HANDOFF_SESSION_TTL_MS = 90 * 1000;

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

  function getPragueCalendarDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(now);
    const values = {};
    parts.forEach(function (part) {
      if (["year", "month", "day"].includes(part.type)) values[part.type] = part.value;
    });
    return values.year + "-" + values.month + "-" + values.day;
  }

  // The UI hides the PIN at the *instant* of the agreed return time, not at
  // midnight. Keep DST overlap/gap resolution aligned with the Edge helper and
  // PostgreSQL AT TIME ZONE 'Europe/Prague'. SQL is the final authority.
  function pragueReturnDeadline(endDate, pickupTime) {
    const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(endDate || ""));
    const time = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,6}))?)?$/.exec(String(pickupTime || ""));
    if (!date || !time) return null;
    const year = Number(date[1]), month = Number(date[2]), day = Number(date[3]);
    const hour = Number(time[1]), minute = Number(time[2]), second = Number(time[3] || 0);
    const millis = Number((time[4] || "").padEnd(3, "0").slice(0, 3));
    const naive = Date.UTC(year, month - 1, day, hour, minute, second, millis);
    const checked = new Date(naive);
    if (checked.getUTCFullYear() !== year || checked.getUTCMonth() + 1 !== month || checked.getUTCDate() !== day) return null;
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Prague", hourCycle: "h23", year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
    function fields(ms) {
      const values = Object.fromEntries(formatter.formatToParts(new Date(ms)).map(function (part) { return [part.type, part.value]; }));
      return {
        year: Number(values.year), month: Number(values.month), day: Number(values.day),
        hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second)
      };
    }
    function timestampKey(v) {
      return [v.year, v.month, v.day, v.hour, v.minute, v.second]
        .map(function (value, index) { return String(value).padStart(index === 0 ? 4 : 2, "0"); }).join("");
    }
    function offset(ms) {
      const v = fields(ms);
      return Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second) - Math.floor(ms / 1000) * 1000;
    }
    const requested = timestampKey({ year: year, month: month, day: day, hour: hour, minute: minute, second: second });
    const offsets = Array.from(new Set([offset(naive - 86400000), offset(naive), offset(naive + 86400000)]));
    const candidates = offsets.map(function (utcOffset) {
      const instant = naive - utcOffset;
      return { instant: instant, local: timestampKey(fields(instant)) };
    });
    const exact = candidates.filter(function (candidate) { return candidate.local === requested; });
    if (exact.length) return Math.max.apply(null, exact.map(function (candidate) { return candidate.instant; }));
    const afterGap = candidates.filter(function (candidate) { return candidate.local > requested; });
    return afterGap.length ? Math.min.apply(null, afterGap.map(function (candidate) { return candidate.instant; })) : null;
  }

  function isExpiredRentalPeriod(endDate, pickupTime, now = new Date()) {
    const deadline = pragueReturnDeadline(endDate, pickupTime);
    // An invalid legacy time is not proof of expiry; the Edge endpoint then
    // rejects PIN access. Never guess midnight for money-sensitive state.
    return deadline !== null && now.getTime() >= deadline;
  }

  function setOwnerMessage(message, tone) {
    const element = document.getElementById("accountMessage");
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("error", tone === "error");
    element.classList.add("active");
  }

  // The owner enters PIN only via the single action on the homepage.
  // Carry it only across the immediate same-tab navigation, never in the URL,
  // never in localStorage. The receiving page consumes the value immediately.
  function storeOwnerHandoff(reservationId, pin, ownerId) {
    try {
      window.sessionStorage.setItem(HANDOFF_SESSION_KEY, JSON.stringify({
        reservationId: reservationId,
        pin: pin,
        ownerId: ownerId,
        createdAt: Date.now()
      }));
      return true;
    } catch (_) {
      return false;
    }
  }

  function consumeOwnerHandoff() {
    try {
      const raw = window.sessionStorage.getItem(HANDOFF_SESSION_KEY);
      window.sessionStorage.removeItem(HANDOFF_SESSION_KEY);
      if (!raw) return null;
      const candidate = JSON.parse(raw);
      if (!candidate || !/^[a-f0-9-]{36}$/i.test(String(candidate.reservationId || "")) ||
          !/^\d{6}$/.test(String(candidate.pin || "")) ||
          !/^[a-f0-9-]{36}$/i.test(String(candidate.ownerId || "")) ||
          !Number.isFinite(candidate.createdAt) ||
          Date.now() - candidate.createdAt < 0 ||
          Date.now() - candidate.createdAt > HANDOFF_SESSION_TTL_MS) return null;
      return candidate;
    } catch (_) {
      return null;
    }
  }

  function updateOwnerPickupButtons() {
    const buttons = document.querySelectorAll('[data-offers-action="mark-picked-up"]');
    buttons.forEach(function (button) {
      const reservationId = button.dataset.reservationId || "";
      const card = button.closest(".owner-reservation-card");
      const isVerified = Boolean(card && verifiedPin && reservationId === verifiedReservationId);
      if (button.hidden === isVerified) button.hidden = !isVerified;
      if (isVerified) {
        if (button.textContent !== text("confirmAction")) button.textContent = text("confirmAction");
        button.classList.add("pickup-confirm-ready");
        if (!focusedOwnerReservation) {
          focusedOwnerReservation = true;
          card.classList.add("owner-pin-target");
          window.requestAnimationFrame(function () {
            if (button.isConnected) {
              card.scrollIntoView({ behavior: "smooth", block: "center" });
              button.focus({ preventScroll: true });
            }
          });
        }
      } else {
        button.classList.remove("pickup-confirm-ready");
      }
    });
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
        verifiedPin = "";
        verifiedReservationId = "";
        setOwnerMessage(text("success"), "success");
        window.setTimeout(function () { window.location.replace("moje-nabidky.html"); }, 500);
        return;
      }

      const data = result.data || {};
      if (data.code === "pickup_wrong_day") {
        setOwnerMessage(text("wrongDay"), "error");
      } else if (data.code === "pickup_not_started") {
        setOwnerMessage(text("tooEarly"), "error");
      } else if (data.code === "locked") {
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
    if (button.dataset.reservationId === verifiedReservationId && verifiedPin) {
      void confirmVerifiedPickup(button);
    }
  }

  function getHomePinElements() {
    return {
      overlay: document.getElementById("homePinModal"),
      title: document.getElementById("homePinTitle"),
      description: document.getElementById("homePinDescription"),
      inputLabel: document.getElementById("homePinInputLabel"),
      form: document.getElementById("homePinForm"),
      input: document.getElementById("homePinInput"),
      submit: document.getElementById("homePinSubmit"),
      cancel: document.getElementById("homePinClose"),
      feedback: document.getElementById("homePinFeedback")
    };
  }

  function updateHomePinText() {
    const e = getHomePinElements();
    if (!e.overlay) return;
    if (e.title) e.title.textContent = text("handoffOpen");
    if (e.description) e.description.textContent = text("homePinInstructions");
    if (e.inputLabel) e.inputLabel.textContent = text("handoffInput");
    if (e.submit) e.submit.textContent = text("verifyPin");
    if (e.cancel) e.cancel.textContent = text("closePin");
  }

  let homePinReturnFocus = null;
  function closeHomePinModal() {
    const e = getHomePinElements();
    if (!e.overlay) return;
    e.overlay.hidden = true;
    e.overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("home-pin-open");
    if (e.input) e.input.value = "";
    if (homePinReturnFocus && homePinReturnFocus.isConnected) homePinReturnFocus.focus();
    homePinReturnFocus = null;
  }

  function openHomePinModal(button) {
    const e = getHomePinElements();
    if (!e.overlay) return;
    homePinReturnFocus = button;
    updateHomePinText();
    e.overlay.hidden = false;
    e.overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("home-pin-open");
    if (e.feedback) e.feedback.textContent = "";
    if (e.input) {
      e.input.disabled = false;
      e.input.value = "";
      e.input.focus();
    }
  }

  async function resolveHomePin() {
    const e = getHomePinElements();
    if (!e.form || !e.input || !e.feedback || e.form.dataset.submitting === "true") return;
    const pin = e.input.value.trim();
    if (!/^\d{6}$/.test(pin)) {
      e.feedback.textContent = text("handoffInput");
      return;
    }

    e.form.dataset.submitting = "true";
    e.input.disabled = true;
    if (e.submit) e.submit.disabled = true;
    e.feedback.textContent = text("verifying");
    try {
      const result = await invoke("resolve-pickup-pin", { pin: pin });
      const data = result.data || {};
      if (result.ok && data.status === "verified" && data.reservation_id &&
          /^[a-f0-9-]{36}$/i.test(String(data.reservation_id))) {
        const owner = typeof getCurrentSupabaseUser === "function"
          ? await getCurrentSupabaseUser() : null;
        if (owner && storeOwnerHandoff(String(data.reservation_id), pin, owner.id)) {
          window.location.assign("moje-nabidky.html#handoff-" + encodeURIComponent(data.reservation_id));
          return;
        }
        e.feedback.textContent = text("genericError");
      } else if (data.code === "locked") {
        const time = formatLockTime(data.locked_until);
        e.feedback.textContent = time ? text("locked") + " " + text("lockedUntil", { time: time }) : text("locked");
      } else if (data.code === "pickup_wrong_day") {
        e.feedback.textContent = text("wrongDay");
      } else if (data.code === "invalid_pin") {
        const remaining = Number(data.attempts_remaining || 0);
        e.feedback.textContent = text("invalid") + " " +
          (remaining === 1 ? text("remainingOne") : text("remainingMany", { count: remaining }));
        e.input.value = "";
      } else {
        e.feedback.textContent = text("genericError");
      }
    } catch (_) {
      e.feedback.textContent = text("genericError");
    } finally {
      e.form.dataset.submitting = "false";
      if (e.input.isConnected) {
        e.input.disabled = false;
        if (e.submit) e.submit.disabled = false;
        if (!e.overlay.hidden) e.input.focus();
      }
    }
  }

  function showExpiredRenterPin(block) {
    block.classList.add("expired");
    block.innerHTML = `<span>${escapeHtml(text("pinExpired"))}</span>`;
  }

  async function loadRenterPin(row, reservationId, block) {
    // Avoid a PIN request at/after the exact Prague-local return time.
    if (isExpiredRentalPeriod(row.dataset.pickupEndDate, row.dataset.pickupTime)) {
      showExpiredRenterPin(block);
      return;
    }

    const result = await invoke("get-pickup-pin", { reservation_id: reservationId });
    if (!row.isConnected || !block.isConnected) return;

    // Also protect the UI if an in-flight request finishes after return time.
    if (isExpiredRentalPeriod(row.dataset.pickupEndDate, row.dataset.pickupTime) || result.data?.code === "pickup_day_expired") {
      showExpiredRenterPin(block);
      return;
    }

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

  function refreshExpiredRenterPins() {
    document.querySelectorAll(".simple-reservation-row[data-pickup-date]").forEach(function (row) {
      if (!isExpiredRentalPeriod(row.dataset.pickupEndDate, row.dataset.pickupTime)) return;
      const block = row.querySelector(".pickup-pin-card");
      if (block && !block.classList.contains("expired")) showExpiredRenterPin(block);
    });
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
      const expired = isExpiredRentalPeriod(row.dataset.pickupEndDate, row.dataset.pickupTime);
      if (expired) showExpiredRenterPin(block);
      else block.innerHTML = `<strong>${escapeHtml(text("pinTitle"))}</strong><span>${escapeHtml(text("pinLoading"))}</span>`;

      const detailRow = row.querySelector(".detail-row");
      if (detailRow) row.insertBefore(block, detailRow);
      else row.appendChild(block);

      if (!expired) loadRenterPin(row, reservationId, block);
    });
  }

  function resetRenterEnhancements() {
    document.querySelectorAll(".pickup-pin-card").forEach(function (element) { element.remove(); });
    document.querySelectorAll('[data-pickup-pin-enhanced="true"]').forEach(function (row) {
      delete row.dataset.pickupPinEnhanced;
    });
    enhanceRenterRows();
  }

  function initializeHomePinEntry() {
    const e = getHomePinElements();
    if (!e.overlay || !e.form) return;
    updateHomePinText();
    document.addEventListener("click", function (event) {
      const trigger = event.target.closest('[data-home-pin-open="true"]');
      if (trigger) {
        event.preventDefault();
        openHomePinModal(trigger);
      }
    });
    if (e.cancel) e.cancel.addEventListener("click", closeHomePinModal);
    e.overlay.addEventListener("click", function (event) {
      if (event.target === e.overlay) closeHomePinModal();
    });
    e.form.addEventListener("submit", function (event) {
      event.preventDefault();
      void resolveHomePin();
    });
    if (e.input) e.input.addEventListener("input", function (event) {
      event.target.value = event.target.value.replace(/\D/g, "").slice(0, 6);
    });
    document.addEventListener("keydown", function (event) {
      if (e.overlay.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeHomePinModal();
      } else if (event.key === "Tab") {
        const focusable = [e.input, e.cancel, e.submit].filter(Boolean);
        if (event.shiftKey && document.activeElement === focusable[0]) {
          event.preventDefault();
          focusable[focusable.length - 1].focus();
        } else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) {
          event.preventDefault();
          focusable[0].focus();
        }
      }
    });
  }

  async function initializeOwnerHandoff() {
    if (!document.getElementById("offersList")) return;
    const session = consumeOwnerHandoff();
    if (!session || window.location.hash !== "#handoff-" + session.reservationId) return;
    const user = typeof getCurrentSupabaseUser === "function"
      ? await getCurrentSupabaseUser() : null;
    if (!user || user.id !== session.ownerId) return;

    // A sessionStorage value alone is not authorization. Reverify against the
    // authenticated owner's actual Stripe-paid reservation before enabling UI.
    const checked = await invoke("resolve-pickup-pin", { pin: session.pin });
    if (!checked.ok || !checked.data || checked.data.status !== "verified" ||
        checked.data.reservation_id !== session.reservationId) {
      setOwnerMessage(text("genericError"), "error");
      return;
    }
    verifiedReservationId = session.reservationId;
    verifiedPin = session.pin;
    focusedOwnerReservation = false;
    setOwnerMessage(text("matched"), "success");
    scheduleOwnerPickupRefresh();
  }

  let ownerPickupRefreshScheduled = false;
  function scheduleOwnerPickupRefresh() {
    if (ownerPickupRefreshScheduled) return;
    ownerPickupRefreshScheduled = true;
    window.requestAnimationFrame(function () {
      ownerPickupRefreshScheduled = false;
      updateOwnerPickupButtons();
    });
  }

  document.addEventListener("click", interceptOwnerPickup, true);
  document.addEventListener("rentuloLanguageChanged", function () {
    updateHomePinText();
    resetRenterEnhancements();
    scheduleOwnerPickupRefresh();
  });

  document.addEventListener("DOMContentLoaded", function () {
    initializeHomePinEntry();
    void initializeOwnerHandoff();

    const reservationsList = document.getElementById("reservationsList");
    if (reservationsList) {
      const observer = new MutationObserver(function () { enhanceRenterRows(); });
      observer.observe(reservationsList, { childList: true, subtree: true });
      enhanceRenterRows();
      // A tab can stay open past the final rental day. Hide an expired PIN.
      window.setInterval(refreshExpiredRenterPins, 30000);
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden) refreshExpiredRenterPins();
      });
    }

    const offersList = document.getElementById("offersList");
    if (offersList) {
      const observer = new MutationObserver(scheduleOwnerPickupRefresh);
      observer.observe(offersList, { childList: true, subtree: true });
      scheduleOwnerPickupRefresh();
    }
  });
})();
