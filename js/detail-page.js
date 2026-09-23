    const PLATFORM_FEE_PERCENT = 10;
    let currentOffer = null;
    let detailPageState = "idle";
    let detailBookingMessage = "";

    const DETAIL_BOOKING_TIME_COPY = {
      cs: {
        pickupTime: "Čas převzetí",
        pickupTimeHelp: "Vrácení bude v poslední den rezervace ve stejný čas.",
        selectTime: "Vyberte čas převzetí.",
        invalidTime: "Vyberte platný čas převzetí."
      },
      sk: {
        pickupTime: "Čas prevzatia",
        pickupTimeHelp: "Vrátenie bude v posledný deň rezervácie v rovnakom čase.",
        selectTime: "Vyberte čas prevzatia.",
        invalidTime: "Vyberte platný čas prevzatia."
      },
      en: {
        pickupTime: "Pickup time",
        pickupTimeHelp: "Return is due at the same time on the last day of the reservation.",
        selectTime: "Choose a pickup time.",
        invalidTime: "Choose a valid pickup time."
      },
      de: {
        pickupTime: "Abholzeit",
        pickupTimeHelp: "Die Rückgabe erfolgt am letzten Reservierungstag zur gleichen Uhrzeit.",
        selectTime: "Wählen Sie eine Abholzeit.",
        invalidTime: "Wählen Sie eine gültige Abholzeit."
      },
      pl: {
        pickupTime: "Godzina odbioru",
        pickupTimeHelp: "Zwrot następuje o tej samej godzinie w ostatnim dniu rezerwacji.",
        selectTime: "Wybierz godzinę odbioru.",
        invalidTime: "Wybierz prawidłową godzinę odbioru."
      }
    };

    function detailBookingTimeText(key) {
      const language = typeof window.getRentuloLanguage === "function"
        ? window.getRentuloLanguage()
        : "cs";
      const copy = DETAIL_BOOKING_TIME_COPY[language] || DETAIL_BOOKING_TIME_COPY.cs;

      return copy[key] || DETAIL_BOOKING_TIME_COPY.cs[key] || key;
    }

    function isValidPickupTime(value) {
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
    }

    function detailTranslate(key, replacements) {
      let text = typeof window.rentuloTranslate === "function"
        ? window.rentuloTranslate(key)
        : key;

      Object.keys(replacements || {}).forEach(function (name) {
        text = text.replaceAll("{" + name + "}", String(replacements[name]));
      });

      return text;
    }

    function getDetailLocale() {
      const language = typeof window.getRentuloLanguage === "function"
        ? window.getRentuloLanguage()
        : "cs";
      const locales = {
        cs: "cs-CZ",
        sk: "sk-SK",
        en: "en-GB",
        de: "de-DE",
        pl: "pl-PL"
      };

      return locales[language] || locales.cs;
    }

    function getDetailDescriptionTitle() {
      const language = typeof window.getRentuloLanguage === "function"
        ? window.getRentuloLanguage()
        : "cs";
      const labels = {
        cs: "Popis věci",
        sk: "Popis veci",
        en: "Item description",
        de: "Beschreibung des Artikels",
        pl: "Opis przedmiotu"
      };

      return labels[language] || labels.cs;
    }

    function formatDetailNumber(value, options) {
      const numberValue = Number(value);

      if (!Number.isFinite(numberValue)) {
        return String(value === undefined || value === null ? "" : value);
      }

      return numberValue.toLocaleString(getDetailLocale(), options);
    }

    function formatDetailMoney(value) {
      return formatDetailNumber(value) + " Kč";
    }

    function getDetailRatingLabel(count) {
      const pluralCategory = new Intl.PluralRules(getDetailLocale()).select(Number(count));
      const keys = {
        one: "detail.ratingOne",
        few: "detail.ratingFew",
        many: "detail.ratingMany",
        other: "detail.ratingOther"
      };

      return detailTranslate(keys[pluralCategory] || keys.other);
    }

    function getDetailDaysText(days) {
      const count = Number(days);
      const language = typeof window.getRentuloLanguage === "function"
        ? window.getRentuloLanguage()
        : "cs";

      if (language === "sk") {
        const pluralCategory = new Intl.PluralRules("sk-SK").select(count);
        const key = pluralCategory === "one"
          ? "detail.oneDay"
          : pluralCategory === "few"
            ? "detail.fewDays"
            : "detail.manyDays";
        return detailTranslate(key, { days: count });
      }

      return detailTranslate(count === 1 ? "detail.oneDay" : "detail.manyDays", { days: count });
    }

    function detailCategoryLabel(category) {
      const value = String(category || "").trim();
      const categories = {
        "Domácnost": "home.category.household",
        "Zahrada": "home.category.garden",
        "Stavba": "home.category.construction",
        "Hobby": "home.category.hobby",
        "Párty": "home.category.party",
        "Ostatní": "home.category.other",
        "Dům a zahrada": "detail.category.homeGarden",
        "Dílna a nářadí": "detail.category.workshopTools",
        "Stavební technika": "detail.category.construction",
        "Sport a volný čas": "detail.category.sportLeisure",
        "Elektronika": "detail.category.electronics",
        "Děti a rodina": "detail.category.childrenFamily",
        "Cestování a kempování": "detail.category.travelCamping",
        "Párty a akce": "detail.category.partyEvents",
        "Auto a doprava": "detail.category.autoTransport"
      };
      return categories[value]
        ? detailTranslate(categories[value])
        : (value || detailTranslate("home.category.other"));
    }

  

 

    function getOfferIdFromUrl() {
      const params = new URLSearchParams(window.location.search);
      return params.get("id");
    }

    function getDaysBetween(startDate, endDate) {
      if (!startDate || !endDate) {
        return 0;
      }

      const start = new Date(startDate);
      const end = new Date(endDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return 0;
      }

      const difference = end - start;
      const days = Math.ceil(difference / (1000 * 60 * 60 * 24));

      return days > 0 ? days : 0;
    }

    function getNextDate(dateString) {
      const date = new Date(dateString);

      if (!dateString || isNaN(date.getTime())) {
        return "";
      }

      date.setDate(date.getDate() + 1);

      return date.toISOString().split("T")[0];
    }

    function normalizeSupabaseOffer(row) {
      return {
        id: row.id,
ownerId: row.owner_id,
owner_id: row.owner_id,
        name: row.name,
        title: row.name,
        nazev: row.name,

        category: row.category,
        kategorie: row.category,

        description: row.description,
        popis: row.description,

        city: row.city,
        mesto: row.city,

        postalCode: row.postal_code,
        psc: row.postal_code,

        price: row.price_per_day,
        pricePerDay: row.price_per_day,
        cena: row.price_per_day,


        status: row.status === "active" ? "Aktivní" : row.status,
        supabaseStatus: row.status,

        photoUrl: row.photo_url,
        photo_url: row.photo_url,
        image: row.photo_url,

        pickupMode: row.pickup_mode || "",
        pickup_mode: row.pickup_mode || "",
        pickupPhone: row.pickup_phone || "",
        pickup_phone: row.pickup_phone || "",
        pickupStreet: row.pickup_street || "",
        pickup_street: row.pickup_street || "",
        pickupCity: row.pickup_city || "",
        pickup_city: row.pickup_city || "",
        pickupPostalCode: row.pickup_postal_code || "",
        pickup_postal_code: row.pickup_postal_code || "",
        pickupNote: row.pickup_note || "",
        pickup_note: row.pickup_note || "",

        createdAt: row.created_at,
        updatedAt: row.updated_at,

        source: "supabase"
      };
    }

    async function loadOfferFromSupabase(offerId) {
      const supabaseClient = getSupabaseClient();

      if (!offerId) {
        return null;
      }

      if (!supabaseClient) {
        throw new Error("Supabase client is unavailable.");
      }

      const { data, error } = await supabaseClient
        .from("public_offers")
        .select("*")
        .eq("id", offerId)
        .maybeSingle();

      if (error) {
        console.error(error);
        throw error;
      }

      return data ? normalizeSupabaseOffer(data) : null;
    }

