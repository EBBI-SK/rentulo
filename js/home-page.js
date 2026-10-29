document.addEventListener("DOMContentLoaded", function () {
  showHomeEmailChangeConfirmationNotice();
  clearLegacyStoredVisitorLocation();
  setupHomeSearch();
  setupHomeNearbySearch();
  setupCategorySearch();
  applyHomeDynamicTranslations();
  initializeHomeMap();
  centerHomeMapOnVisitor();
  loadHomeMapOffers();
});

document.addEventListener("rentuloLanguageChanged", function () {
  applyHomeDynamicTranslations();
  renderHomeOffersMap();
  renderHomeMapPreviews();
});

let homeMap = null;
let homeMapLayer = null;
let homeMapOffers = [];
let homeMapLoadState = "loading";
let homeVisitorLocation = null;
let homeMapReturnView = getHomeMapReturnView();
let homeMapReturnViewPending = Boolean(homeMapReturnView);

function showHomeEmailChangeConfirmationNotice() {
  const notice = document.getElementById("emailChangeNotice");
  if (!notice) return;

  const hash = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
  const confirmationMessage = hash.get("message") || "";
  if (/^Confirmation link accepted\. Please proceed to confirm link sent to the other email\.?$/i.test(confirmationMessage)) {
    notice.hidden = false;
  }
}

function homeTranslate(key, fallback) {
  if (typeof window.rentuloTranslate === "function") {
    const translated = window.rentuloTranslate(key);

    if (translated && translated !== key) {
      return translated;
    }
  }

  return fallback || key;
}

function isMacLikePlatform() {
  const platform = String(
    (navigator.userAgentData && navigator.userAgentData.platform) ||
    navigator.platform ||
    navigator.userAgent ||
    ""
  ).toLowerCase();

  return platform.includes("mac") || platform.includes("iphone") || platform.includes("ipad");
}

function getHomeMapGestureTexts() {
  return {
    touch: homeTranslate("home.mapGestureTouch", "Mapu posunete dvěma prsty."),
    scroll: homeTranslate(
      "home.mapGestureScroll",
      "Pro přiblížení mapy podržte Ctrl a posouvejte kolečkem."
    ),
    scrollMac: homeTranslate(
      "home.mapGestureScrollMac",
      "Pro přiblížení mapy podržte ⌘ a posouvejte kolečkem."
    )
  };
}

function applyHomeMapGestureTranslations() {
  const mapElement = document.getElementById("homeOffersMap");
  if (!mapElement) return;

  const texts = getHomeMapGestureTexts();
  mapElement.setAttribute("data-gesture-handling-touch-content", texts.touch);
  mapElement.setAttribute(
    "data-gesture-handling-scroll-content",
    isMacLikePlatform() ? texts.scrollMac : texts.scroll
  );

  if (homeMap && homeMap.options && homeMap.options.gestureHandlingOptions) {
    homeMap.options.gestureHandlingOptions.text = texts;
  }
}

