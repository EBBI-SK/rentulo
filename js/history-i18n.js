(function () {
  const extraHistoryTranslations = {
    cs: {
      "history.subtitle": "Dokončené rezervace, půjčení a hodnocení na jednom místě.",
      "history.rentalsTabShort": "Moje rezervace",
      "history.offersTabShort": "Moje nabídky",
      "history.detail.show": "Zobrazit detail",
      "history.detail.hide": "Skrýt detail",
      "history.detail.expiryReason": "Důvod vypršení",
      "history.expiry.ownerNoResponse": "Majitel žádost nepotvrdil ve stanovené lhůtě.",
      "history.expiry.paymentTimeout": "Platba nebyla dokončena ve stanovené lhůtě.",
      "history.expiry.unknown": "Důvod vypršení není k dispozici.",
      "history.review.commentOptional": "Komentář (nepovinný)"
    },
    sk: {
      "history.subtitle": "Dokončené rezervácie, požičania a hodnotenia na jednom mieste.",
      "history.rentalsTabShort": "Moje rezervácie",
      "history.offersTabShort": "Moje ponuky",
      "history.detail.show": "Zobraziť detail",
      "history.detail.hide": "Skryť detail",
      "history.detail.expiryReason": "Dôvod vypršania",
      "history.expiry.ownerNoResponse": "Majiteľ žiadosť nepotvrdil v stanovenej lehote.",
      "history.expiry.paymentTimeout": "Platba nebola dokončená v stanovenej lehote.",
      "history.expiry.unknown": "Dôvod vypršania nie je k dispozícii.",
      "history.review.commentOptional": "Komentár (nepovinný)"
    },
    en: {
      "history.subtitle": "Completed reservations, rentals and reviews in one place.",
      "history.rentalsTabShort": "My reservations",
      "history.offersTabShort": "My offers",
      "history.detail.show": "Show details",
      "history.detail.hide": "Hide details",
      "history.detail.expiryReason": "Reason for expiration",
      "history.expiry.ownerNoResponse": "The owner did not approve the request within the deadline.",
      "history.expiry.paymentTimeout": "Payment was not completed within the deadline.",
      "history.expiry.unknown": "The reason for expiration is unavailable.",
      "history.review.commentOptional": "Comment (optional)"
    },
    de: {
      "history.subtitle": "Abgeschlossene Reservierungen, Ausleihen und Bewertungen an einem Ort.",
      "history.rentalsTabShort": "Meine Reservierungen",
      "history.offersTabShort": "Meine Angebote",
      "history.detail.show": "Details anzeigen",
      "history.detail.hide": "Details ausblenden",
      "history.detail.expiryReason": "Grund für den Fristablauf",
      "history.expiry.ownerNoResponse": "Der Eigentümer hat die Anfrage nicht innerhalb der Frist bestätigt.",
      "history.expiry.paymentTimeout": "Die Zahlung wurde nicht innerhalb der Frist abgeschlossen.",
      "history.expiry.unknown": "Der Grund für den Fristablauf ist nicht verfügbar.",
      "history.review.commentOptional": "Kommentar (optional)"
    },
    pl: {
      "history.subtitle": "Zakończone rezerwacje, wypożyczenia i oceny w jednym miejscu.",
      "history.rentalsTabShort": "Moje rezerwacje",
      "history.offersTabShort": "Moje oferty",
      "history.detail.show": "Pokaż szczegóły",
      "history.detail.hide": "Ukryj szczegóły",
      "history.detail.expiryReason": "Powód wygaśnięcia",
      "history.expiry.ownerNoResponse": "Właściciel nie zatwierdził prośby w wyznaczonym terminie.",
      "history.expiry.paymentTimeout": "Płatność nie została zakończona w wyznaczonym terminie.",
      "history.expiry.unknown": "Powód wygaśnięcia jest niedostępny.",
      "history.review.commentOptional": "Komentarz (opcjonalnie)"
    }
  };

  function currentHistoryLanguage() {
    if (typeof window.getRentuloLanguage === "function") {
      return window.getRentuloLanguage();
    }

    return document.documentElement.lang || "cs";
  }

  function historyTranslation(key, fallback) {
    const language = currentHistoryLanguage();
    const languageMap = extraHistoryTranslations[language] || extraHistoryTranslations.cs;
    return languageMap[key] || extraHistoryTranslations.cs[key] || fallback || key;
  }

  window.historyExtraT = historyTranslation;

  const baseRentuloTranslate = typeof window.rentuloTranslate === "function"
    ? window.rentuloTranslate
    : null;

  window.rentuloTranslate = function (key) {
    const language = currentHistoryLanguage();
    const languageMap = extraHistoryTranslations[language] || extraHistoryTranslations.cs;

    if (Object.prototype.hasOwnProperty.call(languageMap, key)) {
      return languageMap[key];
    }

    return baseRentuloTranslate ? baseRentuloTranslate(key) : key;
  };

  function renderHistoryExtraTranslations() {
    document.querySelectorAll("[data-history-extra-i18n]").forEach(function (element) {
      const key = element.dataset.historyExtraI18n;
      if (!key) return;
      element.textContent = historyTranslation(key, element.textContent);
    });
  }

  document.addEventListener("DOMContentLoaded", renderHistoryExtraTranslations);
  document.addEventListener("rentuloLanguageChanged", renderHistoryExtraTranslations);
})();