function getOfferCategory(offer) {
      return offer.category || offer.kategorie || detailTranslate("detail.category.other");
    }

    function getOfferCity(offer) {
      return offer.city || offer.mesto || offer.location || "-";
    }

    function getOfferStatus(offer) {
      return offer.status || "active";
    }

    function getOfferPhoto(offer) {
      return (
        offer.photoUrl ||
        offer.photo_url ||
        offer.photoDataUrl ||
        offer.imageDataUrl ||
        offer.image ||
        offer.photo ||
        ""
      );
    }

function renderDetailImage(offer) {
      const offerName = getOfferName(offer);
      const photo = getOfferPhoto(offer);

      if (photo) {
        return `
          <div class="image-box has-photo">
            <img src="${escapeHtml(photo)}" alt="${escapeHtml(offerName)}">
            <div class="image-label">${escapeHtml(offerName)}</div>
          </div>
        `;
      }

      return `
        <div class="image-box">
          <div class="image-icon">⌁</div>
          <div class="image-label">${escapeHtml(offerName)}</div>
        </div>
      `;
    }

    function isOfferDraft(offer) {
      const status = String(getOfferStatus(offer)).trim().toLowerCase();
      return status === "koncept" || status === "draft";
    }

    function isOfferActive(offer) {
      return !isOfferDraft(offer);
    }

    function offerHasGpsLocation() {
      return false;
    }

    function getPickupGpsText() {
      return detailTranslate("detail.gps.private");
    }

    function setupBackLink() {
      const backLink = document.getElementById("detailBackLink");

      if (!backLink) {
        return;
      }

      try {
        const referrer = document.referrer;

        if (referrer && referrer.includes("vysledky.html")) {
          backLink.href = referrer;
          return;
        }

        const storedResultsUrl = sessionStorage.getItem("rentuloLastResultsUrl");

        if (storedResultsUrl) {
          backLink.href = storedResultsUrl;
        }
      } catch (error) {
        backLink.href = "vysledky.html";
      }
    }

    function renderLoading() {
      document.getElementById("detailContent").innerHTML = `
        <div class="message-card">
          <strong>${detailTranslate("detail.loadingTitle")}</strong><br>
          ${detailTranslate("detail.loadingText")}
        </div>
      `;
    }

    function renderNotFound() {
      document.getElementById("detailContent").innerHTML = `
        <div class="message-card warning">
          <strong>${detailTranslate("detail.notFoundTitle")}</strong><br>
          ${detailTranslate("detail.notFoundText")}
          <br>
          <a href="vysledky.html" class="primary-button">${detailTranslate("detail.backToListings")}</a>
        </div>
      `;
    }

    function renderLoadError() {
      document.getElementById("detailContent").innerHTML = `
        <div class="message-card warning">
          <strong>${detailTranslate("detail.loadErrorTitle")}</strong><br>
          ${detailTranslate("detail.loadErrorText")}
          <br>
          <button type="button" class="primary-button" id="detailRetryButton">
            ${detailTranslate("detail.reload")}
          </button>
        </div>
      `;

      const retryButton = document.getElementById("detailRetryButton");
      if (retryButton) {
        retryButton.addEventListener("click", initializeDetailPage);
      }
    }

    function showDetailBookingMessage(message) {
      const text = String(message || "").trim();
      detailBookingMessage = text;

      if (!text) {
        return false;
      }

      const bookingDateHelp = document.getElementById("bookingDateHelp");

      if (bookingDateHelp) {
        bookingDateHelp.textContent = text;
        bookingDateHelp.setAttribute("role", "alert");
        return true;
      }

      const sidebar = document.querySelector(".sidebar");

      if (sidebar) {
        let notice = sidebar.querySelector(".detail-booking-message");

        if (!notice) {
          notice = document.createElement("div");
          notice.className = "message-card warning detail-booking-message";
          notice.setAttribute("role", "alert");
          sidebar.prepend(notice);
        }

        notice.textContent = text;
        return true;
      }

      console.error(text);
      return false;
    }

    function clearDetailBookingMessage() {
      detailBookingMessage = "";

      const bookingDateHelp = document.getElementById("bookingDateHelp");
      if (bookingDateHelp) {
        bookingDateHelp.removeAttribute("role");
      }

      const notice = document.querySelector(".detail-booking-message");
      if (notice) {
        notice.remove();
      }
    }

    function renderSidebarMessage(type, title, text, buttonHref, buttonText) {
      return `
        <div class="message-card ${type === "warning" ? "warning" : ""}">
          <strong>${escapeHtml(title)}</strong><br>
          ${escapeHtml(text)}
          <br>
          <a href="${escapeHtml(buttonHref)}" class="primary-button">${escapeHtml(buttonText)}</a>
        </div>
      `;
    }

    function renderUnavailableSidebar(price, messageTitle, messageText) {
      return `
        <aside class="sidebar">
          <div class="price">${escapeHtml(formatDetailNumber(price))}</div>
          <div class="price-small">${detailTranslate("detail.currencyPerDay")}</div>

          <div class="info-list">
            <div class="info-row">
              <span>${detailTranslate("detail.availability")}</span>
              <span>${detailTranslate("detail.unavailable")}</span>
            </div>
          </div>

          <div class="availability-box unavailable">
            <strong>${escapeHtml(messageTitle)}</strong>
            ${escapeHtml(messageText)}
          </div>

          <button class="primary-button disabled" type="button" disabled>
            ${detailTranslate("detail.cannotReserve")}
          </button>

          <div class="note">
            ${detailTranslate("detail.cannotReserveNote")}
          </div>
        </aside>
      `;
    }

    function renderBookingSidebar(price) {
      return `
        <aside class="sidebar">
          <div class="price">${escapeHtml(formatDetailNumber(price))}</div>
          <div class="price-small">${detailTranslate("detail.currencyPerDay")}</div>


          <div class="booking-box">
            <h2>${detailTranslate("detail.chooseDates")}</h2>

            <div class="form-group">
              <label for="startDate">${detailTranslate("detail.startDate")}</label>
              <input type="date" id="startDate">
            </div>

            <div class="form-group">
              <label for="endDate">${detailTranslate("detail.endDate")}</label>
              <input type="date" id="endDate">
            </div>

            <div class="form-group">
              <label for="pickupTime">${escapeHtml(detailBookingTimeText("pickupTime"))}</label>
              <input type="time" id="pickupTime" required>
            </div>

            <div class="date-help" id="bookingTimeHelp">
              ${escapeHtml(detailBookingTimeText("pickupTimeHelp"))}
            </div>

            <div class="date-help" id="bookingDateHelp">
              ${detailTranslate("detail.dateHelp")}
            </div>

            <div class="calculation">
              <div class="calc-row">
                <span>${detailTranslate("detail.days")}</span>
                <strong id="calcDays">-</strong>
              </div>

              <div class="calc-row">
                <span>${detailTranslate("detail.pricePerDay")}</span>
                <strong>${escapeHtml(formatDetailMoney(price))}</strong>
              </div>

              <div class="calc-row calc-total">
                <span>${detailTranslate("detail.total")}</span>
                <strong id="calcTotal">-</strong>
              </div>
            </div>

            <div class="platform-fee-note">
              ${detailTranslate("detail.platformFee")}: ${PLATFORM_FEE_PERCENT} %
            </div>

            <button class="primary-button disabled" id="rentButton" type="button" disabled>
              ${detailTranslate("detail.selectDates")}
            </button>
          </div>

          <div class="note">
            ${detailTranslate("detail.requestNote")}
          </div>
        </aside>
      `;
    }

    async function hasReservationDateConflict(offerId, startDate, endDate) {
      const supabaseClient = getSupabaseClient();

      if (!supabaseClient || !offerId || !startDate || !endDate) {
        return false;
      }

      const { data: blockingReservations, error } = await supabaseClient
  .rpc("get_blocking_reservations", {
    p_offer_id: offerId
  });

const data = Array.isArray(blockingReservations)
  ? blockingReservations.filter(function (reservation) {
      return (
        reservation.start_date < endDate &&
        reservation.end_date > startDate
      );
    }).slice(0, 1)
  : [];

      if (error) {
        console.warn("Dostupnost termínu se nepodařilo ověřit.", error);
        throw error;
      }

      return Array.isArray(data) && data.length > 0;
    }

    async function renderDetail(offer) {
      if (!offer) {
        renderNotFound();
        return;
      }

      currentOffer = offer;

      const currentUser = typeof navGetVerifiedUser === "function"
        ? await navGetVerifiedUser()
        : await getCurrentSupabaseUser();

      const offerName = getOfferName(offer);
      const offerCategory = detailCategoryLabel(getOfferCategory(offer));
      const offerCity = getOfferCity(offer);

      const price = getOfferPrice(offer);

      const currentUserId = currentUser ? String(currentUser.id || "") : "";
const ownerId = String(offer.ownerId || offer.owner_id || "");
const isOwner = currentUserId && ownerId && currentUserId === ownerId;

const isActive = isOfferActive(offer);
const hasGps = offerHasGpsLocation(offer);

      const availabilityBadgeClass = isActive ? "available" : "unavailable";

      let availabilityText = detailTranslate("detail.available");
      let availabilityPanelText = detailTranslate("detail.availabilityPanelActive");

      if (isOwner && isActive) {
        availabilityText = detailTranslate("detail.ownerOfferActiveTitle");
        availabilityPanelText = detailTranslate("detail.ownerOfferActiveText");
      } else if (!isActive) {
        availabilityText = detailTranslate("detail.inactive");
        availabilityPanelText = detailTranslate("detail.availabilityPanelInactive");
      }

      let sidebarContent = "";

      if (!currentUser) {
  sidebarContent = renderSidebarMessage(
    "",
    detailTranslate("detail.loginRequiredTitle"),
    detailTranslate("detail.loginRequiredText"),
    `prihlaseni.html?returnTo=${encodeURIComponent(
  window.location.pathname.split("/").pop() + window.location.search
)}`,
    detailTranslate("nav.login")
  );
} else if (isOwner) {
  sidebarContent = renderSidebarMessage(
    "",
    detailTranslate("detail.ownItemTitle"),
    detailTranslate("detail.ownItemText"),
    "moje-nabidky.html",
    detailTranslate("account.myListingsTitle")
  );
} else if (!isActive) {
        sidebarContent = renderUnavailableSidebar(
          price,
          detailTranslate("detail.inactiveTitle"),
          detailTranslate("detail.inactiveText")
        );
      } else {
        sidebarContent = renderBookingSidebar(price);
      }

      document.getElementById("detailContent").innerHTML = `
        <div class="detail-layout">
          <section class="detail-main-card">
            <div class="detail-hero">
              ${renderDetailImage(offer)}

              <div class="detail-hero-copy">
                <h1>${escapeHtml(offerName)}</h1>

                <div class="category-line">
                  ${escapeHtml(offerCategory)}
                </div>

                <div class="badges">
                  <span class="badge" id="ownerRatingBadge">${detailTranslate("detail.ratingLoading")}</span>
                </div>
              </div>
            </div>

            <div class="detail-content">
              <div class="availability-panel ${availabilityBadgeClass}" id="detailAvailabilityPanel">
                <strong>${escapeHtml(availabilityText)}</strong>
                ${escapeHtml(availabilityPanelText)}
              </div>

              ${offer.description && offer.description.trim() ? `
                <section class="description-section">
                  <h2>${escapeHtml(getDetailDescriptionTitle())}</h2>
                  <p class="description">${escapeHtml(offer.description)}</p>
                </section>
              ` : ""}

              <div class="info-grid">
                <div class="section">
                  <h2>${detailTranslate("detail.termsTitle")}</h2>

                  <p>
                    ${detailTranslate("detail.termsText")}
                  </p>
                </div>

                <div class="section">
                  <h2>${detailTranslate("detail.pickupTitle")}</h2>
                  <p>${escapeHtml(offerCity || "-")}</p>
                </div>

                <div class="section">
                  <h2>${detailTranslate("detail.nearbyTitle")}</h2>

                  <div class="gps-note ${hasGps ? "" : "missing"}">
                    ${escapeHtml(getPickupGpsText(offer))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div>
            ${sidebarContent}
          </div>
        </div>
      `;

      loadOwnerRating(ownerId);

      if (currentUser && !isOwner && isActive) {
  setupBookingForm(offer);
}
    }

    async function loadOwnerRating(ownerId) {
      const ratingBadge = document.getElementById("ownerRatingBadge");

      if (!ratingBadge) {
        return;
      }

      if (!ownerId) {
        ratingBadge.textContent = detailTranslate("detail.ratingNone");
        return;
      }

      const supabaseClient = getSupabaseClient();

      if (!supabaseClient) {
        ratingBadge.textContent = detailTranslate("detail.ratingUnavailable");
        return;
      }

      const { data, error } = await supabaseClient
        .from("user_rating_summary")
        .select("average_rating, rating_count")
        .eq("user_id", ownerId)
        .maybeSingle();

      if (error) {
        console.warn("Hodnocení majitele se nepodařilo načíst.", error);
        ratingBadge.textContent = detailTranslate("detail.ratingUnavailable");
        return;
      }

      if (!data || !data.rating_count) {
        ratingBadge.textContent = detailTranslate("detail.ratingNone");
        return;
      }

      ratingBadge.textContent =
        detailTranslate("detail.ratingPrefix") + " ⭐ " +
        formatDetailNumber(data.average_rating, { maximumFractionDigits: 2 }) +
        " / 5 (" +
        formatDetailNumber(data.rating_count) +
        " " + getDetailRatingLabel(data.rating_count) + ")";
    }



    async function createSupabaseReservation(offer, startDate, endDate, pickupTime) {
      const supabaseClient = getSupabaseClient();

      if (!supabaseClient) {
        showDetailBookingMessage(detailTranslate("detail.error.supabase"));
        return false;
      }

      const supabaseUser = await getCurrentSupabaseUser();

      if (!supabaseUser) {
        showDetailBookingMessage(detailTranslate("detail.error.loginAgain"));
        window.location.href =
  `prihlaseni.html?returnTo=${encodeURIComponent(
    window.location.pathname.split("/").pop() + window.location.search
  )}`;
        return false;
      }

      const ownerId = String(offer.ownerId || offer.owner_id || "");

      if (!ownerId) {
        showDetailBookingMessage(detailTranslate("detail.error.ownerMissing"));
        return false;
      }

      if (String(supabaseUser.id) === ownerId) {
        renderDetail(offer);
        return false;
      }

      const reservationToInsert = {
         offer_id: offer.id,
         start_date: startDate,
         end_date: endDate,
         pickup_time: pickupTime
  };

      const { data, error } = await supabaseClient
        .from("reservations")
        .insert(reservationToInsert)
        .select("id")
        .single();

      if (error) {
        console.error(error);

        const errorMessage = String(error.message || "");

        if (errorMessage.includes("Reservation dates overlap")) {
          showDetailBookingMessage(detailTranslate("detail.error.overlap"));
          return false;
        }

        if (errorMessage.includes("row-level security")) {
          showDetailBookingMessage(detailTranslate("detail.error.rls"));
          return false;
        }

        showDetailBookingMessage(detailTranslate("detail.error.save"));
        return false;
      }

      if (data && data.id) {
        try {
          sessionStorage.setItem("rentuloLastCreatedReservationId", data.id);
        } catch (storageError) {
          console.warn("ID nové rezervace se nepodařilo uložit do sessionStorage.", storageError);
        }

        if (typeof window.apiSendReservationEmail === "function") {
          try {
            await window.apiSendReservationEmail(data.id, "new_request");
          } catch (emailError) {
            console.warn("E-mail o nové rezervaci se nepodařilo odeslat.", emailError);
          }
        }
      }

      window.location.href = "moje-rezervace.html";
      return true;
    }
    function setupBookingForm(offer) {
      const startDateInput = document.getElementById("startDate");
      const endDateInput = document.getElementById("endDate");
      const pickupTimeInput = document.getElementById("pickupTime");
      const bookingTimeHelp = document.getElementById("bookingTimeHelp");
      const calcDays = document.getElementById("calcDays");
      const calcTotal = document.getElementById("calcTotal");
      const rentButton = document.getElementById("rentButton");
      const bookingDateHelp = document.getElementById("bookingDateHelp");
      const detailAvailabilityPanel = document.getElementById("detailAvailabilityPanel");

      if (!startDateInput || !endDateInput || !pickupTimeInput || !calcDays || !calcTotal || !rentButton) {
        return;
      }

      const today = new Date().toISOString().split("T")[0];
      let availabilityCheckVersion = 0;

      startDateInput.min = today;
      endDateInput.min = getNextDate(today);

      function updateAvailabilityElement(element, state, title, text) {
        if (!element) {
          return;
        }

        element.classList.remove("available", "unavailable");
        element.classList.add(state === "conflict" ? "unavailable" : "available");
        element.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(text)}`;
      }

      function setAvailabilityDisplay(state) {
        const hasConflict = state === "conflict";

        updateAvailabilityElement(
          detailAvailabilityPanel,
          state,
          hasConflict
            ? detailTranslate("detail.dateConflictButton")
            : detailTranslate("detail.available"),
          hasConflict
            ? detailTranslate("detail.dateConflictText")
            : detailTranslate("detail.availabilityPanelActive")
        );

      }

      function setRentButtonState(state) {
        if (state === "available") {
          rentButton.disabled = false;
          rentButton.classList.remove("disabled", "date-conflict");
          rentButton.textContent = detailTranslate("detail.requestRental");
          return;
        }

        rentButton.disabled = true;
        rentButton.classList.add("disabled");
        rentButton.classList.toggle("date-conflict", state === "conflict");

        if (state === "checking") {
          rentButton.textContent = detailTranslate("detail.checkingDates");
        } else if (state === "conflict") {
          rentButton.textContent = detailTranslate("detail.dateConflictButton");
        } else if (state === "missing-time") {
          rentButton.textContent = detailBookingTimeText("selectTime");
        } else {
          rentButton.textContent = detailTranslate("detail.selectDates");
        }
      }

      async function updateCalculation() {
        const checkVersion = ++availabilityCheckVersion;

        if (bookingDateHelp) {
          bookingDateHelp.removeAttribute("role");
        }
        const startDate = startDateInput.value;
        const endDate = endDateInput.value;

        if (startDate) {
          const nextDate = getNextDate(startDate);
          endDateInput.min = nextDate;

          if (endDate && endDate <= startDate) {
            endDateInput.value = "";
          }
        } else {
          endDateInput.min = getNextDate(today);
        }

        const activeStartDate = startDateInput.value;
        const activeEndDate = endDateInput.value;
        const pickupTime = pickupTimeInput.value;
        const days = getDaysBetween(activeStartDate, activeEndDate);
        const total = days * getOfferPrice(offer);

        calcDays.textContent = days > 0 ? getDetailDaysText(days) : "-";
        calcTotal.textContent = days > 0 ? formatDetailMoney(total) : "-";

        if (!activeStartDate || !activeEndDate || days <= 0) {
          setAvailabilityDisplay("available");
          if (bookingDateHelp) {
            bookingDateHelp.textContent = !activeStartDate || !activeEndDate
              ? detailTranslate("detail.dateHelp")
              : detailTranslate("detail.endAfterStart");
          }
          setRentButtonState("invalid");
          return;
        }

        if (!isValidPickupTime(pickupTime)) {
          setAvailabilityDisplay("available");
          setRentButtonState("missing-time");
          if (bookingTimeHelp) {
            bookingTimeHelp.textContent = detailBookingTimeText("selectTime");
          }
          return;
        }

        if (bookingTimeHelp) {
          bookingTimeHelp.textContent = detailBookingTimeText("pickupTimeHelp");
        }

        setAvailabilityDisplay("available");
        setRentButtonState("checking");
        if (bookingDateHelp) {
          bookingDateHelp.textContent = detailTranslate("detail.checkingAvailability");
        }

        try {
          const hasConflict = await hasReservationDateConflict(
            offer.id,
            activeStartDate,
            activeEndDate
          );

          if (checkVersion !== availabilityCheckVersion) {
            return;
          }

          if (hasConflict) {
            setAvailabilityDisplay("conflict");
            setRentButtonState("conflict");
            if (bookingDateHelp) {
              bookingDateHelp.textContent = detailTranslate("detail.dateConflictText");
            }
            return;
          }

          setAvailabilityDisplay("available");
          setRentButtonState("available");
          if (bookingDateHelp) {
            bookingDateHelp.textContent = detailTranslate("detail.dateAvailableText");
          }
        } catch (error) {
          if (checkVersion !== availabilityCheckVersion) {
            return;
          }

          setRentButtonState("invalid");
          if (bookingDateHelp) {
            bookingDateHelp.textContent = detailTranslate("detail.error.availabilityReload");
          }
        }
      }

      startDateInput.addEventListener("change", function () {
        clearDetailBookingMessage();
        updateCalculation();
      });
      endDateInput.addEventListener("change", function () {
        clearDetailBookingMessage();
        updateCalculation();
      });
      pickupTimeInput.addEventListener("change", function () {
        clearDetailBookingMessage();
        updateCalculation();
      });

      updateCalculation();

      rentButton.addEventListener("click", async function () {
        if (rentButton.disabled) {
          return;
        }

        clearDetailBookingMessage();

        const startDate = startDateInput.value;
        const endDate = endDateInput.value;
        const pickupTime = pickupTimeInput.value;
        const days = getDaysBetween(startDate, endDate);

        if (!startDate || !endDate || days <= 0) {
          await updateCalculation();
          showDetailBookingMessage(detailTranslate("detail.error.validDates"));
          return;
        }

        if (!isValidPickupTime(pickupTime)) {
          await updateCalculation();
          showDetailBookingMessage(detailBookingTimeText("invalidTime"));
          return;
        }

        rentButton.disabled = true;
        rentButton.classList.add("disabled");
        rentButton.textContent = detailTranslate("detail.checkingDates");

        try {
          const hasConflict = await hasReservationDateConflict(offer.id, startDate, endDate);

          if (hasConflict) {
            await updateCalculation();
            showDetailBookingMessage(detailTranslate("detail.error.dateConflict"));
            return;
          }
        } catch (error) {
          await updateCalculation();
          showDetailBookingMessage(detailTranslate("detail.error.availability"));
          return;
        }

        rentButton.textContent = detailTranslate("detail.sendingRequest");
        try {
          const reservationCreated = await createSupabaseReservation(
            offer,
            startDate,
            endDate,
            pickupTime
          );

          if (!reservationCreated) {
            const reservationMessage = detailBookingMessage;
            await updateCalculation();
            if (reservationMessage) {
              showDetailBookingMessage(reservationMessage);
            }
          }
        } catch (error) {
          console.error(error);
          await updateCalculation();
          showDetailBookingMessage(detailTranslate("detail.error.save"));
        }
      });
    }

    async function initializeDetailPage() {
      detailPageState = "loading";
      document.title = detailTranslate("detail.documentTitle");
      renderSharedNavigation("");
      setupBackLink();
      renderLoading();

      const offerId = getOfferIdFromUrl();

      if (!offerId) {
        detailPageState = "notFound";
        renderNotFound();
        return;
      }

      try {
        const offer = await loadOfferFromSupabase(offerId);

        if (!offer) {
          detailPageState = "notFound";
          renderNotFound();
          return;
        }

        detailPageState = "ready";
        await renderDetail(offer);
      } catch (error) {
        console.error(error);
        detailPageState = "error";
        renderLoadError();
      }
    }

    async function rerenderDetailForLanguage() {
      document.title = detailTranslate("detail.documentTitle");

      if (detailPageState === "loading") {
        renderLoading();
        return;
      }

      if (detailPageState === "notFound") {
        renderNotFound();
        return;
      }

      if (detailPageState === "error") {
        renderLoadError();
        return;
      }

      if (detailPageState !== "ready" || !currentOffer) {
        return;
      }

      const startDateValue = document.getElementById("startDate")?.value || "";
      const endDateValue = document.getElementById("endDate")?.value || "";
      const pickupTimeValue = document.getElementById("pickupTime")?.value || "";

      await renderDetail(currentOffer);

      const startDateInput = document.getElementById("startDate");
      const endDateInput = document.getElementById("endDate");
      const pickupTimeInput = document.getElementById("pickupTime");

      if (startDateInput && endDateInput && pickupTimeInput) {
        startDateInput.value = startDateValue;
        endDateInput.value = endDateValue;
        pickupTimeInput.value = pickupTimeValue;
        startDateInput.dispatchEvent(new Event("change"));
      }
    }

    document.addEventListener("DOMContentLoaded", function () {
      initializeDetailPage();
    });

    document.addEventListener("rentuloLanguageChanged", function () {
      rerenderDetailForLanguage();
    });