// BOD 5: optional date range in the existing three-part homepage search.
function homePragueToday() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const read = (type) => parts.find((part) => part.type === type).value;
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function homeIsIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function getHomeSearchDates() {
  const from = document.getElementById("home-date-from")?.value || "";
  const to = document.getElementById("home-date-to")?.value || "";
  if (!from && !to) return { enabled: false };
  if (!from || !to) return { error: "search.dateBoth" };
  if (!homeIsIsoDate(from) || !homeIsIsoDate(to)) return { error: "search.dateInvalid" };
  const days = (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000;
  if (!Number.isInteger(days) || days < 1 || days > 365) return { error: "search.dateInvalid" };
  if (from < homePragueToday()) return { error: "search.datePast" };
  return { enabled: true, from, to };
}

function homeDateRangeText(from, to) {
  const lang = typeof window.getRentuloLanguage === "function" ? window.getRentuloLanguage() : "cs";
  const locales = { cs: "cs-CZ", sk: "sk-SK", en: "en-GB", de: "de-DE", pl: "pl-PL" };
  const options = { day: "numeric", month: "numeric", timeZone: "UTC" };
  if (from.slice(0, 4) !== to.slice(0, 4)) options.year = "numeric";
  const format = new Intl.DateTimeFormat(locales[lang] || "cs-CZ", options);
  return format.format(new Date(from + "T00:00:00Z")) + " – " + format.format(new Date(to + "T00:00:00Z"));
}

function refreshHomeDateSummary() {
  const picker = document.getElementById("home-search-when");
  const summary = document.getElementById("home-when-value");
  if (!summary || !picker) return;
  const dates = getHomeSearchDates();
  summary.textContent = dates.enabled && !dates.error
    ? homeDateRangeText(dates.from, dates.to)
    : homeTranslate("search.whenPlaceholder", "Vyberte termín");
  picker.classList.toggle("has-dates", Boolean(dates.enabled && !dates.error));
}

function homeDateError(key) {
  const error = document.getElementById("home-date-error");
  const picker = document.getElementById("home-search-when");
  if (error) {
    error.hidden = !key;
    error.textContent = key ? homeTranslate(key, "Vyberte platný termín.") : "";
  }
  if (key && picker) picker.open = true;
}

function homeValidatedDates() {
  const dates = getHomeSearchDates();
  homeDateError(dates.error || "");
  if (dates.error) return null;
  return dates;
}

function homeSetDateParams(params, dates) {
  if (dates?.enabled) {
    params.set("od", dates.from);
    params.set("do", dates.to);
  }
}

function setupHomeDateSelector() {
  const from = document.getElementById("home-date-from");
  const to = document.getElementById("home-date-to");
  const picker = document.getElementById("home-search-when");
  const clear = document.getElementById("home-date-clear");
  if (!from || !to || !picker || !clear) return;

  function onDateChange() {
    from.min = homePragueToday();
    to.min = from.value || from.min;
    homeDateError("");
    refreshHomeDateSummary();
    const dates = getHomeSearchDates();
    if (dates.enabled && !dates.error) picker.open = false;
  }
  from.addEventListener("change", onDateChange);
  to.addEventListener("change", onDateChange);
  clear.addEventListener("click", function () {
    from.value = "";
    to.value = "";
    picker.open = false;
    onDateChange();
  });
  document.addEventListener("pointerdown", function (event) {
    if (picker.open && !picker.contains(event.target)) picker.open = false;
  });
  picker.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      picker.open = false;
      picker.querySelector("summary")?.focus();
    }
  });
  onDateChange();
}

function goToResults(what, where, dates) {
  const searchParams = new URLSearchParams();

  if (what) {
    searchParams.set("co", what);
  }

  if (where) {
    searchParams.set("kde", where);
  }

  homeSetDateParams(searchParams, dates);
  const queryString = searchParams.toString();
  window.location.href = queryString ? "vysledky.html?" + queryString : "vysledky.html";
}

function setupHomeSearch() {
  const form = document.getElementById("homeSearchForm");
  const whatInput = document.getElementById("home-search-what");
  const whereInput = document.getElementById("home-search-where");

  if (!form) return;
  setupHomeDateSelector();

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    const dates = homeValidatedDates();
    if (!dates) return;
    goToResults(
      whatInput ? whatInput.value.trim() : "",
      whereInput ? whereInput.value.trim() : "",
      dates
    );
  });
}

function setupHomeNearbySearch() {
  const button = document.getElementById("homeNearbySearchButton");
  const status = document.getElementById("homeNearbySearchStatus");
  if (!button) return;

  let statusTimer = null;

  function clearStatus() {
    if (status) {
      status.textContent = "";
      status.hidden = true;
    }
    if (statusTimer !== null && typeof window.clearTimeout === "function") {
      window.clearTimeout(statusTimer);
    }
    statusTimer = null;
  }

  function showStatus(key, fallback) {
    if (!status) return;
    clearStatus();
    status.textContent = homeTranslate(key, fallback);
    status.hidden = false;
    statusTimer = window.setTimeout(clearStatus, 4000);
  }

  button.addEventListener("click", function () {
    if (button.disabled) return;
    clearStatus();
    const dates = homeValidatedDates();
    if (!dates) return;
    const nearby = window.rentuloNearbyLocation;
    if (!navigator.geolocation || !nearby) {
      showStatus("home.locationUnavailable", "Poloha není dostupná. Hledejte podle města.");
      return;
    }
    button.disabled = true;

    navigator.geolocation.getCurrentPosition(function (position) {
      const coords = position && position.coords ? position.coords : {};
      if (!nearby.saveForNextPage(coords.latitude, coords.longitude)) {
        button.disabled = false;
        showStatus("home.locationStorageUnavailable", "Polohu nelze bezpečně předat. Hledejte podle města.");
        return;
      }
      const params = new URLSearchParams();
      const searchTerm = document.getElementById("home-search-what");
      if (searchTerm && searchTerm.value.trim()) params.set("co", searchTerm.value.trim());
      params.set("okoli", "1");
      homeSetDateParams(params, dates);
      // The next page consumes the coordinates once and deletes them.
      // No lat/lng is ever appended to the URL or stored in a user profile.
      window.location.assign("vysledky.html?" + params.toString());
    }, function () {
      button.disabled = false;
      showStatus("home.locationDenied", "Poloha nebyla povolena. Hledejte podle města.");
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 });
  });
}

