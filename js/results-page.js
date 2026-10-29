    let resultsOffers = [];
    let resultsRatingSummaries = {};
    let resultsLoadState = "idle";
    let resultsGpsLoadState = "idle";
    let resultsNearbyLocation = null;
    let resultsDateRenderId = 0;

    const RESULTS_DATE_COPY = {
      cs: {
        from: "Od", to: "Do",
        hint: "Dostupnost je orienta\u010dn\u00ed. P\u0159esn\u00fd \u010das ov\u011b\u0159\u00edme v detailu nab\u00eddky.",
        both: "Vypl\u0148te oba datumy (Od i Do), nebo je oba sma\u017ete.",
        invalid: "Zvolte platn\u00e9 datum Od a pozd\u011bj\u0161\u00ed datum Do (max. 365 dn\u00ed).",
        past: "Datum Od nesm\u00ed b\u00fdt v minulosti.",
        checking: "Ov\u011b\u0159uji dostupnost pro vybran\u00e9 term\u00edny...",
        unavailable: "Dostupnost se nepoda\u0159ilo ov\u011b\u0159it. Zkuste hledat znovu."
      },
      sk: {
        from: "Od", to: "Do",
        hint: "Dostupnos\u0165 je orienta\u010dn\u00e1. Presn\u00fd \u010das over\u00edme v detaile ponuky.",
        both: "Vypl\u0148te oba d\u00e1tumy (Od aj Do), alebo ich oba vyma\u017ete.",
        invalid: "Zvo\u013ete platn\u00fd d\u00e1tum Od a neskor\u0161\u00ed d\u00e1tum Do (max. 365 dn\u00ed).",
        past: "D\u00e1tum Od nesmie by\u0165 v minulosti.",
        checking: "Overujem dostupnos\u0165 vo vybran\u00fdch term\u00ednoch...",
        unavailable: "Dostupnos\u0165 sa nepodarilo overi\u0165. Sk\u00faste h\u013eada\u0165 znova."
      },
      en: {
        from: "From", to: "To",
        hint: "Availability is preliminary. Choose an exact pickup time on the offer page.",
        both: "Enter both dates (From and To), or clear both.",
        invalid: "Choose a valid From date and a later To date (max. 365 days).",
        past: "The From date cannot be in the past.",
        checking: "Checking availability for the selected dates...",
        unavailable: "Availability could not be checked. Please search again."
      },
      de: {
        from: "Von", to: "Bis",
        hint: "Verf\u00fcgbarkeit vorl\u00e4ufig. Die genaue Abholzeit wird im Angebot gepr\u00fcft.",
        both: "Bitte beide Daten (Von und Bis) eingeben oder beide l\u00f6schen.",
        invalid: "G\u00fcltiges Von-Datum und sp\u00e4teres Bis-Datum w\u00e4hlen (max. 365 Tage).",
        past: "Das Von-Datum darf nicht in der Vergangenheit liegen.",
        checking: "Verf\u00fcgbarkeit f\u00fcr die gew\u00e4hlten Daten wird gepr\u00fcft...",
        unavailable: "Verf\u00fcgbarkeit konnte nicht gepr\u00fcft werden. Bitte erneut suchen."
      },
      pl: {
        from: "Od", to: "Do",
        hint: "Dost\u0119pno\u015b\u0107 jest wst\u0119pna. Dok\u0142adn\u0105 godzin\u0119 odbioru sprawdzisz w ofercie.",
        both: "Wybierz obie daty (Od i Do) albo usu\u0144 obie.",
        invalid: "Wybierz poprawn\u0105 dat\u0119 Od i p\u00f3\u017aniejsz\u0105 Do (maks. 365 dni).",
        past: "Data Od nie mo\u017ce by\u0107 przesz\u0142a.",
        checking: "Sprawdzanie dost\u0119pno\u015bci w wybranym terminie...",
        unavailable: "Nie uda\u0142o si\u0119 sprawdzi\u0107 dost\u0119pno\u015bci. Spr\u00f3buj ponownie."
      }
    };

    function resultsDateText(key) {
      const language = typeof window.getRentuloLanguage === "function"
        ? window.getRentuloLanguage()
        : "cs";
      const copy = RESULTS_DATE_COPY[language] || RESULTS_DATE_COPY.cs;
      return copy[key] || RESULTS_DATE_COPY.cs[key] || key;
    }

    function getTodayInPrague() {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit"
      }).formatToParts(new Date());
      const getPart = (name) => parts.find((part) => part.type === name).value;
      return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
    }

    function isValidIsoDate(value) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
      const date = new Date(value + "T00:00:00Z");
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }

    function getDateDurationDays(from, to) {
      return (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000;
    }

    function getResultsDateRange() {
      const from = document.getElementById("results-date-from")?.value || "";
      const to = document.getElementById("results-date-to")?.value || "";
      if (!from && !to) return { enabled: false };
      if (!from || !to) return { enabled: true, error: "both" };
      if (!isValidIsoDate(from) || !isValidIsoDate(to)) return { enabled: true, error: "invalid" };
      const days = getDateDurationDays(from, to);
      if (!Number.isInteger(days) || days < 1 || days > 365) return { enabled: true, error: "invalid" };
      if (from < getTodayInPrague()) return { enabled: true, error: "past" };
      return { enabled: true, from, to, days };
    }

    function updateResultsDateInputMin() {
      const fromInput = document.getElementById("results-date-from");
      const toInput = document.getElementById("results-date-to");
      if (fromInput) fromInput.min = getTodayInPrague();
      if (toInput) toInput.min = fromInput?.value || getTodayInPrague();
    }

    function showResultsDateStatus(key, isError = false) {
      const status = document.getElementById("results-date-status");
      if (!status) return;
      status.hidden = !key;
      status.classList.toggle("error", Boolean(isError));
      status.textContent = key ? resultsDateText(key) : "";
    }

    function updateResultsDateLabels() {
      const fromLabel = document.getElementById("results-date-from-label");
      const toLabel = document.getElementById("results-date-to-label");
      if (fromLabel) fromLabel.textContent = resultsDateText("from");
      if (toLabel) toLabel.textContent = resultsDateText("to");
    }

    async function getAvailableOfferIdsForDates(offers, from, to) {
      const supabaseClient = getSupabaseClient();
      if (!supabaseClient) throw new Error("Supabase unavailable");
      const ids = [...new Set(offers.map(getOfferId).filter(Boolean))];
      const available = new Set();
      for (let offset = 0; offset < ids.length; offset += 50) {
        const { data, error } = await supabaseClient.rpc("get_available_offer_ids_for_dates", {
          p_offer_ids: ids.slice(offset, offset + 50),
          p_start_date: from,
          p_end_date: to
        });
        if (error || !Array.isArray(data)) throw error || new Error("Availability check failed");
        data.forEach(function (row) {
          if (!row || typeof row.offer_id !== "string") throw new Error("Invalid availability result");
          available.add(row.offer_id);
        });
      }
      return available;
    }

    function getResultOfferDetailLink(offerId) {
      const url = "/nabidka/" + encodeURIComponent(offerId);
      const dates = getResultsDateRange();
      if (!dates.enabled || dates.error) return url;
      const params = new URLSearchParams({ od: dates.from, do: dates.to });
      return url + "?" + params.toString();
    }

    function resultsTranslate(key, fallback) {
      if (typeof window.rentuloTranslate === "function") {
        const translated = window.rentuloTranslate(key);
        if (translated && translated !== key) {
          return translated;
        }
      }
      return fallback || key;
    }

    function getResultsLocale() {
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

    function formatResultsNumber(value, options) {
      const numberValue = Number(value);

      if (!Number.isFinite(numberValue)) {
        return String(value === undefined || value === null ? "" : value);
      }

      return numberValue.toLocaleString(getResultsLocale(), options);
    }

    function getResultsRatingLabel(count) {
      const pluralCategory = new Intl.PluralRules(getResultsLocale()).select(Number(count));
      const keys = {
        one: ["results.ratingOne", "hodnocení"],
        few: ["results.ratingFew", "hodnocení"],
        many: ["results.ratingMany", "hodnocení"],
        other: ["results.ratingOther", "hodnocení"]
      };
      const selected = keys[pluralCategory] || keys.other;

      return resultsTranslate(selected[0], selected[1]);
    }

    function resultsCategoryLabel(category) {
      const normalized = normalizeText(category || "");
      const keys = {
        "domacnost": "home.category.household",
        "zahrada": "home.category.garden",
        "stavba": "home.category.construction",
        "hobby": "home.category.hobby",
        "party": "home.category.party",
        "ostatni": "home.category.other",
        "dum a zahrada": "category.homeGarden",
        "dilna a naradi": "category.workshopTools",
        "sport a volny cas": "category.sportLeisure",
        "elektronika": "category.electronics",
        "deti a rodina": "category.childrenFamily",
        "auto a doprava": "category.autoTransport",
        "party a akce": "category.partyEvents",
        "cestovani a kempovani": "category.travelCamping",
        "stavebni technika": "category.construction"
      };
      const key = keys[normalized];
      return key ? resultsTranslate(key, category) : category;
    }







    function getResultsParams() {
      return new URLSearchParams(window.location.search);
    }

    function isNearbySearchMode() {
      const params = getResultsParams();
      const whereInput = document.getElementById("results-search-where");
      return params.get("okoli") === "1" &&
        (!whereInput || whereInput.dataset.locationMode !== "manual");
    }

    function parseResultsGpsCoordinate(value, minimum, maximum) {
      if (value === null || value === undefined ||
          (typeof value === "string" && !value.trim())) {
        return null;
      }

      const coordinate = Number(value);
      return Number.isFinite(coordinate) && coordinate >= minimum && coordinate <= maximum
        ? coordinate
        : null;
    }

    function clearLegacyStoredVisitorLocation() {
      try {
        localStorage.removeItem("rentuloUserLocation");
      } catch (error) {
        // Úložiště může být v některých režimech prohlížeče nedostupné.
      }
    }

    function getSearchLatitude() {
      return resultsNearbyLocation ? resultsNearbyLocation.latitude : null;
    }

    function getSearchLongitude() {
      return resultsNearbyLocation ? resultsNearbyLocation.longitude : null;
    }

    function toRadians(value) {
      return value * Math.PI / 180;
    }

    function calculateDistanceKm(latitude1, longitude1, latitude2, longitude2) {
      if (
        latitude1 === null ||
        longitude1 === null ||
        latitude2 === null ||
        longitude2 === null
      ) {
        return null;
      }

      const earthRadiusKm = 6371;

      const latitudeDifference = toRadians(latitude2 - latitude1);
      const longitudeDifference = toRadians(longitude2 - longitude1);

      const a =
        Math.sin(latitudeDifference / 2) * Math.sin(latitudeDifference / 2) +
        Math.cos(toRadians(latitude1)) *
        Math.cos(toRadians(latitude2)) *
        Math.sin(longitudeDifference / 2) *
        Math.sin(longitudeDifference / 2);

      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      return earthRadiusKm * c;
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

        createdAt: row.created_at,
        updatedAt: row.updated_at,

        source: "supabase"
      };
    }

    async function loadOffersFromSupabase() {
      resultsLoadState = "loading";
      const supabaseClient = getSupabaseClient();

      if (!supabaseClient) {
        resultsLoadState = "error";
        return [];
      }

      const { data, error } = await supabaseClient
        .from("public_offers")
        .select(
  "id, owner_id, name, category, description, city, postal_code, price_per_day, status, photo_url, created_at, updated_at"
)
        .order("created_at", {
          ascending: false
        });

      if (error) {
       console.error("Ponuky sa nepodařilo načíst.");
        resultsLoadState = "error";
        return [];
      }

      resultsLoadState = "ready";

      return Array.isArray(data)
        ? data.map(normalizeSupabaseOffer)
        : [];
    }

    async function attachPublicGpsLocations(offers) {
      resultsGpsLoadState = "idle";

      if (!isNearbySearchMode() || !Array.isArray(offers) || !offers.length) {
        return offers;
      }

      const supabaseClient = getSupabaseClient();

      if (!supabaseClient) {
        resultsGpsLoadState = "error";
        return offers;
      }

      resultsGpsLoadState = "loading";

      const { data, error } = await supabaseClient.rpc("get_public_map_offers");

      if (error || !Array.isArray(data)) {
        console.warn("GPS polohy nabídek se nepodařilo načíst.");
        resultsGpsLoadState = "error";
        return offers;
      }

      const locationsByOfferId = new Map();

      data.forEach(function (row) {
        const latitude = parseResultsGpsCoordinate(row && row.map_latitude, -90, 90);
        const longitude = parseResultsGpsCoordinate(row && row.map_longitude, -180, 180);

        if (
          row &&
          row.id &&
          latitude !== null &&
          longitude !== null
        ) {
          locationsByOfferId.set(String(row.id), {
            latitude: latitude,
            longitude: longitude
          });
        }
      });

      resultsGpsLoadState = "ready";

      return offers.map(function (offer) {
        const location = locationsByOfferId.get(String(getOfferId(offer) || ""));

        if (!location) {
          return offer;
        }

        return {
          ...offer,
          pickupLatitude: location.latitude,
          pickupLongitude: location.longitude
        };
      });
    }

    function getOfferOwnerId(offer) {
      return String(offer.ownerId || offer.owner_id || offer.userId || offer.user_id || "");
    }

    async function loadRatingSummariesForOffers(offers) {
      resultsRatingSummaries = {};

      const supabaseClient = getSupabaseClient();

      if (!supabaseClient || !Array.isArray(offers) || !offers.length) {
        return;
      }

      const ownerIds = Array.from(new Set(
        offers
          .map(getOfferOwnerId)
          .filter(Boolean)
      ));

      if (!ownerIds.length) {
        return;
      }

      const { data, error } = await supabaseClient
        .from("user_rating_summary")
        .select("user_id, average_rating, rating_count")
        .in("user_id", ownerIds);

      if (error) {
        console.warn("Hodnocení majitelů se nepodařilo načíst.");
        return;
      }

      if (!Array.isArray(data)) {
        return;
      }

      data.forEach(function (ratingRow) {
        if (!ratingRow || !ratingRow.user_id) {
          return;
        }

        resultsRatingSummaries[String(ratingRow.user_id)] = {
          averageRating: ratingRow.average_rating,
          ratingCount: ratingRow.rating_count
        };
      });
    }

    function getOwnerRatingSummary(offer) {
      const ownerId = getOfferOwnerId(offer);

      if (!ownerId || !resultsRatingSummaries[ownerId]) {
        return null;
      }

      return resultsRatingSummaries[ownerId];
    }

    function formatOwnerRating(offer) {
      const summary = getOwnerRatingSummary(offer);

      if (!summary || !summary.ratingCount) {
        return resultsTranslate("results.noRatings", "Zatím bez hodnocení");
      }

      const ratingCount = Number(summary.ratingCount);

      return "⭐ " +
        formatResultsNumber(summary.averageRating, { maximumFractionDigits: 2 }) +
        " / 5 (" +
        formatResultsNumber(ratingCount) +
        " " + getResultsRatingLabel(ratingCount) + ")";
    }

    function getOfferDistanceKm(offer) {
      if (!isNearbySearchMode()) {
        return null;
      }

      const userLatitude = getSearchLatitude();
      const userLongitude = getSearchLongitude();

      const offerLatitude = parseResultsGpsCoordinate(offer.pickupLatitude, -90, 90);
      const offerLongitude = parseResultsGpsCoordinate(offer.pickupLongitude, -180, 180);

      if (
        userLatitude === null ||
        userLongitude === null ||
        offerLatitude === null ||
        offerLongitude === null
      ) {
        return null;
      }

      return calculateDistanceKm(userLatitude, userLongitude, offerLatitude, offerLongitude);
    }

    function offerHasGpsLocation(offer) {
      return parseResultsGpsCoordinate(offer.pickupLatitude, -90, 90) !== null &&
        parseResultsGpsCoordinate(offer.pickupLongitude, -180, 180) !== null;
    }

    function formatDistance(distanceKm) {
      if (distanceKm === null || Number.isNaN(distanceKm)) {
        if (getSearchLatitude() === null || getSearchLongitude() === null) {
          return resultsTranslate("results.userLocationMissing", "Vaše poloha není dostupná");
        }
        return resultsTranslate("results.locationMissing", "Poloha nabídky není uložená");
      }

      const distanceMeters = Math.round(distanceKm * 1000);
      const approximate = resultsTranslate("results.approximate", "cca");

      if (distanceMeters < 50) {
        return resultsTranslate("results.veryNear", "ve vaší blízkosti");
      }

      if (distanceKm < 1) {
        return approximate + " " + formatResultsNumber(distanceMeters) + " m";
      }

      return approximate + " " + formatResultsNumber(distanceKm, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      }) + " km";
    }

    function getOfferId(offer) {
      return offer.id || offer.offerId;
    }

