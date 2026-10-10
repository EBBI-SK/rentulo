document.addEventListener("DOMContentLoaded", function () {
  clearLegacyStoredVisitorLocation();
  setupHomeSearch();
  setupCategorySearch();
  applyHomeDynamicTranslations();
  initializeHomeMap();
  centerHomeMapOnVisitor();
  loadHomeMapOffers();
});

document.addEventListener("rentuloLanguageChanged", function () {
  applyHomeDynamicTranslations();
  renderHomeOffersMap();
});

let homeMap = null;
let homeMapLayer = null;
let homeMapOffers = [];
let homeMapLoadState = "loading";
let homeVisitorLocation = null;
let homeMapReturnView = getHomeMapReturnView();
let homeMapReturnViewPending = Boolean(homeMapReturnView);

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

function goToResults(what, where) {
  const searchParams = new URLSearchParams();

  if (what) {
    searchParams.set("co", what);
  }

  if (where) {
    searchParams.set("kde", where);
  }

  const queryString = searchParams.toString();
  window.location.href = queryString ? "vysledky.html?" + queryString : "vysledky.html";
}

function setupHomeSearch() {
  const form = document.getElementById("homeSearchForm");
  const whatInput = document.getElementById("home-search-what");
  const whereInput = document.getElementById("home-search-where");

  if (!form) return;

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    goToResults(
      whatInput ? whatInput.value.trim() : "",
      whereInput ? whereInput.value.trim() : ""
    );
  });
}

function setupCategorySearch() {
  document.querySelectorAll(".home-point-button").forEach(function (button) {
    button.addEventListener("click", function () {
      const category = button.dataset.category || "";
      const searchParams = new URLSearchParams();

      if (category) {
        searchParams.set("kategorie", category);
      }

      const queryString = searchParams.toString();
      window.location.href = queryString ? "vysledky.html?" + queryString : "vysledky.html";
    });
  });
}

function applyHomeDynamicTranslations() {
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

function applyVisitorLocation(position) {
  const location = {
    latitude: Number(position && position.coords ? position.coords.latitude : NaN),
    longitude: Number(position && position.coords ? position.coords.longitude : NaN)
  };

  if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return;

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
  if (homeMapReturnView && homeMap) {
    applyHomeMapReturnView();
    return;
  }

  requestVisitorLocation();

  if (navigator.permissions && typeof navigator.permissions.query === "function") {
    navigator.permissions.query({ name: "geolocation" }).then(function (permissionStatus) {
      permissionStatus.addEventListener("change", function () {
        if (permissionStatus.state === "granted") {
          requestVisitorLocation();
        }
      });
    }).catch(function () {
      // Permissions API nemusí být v každém prohlížeči dostupné.
    });
  }
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

  homeMap.on("moveend", updateHomeMapViewportStatus);
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
  if (emptyStatus) emptyStatus.hidden = true;
  if (!status) return;
  status.hidden = false;
  status.textContent = homeTranslate("home.mapUnavailable", "Mapu se teď nepodařilo načíst. Nabídky zůstávají dostupné ve výsledcích hledání.");
}