function setupCategorySearch() {
  document.querySelectorAll(".home-point-button").forEach(function (button) {
    button.addEventListener("click", function () {
      const dates = homeValidatedDates();
      if (!dates) return;
      const category = button.dataset.category || "";
      const searchParams = new URLSearchParams();

      if (category) {
        searchParams.set("kategorie", category);
      }
      homeSetDateParams(searchParams, dates);

      const queryString = searchParams.toString();
      window.location.href = queryString ? "vysledky.html?" + queryString : "vysledky.html";
    });
  });
}

function applyHomeDynamicTranslations() {
  refreshHomeDateSummary();
  const mapElement = document.getElementById("homeOffersMap");

  if (mapElement) {
    mapElement.setAttribute(
      "aria-label",
      homeTranslate("home.mapAriaLabel", "Mapa dostupných nabídek")
    );
  }

  const zoomControls = document.querySelector(".home-map-zoom-controls");
  if (zoomControls) {
    zoomControls.setAttribute(
      "aria-label",
      homeTranslate("home.mapZoomControlsAriaLabel", "Ovládání přiblížení mapy")
    );
  }

  const previews = document.getElementById("homeMapPreviews");
  if (previews) {
    previews.setAttribute("aria-label", homeTranslate("home.latestInView", "Nejnovější nabídky v zobrazené oblasti"));
  }
  applyHomeMapGestureTranslations();
}

function getHomeMapReturnView() {
  try {
    const state = window.history && window.history.state ? window.history.state : null;
    const view = state && state.rentuloHomeMapView ? state.rentuloHomeMapView : null;
    if (!view || typeof view !== "object") return null;

    const latitude = Number(view.latitude);
    const longitude = Number(view.longitude);
    const zoom = Number(view.zoom);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(zoom)) {
      return null;
    }

    return { latitude: latitude, longitude: longitude, zoom: zoom };
  } catch (error) {
    return null;
  }
}

function saveHomeMapViewForReturn() {
  if (!homeMap || !window.history || typeof window.history.replaceState !== "function") return;

  const center = homeMap.getCenter();
  const zoom = homeMap.getZoom();
  if (!center || !Number.isFinite(Number(center.lat)) || !Number.isFinite(Number(center.lng)) || !Number.isFinite(Number(zoom))) return;

  const currentState = window.history.state && typeof window.history.state === "object"
    ? window.history.state
    : {};
  const nextState = Object.assign({}, currentState, {
    rentuloHomeMapView: {
      latitude: Number(center.lat),
      longitude: Number(center.lng),
      zoom: Number(zoom)
    }
  });

  window.history.replaceState(nextState, "", window.location.href);
}

function applyHomeMapReturnView() {
  if (!homeMap || !homeMapReturnView) return;

  homeMap.setView(
    [homeMapReturnView.latitude, homeMapReturnView.longitude],
    homeMapReturnView.zoom,
    { animate: false }
  );
}