function getOfferCity(offer) {
      return offer.city || offer.mesto || offer.location || "-";
    }

    function normalizeOfferCategory(category) {
      const value = String(category || "").trim();
      const legacyMap = {
        "Dům a zahrada": "Domácnost",
        "Dílna a nářadí": "Stavba",
        "Stavební technika": "Stavba",
        "Sport a volný čas": "Hobby",
        "Elektronika": "Hobby",
        "Děti a rodina": "Hobby",
        "Cestování a kempování": "Hobby",
        "Párty a akce": "Párty",
        "Auto a doprava": "Ostatní"
      };

      return legacyMap[value] || value || resultsTranslate("home.category.other", "Ostatní");
    }

    function getOfferCategory(offer) {
      return normalizeOfferCategory(offer.category || offer.kategorie);
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

    function renderResultImage(offer) {
      const photo = getOfferPhoto(offer);
      const name = getOfferName(offer);

      if (photo) {
        return `
          <div class="result-image">
            <img src="${escapeHtml(photo)}" alt="${escapeHtml(name)}">
          </div>
        `;
      }

      return `
        <div class="result-image">
          <div class="result-image-icon"></div>
          <span>${escapeHtml(name)}</span>
        </div>
      `;
    }

    function getEmptyResultsContent(type) {
      const content = {
        "load-error": ["results.empty.loadErrorTitle", "Nabídky se nepodařilo načíst.", "results.empty.loadErrorMessage", "Zkontrolujte připojení k internetu a zkuste stránku obnovit.", "vysledky.html", "results.tryAgain", "Zkusit znovu", "index.html", "results.backHome", "Zpět na úvod"],
        "loading": ["results.empty.loadingTitle", "Načítám nabídky...", "results.empty.loadingMessage", "Chvíli strpení, načítáme nabídky.", "vysledky.html", "results.refresh", "Obnovit", "index.html", "results.backHome", "Zpět na úvod"],
        "no-offers": ["results.empty.noOffersTitle", "Zatím zde nejsou žádné nabídky.", "results.empty.noOffersMessage", "Na Rentulu zatím nikdo nepřidal žádnou věc k půjčení. Můžete přidat první nabídku a vyzkoušet, jak bude fungovat.", "nabidnout.html", "results.addItem", "Přidat věc", "index.html", "results.backHome", "Zpět na úvod"],
        "no-match": ["results.empty.noMatchTitle", "Nenašli jsme žádnou nabídku.", "results.empty.noMatchMessage", "Pro zadané hledání nebo zvolené filtry nebyla nalezena žádná nabídka. Zkuste změnit název, kategorii, město, cenu nebo dostupnost.", "vysledky.html", "results.clearSearch", "Zrušit hledání", "nabidnout.html", "results.addItem", "Přidat věc"]
      }[type] || null;

      const row = content || ["results.empty.noMatchTitle", "Nenašli jsme žádnou nabídku.", "results.empty.noMatchMessage", "Pro zadané hledání nebo zvolené filtry nebyla nalezena žádná nabídka. Zkuste změnit název, kategorii, město, cenu nebo dostupnost.", "vysledky.html", "results.clearSearch", "Zrušit hledání", "nabidnout.html", "results.addItem", "Přidat věc"];
      return {
        title: resultsTranslate(row[0], row[1]),
        message: resultsTranslate(row[2], row[3]),
        primaryLink: row[4],
        primaryText: resultsTranslate(row[5], row[6]),
        secondaryLink: row[7],
        secondaryText: resultsTranslate(row[8], row[9])
      };
    }

    function renderEmptyResults(type) {
      const content = getEmptyResultsContent(type);

      document.getElementById("resultsList").innerHTML = `
        <div class="empty-results">
          <h2>${escapeHtml(content.title)}</h2>

          <p>${escapeHtml(content.message)}</p>

          <div class="empty-results-actions">
            <a href="${escapeHtml(content.primaryLink)}" class="empty-results-button">
              ${escapeHtml(content.primaryText)}
            </a>

            <a href="${escapeHtml(content.secondaryLink)}" class="empty-results-button light">
              ${escapeHtml(content.secondaryText)}
            </a>
          </div>
        </div>
      `;
    }

    function renderDistanceBox(offer) {
      if (!isNearbySearchMode()) {
        return "";
      }

      const distanceKm = getOfferDistanceKm(offer);
      const missingClass = distanceKm === null ? "missing" : "";

      return `
        <div class="result-info-box distance ${missingClass}">
          <span>${escapeHtml(resultsTranslate("results.distance", "Vzdálenost"))}</span>
          <strong>${escapeHtml(formatDistance(distanceKm))}</strong>
        </div>
      `;
    }

    function renderOfferCard(offer) {
      const offerId = getOfferId(offer);
      const name = getOfferName(offer);
      const city = getOfferCity(offer);
      const category = resultsCategoryLabel(getOfferCategory(offer));
      const price = getOfferPrice(offer);

      return `
        <article class="result-card">
          ${renderResultImage(offer)}

          <div class="result-main">
            <div class="result-heading">
              <div>
                <h2 class="result-title">${escapeHtml(name)}</h2>
                <p class="result-meta">${escapeHtml(category)}</p>
              </div>
            </div>

            <div class="result-info">
              <div class="result-info-box">
                <span>${escapeHtml(resultsTranslate("results.pricePerDay", "Cena za den"))}</span>
                <strong>${escapeHtml(formatResultsNumber(price))} ${escapeHtml(resultsTranslate("results.currency", "Kč"))}</strong>
              </div>

              <div class="result-info-box">
                <span>${escapeHtml(resultsTranslate("detail.city", "Město"))}</span>
                <strong>${escapeHtml(city)}</strong>
              </div>

              <div class="result-info-box">
                <span>${escapeHtml(resultsTranslate("results.ownerRating", "Hodnocení majitele"))}</span>
                <strong>${escapeHtml(formatOwnerRating(offer))}</strong>
              </div>

              ${renderDistanceBox(offer)}
            </div>

            <div class="result-actions">
              <a class="result-button" href="${escapeHtml(getResultOfferDetailLink(offerId))}">
                ${escapeHtml(resultsTranslate("results.viewDetail", "Zobrazit detail"))}
              </a>
            </div>
          </div>
        </article>
      `;
    }
const HOME_CATEGORY_GROUPS = {
  domacnost: ["domacnost", "dum a zahrada"],
  zahrada: ["zahrada", "zahradni technika", "dum a zahrada"],
  stavba: [
    "stavba",
    "vrtacky",
    "brusky",
    "pily",
    "zebriky",
    "stavebni technika",
    "dilna a naradi"
  ],
  hobby: [
    "hobby",
    "sport a volny cas",
    "elektronika",
    "deti a rodina",
    "cestovani a kempovani"
  ],
  party: ["party", "party a akce"],
  ostatni: ["ostatni", "auto a doprava"]
};
    function offerMatchesSearch(offer, whatQuery, whereQuery, categoryFilter, priceFilter) {
      const name = normalizeText(getOfferName(offer));
      const category = normalizeText(getOfferCategory(offer));
      const city = normalizeText(getOfferCity(offer));
      const postalCode = normalizeText(offer.postalCode || offer.psc || "");
      const price = getOfferPrice(offer);

      const what = normalizeText(whatQuery);
      const where = normalizeText(whereQuery);
      const nearbyMode = isNearbySearchMode();

      if (what) {
  const groupedCategories = HOME_CATEGORY_GROUPS[what];

  if (groupedCategories) {
    const matchesGroupedCategory = groupedCategories.some(function (value) {
      return category.includes(value);
    });

    if (!matchesGroupedCategory) {
      return false;
    }
  } else if (!name.includes(what) && !category.includes(what)) {
    return false;
  }
}

      if (!nearbyMode && where && !city.includes(where) && !postalCode.includes(where)) {
        return false;
      }

      if (categoryFilter && category !== normalizeText(categoryFilter)) {
        return false;
      }

      if (priceFilter && price > Number(priceFilter)) {
        return false;
      }

      return true;
    }

    function sortOffersForNearbySearch(offers) {
      if (!isNearbySearchMode()) {
        return offers;
      }

      return offers.slice().sort(function (offerA, offerB) {
        const distanceA = getOfferDistanceKm(offerA);
        const distanceB = getOfferDistanceKm(offerB);

        if (distanceA !== null && distanceB !== null) {
          return distanceA - distanceB;
        }

        if (distanceA !== null && distanceB === null) {
          return -1;
        }

        if (distanceA === null && distanceB !== null) {
          return 1;
        }

        return 0;
      });
    }

    function updateNearbyBanner(offers) {
      const banner = document.getElementById("nearbyResultsBanner");
      const nearbyText = document.getElementById("nearbyResultsText");

      if (!banner || !nearbyText) {
        return;
      }

      banner.classList.remove("active");
      banner.classList.remove("warning");

      if (!isNearbySearchMode() || !offers.length) {
        return;
      }

      const userLatitude = getSearchLatitude();
      const userLongitude = getSearchLongitude();
      const offersWithGps = offers.filter(offerHasGpsLocation).length;
      const offersWithoutGps = offers.length - offersWithGps;

      banner.classList.add("active");

      if (resultsGpsLoadState === "error") {
        banner.classList.add("warning");
        nearbyText.textContent =
          resultsTranslate("results.nearbyGpsLoadError", "GPS polohy nabídek se nepodařilo načíst. Nabídky zobrazujeme bez řazení podle vzdálenosti.");
        return;
      }

      if (userLatitude === null || userLongitude === null) {
        banner.classList.add("warning");
        nearbyText.textContent =
          resultsTranslate("results.nearbyNoLocation", "Polohu se nepodařilo načíst. Zobrazujeme všechny nabídky bez řazení podle vzdálenosti.");
        return;
      }

      if (offersWithGps === 0 && offers.length > 0) {
        banner.classList.add("warning");
        nearbyText.textContent =
          resultsTranslate("results.nearbyNoGps", "Žádná nabídka zatím nemá uloženou GPS polohu. Nabídky proto neumíme seřadit podle vzdálenosti.");
        return;
      }

      if (offersWithoutGps > 0) {
        nearbyText.textContent =
          resultsTranslate("results.nearbyDefault", "Nabídky s uloženou polohou řadíme podle vzdálenosti od vás. Nabídky bez GPS polohy zobrazujeme pod nimi.");
        return;
      }

      nearbyText.textContent =
        resultsTranslate("results.nearbyAllGps", "Všechny zobrazené nabídky mají uloženou GPS polohu a jsou seřazené podle vzdálenosti od vás.");
    }

    function applyResultsModeTranslations() {
      const whereInput = document.getElementById("results-search-where");
      const title = document.getElementById("resultsTitle");

      if (isNearbySearchMode()) {
        if (whereInput && whereInput.dataset.locationMode === "nearby") {
          whereInput.value = resultsTranslate("results.myLocation", "Moje poloha");
        }
      }

      if (title) {
        title.textContent = isNearbySearchMode()
          ? resultsTranslate("results.nearbyPageTitle", "Věci ve vašem okolí")
          : resultsTranslate("results.title", "Věci k půjčení");
      }
    }

    function setupResultsFromUrl() {
      const params = getResultsParams();

      const whatInput = document.getElementById("results-search-what");
      const whereInput = document.getElementById("results-search-where");
      const categoryFilter = document.getElementById("categoryFilter");
      const priceFilter = document.getElementById("priceFilter");
      const fromInput = document.getElementById("results-date-from");
      const toInput = document.getElementById("results-date-to");

      const what = params.get("co") || "";
      const where = params.get("kde") || "";
      const category = params.get("kategorie") || "";
      const price = params.get("cena") || "";
      const hasExplicitWhere = Boolean(where.trim());

      if (whatInput) {
        whatInput.value = what;
      }

      if (whereInput) {
        whereInput.value = where;
        delete whereInput.dataset.locationMode;

        if (isNearbySearchMode() && !hasExplicitWhere) {
          whereInput.dataset.locationMode = "nearby";
        }
      }

      if (categoryFilter) {
        categoryFilter.value = category;
      }

      if (priceFilter) {
        priceFilter.value = price;
      }
      if (fromInput) fromInput.value = params.get("od") || "";
      if (toInput) toInput.value = params.get("do") || "";
      updateResultsDateInputMin();
      updateResultsDateLabels();

      applyResultsModeTranslations();
    }

    function updateUrlFromCurrentControls() {
      const params = getResultsParams();

      const whatInput = document.getElementById("results-search-what");
      const whereInput = document.getElementById("results-search-where");
      const categoryFilter = document.getElementById("categoryFilter");
      const priceFilter = document.getElementById("priceFilter");
      const fromInput = document.getElementById("results-date-from");
      const toInput = document.getElementById("results-date-to");

      const what = whatInput ? whatInput.value.trim() : "";
      const where = whereInput ? whereInput.value.trim() : "";
      const category = categoryFilter ? categoryFilter.value : "";
      const price = priceFilter ? priceFilter.value : "";
      const usingCurrentLocation = Boolean(
        isNearbySearchMode() &&
        whereInput &&
        whereInput.dataset.locationMode === "nearby"
      );

      // Scrub coordinates from any old/shared URL, regardless of search mode.
      // They are never required by the current application.
      params.delete("lat");
      params.delete("lng");

      if (what) {
        params.set("co", what);
      } else {
        params.delete("co");
      }

      if (usingCurrentLocation) {
        params.delete("kde");
      } else if (where) {
        params.set("kde", where);
        params.delete("okoli");
        params.delete("lat");
        params.delete("lng");
      } else {
        params.delete("kde");
        params.delete("okoli");
        params.delete("lat");
        params.delete("lng");
      }

      if (category) {
        params.set("kategorie", category);
      } else {
        params.delete("kategorie");
      }

      if (price) {
        params.set("cena", price);
      } else {
        params.delete("cena");
      }

      // Date filters are optional; keep the historical search unchanged when empty.
      if (fromInput?.value) params.set("od", fromInput.value);
      else params.delete("od");
      if (toInput?.value) params.set("do", toInput.value);
      else params.delete("do");

      // Remove the legacy availability filter parameter from older result URLs.
      params.delete("dostupnost");

      const queryString = params.toString();
      const newUrl = queryString
        ? window.location.pathname + "?" + queryString
        : window.location.pathname;

      window.history.replaceState(null, "", newUrl);
    }

    function applySearchAndUpdateUrl() {
      updateUrlFromCurrentControls();
      applyResultsModeTranslations();
      renderResults();
    }

    async function renderResults() {
      // A later filter change must never display an older asynchronous result.
      const requestId = ++resultsDateRenderId;
      const offers = resultsOffers;
      const dates = getResultsDateRange();
      const list = document.getElementById("resultsList");
      showResultsDateStatus(dates.error || (dates.enabled ? "hint" : ""), Boolean(dates.error));

      if (resultsLoadState === "error") {
        renderEmptyResults("load-error");
        return;
      }

      if (dates.error) {
        list.innerHTML = "";
        return;
      }

      if (!offers.length) {
        renderEmptyResults("no-offers");
        return;
      }

      const whatQuery = document.getElementById("results-search-what").value;
      const whereQuery = document.getElementById("results-search-where").value;
      const categoryFilter = document.getElementById("categoryFilter").value;
      const priceFilter = document.getElementById("priceFilter").value;

      const filteredOffers = offers.filter(function (offer) {
        return offerMatchesSearch(offer, whatQuery, whereQuery, categoryFilter, priceFilter);
      });

      if (!filteredOffers.length) {
        updateNearbyBanner([]);
        renderEmptyResults("no-match");
        return;
      }

      let availableOffers = filteredOffers;
      if (dates.enabled) {
        showResultsDateStatus("checking");
        list.innerHTML = "";
        try {
          const allowedIds = await getAvailableOfferIdsForDates(filteredOffers, dates.from, dates.to);
          if (requestId !== resultsDateRenderId) return;
          availableOffers = filteredOffers.filter((offer) => allowedIds.has(getOfferId(offer)));
          showResultsDateStatus("hint");
        } catch (error) {
          if (requestId !== resultsDateRenderId) return;
          console.warn("Availability search failed.", error);
          showResultsDateStatus("unavailable", true);
          list.innerHTML = "";
          updateNearbyBanner([]);
          return;
        }
      }

      const sortedOffers = sortOffersForNearbySearch(availableOffers);
      updateNearbyBanner(sortedOffers);
      if (!sortedOffers.length) {
        renderEmptyResults("no-match");
        return;
      }
      list.innerHTML = sortedOffers.map(renderOfferCard).join("");
    }

    function getCompactCategoryAllLabel() {
      const language = typeof window.getRentuloLanguage === "function"
        ? window.getRentuloLanguage()
        : "cs";
      const labels = {
        cs: "Všechny",
        en: "All",
        de: "Alle",
        pl: "Wszystkie",
        sk: "Všetky"
      };

      return labels[language] || labels.cs;
    }

    function updateResultsFilterLabelsForViewport() {
      const allCategoriesOption = document.querySelector('#categoryFilter option[value=""]');

      if (!allCategoriesOption) {
        return;
      }

      allCategoriesOption.textContent = getCompactCategoryAllLabel();
    }

    function setupResultsEvents() {
      document.getElementById("results-search-button").addEventListener("click", function () {
        applySearchAndUpdateUrl();
      });

      document.getElementById("results-search-what").addEventListener("input", function () {
        renderResults();
      });

      document.getElementById("results-search-what").addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          applySearchAndUpdateUrl();
        }
      });

      document.getElementById("results-search-where").addEventListener("input", function () {
        if (isNearbySearchMode()) {
          this.dataset.locationMode = "manual";
        }
        applyResultsModeTranslations();
        renderResults();
      });

      document.getElementById("results-search-where").addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          applySearchAndUpdateUrl();
        }
      });

      document.getElementById("categoryFilter").addEventListener("change", function () {
        applySearchAndUpdateUrl();
      });

      document.getElementById("priceFilter").addEventListener("change", function () {
        applySearchAndUpdateUrl();
      });

      ["results-date-from", "results-date-to"].forEach(function (id) {
        document.getElementById(id).addEventListener("change", function () {
          updateResultsDateInputMin();
          applySearchAndUpdateUrl();
        });
      });
    }

    async function initializeResultsPage() {
      clearLegacyStoredVisitorLocation();
      if (window.rentuloNearbyLocation) {
        window.rentuloNearbyLocation.stripLegacyCoordinatesFromUrl();
        // Never persist: one-time handoff consumed at the start of this page.
        resultsNearbyLocation = window.rentuloNearbyLocation.consumeOnce();
      }
      setupResultsFromUrl();
      updateResultsFilterLabelsForViewport();
      setupResultsEvents();

      renderEmptyResults("loading");

      resultsOffers = await loadOffersFromSupabase();
      resultsOffers = await attachPublicGpsLocations(resultsOffers);
      await loadRatingSummariesForOffers(resultsOffers);

      renderResults();
    }

    document.addEventListener("DOMContentLoaded", function () {
      initializeResultsPage();
    });

    document.addEventListener("rentuloLanguageChanged", function () {
      applyResultsModeTranslations();
      updateResultsDateLabels();
      updateResultsFilterLabelsForViewport();
      renderResults();
    });
