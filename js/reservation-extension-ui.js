/* BOD 1: shared presentation labels for the existing rental-extension workflow. */
(function (root) {
  "use strict";
  const copy = {
    cs: {
      extend: "Prodloužit pronájem", newReturn: "Nové datum vrácení",
      submit: "Požádat o prodloužení", requested: "Žádost o prodloužení odeslána.",
      pending: "Čeká na schválení majitele", approved: "Prodloužení schváleno – čeká na doplatek",
      pay: "Zaplatit doplatek", paymentDue: "Čeká na doplatek", rejected: "Prodloužení zamítnuto", expired: "Žádost o prodloužení vypršela",
      paid: "Prodloužení zaplaceno", until: "Nové vrácení", extra: "Doplatek",
      approve: "Schválit prodloužení", reject: "Zamítnout prodloužení",
      ownerPending: "Žádost o prodloužení do", ownerApproved: "Doplatek čeká na zaplacení",
      ownerPaid: "Prodloužení zaplaceno", error: "Prodloužení se nepodařilo zpracovat. Ověřte dostupnost a zkuste to znovu.",
      declined: "Žádost o prodloužení byla zamítnuta.", confirmed: "Prodloužení schváleno.",
      checking: "Ověřujeme doplatek ve Stripe. Nový termín platí až po potvrzení platby.",
      cancelled: "Platbu jste nedokončili. Původní termín zatím platí.",
      deadline: "Zaplatit do", paymentBusy: "Ověřujeme předchozí pokus ve Stripe. Neplaťte znovu, dokud nebude stav potvrzen.",
      checkoutRetry: "Platební stránku se nepodařilo vytvořit. Zkuste doplatek znovu.",
      deadlineElapsed: "Lhůta pro doplatek uplynula nebo se již nedá otevřít nová platební stránka.",
      priceInfo: "Cena dalších dní podle původní denní ceny; minimální provize je účtována za rezervaci jen jednou."
    },
    sk: {
      extend: "Predĺžiť prenájom",newReturn: "Nový dátum vrátenia",submit: "Požiadať o predĺženie",
      requested: "Žiadosť o predĺženie odoslaná.", pending: "Čaká na schválenie majiteľa",
      approved: "Predĺženie schválené – čaká na doplatok",pay: "Zaplatiť doplatok",paymentDue: "Čaká na doplatok",
      rejected: "Predĺženie zamietnuté",expired: "Žiadosť o predĺženie vypršala",paid: "Predĺženie zaplatené",
      until: "Nové vrátenie",extra: "Doplatok",approve: "Schváliť predĺženie",reject: "Zamietnuť predĺženie",
      ownerPending: "Žiadosť o predĺženie do",ownerApproved: "Doplatok čaká na zaplatenie",ownerPaid: "Predĺženie zaplatené",
      error: "Predĺženie sa nepodarilo spracovať. Overte dostupnosť a skúste to znova.",
      declined: "Žiadosť o predĺženie bola zamietnutá.",confirmed: "Predĺženie schválené.",
      checking: "Overujeme doplatok v Stripe. Nový termín platí až po potvrdení platby.",
      cancelled: "Platbu ste nedokončili. Pôvodný termín zatiaľ platí.",
      deadline: "Zaplatiť do",paymentBusy: "Overujeme predchádzajúci pokus v Stripe. Neplaťte znova, kým nebude stav potvrdený.",
      checkoutRetry: "Platobnú stránku sa nepodarilo vytvoriť. Skúste doplatok znova.",
      deadlineElapsed: "Lehota na doplatok uplynula alebo už nemožno vytvoriť novú platobnú stránku.",
      priceInfo: "Cena ďalších dní podľa pôvodnej dennej ceny; minimálna provízia len raz za rezerváciu."
    },
    en: {
      extend: "Extend rental",newReturn: "New return date",submit: "Request extension",requested: "Extension request sent.",
      pending: "Awaiting owner approval",approved: "Extension approved – payment required",pay: "Pay extra amount",paymentDue: "Additional payment due",
      rejected: "Extension declined",expired: "Extension request expired",paid: "Extension paid",
      until: "New return date",extra: "Additional payment",approve: "Approve extension",reject: "Decline extension",
      ownerPending: "Extension requested until",ownerApproved: "Awaiting additional payment",ownerPaid: "Extension paid",
      error: "Could not process the extension. Check availability and try again.",declined: "Extension request declined.",
      confirmed: "Extension approved.",checking: "Verifying additional Stripe payment. The return date changes only after payment.",
      cancelled: "Payment was not completed; original return date still applies.",deadline: "Pay by",
      paymentBusy: "Stripe is verifying the previous attempt. Do not pay again until it is resolved.",
      checkoutRetry: "We could not create the payment page. Please try the additional payment again.",
      deadlineElapsed: "The payment deadline has passed or there is insufficient time for a new checkout.",
      priceInfo: "Additional days use the agreed daily price; the minimum platform fee applies only once per reservation."
    },
    de: {
      extend: "Mietzeit verlängern",newReturn: "Neues Rückgabedatum",submit: "Verlängerung anfragen",requested: "Verlängerung angefragt.",
      pending: "Wartet auf Zustimmung des Eigentümers",approved: "Verlängerung genehmigt – Zahlung ausstehend",
      pay: "Aufpreis bezahlen",paymentDue: "Aufpreis ausstehend",rejected: "Verlängerung abgelehnt",expired: "Verlängerungsanfrage abgelaufen",paid: "Verlängerung bezahlt",
      until: "Neue Rückgabe",extra: "Aufpreis",approve: "Verlängerung genehmigen",reject: "Verlängerung ablehnen",
      ownerPending: "Verlängerung angefragt bis",ownerApproved: "Aufpreis noch nicht bezahlt",ownerPaid: "Verlängerung bezahlt",
      error: "Verlängerung nicht möglich. Verfügbarkeit prüfen und erneut versuchen.",declined: "Verlängerung abgelehnt.",
      confirmed: "Verlängerung genehmigt.",checking: "Stripe-Zahlung wird geprüft. Das neue Datum gilt erst nach Zahlung.",
      cancelled: "Zahlung nicht abgeschlossen; ursprüngliche Rückgabe gilt weiterhin.",deadline: "Zahlen bis",
      paymentBusy: "Stripe prüft den vorherigen Versuch. Bitte noch nicht erneut bezahlen.",
      checkoutRetry: "Die Zahlungsseite konnte nicht erstellt werden. Bitte versuchen Sie es erneut.",
      deadlineElapsed: "Die Zahlungsfrist ist abgelaufen oder reicht für eine neue Zahlungsseite nicht aus.",
      priceInfo: "Zusätzliche Tage zum vereinbarten Tagespreis; Mindestprovision nur einmal pro Reservierung."
    },
    pl: {
      extend: "Przedłuż wynajem",newReturn: "Nowa data zwrotu",submit: "Poproś o przedłużenie",requested: "Prośba o przedłużenie wysłana.",
      pending: "Oczekuje na zgodę właściciela",approved: "Przedłużenie zatwierdzone – dopłata wymagana",pay: "Zapłać dopłatę",paymentDue: "Oczekuje na dopłatę",
      rejected: "Przedłużenie odrzucone",expired: "Prośba o przedłużenie wygasła",paid: "Przedłużenie opłacone",
      until: "Nowy zwrot",extra: "Dopłata",approve: "Zatwierdź przedłużenie",reject: "Odrzuć przedłużenie",
      ownerPending: "Prośba o przedłużenie do",ownerApproved: "Oczekuje na dopłatę",ownerPaid: "Przedłużenie opłacone",
      error: "Nie udało się przedłużyć. Sprawdź dostępność i spróbuj ponownie.",declined: "Przedłużenie odrzucone.",
      confirmed: "Przedłużenie zatwierdzone.",checking: "Trwa weryfikacja płatności Stripe. Nowa data obowiązuje dopiero po zapłacie.",
      cancelled: "Nie dokończono płatności; obowiązuje pierwotna data zwrotu.",deadline: "Zapłać do",
      paymentBusy: "Stripe weryfikuje poprzednią próbę. Nie płać ponownie do czasu wyjaśnienia.",
      checkoutRetry: "Nie udało się utworzyć strony płatności. Spróbuj dopłacić ponownie.",
      deadlineElapsed: "Termin dopłaty upłynął lub pozostało zbyt mało czasu na nową płatność.",
      priceInfo: "Kolejne dni według ustalonej stawki dziennej; minimalna prowizja tylko raz za rezerwację."
    }
  };
  function t(key) {
    const lang = typeof root.getRentuloLanguage === "function" ? root.getRentuloLanguage() : "cs";
    return (copy[lang] || copy.cs)[key] || copy.cs[key] || key;
  }
  function nextDate(date) {
    const match = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return "";
    const timestamp = Date.UTC(+match[1], +match[2]-1, +match[3]+1);
    return new Date(timestamp).toISOString().slice(0,10);
  }
  function attachPaidExtensions(reservations, extensions) {
    const byReservation = new Map();
    extensions.forEach(function (extension) {
      const id = String(extension.reservation_id);
      if (!byReservation.has(id)) byReservation.set(id, []);
      byReservation.get(id).push(extension);
    });
    return reservations.map(function (reservation) {
      const list = byReservation.get(String(reservation.id)) || [];
      const paid = list.filter(function (entry) { return entry.status === "paid"; });
      // Database days and total_days must equal the original paid booking days;
      // effective duration is derived from separately paid extension records.
      const extraDays = paid.reduce(function (n,e) { return n + Number(e.additional_days || 0); },0);
      const baseDays = Number(reservation.totalDays || reservation.days || 0);
      return Object.assign(reservation, {
        extensions: list,
        days: baseDays + extraDays,
        totalDays: baseDays + extraDays,
        totalPrice: Number(reservation.totalPrice || 0) + paid.reduce(function (n,e) { return n + Number(e.amount_total); },0),
        platformFeeAmount: Number(reservation.platformFeeAmount || 0) + paid.reduce(function (n,e) { return n + Number(e.platform_fee_amount); },0),
        ownerPayout: Number(reservation.ownerPayout || 0) + paid.reduce(function (n,e) { return n + Number(e.owner_payout); },0)
      });
    });
  }
  root.RentuloReservationExtensions = { t, nextDate, attachPaidExtensions };
  if (typeof module !== "undefined") module.exports = { t, nextDate, attachPaidExtensions };
})(typeof window !== "undefined" ? window : globalThis);