// Zjednodušená hranice ČR (souřadnice [délka, šířka]), pouze pro zobrazení mapy.
const HOME_CZECH_BORDER = [
  [16.960288, 48.596982],
  [16.499283, 48.785808],
  [16.029647, 48.733899],
  [15.253416, 49.039074],
  [14.901447, 48.964402],
  [14.338898, 48.555305],
  [13.595946, 48.877172],
  [13.031329, 49.307068],
  [12.521024, 49.547415],
  [12.415191, 49.969121],
  [12.240111, 50.266338],
  [12.966837, 50.484076],
  [13.338132, 50.733234],
  [14.056228, 50.926918],
  [14.307013, 51.117268],
  [14.570718, 51.002339],
  [15.016996, 51.106674],
  [15.490972, 50.78473],
  [16.238627, 50.697733],
  [16.176253, 50.422607],
  [16.719476, 50.215747],
  [16.868769, 50.473974],
  [17.554567, 50.362146],
  [17.649445, 50.049038],
  [18.392914, 49.988629],
  [18.853144, 49.49623],
  [18.554971, 49.495015],
  [18.399994, 49.315001],
  [18.170498, 49.271515],
  [18.104973, 49.043983],
  [17.913512, 48.996493],
  [17.886485, 48.903475],
  [17.545007, 48.800019],
  [17.101985, 48.816969],
  [16.960288, 48.596982]
];

function isVisitorInCzechRepublic(location) {
  if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return false;
  if (Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180) return false;

  // Odd-even ray casting: přibližné určení státu bez posílání polohy třetí straně.
  let inside = false;
  for (let i = 0, previous = HOME_CZECH_BORDER.length - 1; i < HOME_CZECH_BORDER.length; previous = i++) {
    const [lonA, latA] = HOME_CZECH_BORDER[i];
    const [lonB, latB] = HOME_CZECH_BORDER[previous];
    if ((latA > location.latitude) !== (latB > location.latitude) &&
        location.longitude < (lonB - lonA) * (location.latitude - latA) / (latB - latA) + lonA) {
      inside = !inside;
    }
  }
  return inside;
}

function applyVisitorLocation(position) {
  const location = {
    latitude: Number(position && position.coords ? position.coords.latitude : NaN),
    longitude: Number(position && position.coords ? position.coords.longitude : NaN)
  };

  if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return;

  // Rentulo zatím funguje pouze v ČR: návštěvníky ze zahraničí nepřibližujeme na jejich polohu.
  // Pokud se již načetly nabídky, mapa zůstane přiblížena na české nabídky.
  if (!isVisitorInCzechRepublic(location)) {
    if (homeVisitorLocation) {
      homeVisitorLocation = null;
      renderHomeOffersMap();
    }
    return;
  }

  homeVisitorLocation = location;

  if (homeMap) {
    homeMap.setView([location.latitude, location.longitude], 9, { animate: true });
    window.setTimeout(function () {
      if (homeMap) homeMap.invalidateSize();
    }, 0);
  }

  renderHomeOffersMap();
}

function requestVisitorLocation() {
  if (!navigator.geolocation) return;

  navigator.geolocation.getCurrentPosition(
    applyVisitorLocation,
    function () {
      // Bez souhlasu zůstane zobrazena neutrální mapa Česka.
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 }
  );
}

function centerHomeMapOnVisitor() {
  // Do not request visitor position on page load, even if previously granted.
  if (homeMapReturnView && homeMap) applyHomeMapReturnView();
}

function clearLegacyStoredVisitorLocation() {
  try {
    localStorage.removeItem("rentuloUserLocation");
  } catch (error) {
    // Úložiště může být v některých režimech prohlížeče nedostupné.
  }
}
function distanceInKm(firstLat, firstLng, secondLat, secondLng) {
  const toRadians = function (value) { return value * Math.PI / 180; };
  const earthRadius = 6371;
  const latitudeDistance = toRadians(secondLat - firstLat);
  const longitudeDistance = toRadians(secondLng - firstLng);
  const calculation = Math.sin(latitudeDistance / 2) ** 2 +
    Math.cos(toRadians(firstLat)) * Math.cos(toRadians(secondLat)) *
    Math.sin(longitudeDistance / 2) ** 2;

  return earthRadius * 2 * Math.atan2(Math.sqrt(calculation), Math.sqrt(1 - calculation));
}

function compareMapOffers(first, second, userLocation) {
  const ratingDifference = Number(second.averageRating || 0) - Number(first.averageRating || 0);
  if (ratingDifference !== 0) return ratingDifference;

  const countDifference = Number(second.ratingCount || 0) - Number(first.ratingCount || 0);
  if (countDifference !== 0) return countDifference;

  if (userLocation) {
    const firstDistance = distanceInKm(userLocation.latitude, userLocation.longitude, first.map_latitude, first.map_longitude);
    const secondDistance = distanceInKm(userLocation.latitude, userLocation.longitude, second.map_latitude, second.map_longitude);
    if (firstDistance !== secondDistance) return firstDistance - secondDistance;
  }

  return Date.parse(second.created_at || "") - Date.parse(first.created_at || "");
}

