// Pure locale-specific notification copy, shared by TEST Edge Function and Node tests.
const smsTemplates = {
  cs: {
    new_request: "Rentulo: Nova zadost o rezervaci {number}. Otevrete Moje nabidky.",
    approved: "Rentulo: Rezervace {number} byla schvalena. Dokoncete platbu v Rentulo.",
    paid: "Rentulo: Platba rezervace {number} byla potvrzena. Otevrete Moje nabidky.",
    cancelled: "Rentulo: Rezervace {number} byla zrusena. Podrobnosti najdete v Rentulo.",
    paid_cancelled: "Rentulo: Rezervace {number} byla zrusena. Podrobnosti o stornu jsou v e-mailu.",
  },
  sk: {
    new_request: "Rentulo: Nova ziadost o rezervaciu {number}. Otvorte Moje ponuky.",
    approved: "Rentulo: Rezervacia {number} bola schvalena. Dokoncite platbu v Rentulo.",
    paid: "Rentulo: Platba rezervacie {number} bola potvrdena. Otvorte Moje ponuky.",
    cancelled: "Rentulo: Rezervacia {number} bola zrusena. Podrobnosti su v Rentulo.",
    paid_cancelled: "Rentulo: Rezervacia {number} bola zrusena. Podrobnosti o storne su v e-maile.",
  },
  en: {
    new_request: "Rentulo: New rental request {number}. Check My listings.",
    approved: "Rentulo: Reservation {number} was approved. Complete payment in Rentulo.",
    paid: "Rentulo: Payment for reservation {number} confirmed. Check My listings.",
    cancelled: "Rentulo: Reservation {number} has been cancelled. See Rentulo for details.",
    paid_cancelled: "Rentulo: Reservation {number} cancelled. Check your email for cancellation details.",
  },
  de: {
    new_request: "Rentulo: Neue Reservierungsanfrage {number}. Bitte Angebote pruefen.",
    approved: "Rentulo: Reservierung {number} bestaetigt. Bitte in Rentulo bezahlen.",
    paid: "Rentulo: Zahlung fuer Reservierung {number} bestaetigt. Angebote pruefen.",
    cancelled: "Rentulo: Reservierung {number} storniert. Details in Rentulo.",
    paid_cancelled: "Rentulo: Reservierung {number} storniert. Details zur Stornierung per E-Mail.",
  },
  pl: {
    new_request: "Rentulo: Nowa prosba o rezerwacje {number}. Sprawdz Moje oferty.",
    approved: "Rentulo: Rezerwacja {number} zaakceptowana. Dokoncz platnosc w Rentulo.",
    paid: "Rentulo: Platnosc rezerwacji {number} potwierdzona. Sprawdz oferty.",
    cancelled: "Rentulo: Rezerwacja {number} anulowana. Szczegoly w Rentulo.",
    paid_cancelled: "Rentulo: Rezerwacja {number} anulowana. Szczegoly anulowania w e-mailu.",
  },
};

function language(value) {
  return value === "sk" || value === "en" || value === "de" || value === "pl"
    ? value : "cs";
}

export function phoneToE164(value) {
  const original = String(value || "").replace(/[\s()\-]/g, "");
  const formatted = original.startsWith("00")
    ? `+${original.slice(2)}`
    : /^\d{9}$/.test(original) ? `+420${original}` : original;
  return /^\+[1-9]\d{7,14}$/.test(formatted) ? formatted : null;
}

export function smsMessage(event, lang, number) {
  if (!(event in smsTemplates[language(lang)]) || !/^R-\d{6,}$/.test(number)) return null;
  const copy = smsTemplates[language(lang)][event];
  const result = copy.replace("{number}", number);
  // 7-bit, one SMS segment, no private information or PINs.
  return result.length <= 160 && /^[\x20-\x7E]+$/.test(result) ? result : null;
}

