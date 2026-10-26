(function () {
  const extraHistoryTranslations = {
    cs: {
      "history.subtitle": "Dokončené rezervace, půjčení a hodnocení na jednom místě.",
      "history.rentalsTabShort": "Moje rezervace",
      "history.offersTabShort": "Moje nabídky",
      "history.detail.show": "Zobrazit detail",
      "history.detail.hide": "Skrýt detail",
      "history.detail.expiryReason": "Důvod vypršení",
      "history.detail.noShowReason": "Důvod ukončení",
      "history.noShow.owner": "Zájemce si věc nevyzvedl během celého zaplaceného období. Rezervace byla ukončena a výplata se zpracovává.",
      "history.noShow.renter": "Věc jste si nevyzvedli během celého zaplaceného období. Rezervace skončila, termín je uvolněn a platba se automaticky nevrací.",
      "history.expiry.ownerNoResponse.renter": "Majitel žádost nepotvrdil ve stanovené lhůtě.",
      "history.expiry.ownerNoResponse.owner": "Žádost jste nepotvrdili ve stanovené lhůtě.",
      "history.expiry.paymentTimeout.renter": "Platbu jste nedokončili ve stanovené lhůtě.",
      "history.expiry.paymentTimeout.owner": "Zájemce nedokončil platbu ve stanovené lhůtě.",
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
      "history.detail.noShowReason": "Dôvod ukončenia",
      "history.noShow.owner": "Záujemca si vec nevyzdvihol počas celého zaplateného obdobia. Rezervácia sa ukončila a výplata sa spracúva.",
      "history.noShow.renter": "Vec ste si nevyzdvihli počas celého zaplateného obdobia. Rezervácia sa skončila, termín sa uvoľnil a platba sa automaticky nevracia.",
      "history.expiry.ownerNoResponse.renter": "Majiteľ žiadosť nepotvrdil v stanovenej lehote.",
      "history.expiry.ownerNoResponse.owner": "Žiadosť ste nepotvrdili v stanovenej lehote.",
      "history.expiry.paymentTimeout.renter": "Platbu ste nedokončili v stanovenej lehote.",
      "history.expiry.paymentTimeout.owner": "Záujemca nedokončil platbu v stanovenej lehote.",
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
      "history.detail.noShowReason": "Reason for closure",
      "history.noShow.owner": "The renter did not collect the item throughout the paid rental period. The reservation has closed and the owner payout is being processed.",
      "history.noShow.renter": "You did not collect the item during the entire paid rental period. The reservation has closed, the dates are released, and the payment is not automatically refunded.",
      "history.expiry.ownerNoResponse.renter": "The owner did not approve the request within the deadline.",
      "history.expiry.ownerNoResponse.owner": "You did not approve the request before the deadline.",
      "history.expiry.paymentTimeout.renter": "You did not complete the payment before the deadline.",
      "history.expiry.paymentTimeout.owner": "The renter did not complete the payment before the deadline.",
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
      "history.detail.noShowReason": "Grund der Beendigung",
      "history.noShow.owner": "Der Mieter hat den Gegenstand während des gesamten bezahlten Mietzeitraums nicht abgeholt. Die Buchung wurde beendet und die Auszahlung wird bearbeitet.",
      "history.noShow.renter": "Sie haben den Gegenstand während des gesamten bezahlten Mietzeitraums nicht abgeholt. Die Buchung wurde beendet, der Zeitraum ist frei und die Zahlung wird nicht automatisch erstattet.",
      "history.expiry.ownerNoResponse.renter": "Der Eigentümer hat die Anfrage nicht innerhalb der Frist bestätigt.",
      "history.expiry.ownerNoResponse.owner": "Sie haben die Anfrage nicht fristgerecht bestätigt.",
      "history.expiry.paymentTimeout.renter": "Sie haben die Zahlung nicht fristgerecht abgeschlossen.",
      "history.expiry.paymentTimeout.owner": "Der Mieter hat die Zahlung nicht fristgerecht abgeschlossen.",
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
      "history.detail.noShowReason": "Powód zakończenia",
      "history.noShow.owner": "Najemca nie odebrał rzeczy przez cały opłacony okres najmu. Rezerwacja została zakończona, a wypłata dla właściciela jest przetwarzana.",
      "history.noShow.renter": "Nie odebrano rzeczy przez cały opłacony okres najmu. Rezerwacja została zakończona, termin zwolniony, a płatność nie jest automatycznie zwracana.",
      "history.expiry.ownerNoResponse.renter": "Właściciel nie zatwierdził prośby w wyznaczonym terminie.",
      "history.expiry.ownerNoResponse.owner": "Nie udało Ci się zatwierdzić prośby w wyznaczonym terminie.",
      "history.expiry.paymentTimeout.renter": "Nie udało Ci się dokończyć płatności w wyznaczonym terminie.",
      "history.expiry.paymentTimeout.owner": "Najemca nie dokończył płatności w wyznaczonym terminie.",
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
