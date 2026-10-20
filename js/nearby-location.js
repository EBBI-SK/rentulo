// BOD02 V1 / GPS privacy. Only used after an explicit location-search click.
// Browser tab sessionStorage is a ONE-TIME handoff, not a location history.
(function () {
  "use strict";
  const KEY = "rentuloNearbyOnceV1";
  const MAX_AGE_MS = 120000;

  function validCoordinate(value, min, max) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
  }

  function saveForNextPage(latitude, longitude) {
    const lat = validCoordinate(latitude, -90, 90);
    const lng = validCoordinate(longitude, -180, 180);
    if (lat === null || lng === null) return false;
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify({ lat, lng, createdAt: Date.now() }));
      return true;
    } catch {
      // Fail closed: never fall back to URL, localStorage, cookies or profile.
      return false;
    }
  }

  function consumeOnce() {
    let raw = null;
    try {
      raw = window.sessionStorage.getItem(KEY);
      window.sessionStorage.removeItem(KEY); // Remove BEFORE reading or validating.
    } catch { return null; }
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      const age = Date.now() - Number(data.createdAt);
      const latitude = validCoordinate(data.lat, -90, 90);
      const longitude = validCoordinate(data.lng, -180, 180);
      if (latitude === null || longitude === null || age < 0 || age > MAX_AGE_MS) return null;
      return { latitude, longitude };
    } catch { return null; }
  }

  function stripLegacyCoordinatesFromUrl() {
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has("lat") && !url.searchParams.has("lng")) return;
      url.searchParams.delete("lat");
      url.searchParams.delete("lng");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch {
      // Fallback is safe: legacy URL coordinates are not used for sorting.
    }
  }

  window.rentuloNearbyLocation = Object.freeze({
    saveForNextPage,
    consumeOnce,
    stripLegacyCoordinatesFromUrl
  });
})();
