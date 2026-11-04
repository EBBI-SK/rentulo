(function () {
  const extraHistoryTranslations = {
    cs: {
      "history.finance.heading": "Finanční vyúčtování",
      "history.finance.original": "Původní pronájem",
      "history.finance.extension": "Prodloužení",
      "history.finance.paidTotal": "Celkem zaplaceno",
      "history.finance.commission": "Provize Rentulo",
      "history.finance.totalPayout": "Celkem k výplatě",
      "history.finance.originalStatus": "Původní převod",
      "history.finance.statusLabel": "Stav výplaty",
      "history.finance.extensionStatus": "Prodloužení do",
      "history.finance.status.succeeded": "Převedeno na účet Stripe",
      "history.finance.status.waiting": "Čeká na výplatu",
      "history.finance.status.pending": "Převod se zpracovává",
      "history.finance.status.failed": "Převod se nezdařil",
      "history.finance.status.reversed": "Převod byl vrácen",
      "history.finance.status.blocked": "Výplata pozastavena (spor)",
      "history.finance.status.unknown": "Stav nelze ověřit",
      "history.finance.unavailable": "Finanční údaje se nepodařilo ověřit. Zkuste stránku obnovit.",
      "history.finance.stripeNote": "Převod na Stripe neznamená připsání na bankovní účet.",
      "history.price.original": "Původní cena",
      "history.price.extensionUntil": "Zaplacené prodloužení do",
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
      "history.finance.heading": "Finančné vyúčtovanie",
      "history.finance.original": "Pôvodný prenájom",
      "history.finance.extension": "Predĺženie",
      "history.finance.paidTotal": "Spolu zaplatené",
      "history.finance.commission": "Provízia Rentulo",
      "history.finance.totalPayout": "Spolu na výplatu",
      "history.finance.originalStatus": "Pôvodný prevod",
      "history.finance.statusLabel": "Stav výplaty",
      "history.finance.extensionStatus": "Predĺženie do",
      "history.finance.status.succeeded": "Prevedené na účet Stripe",
      "history.finance.status.waiting": "Čaká na výplatu",
      "history.finance.status.pending": "Prevod sa spracúva",
      "history.finance.status.failed": "Prevod sa nepodaril",
      "history.finance.status.reversed": "Prevod bol vrátený",
      "history.finance.status.blocked": "Výplata pozastavená (spor)",
      "history.finance.status.unknown": "Stav sa nedá overiť",
      "history.finance.unavailable": "Finančné údaje sa nepodarilo overiť. Skúste stránku obnoviť.",
      "history.finance.stripeNote": "Prevod na Stripe neznamená pripísanie na bankový účet.",
      "history.price.original": "Pôvodná cena",
      "history.price.extensionUntil": "Zaplatené predĺženie do",
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
      "history.finance.heading": "Financial summary",
      "history.finance.original": "Original rental",
      "history.finance.extension": "Extension",
      "history.finance.paidTotal": "Total paid",
      "history.finance.commission": "Rentulo commission",
      "history.finance.totalPayout": "Total due to owner",
      "history.finance.originalStatus": "Original transfer",
      "history.finance.statusLabel": "Payout status",
      "history.finance.extensionStatus": "Extension until",
      "history.finance.status.succeeded": "Transferred to Stripe account",
      "history.finance.status.waiting": "Awaiting payout",
      "history.finance.status.pending": "Transfer processing",
      "history.finance.status.failed": "Transfer failed",
      "history.finance.status.reversed": "Transfer reversed",
      "history.finance.status.blocked": "Payout on hold (dispute)",
      "history.finance.status.unknown": "Status cannot be verified",
      "history.finance.unavailable": "Financial details could not be verified. Please reload this page.",
      "history.finance.stripeNote": "A Stripe transfer does not confirm receipt in your bank account.",
      "history.price.original": "Original price",
      "history.price.extensionUntil": "Paid extension until",
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
      "history.finance.heading": "Finanzübersicht",
      "history.finance.original": "Ursprüngliche Miete",
      "history.finance.extension": "Verlängerung",
      "history.finance.paidTotal": "Insgesamt bezahlt",
      "history.finance.commission": "Rentulo-Provision",
      "history.finance.totalPayout": "Auszahlung an Eigentümer gesamt",
      "history.finance.originalStatus": "Ursprüngliche Übertragung",
      "history.finance.statusLabel": "Auszahlungsstatus",
      "history.finance.extensionStatus": "Verlängerung bis",
      "history.finance.status.succeeded": "Auf Stripe-Konto übertragen",
      "history.finance.status.waiting": "Wartet auf Auszahlung",
      "history.finance.status.pending": "Übertragung wird bearbeitet",
      "history.finance.status.failed": "Übertragung fehlgeschlagen",
      "history.finance.status.reversed": "Übertragung rückgängig gemacht",
      "history.finance.status.blocked": "Auszahlung gesperrt (Streitfall)",
      "history.finance.status.unknown": "Status nicht überprüfbar",
      "history.finance.unavailable": "Finanzdaten konnten nicht überprüft werden. Bitte laden Sie die Seite neu.",
      "history.finance.stripeNote": "Eine Stripe-Übertragung bestätigt keinen Geldeingang auf dem Bankkonto.",
      "history.price.original": "Ursprünglicher Preis",
      "history.price.extensionUntil": "Bezahlte Verlängerung bis",
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
      "history.finance.heading": "Rozliczenie finansowe",
      "history.finance.original": "Pierwotny wynajem",
      "history.finance.extension": "Przedłużenie",
      "history.finance.paidTotal": "Łącznie zapłacono",
      "history.finance.commission": "Prowizja Rentulo",
      "history.finance.totalPayout": "Łącznie do wypłaty",
      "history.finance.originalStatus": "Pierwotny przelew",
      "history.finance.statusLabel": "Status wypłaty",
      "history.finance.extensionStatus": "Przedłużenie do",
      "history.finance.status.succeeded": "Przelano na konto Stripe",
      "history.finance.status.waiting": "Oczekuje na wypłatę",
      "history.finance.status.pending": "Przelew w trakcie realizacji",
      "history.finance.status.failed": "Przelew nie powiódł się",
      "history.finance.status.reversed": "Przelew cofnięty",
      "history.finance.status.blocked": "Wypłata wstrzymana (spór)",
      "history.finance.status.unknown": "Nie można potwierdzić statusu",
      "history.finance.unavailable": "Nie można zweryfikować danych finansowych. Odśwież stronę.",
      "history.finance.stripeNote": "Przelew na Stripe nie oznacza wpływu na konto bankowe.",
      "history.price.original": "Cena pierwotna",
      "history.price.extensionUntil": "Opłacone przedłużenie do",
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