async function loadHomeMapOffers() {
  const supabaseClient = typeof getSupabaseClient === "function" ? getSupabaseClient() : null;

  if (!supabaseClient || typeof window.L === "undefined") {
    showHomeMapError();
    return;
  }

  const { data: offers, error: offersError } = await supabaseClient.rpc("get_public_map_offers");

  if (offersError || !Array.isArray(offers)) {
    console.error("Mapa nabídek se nepodařila načíst.", offersError || "");
    showHomeMapError();
    return;
  }

  const ownerIds = Array.from(new Set(offers.map(function (offer) {
    return String(offer.owner_id || "");
  }).filter(Boolean)));

  const ratingsByOwner = {};
  if (ownerIds.length) {
    const { data: ratings } = await supabaseClient
      .from("user_rating_summary")
      .select("user_id, average_rating, rating_count")
      .in("user_id", ownerIds);

    if (Array.isArray(ratings)) {
      ratings.forEach(function (rating) {
        ratingsByOwner[String(rating.user_id)] = {
          averageRating: Number(rating.average_rating || 0),
          ratingCount: Number(rating.rating_count || 0)
        };
      });
    }
  }

  homeMapOffers = offers.map(function (offer) {
    const rating = ratingsByOwner[String(offer.owner_id || "")] || {};
    return {
      ...offer,
      map_latitude: Number(offer.map_latitude),
      map_longitude: Number(offer.map_longitude),
      averageRating: Number(rating.averageRating || 0),
      ratingCount: Number(rating.ratingCount || 0)
    };
  }).filter(function (offer) {
    return Number.isFinite(offer.map_latitude) && Number.isFinite(offer.map_longitude);
  });

  homeMapLoadState = homeMapOffers.length ? "ready" : "empty";
  renderHomeOffersMap();
  renderHomeMapPreviews();
}

function updateHomeMapZoomControls() {
  const zoomInButton = document.getElementById("homeMapZoomIn");
  const zoomOutButton = document.getElementById("homeMapZoomOut");

  if (!homeMap) return;

  if (zoomInButton) {
    zoomInButton.disabled = homeMap.getZoom() >= homeMap.getMaxZoom();
  }

  if (zoomOutButton) {
    zoomOutButton.disabled = homeMap.getZoom() <= homeMap.getMinZoom();
  }
}

function bindHomeMapZoomControls() {
  const zoomInButton = document.getElementById("homeMapZoomIn");
  const zoomOutButton = document.getElementById("homeMapZoomOut");

  if (zoomInButton) {
    zoomInButton.addEventListener("click", function () {
      if (homeMap) homeMap.zoomIn();
    });
  }

  if (zoomOutButton) {
    zoomOutButton.addEventListener("click", function () {
      if (homeMap) homeMap.zoomOut();
    });
  }

  updateHomeMapZoomControls();
}

function initializeHomeMap() {
  if (homeMap || typeof window.L === "undefined") return;

  const gestureTexts = getHomeMapGestureTexts();

  homeMap = window.L.map("homeOffersMap", {
    zoomControl: false,
    scrollWheelZoom: false,
    touchZoom: true,
    attributionControl: false,
    gestureHandling: true,
    gestureHandlingOptions: {
      duration: 1400,
      text: gestureTexts
    }
  }).setView([49.8, 15.5], 6);

  applyHomeMapGestureTranslations();

  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap"
  }).addTo(homeMap);

  homeMapLayer = window.L.layerGroup().addTo(homeMap);
  bindHomeMapZoomControls();

  homeMap.on("moveend", function () {
    updateHomeMapViewportStatus();
    renderHomeMapPreviews();
  });
  homeMap.on("zoomend", function () {
    updateHomeMapViewportStatus();
    updateHomeMapZoomControls();
  });
}

