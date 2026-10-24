(function () {
  "use strict";

  const LABELS = {
    cs: {
      offers: "Nabídky",
      reservations: "Žádosti a rezervace",
      manage: "Spravovat nabídku",
      offerRenter: "Nabídka / zájemce",
      term: "Termín",
      price: "Cena",
      status: "Stav",
      action: "Co udělat",
      empty: "Zatím nemáte žádné aktivní rezervace."
    },
    sk: {
      offers: "Ponuky",
      reservations: "Žiadosti a rezervácie",
      manage: "Spravovať ponuku",
      offerRenter: "Ponuka / záujemca",
      term: "Termín",
      price: "Cena",
      status: "Stav",
      action: "Čo urobiť",
      empty: "Zatiaľ nemáte žiadne aktívne rezervácie."
    },
    en: {
      offers: "Listings",
      reservations: "Requests and reservations",
      manage: "Manage listing",
      offerRenter: "Listing / renter",
      term: "Dates",
      price: "Price",
      status: "Status",
      action: "Next step",
      empty: "You have no active reservations yet."
    },
    de: {
      offers: "Angebote",
      reservations: "Anfragen und Reservierungen",
      manage: "Angebot verwalten",
      offerRenter: "Angebot / Interessent",
      term: "Zeitraum",
      price: "Preis",
      status: "Status",
      action: "Nächster Schritt",
      empty: "Sie haben noch keine aktiven Reservierungen."
    },
    pl: {
      offers: "Oferty",
      reservations: "Prośby i rezerwacje",
      manage: "Zarządzaj ofertą",
      offerRenter: "Oferta / zainteresowany",
      term: "Termin",
      price: "Cena",
      status: "Status",
      action: "Co zrobić",
      empty: "Nie masz jeszcze aktywnych rezerwacji."
    }
  };

  // These labels only affect the owner page; no global navigation translations change.
  const EXTRA_LABELS = {
    cs: {
      activeReservations: "Aktivní rezervace",
      attention: "K vy\u0159\u00edzen\u00ed", waiting: "Ostatn\u00ed aktivn\u00ed",
      search: "Hledat \u010d\u00edslo, p\u0159edm\u011bt nebo n\u00e1jemce",
      pending: "\u010cek\u00e1 na potvrzen\u00ed", approved: "\u010cek\u00e1 na platbu",
      paid: "Zaplaceno", picked_up: "P\u0159ed\u00e1no",
      noMatches: "\u017d\u00e1dn\u00e9 rezervace neodpov\u00eddaj\u00ed hled\u00e1n\u00ed.",
      handover: "Předat věc", receiveBack: "Převzít zpět",
      completed: "Dokon\u010den\u00e9 rezervace"
    },
    sk: {
      activeReservations: "Aktívne rezervácie",
      attention: "Na vybavenie", waiting: "Ostatn\u00e9 akt\u00edvne",
      search: "H\u013eada\u0165 \u010d\u00edslo, predmet alebo n\u00e1jomcu",
      pending: "\u010cak\u00e1 na potvrdenie", approved: "\u010cak\u00e1 na platbu",
      paid: "Zaplaten\u00e9", picked_up: "Odovzdan\u00e9",
      noMatches: "\u017diadne rezerv\u00e1cie nezodpovedaj\u00fa h\u013eadaniu.",
      handover: "Odovzdať vec", receiveBack: "Prevziať späť",
      completed: "Dokon\u010den\u00e9 rezerv\u00e1cie"
    },
    en: {
      activeReservations: "Active reservations",
      attention: "Needs attention", waiting: "Other active reservations",
      search: "Search number, item or renter",
      pending: "Awaiting approval", approved: "Awaiting payment", paid: "Paid", picked_up: "Handed over",
      noMatches: "No reservations match your search.",
      handover: "Hand over item", receiveBack: "Receive item back",
      completed: "Completed reservations"
    },
    de: {
      activeReservations: "Aktive Reservierungen",
      attention: "Zu erledigen", waiting: "Weitere aktive Reservierungen",
      search: "Nummer, Gegenstand oder Mieter suchen",
      pending: "Wartet auf Best\u00e4tigung",
      approved: "Wartet auf Zahlung", paid: "Bezahlt", picked_up: "\u00dcbergeben",
      noMatches: "Keine Reservierungen entsprechen der Suche.",
      handover: "Gegenstand übergeben", receiveBack: "Gegenstand zurücknehmen",
      completed: "Abgeschlossene Reservierungen"
    },
    pl: {
      activeReservations: "Aktywne rezerwacje",
      attention: "Do za\u0142atwienia", waiting: "Pozosta\u0142e aktywne rezerwacje",
      search: "Szukaj numeru, przedmiotu lub najemcy",
      pending: "Czeka na zatwierdzenie",
      approved: "Czeka na p\u0142atno\u015b\u0107", paid: "Op\u0142acona", picked_up: "Przekazana",
      noMatches: "Brak rezerwacji pasuj\u0105cych do wyszukiwania.",
      handover: "Przekaż przedmiot", receiveBack: "Odbierz przedmiot z powrotem",
      completed: "Zako\u0144czone rezerwacje"
    }
  };

  const ATTENTION_STATUSES = new Set(["pending", "picked_up", "paid"]);

  function normalizeSearch(value) {
    return String(value || "").normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  function priorityForStatus(status) {
    const priority = { pending: 0, picked_up: 1, paid: 2, approved: 3 };
    return Object.prototype.hasOwnProperty.call(priority, status) ? priority[status] : 4;
  }

  function shouldShowReservationsFirst(statuses) {
    return statuses.some(function (status) { return ATTENTION_STATUSES.has(status); });
  }

  function compareReservationData(first, second) {
    const rank = priorityForStatus(first.status) - priorityForStatus(second.status);
    if (rank) return rank;
    const a = String(first.date || "");
    const b = String(second.date || "");
    if (a !== b) return (a || "9999").localeCompare(b || "9999");
    return String(first.number || "").localeCompare(String(second.number || ""));
  }

  function matchesReservation(data, query) {
    const search = normalizeSearch(query);
    if (!search) return true;
    return normalizeSearch([
      data.number, data.offerNumber, data.offer, data.renter
    ].join(" ")).includes(search);
  }

  // Pure helpers are testable without Supabase, the DOM or browser-only dependencies.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { normalizeSearch, priorityForStatus, shouldShowReservationsFirst, compareReservationData, matchesReservation };
  }
  if (typeof document === "undefined") return;

  let searchQuery = "";
  let scheduled = false;
  let applying = false;

  function language() {
    const value = String(document.documentElement.lang || "cs")
      .toLowerCase()
      .split("-")[0];

    return LABELS[value] ? value : "cs";
  }

  function label(key) {
    const current = language();
    return EXTRA_LABELS[current][key] || LABELS[current][key] ||
      EXTRA_LABELS.cs[key] || LABELS.cs[key] || key;
  }

  function setText(element, value) {
    if (element && element.textContent !== value) {
      element.textContent = value;
    }
  }

  function createSectionHeader(className, text) {
    const header = document.createElement("div");
    header.className = "owner-section-header " + className;

    const heading = document.createElement("h2");
    heading.textContent = text;
    header.appendChild(heading);

    return header;
  }

  function simplifyOfferRow(record) {
    const row = record.querySelector(":scope > .simple-offer-row");

    if (!row) {
      return "";
    }

    row.classList.add("owner-offer-row");

    const offerName = (row.querySelector(".simple-offer-name") || {}).textContent || "";
    const directValues = Array.from(row.children).filter(function (element) {
      return element.classList && element.classList.contains("simple-offer-value");
    });

    if (directValues.length >= 3) {
      directValues[1].classList.add("owner-offer-request-summary");
    }

    const actions = row.querySelector(":scope > .simple-offer-actions");

    if (!actions) {
      return offerName.trim();
    }

    // The public detail is reachable from the photo or title; it is not a management action.
    const detailLink = actions.querySelector(':scope > a[href^="detail.html?id="]');
    if (detailLink) {
      const href = detailLink.getAttribute("href");
      const image = row.querySelector(".simple-offer-main > .tool-image");
      const title = row.querySelector(".simple-offer-name");

      if (image) {
        const photoLink = document.createElement("a");
        photoLink.href = href;
        photoLink.className = "owner-offer-detail-link owner-offer-photo-link";
        photoLink.setAttribute("aria-label", offerName.trim());
        image.replaceWith(photoLink);
        photoLink.appendChild(image);
      }
      if (title) {
        const titleLink = document.createElement("a");
        titleLink.href = href;
        titleLink.className = "owner-offer-detail-link owner-offer-title-link";
        title.replaceWith(titleLink);
        titleLink.appendChild(title);
      }
      detailLink.remove();
    }

    const openReservationsButton = actions.querySelector(
      '[data-offers-action="open-offer-requests"]'
    );

    if (openReservationsButton) {
      openReservationsButton.remove();
    }

    if (!actions.querySelector(":scope > .owner-offer-manage")) {
      const publishButton = actions.querySelector(
        ':scope > [data-offers-action="publish-offer"]'
      );
      const otherActions = Array.from(actions.children).filter(function (element) {
        return element !== publishButton;
      });

      if (otherActions.length) {
        const details = document.createElement("details");
        details.className = "owner-offer-manage";

        const summary = document.createElement("summary");
        summary.className = "owner-offer-manage-summary";
        summary.textContent = label("manage");

        const panel = document.createElement("div");
        panel.className = "owner-offer-manage-panel";

        otherActions.forEach(function (element) {
          panel.appendChild(element);
        });

        details.appendChild(summary);
        details.appendChild(panel);
        actions.appendChild(details);
      }
    }

    return offerName.trim();
  }

  function setFieldLabel(element, value) {
    if (element) {
      element.dataset.ownerLabel = value;
      element.classList.add("owner-reservation-field");
    }
  }

  function enhanceReservationCard(card, offerName, offerNumber) {
    card.classList.add("owner-reservation-card");
    card.dataset.ownerOffer = offerName;
    card.dataset.ownerOfferNumber = offerNumber;

    card.querySelectorAll('[data-offers-action="mark-picked-up"]').forEach(function (button) {
      button.hidden = true;
    });

    const row = card.querySelector(":scope > .request-row");

    if (!row) {
      return;
    }

    const party = row.querySelector(":scope > .request-main");
    const term = row.querySelector(":scope > .request-date");
    const status = row.querySelector(":scope > .request-status");
    const actions = row.querySelector(":scope > .row-actions");

    if (actions && card.dataset.ownerStatus === "picked_up") {
      const receiveBack = actions.querySelector('[data-offers-action="mark-returned"]');
      if (receiveBack) receiveBack.textContent = label("receiveBack");
    }

    if (party) {
      party.classList.add("owner-reservation-party");
      setFieldLabel(party, label("offerRenter"));
      const emails = party.querySelectorAll(":scope > .request-email");
      // The email is shown in the contact block after payment; keep the main row compact.
      if (emails[0]) emails[0].classList.add("owner-reservation-contact-preview");
      if (emails[1]) emails[1].classList.add("owner-reservation-reference");

      let offer = party.querySelector(":scope > .owner-reservation-offer");

      if (!offer) {
        offer = document.createElement("span");
        offer.className = "owner-reservation-offer";
        party.insertBefore(offer, party.firstChild);
      }

      setText(offer, offerName);
    }

    if (term) {
      term.classList.add("owner-reservation-term");
      setFieldLabel(term, label("term"));
    }

    if (status) {
      let wrapper = status.parentElement;

      if (!wrapper || !wrapper.classList.contains("owner-reservation-status-field")) {
        wrapper = document.createElement("div");
        wrapper.className = "owner-reservation-status-field owner-reservation-field";
        status.replaceWith(wrapper);
        wrapper.appendChild(status);
      }

      wrapper.dataset.ownerLabel = label("status");
    }

    if (actions) {
      actions.classList.add("owner-reservation-actions");
      setFieldLabel(actions, label("action"));
    }
  }

  function updateGeneratedLabels(root) {
    const offersHeader = root.querySelector(".owner-offers-section-header h2");
    const reservationsHeader = root.querySelector(".owner-reservations-section h2");
    const empty = root.querySelector(".owner-reservations-empty");

    setText(offersHeader, label("offers"));
    setText(reservationsHeader, label(
      root.querySelectorAll(".owner-reservation-card").length ? "reservations" : "activeReservations"
    ));
    setText(empty, label("empty"));

    root.querySelectorAll(".owner-offer-manage-summary").forEach(function (summary) {
      setText(summary, label("manage"));
    });

    root.querySelectorAll(".owner-reservation-card").forEach(function (card) {
      setFieldLabel(card.querySelector(".owner-reservation-party"), label("offerRenter"));
      setFieldLabel(card.querySelector(".owner-reservation-term"), label("term"));
      setFieldLabel(card.querySelector(".owner-reservation-price"), label("price"));

      const statusField = card.querySelector(".owner-reservation-status-field");
      if (statusField) statusField.dataset.ownerLabel = label("status");

      setFieldLabel(card.querySelector(".owner-reservation-actions"), label("action"));
      const receiveBack = card.querySelector('[data-offers-action="mark-returned"]');
      if (receiveBack) setText(receiveBack, label("receiveBack"));
    });

    const search = root.querySelector("#ownerReservationSearch");
    if (search) {
      search.placeholder = label("search");
      search.setAttribute("aria-label", label("search"));
    }
    root.querySelectorAll(".owner-reservation-group-title").forEach(function (heading) {
      setText(heading, label(heading.dataset.groupLabel));
    });
  }

  function readReservationData(card) {
    return {
      status: card.dataset.ownerStatus || "",
      date: card.dataset.ownerDate || "",
      number: card.dataset.ownerNumber || "",
      offerNumber: card.dataset.ownerOfferNumber || "",
      offer: card.dataset.ownerOffer || "",
      renter: card.dataset.ownerRenter || ""
    };
  }

  function createReservationToolbar() {
    const toolbar = document.createElement("div");
    toolbar.className = "owner-reservations-toolbar";
    const input = document.createElement("input");
    input.type = "search";
    input.id = "ownerReservationSearch";
    input.className = "owner-reservation-search";
    input.autocomplete = "off";
    input.value = searchQuery;
    input.placeholder = label("search");
    input.setAttribute("aria-label", label("search"));
    toolbar.appendChild(input);
    return toolbar;
  }

  function createReservationGroup(type, cards) {
    const section = document.createElement("section");
    section.className = "owner-reservation-group owner-reservation-group-" + type;
    const heading = document.createElement("h3");
    heading.className = "owner-reservation-group-title";
    heading.dataset.groupLabel = type === "attention" ? "attention" : "waiting";
    heading.textContent = label(heading.dataset.groupLabel);
    const list = document.createElement("div");
    list.className = "owner-reservations-list";
    cards.forEach(function (card) { list.appendChild(card); });
    section.appendChild(heading);
    section.appendChild(list);
    return section;
  }

  function applyReservationFilters(root) {
    const section = root.querySelector(":scope > .owner-reservations-section");
    if (!section) return;
    const total = section.querySelectorAll(".owner-reservation-card").length;
    // Search is useful only for more than five active reservations. If the
    // count drops to five, clear the old query so no row stays invisibly filtered.
    const canSearch = total > 5;
    const toolbar = section.querySelector(".owner-reservations-toolbar");
    if (toolbar) toolbar.hidden = !canSearch;
    if (!canSearch && searchQuery) {
      searchQuery = "";
      const searchInput = section.querySelector("#ownerReservationSearch");
      if (searchInput) searchInput.value = "";
    }
    let shown = 0;
    section.querySelectorAll(".owner-reservation-group").forEach(function (group) {
      let groupShown = 0;
      group.querySelectorAll(".owner-reservation-card").forEach(function (card) {
        const matches = matchesReservation(readReservationData(card), searchQuery);
        card.hidden = !matches;
        if (matches) { groupShown++; shown++; }
      });
      group.hidden = groupShown === 0;
    });
    const empty = section.querySelector(".owner-reservations-empty");
    if (empty) {
      empty.hidden = shown > 0;
      setText(empty, total ? label("noMatches") : label("empty"));
    }
    const badge = section.querySelector(".owner-reservations-section-header .owner-section-count");
    if (badge) setText(badge, String(shown));
  }

  function focusActionReservation(section) {
    const params = new URLSearchParams(window.location.search);

    if (params.get("open") !== "actions") {
      return;
    }

    const cards = Array.from(section.querySelectorAll(".owner-reservation-card"));
    const actionable = cards.find(function (card) {
      return !card.hidden && card.querySelector(
        '[data-offers-action="approve-reservation"], ' +
        '[data-offers-action="reject-reservation"], ' +
        '[data-offers-action="mark-returned"]'
      );
    });

    const target = actionable || cards.find(function (card) { return !card.hidden; });

    if (target) {
      window.setTimeout(function () {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 0);
    }
  }

  function enhance() {
    if (applying) return;
    const root = document.getElementById("offersList");
    if (!root) return;
    const offersList = root.querySelector(":scope > .offers-card-list");
    if (!offersList) return;

    const rawPanels = Array.from(
      offersList.querySelectorAll(":scope > .simple-offer-record > .request-panel")
    );
    if (!rawPanels.length && root.querySelector(":scope > .owner-reservations-section")) {
      updateGeneratedLabels(root);
      applyReservationFilters(root);
      return;
    }
    if (!rawPanels.length) return;

    applying = true;
    try {
      offersList.classList.add("owner-offers-list");
      let offersHeader = root.querySelector(":scope > .owner-offers-section-header");
      if (!offersHeader) {
        offersHeader = createSectionHeader("owner-offers-section-header", label("offers"));
        root.insertBefore(offersHeader, offersList);
      }

      const reservationCards = [];
      Array.from(offersList.querySelectorAll(":scope > .simple-offer-record")).forEach(function (record) {
        const offerName = simplifyOfferRow(record);
        const offerNumber = record.dataset.ownerOfferNumber || "";
        const panel = record.querySelector(":scope > .request-panel");
        if (!panel) return;
        Array.from(panel.querySelectorAll(":scope .request-card")).forEach(function (card) {
          enhanceReservationCard(card, offerName, offerNumber);
          reservationCards.push(card);
        });
        panel.remove();
      });

      const oldReservations = root.querySelector(":scope > .owner-reservations-section");
      if (oldReservations) oldReservations.remove();
      reservationCards.sort(function (first, second) {
        return compareReservationData(readReservationData(first), readReservationData(second));
      });
      const attention = reservationCards.filter(function (card) {
        return ATTENTION_STATUSES.has(card.dataset.ownerStatus);
      });
      const waiting = reservationCards.filter(function (card) {
        return !ATTENTION_STATUSES.has(card.dataset.ownerStatus);
      });

      const section = document.createElement("section");
      section.className = "owner-reservations-section";
      const header = createSectionHeader(
        "owner-reservations-section-header",
        label(reservationCards.length ? "reservations" : "activeReservations")
      );
      const headingWithCount = document.createElement("div");
      headingWithCount.className = "owner-reservations-heading";
      headingWithCount.appendChild(header.querySelector("h2"));
      const count = document.createElement("span");
      count.className = "owner-section-count";
      count.textContent = String(reservationCards.length);
      headingWithCount.appendChild(count);
      header.appendChild(headingWithCount);
      section.appendChild(header);
      const toolbar = createReservationToolbar();
      toolbar.hidden = reservationCards.length <= 5;
      section.appendChild(toolbar);
      section.appendChild(createReservationGroup("attention", attention));
      section.appendChild(createReservationGroup("waiting", waiting));
      const empty = document.createElement("div");
      empty.className = "owner-reservations-empty";
      section.appendChild(empty);

      // Put the reservations first only when an action or handover is needed.
      if (shouldShowReservationsFirst(reservationCards.map(function (card) {
        return card.dataset.ownerStatus;
      }))) {
        root.insertBefore(section, offersHeader);
      } else {
        root.insertBefore(section, offersList.nextSibling);
      }
      applyReservationFilters(root);
      focusActionReservation(section);
    } finally {
      applying = false;
    }
  }

  function scheduleEnhance() {
    if (scheduled) {
      return;
    }

    scheduled = true;

    window.requestAnimationFrame(function () {
      scheduled = false;
      enhance();
    });
  }

  function initialize() {
    const root = document.getElementById("offersList");

    if (!root) {
      return;
    }

    const observer = new MutationObserver(function () {
      scheduleEnhance();
    });

    observer.observe(root, {
      childList: true,
      subtree: true
    });

    root.addEventListener("input", function (event) {
      if (event.target && event.target.id === "ownerReservationSearch") {
        searchQuery = event.target.value;
        applyReservationFilters(root);
      }
    });

    scheduleEnhance();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }

  document.addEventListener("rentuloLanguageChanged", scheduleEnhance);
})();
