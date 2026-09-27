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
      empty: "Teď nemáte žádnou žádost ani probíhající rezervaci."
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
      empty: "Teraz nemáte žiadnu žiadosť ani prebiehajúcu rezerváciu."
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
      empty: "You have no requests or active reservations right now."
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
      empty: "Sie haben derzeit keine Anfragen oder laufenden Reservierungen."
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
      empty: "Nie masz teraz żadnych próśb ani trwających rezerwacji."
    }
  };

  let scheduled = false;
  let applying = false;

  function language() {
    const value = String(document.documentElement.lang || "cs")
      .toLowerCase()
      .split("-")[0];

    return LABELS[value] ? value : "cs";
  }

  function label(key) {
    return LABELS[language()][key] || LABELS.cs[key] || key;
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

  function enhanceReservationCard(card, offerName) {
    card.classList.add("owner-reservation-card");

    card.querySelectorAll('[data-offers-action="mark-picked-up"]').forEach(function (button) {
      button.remove();
    });

    const row = card.querySelector(":scope > .request-row");

    if (!row) {
      return;
    }

    const party = row.querySelector(":scope > .request-main");
    const term = row.querySelector(":scope > .request-date");
    const price = row.querySelector(":scope > .table-value");
    const status = row.querySelector(":scope > .request-status");
    const actions = row.querySelector(":scope > .row-actions");

    if (party) {
      party.classList.add("owner-reservation-party");
      setFieldLabel(party, label("offerRenter"));

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

    if (price) {
      price.classList.remove("hide-tablet");
      price.classList.add("owner-reservation-price");
      setFieldLabel(price, label("price"));
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
    setText(reservationsHeader, label("reservations"));
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
    });
  }

  function focusActionReservation(section) {
    const params = new URLSearchParams(window.location.search);

    if (params.get("open") !== "actions") {
      return;
    }

    const cards = Array.from(section.querySelectorAll(".owner-reservation-card"));
    const actionable = cards.find(function (card) {
      return card.querySelector(
        '[data-offers-action="approve-reservation"], ' +
        '[data-offers-action="reject-reservation"], ' +
        '[data-offers-action="mark-returned"]'
      );
    });

    const target = actionable || cards[0];

    if (target) {
      window.setTimeout(function () {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 0);
    }
  }

  function enhance() {
    if (applying) {
      return;
    }

    const root = document.getElementById("offersList");

    if (!root) {
      return;
    }

    const offersList = root.querySelector(":scope > .offers-card-list");

    if (!offersList) {
      return;
    }

    const rawPanels = Array.from(
      offersList.querySelectorAll(":scope > .simple-offer-record > .request-panel")
    );

    if (!rawPanels.length && root.querySelector(":scope > .owner-reservations-section")) {
      updateGeneratedLabels(root);
      return;
    }

    if (!rawPanels.length) {
      return;
    }

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
        const panel = record.querySelector(":scope > .request-panel");

        if (!panel) {
          return;
        }

        Array.from(panel.querySelectorAll(":scope .request-card")).forEach(function (card) {
          enhanceReservationCard(card, offerName);
          reservationCards.push(card);
        });

        panel.remove();
      });

      const oldReservations = root.querySelector(":scope > .owner-reservations-section");
      if (oldReservations) oldReservations.remove();

      const section = document.createElement("section");
      section.className = "owner-reservations-section";

      const header = createSectionHeader("owner-reservations-section-header", label("reservations"));

      if (reservationCards.length) {
        const count = document.createElement("span");
        count.className = "owner-section-count";
        count.textContent = String(reservationCards.length);
        header.appendChild(count);
      }

      section.appendChild(header);

      const list = document.createElement("div");
      list.className = "owner-reservations-list";

      if (reservationCards.length) {
        reservationCards.forEach(function (card) {
          list.appendChild(card);
        });
      } else {
        const empty = document.createElement("div");
        empty.className = "owner-reservations-empty";
        empty.textContent = label("empty");
        list.appendChild(empty);
      }

      section.appendChild(list);
      root.appendChild(section);

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

    scheduleEnhance();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }

  document.addEventListener("rentuloLanguageChanged", scheduleEnhance);
})();