function updateHomeMapViewportStatus() {
  const emptyStatus = document.getElementById("homeMapEmptyStatus");

  if (!emptyStatus || !homeMap || !homeMapLayer || homeMapLoadState !== "ready") return;

  const visibleBounds = homeMap.getBounds();
  const hasVisibleOffer = homeMapLayer.getLayers().some(function (layer) {
    if (!layer || typeof layer.getLatLng !== "function") return false;
    return visibleBounds.contains(layer.getLatLng());
  });

  if (hasVisibleOffer) {
    emptyStatus.hidden = true;
    return;
  }

  emptyStatus.hidden = false;
  emptyStatus.textContent = homeTranslate(
    "home.mapEmpty",
    "V zobrazené oblasti zatím nejsou žádné nabídky."
  );
}

// Only public, published offers in the current map bounds. No test or placeholder cards.
function renderHomeMapPreviews() {
  const container = document.getElementById("homeMapPreviews");
  if (!container) return;

  container.replaceChildren();
  container.hidden = true;
  if (!homeMap || homeMapLoadState !== "ready") return;

  const bounds = homeMap.getBounds();
  const latest = homeMapOffers.filter(function (offer) {
    return bounds.contains([offer.map_latitude, offer.map_longitude]);
  }).sort(function (a, b) {
    return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0);
  }).slice(0, 3);

  latest.forEach(function (offer) {
    const card = document.createElement("a");
    card.className = "home-map-preview";
    card.href = "detail.html?id=" + encodeURIComponent(offer.id);
    card.addEventListener("click", saveHomeMapViewForReturn);

    const photo = document.createElement("div");
    photo.className = "home-map-preview-photo";
    if (offer.photo_url) {
      const image = document.createElement("img");
      image.src = offer.photo_url;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      photo.appendChild(image);
    } else {
      photo.textContent = "▦";
      photo.setAttribute("aria-hidden", "true");
    }

    const copy = document.createElement("div");
    copy.className = "home-map-preview-copy";
    const title = document.createElement("strong");
    title.className = "home-map-preview-title";
    title.textContent = offer.name || homeTranslate("home.featuredUnnamed", "Nabídka");
    const city = document.createElement("span");
    city.className = "home-map-preview-city";
    city.textContent = offer.city || homeTranslate("home.featuredUnknownCity", "Město neuvedeno");
    const price = document.createElement("strong");
    price.className = "home-map-preview-price";
    price.textContent = formatMapPrice(offer.price_per_day);
    copy.append(title, city, price);
    card.append(photo, copy);
    container.appendChild(card);
  });
  container.hidden = latest.length === 0;
}

function createMapMarkerIcon(count) {
  return window.L.divIcon({
    className: "",
    html: '<div class="home-map-marker"><span>' + String(count) + '</span></div>',
    iconSize: [34, 34],
    iconAnchor: [17, 32],
    popupAnchor: [0, -30]
  });
}

function formatMapPrice(value) {
  const language = typeof window.getRentuloLanguage === "function" ? window.getRentuloLanguage() : "cs";
  const locales = { cs: "cs-CZ", sk: "sk-SK", en: "en-GB", de: "de-DE", pl: "pl-PL" };
  const locale = locales[language] || locales.cs;
  return Number(value || 0).toLocaleString(locale) + " Kč / " + homeTranslate("home.featuredDay", "den");
}

function buildMapPopup(group) {
  const best = group[0];
  const wrapper = document.createElement("div");
  wrapper.className = "home-map-popup";

  const name = document.createElement("strong");
  name.className = "home-map-popup-name";
  name.textContent = best.name || homeTranslate("home.featuredUnnamed", "Nabídka");
  wrapper.appendChild(name);

  const meta = document.createElement("span");
  meta.className = "home-map-popup-meta";
  meta.textContent = (best.city || homeTranslate("home.featuredUnknownCity", "Město neuvedeno")) + " · " + formatMapPrice(best.price_per_day);
  wrapper.appendChild(meta);

  const rating = document.createElement("span");
  rating.className = "home-map-popup-rating";
  if (best.ratingCount > 0) {
    const currentLanguage = typeof window.getRentuloLanguage === "function"
      ? window.getRentuloLanguage()
      : "cs";
    const slovakPluralCategory = currentLanguage === "sk"
      ? new Intl.PluralRules("sk-SK").select(Number(best.ratingCount))
      : "";
    const ratingCountText = best.ratingCount === 1
      ? homeTranslate("home.featuredRatingOne", "1 hodnocení")
      : best.ratingCount + " " + (
          slovakPluralCategory === "few"
            ? homeTranslate("home.featuredRatingFew", "hodnotenia")
            : homeTranslate("home.featuredRatingMany", "hodnocení")
        );
    rating.textContent = "★ " + best.averageRating.toFixed(1) + " · " + ratingCountText;
  } else {
    rating.textContent = homeTranslate("home.featuredNoRating", "Zatím bez hodnocení");
  }
  wrapper.appendChild(rating);

  if (group.length > 1) {
    const more = document.createElement("span");
    more.className = "home-map-popup-more";
    more.textContent = homeTranslate("home.mapMoreOffers", "Další nabídky v tomto okolí") + ": " + (group.length - 1);
    wrapper.appendChild(more);
  }

  const link = document.createElement("a");
  link.className = "home-map-popup-link";
  link.href = "detail.html?id=" + encodeURIComponent(best.id);
  link.textContent = homeTranslate("home.mapOpenDetail", "Zobrazit detail");
  link.addEventListener("click", function () {
    saveHomeMapViewForReturn();
  });
  wrapper.appendChild(link);

  return wrapper;
}

