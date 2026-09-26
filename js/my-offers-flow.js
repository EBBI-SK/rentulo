(function () {
  const COPY = {
    cs: {
      addListing: "Přidat nabídku",
      manageListing: "Spravovat nabídku",
      handleRequestOne: "Zobrazit žádost",
      handleRequestMany: "Zobrazit žádosti",
      hideOverview: "Skrýt přehled",
      renter: "Zájemce",
      term: "Termín",
      price: "Cena",
      status: "Stav",
      nextStep: "Co udělat",
      requestDetail: "Detail žádosti",
      reservationDetail: "Detail rezervace",
      hideDetail: "Skrýt detail",
      awaitingDecision: "Čeká na vaše rozhodnutí",
      waitingRequestOne: "1 žádost čeká na vyřízení",
      waitingRequestMany: "{count} žádostí čeká na vyřízení",
      waitingPayment: "Rezervace čeká na platbu zájemce",
      paidHandover: "Rezervace je zaplacená – čeká na předání",
      pickedReturn: "Půjčení probíhá – po vrácení ho uzavřete",
      showReservation: "Zobrazit rezervaci",
      confirmHandover: "Potvrdit předání",
      confirmReturn: "Potvrdit vrácení"
    },
    sk: {
      addListing: "Pridať ponuku",
      manageListing: "Spravovať ponuku",
      handleRequestOne: "Zobraziť žiadosť",
      handleRequestMany: "Zobraziť žiadosti",
      hideOverview: "Skryť prehľad",
      renter: "Záujemca",
      term: "Termín",
      price: "Cena",
      status: "Stav",
      nextStep: "Čo urobiť",
      requestDetail: "Detail žiadosti",
      reservationDetail: "Detail rezervácie",
      hideDetail: "Skryť detail",
      awaitingDecision: "Čaká na vaše rozhodnutie",
      waitingRequestOne: "1 žiadosť čaká na vybavenie",
      waitingRequestMany: "{count} žiadostí čaká na vybavenie",
      waitingPayment: "Rezervácia čaká na platbu záujemcu",
      paidHandover: "Rezervácia je zaplatená – čaká na odovzdanie",
      pickedReturn: "Požičanie prebieha – po vrátení ho uzavrite",
      showReservation: "Zobraziť rezerváciu",
      confirmHandover: "Potvrdiť odovzdanie",
      confirmReturn: "Potvrdiť vrátenie"
    },
    en: {
      addListing: "Add listing",
      manageListing: "Manage listing",
      handleRequestOne: "View request",
      handleRequestMany: "View requests",
      hideOverview: "Hide overview",
      renter: "Renter",
      term: "Dates",
      price: "Price",
      status: "Status",
      nextStep: "Next step",
      requestDetail: "Request details",
      reservationDetail: "Reservation details",
      hideDetail: "Hide details",
      awaitingDecision: "Waiting for your decision",
      waitingRequestOne: "1 request needs your action",
      waitingRequestMany: "{count} requests need your action",
      waitingPayment: "Reservation is waiting for the renter's payment",
      paidHandover: "Paid – waiting for handover",
      pickedReturn: "Rental in progress – close it after return",
      showReservation: "View reservation",
      confirmHandover: "Confirm handover",
      confirmReturn: "Confirm return"
    },
    de: {
      addListing: "Angebot hinzufügen",
      manageListing: "Angebot verwalten",
      handleRequestOne: "Anfrage anzeigen",
      handleRequestMany: "Anfragen anzeigen",
      hideOverview: "Übersicht ausblenden",
      renter: "Interessent",
      term: "Zeitraum",
      price: "Preis",
      status: "Status",
      nextStep: "Nächster Schritt",
      requestDetail: "Anfragedetails",
      reservationDetail: "Reservierungsdetails",
      hideDetail: "Details ausblenden",
      awaitingDecision: "Wartet auf Ihre Entscheidung",
      waitingRequestOne: "1 Anfrage muss bearbeitet werden",
      waitingRequestMany: "{count} Anfragen müssen bearbeitet werden",
      waitingPayment: "Reservierung wartet auf die Zahlung des Interessenten",
      paidHandover: "Bezahlt – Übergabe steht aus",
      pickedReturn: "Ausleihe läuft – nach Rückgabe abschließen",
      showReservation: "Reservierung anzeigen",
      confirmHandover: "Übergabe bestätigen",
      confirmReturn: "Rückgabe bestätigen"
    },
    pl: {
      addListing: "Dodaj ofertę",
      manageListing: "Zarządzaj ofertą",
      handleRequestOne: "Pokaż prośbę",
      handleRequestMany: "Pokaż prośby",
      hideOverview: "Ukryj przegląd",
      renter: "Zainteresowany",
      term: "Termin",
      price: "Cena",
      status: "Status",
      nextStep: "Co zrobić",
      requestDetail: "Szczegóły prośby",
      reservationDetail: "Szczegóły rezerwacji",
      hideDetail: "Ukryj szczegóły",
      awaitingDecision: "Czeka na Twoją decyzję",
      waitingRequestOne: "1 prośba czeka na rozpatrzenie",
      waitingRequestMany: "{count} próśb czeka na rozpatrzenie",
      waitingPayment: "Rezerwacja czeka na płatność zainteresowanego",
      paidHandover: "Opłacona – czeka na przekazanie",
      pickedReturn: "Wypożyczenie trwa – zamknij po zwrocie",
      showReservation: "Pokaż rezerwację",
      confirmHandover: "Potwierdź przekazanie",
      confirmReturn: "Potwierdź zwrot"
    }
  };

  let scheduled = false;

  function getLanguage() {
    if (typeof window.getRentuloLanguage === "function") {
      const language = window.getRentuloLanguage();
      if (COPY[language]) {
        return language;
      }
    }

    const htmlLanguage = String(document.documentElement.lang || "cs").slice(0, 2).toLowerCase();
    return COPY[htmlLanguage] ? htmlLanguage : "cs";
  }

  function text(key, values) {
    const language = getLanguage();
    let value = COPY[language][key] || COPY.cs[key] || key;

    if (values) {
      Object.keys(values).forEach(function (name) {
        value = value.replaceAll("{" + name + "}", String(values[name]));
      });
    }

    return value;
  }

  function setText(element, value) {
    if (element && element.textContent !== value) {
      element.textContent = value;
    }
  }

  function inspectFlow(panel) {
    if (!panel) {
      return { kind: "none", count: 0 };
    }

    const requestCards = Array.from(panel.querySelectorAll(".request-card"));
    const pendingCount = panel.querySelectorAll('[data-offers-action="approve-reservation"]').length;
    const pickupCount = panel.querySelectorAll('[data-offers-action="mark-picked-up"]').length;
    const waitingPaymentCount = panel.querySelectorAll(".request-status.active").length;
    const returnCount = panel.querySelectorAll('[data-offers-action="mark-returned"]').length;

    if (pendingCount > 0) {
      return { kind: "pending", count: pendingCount };
    }

    if (pickupCount > 0) {
      return { kind: "paid", count: pickupCount };
    }

    if (waitingPaymentCount > 0) {
      return { kind: "reservation", count: waitingPaymentCount };
    }

    if (returnCount > 0) {
      return { kind: "picked", count: returnCount };
    }

    if (requestCards.length > 0) {
      return { kind: "reservation", count: requestCards.length };
    }

    return { kind: "none", count: 0 };
  }

  function ensureAttention(info, flow) {
    if (!info) {
      return;
    }

    let attention = info.querySelector(".offer-flow-attention");

    if (!attention) {
      attention = document.createElement("span");
      attention.className = "offer-flow-attention";
      info.appendChild(attention);
    }

    if (flow.kind === "pending") {
      if (attention.className !== "offer-flow-attention urgent") {
        attention.className = "offer-flow-attention urgent";
      }
      setText(
        attention,
        flow.count === 1
          ? text("waitingRequestOne")
          : text("waitingRequestMany", { count: flow.count })
      );
      attention.hidden = false;
      return;
    }

    if (flow.kind === "paid") {
      if (attention.className !== "offer-flow-attention urgent") {
        attention.className = "offer-flow-attention urgent";
      }
      setText(attention, text("paidHandover"));
      attention.hidden = false;
      return;
    }

    if (flow.kind === "picked") {
      if (attention.className !== "offer-flow-attention active") {
        attention.className = "offer-flow-attention active";
      }
      setText(attention, text("pickedReturn"));
      attention.hidden = false;
      return;
    }

    if (flow.kind === "reservation") {
      if (attention.className !== "offer-flow-attention active") {
        attention.className = "offer-flow-attention active";
      }
      setText(attention, text("waitingPayment"));
      attention.hidden = false;
      return;
    }

    if (attention.className !== "offer-flow-attention") {
      attention.className = "offer-flow-attention";
    }
    attention.hidden = true;
  }

  function createManageMenu(actions) {
    let menu = actions.querySelector(":scope > .offer-flow-manage");

    if (!menu) {
      menu = document.createElement("details");
      menu.className = "offer-flow-manage";

      const summary = document.createElement("summary");
      summary.className = "offer-flow-manage-summary";

      const panel = document.createElement("div");
      panel.className = "offer-flow-manage-panel";

      menu.append(summary, panel);
      actions.appendChild(menu);
    }

    setText(menu.querySelector("summary"), text("manageListing"));
    return menu;
  }

  function organizeOfferActions(row, flow, panel) {
    const actions = row.querySelector(":scope > .simple-offer-actions");

    if (!actions) {
      return;
    }

    const primary = actions.querySelector(":scope > .offer-primary-button");
    const activate = actions.querySelector(':scope > [data-offers-action="activate-offer"]');
    const manageMenu = createManageMenu(actions);
    const managePanel = manageMenu.querySelector(".offer-flow-manage-panel");

    Array.from(actions.children).forEach(function (child) {
      if (child === primary || child === activate || child === manageMenu) {
        return;
      }
      managePanel.appendChild(child);
    });

    if (activate) {
      activate.classList.add("offer-flow-primary");
      if (activate.nextElementSibling !== manageMenu) {
        actions.insertBefore(activate, manageMenu);
      }
    }

    if (primary) {
      if (actions.firstElementChild !== primary) {
        actions.insertBefore(primary, actions.firstChild);
      }

      if (primary.dataset.offersAction === "open-offer-requests") {
        const isPanelOpen = Boolean(panel && panel.classList.contains("open"));

        if (isPanelOpen) {
          setText(primary, text("hideOverview"));
        } else if (flow.kind === "pending") {
          setText(
            primary,
            flow.count === 1 ? text("handleRequestOne") : text("handleRequestMany")
          );
        } else if (flow.kind === "paid") {
          setText(primary, text("confirmHandover"));
        } else if (flow.kind === "picked") {
          setText(primary, text("confirmReturn"));
        } else if (flow.kind === "reservation") {
          setText(primary, text("showReservation"));
        }
      }
    }
  }

  function ensureFieldWrapper(element, wrapperClass, labelText) {
    if (!element) {
      return null;
    }

    let wrapper = element.parentElement;

    if (!wrapper || !wrapper.classList.contains("offer-flow-field")) {
      wrapper = document.createElement("div");
      wrapper.className = "offer-flow-field " + wrapperClass;
      element.parentNode.insertBefore(wrapper, element);
      wrapper.appendChild(element);
    }

    let label = wrapper.querySelector(":scope > .offer-flow-field-label");

    if (!label) {
      label = document.createElement("span");
      label.className = "offer-flow-field-label";
      wrapper.insertBefore(label, wrapper.firstChild);
    }

    setText(label, labelText);
    return wrapper;
  }

  function inspectRequestCard(card) {
    if (!card) {
      return { kind: "none" };
    }

    if (card.querySelector('[data-offers-action="approve-reservation"]')) {
      return { kind: "pending" };
    }

    if (card.querySelector('[data-offers-action="mark-picked-up"]')) {
      return { kind: "paid" };
    }

    if (card.querySelector('[data-offers-action="mark-returned"]')) {
      return { kind: "picked" };
    }

    return { kind: "reservation" };
  }

  function enhanceRequestCard(card) {
    const flow = inspectRequestCard(card);
    const row = card.querySelector(":scope > .request-row");

    if (!row) {
      return;
    }

    const requestMain = row.querySelector(".request-main");
    const requestDate = row.querySelector(".request-date");
    const requestPrice = row.querySelector(".table-value");
    const requestStatus = row.querySelector(".request-status");
    const requestActions = row.querySelector(".row-actions");

    ensureFieldWrapper(requestMain, "offer-flow-party", text("renter"));
    ensureFieldWrapper(requestDate, "offer-flow-term", text("term"));
    ensureFieldWrapper(requestPrice, "offer-flow-price", text("price"));
    ensureFieldWrapper(requestStatus, "offer-flow-status", text("status"));
    ensureFieldWrapper(requestActions, "offer-flow-actions", text("nextStep"));

    if (flow.kind === "pending" && requestStatus) {
      setText(requestStatus, text("awaitingDecision"));
    }

    const detail = card.querySelector(":scope > .request-detail");
    const detailButton = card.querySelector('[data-offers-action="toggle-request-detail"]');

    if (detailButton) {
      const closedDetailLabel = flow.kind === "pending" ? text("requestDetail") : text("reservationDetail");
      setText(
        detailButton,
        detail && detail.classList.contains("open") ? text("hideDetail") : closedDetailLabel
      );
    }
  }

  function enhanceRequestPanel(panel, flow) {
    if (!panel) {
      return;
    }

    panel.classList.toggle("offer-flow-needs-action", flow.kind === "pending" || flow.kind === "paid" || flow.kind === "picked");

    panel.querySelectorAll(".request-card").forEach(function (card) {
      enhanceRequestCard(card);
    });
  }

  function enhanceRecord(record) {
    const row = record.querySelector(":scope > .simple-offer-row");

    if (!row) {
      return;
    }

    const panel = record.querySelector(":scope > .request-panel");
    const flow = inspectFlow(panel);
    const values = row.querySelectorAll(":scope > .simple-offer-value:not(.simple-offer-status)");
    const requestCountSource = values.length > 1 ? values[1] : null;
    const info = row.querySelector(".simple-offer-info");

    if (values[0]) {
      values[0].classList.add("offer-flow-price-summary");
    }

    if (requestCountSource) {
      requestCountSource.classList.add("offer-request-count-source");
    }

    ensureAttention(info, flow);
    organizeOfferActions(row, flow, panel);
    enhanceRequestPanel(panel, flow);
  }

  function enhanceAll() {
    scheduled = false;

    const topAction = document.querySelector(".top-action-button");
    setText(topAction, text("addListing"));

    const list = document.getElementById("offersList");

    if (!list) {
      return;
    }

    list.querySelectorAll(".simple-offer-record").forEach(enhanceRecord);
  }

  function scheduleEnhance() {
    if (scheduled) {
      return;
    }

    scheduled = true;
    window.requestAnimationFrame(enhanceAll);
  }

  function start() {
    const list = document.getElementById("offersList");

    if (!list) {
      return;
    }

    const observer = new MutationObserver(scheduleEnhance);
    observer.observe(list, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class"]
    });

    document.addEventListener("rentuloLanguageChanged", scheduleEnhance);
    scheduleEnhance();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