function renderHomeOffersMap() {
  const status = document.getElementById("homeMapStatus");
  const emptyStatus = document.getElementById("homeMapEmptyStatus");
  initializeHomeMap();

  if (homeMapLoadState === "loading") {
    if (emptyStatus) emptyStatus.hidden = true;
    if (status) {
      status.hidden = false;
      status.textContent = homeTranslate("home.mapLoading", "Načítám nabídky do mapy...");
    }
    return;
  }

  if (homeMapLoadState === "error") {
    if (emptyStatus) emptyStatus.hidden = true;
    if (status) {
      status.hidden = false;
      status.textContent = homeTranslate("home.mapUnavailable", "Mapu se teď nepodařilo načíst. Nabídky zůstávají dostupné ve výsledcích hledání.");
    }
    return;
  }

  if (!homeMap || !homeMapLayer) return;
  homeMapLayer.clearLayers();

  if (!homeMapOffers.length) {
    if (status) status.hidden = true;
    if (emptyStatus) {
      emptyStatus.hidden = false;
      emptyStatus.textContent = homeTranslate(
        "home.mapEmpty",
        "V zobrazené oblasti zatím nejsou žádné nabídky."
      );
    }
    return;
  }

  if (status) status.hidden = true;
  if (emptyStatus) emptyStatus.hidden = true;

  const userLocation = homeVisitorLocation;
  const groups = new Map();

  homeMapOffers.forEach(function (offer) {
    const key = offer.map_latitude.toFixed(2) + ":" + offer.map_longitude.toFixed(2);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(offer);
  });

  const bounds = [];
  groups.forEach(function (group) {
    group.sort(function (first, second) {
      return compareMapOffers(first, second, userLocation);
    });

    const best = group[0];
    const marker = window.L.marker(
      [best.map_latitude, best.map_longitude],
      { icon: createMapMarkerIcon(group.length) }
    ).addTo(homeMapLayer);

    marker.bindPopup(buildMapPopup(group));
    marker.on("mouseover", function () { marker.openPopup(); });
    bounds.push([best.map_latitude, best.map_longitude]);
  });

  if (homeMapReturnViewPending && homeMapReturnView) {
    applyHomeMapReturnView();
    homeMapReturnViewPending = false;
  } else if (userLocation) {
    homeMap.setView([userLocation.latitude, userLocation.longitude], 9);
  } else if (bounds.length === 1) {
    homeMap.setView(bounds[0], 11);
  } else if (bounds.length > 1) {
    homeMap.fitBounds(bounds, { padding: [24, 24], maxZoom: 11 });
  }

  window.setTimeout(function () {
    homeMap.invalidateSize();
    updateHomeMapViewportStatus();
  }, 50);
}

function showHomeMapError() {
  const status = document.getElementById("homeMapStatus");
  const emptyStatus = document.getElementById("homeMapEmptyStatus");
  homeMapLoadState = "error";
  renderHomeMapPreviews();
  if (emptyStatus) emptyStatus.hidden = true;
  if (!status) return;
  status.hidden = false;
  status.textContent = homeTranslate("home.mapUnavailable", "Mapu se teď nepodařilo načíst. Nabídky zůstávají dostupné ve výsledcích hledání.");
}
