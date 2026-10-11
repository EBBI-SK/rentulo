"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (filename) => fs.readFileSync(path.join(root, filename), "utf8");
const languages = ["cs", "sk", "en", "de", "pl"];
const pendingFirstConfirmation =
  "#message=Confirmation+link+accepted.+Please+proceed+to+confirm+link+sent+to+the+other+email&sb=";

function createEnvironment(hash = "", state = null) {
  const listeners = new Map();
  const byId = {
    emailChangeNotice: { hidden: true },
    homeMapStatus: { hidden: true, textContent: "" },
    homeMapEmptyStatus: { hidden: true, textContent: "" }
  };
  const elements = [];
  const doc = {
    body: { dataset: {}, appendChild() {} },
    documentElement: { lang: "cs" },
    title: "",
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener(event);
    },
    getElementById(id) { return byId[id] || null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() {
      const element = {
        textContent: "", className: "", href: "",
        appendChild(child) { elements.push(child); },
        addEventListener() {}
      };
      elements.push(element);
      return element;
    }
  };
  const locations = [];
  const navigator = {
    platform: "Win32",
    geolocation: {
      getCurrentPosition(success) {
        locations.push(success);
      }
    }
  };
  const window = {
    location: { hash },
    history: { state },
    setTimeout() {},
    L: {
      divIcon() { return {}; },
      marker() {
        return {
          addTo() { return this; },
          bindPopup() { return this; },
          on() { return this; }
        };
      }
    }
  };
  const localStorage = { getItem() { return "cs"; }, setItem() {}, removeItem() {} };
  const context = vm.createContext({
    document: doc,
    window,
    navigator,
    localStorage,
    URLSearchParams,
    console,
    setTimeout() {},
    CustomEvent: class {
      constructor(type, options) { this.type = type; this.detail = options.detail; }
    }
  });

  vm.runInContext(read("js/i18n.js"), context, { filename: "js/i18n.js" });
  vm.runInContext(read("js/home-page.js"), context, { filename: "js/home-page.js" });
  function run(code) { return vm.runInContext(code, context); }
  run(`homeMap = {
    setView(coords, zoom) { window.views.push({ type: 'setView', coords: Array.from(coords), zoom }); return this; },
    fitBounds(bounds) { window.views.push({ type: 'fitBounds', bounds }); return this; },
    invalidateSize() {},
    getBounds() { return { contains() { return true; } }; },
    getMaxZoom() { return 18; },
    getMinZoom() { return 4; }
  };
  window.views = [];`);
  return { run, document: doc, window, views: window.views, locations, byId, elements };
}

test("the Czech border lookup distinguishes Czech cities and foreign locations", () => {
  const env = createEnvironment();
  for (const [name, latitude, longitude] of [
    ["Prague", 50.0755, 14.4378],
    ["Brno", 49.1951, 16.6068],
    ["Ostrava", 49.8209, 18.2625],
    ["Plzen", 49.7384, 13.3736],
    ["Ceske Budejovice", 48.9747, 14.4743]
  ]) {
    assert.equal(env.run(`isVisitorInCzechRepublic({ latitude: ${latitude}, longitude: ${longitude} })`), true, name);
  }
  for (const [name, latitude, longitude] of [
    ["Bratislava", 48.1486, 17.1077],
    ["Senica", 48.6792, 17.3669],
    ["Vienna", 48.2082, 16.3738],
    ["Dresden", 51.0504, 13.7373],
    ["Wroclaw", 51.1079, 17.0385],
    ["Berlin", 52.5200, 13.4050]
  ]) {
    assert.equal(env.run(`isVisitorInCzechRepublic({ latitude: ${latitude}, longitude: ${longitude} })`), false, name);
  }
  assert.equal(env.run("isVisitorInCzechRepublic({ latitude: NaN, longitude: 17 })"), false);
  assert.equal(env.run("isVisitorInCzechRepublic({ latitude: 100, longitude: 17 })"), false);
});

test("geolocation outside the Czech Republic does not move the home map", () => {
  const env = createEnvironment();
  env.run('homeMapLoadState = "loading";');
  env.run("applyVisitorLocation({ coords: { latitude: 48.1486, longitude: 17.1077 } });");
  assert.equal(env.views.length, 0);
  assert.equal(env.run("homeVisitorLocation"), null);
});

test("geolocation inside the Czech Republic still centers the home map", () => {
  const env = createEnvironment();
  env.run('homeMapLoadState = "loading";');
  env.run("applyVisitorLocation({ coords: { latitude: 50.0755, longitude: 14.4378 } });");
  assert.equal(env.views.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(env.views[0])), { type: "setView", coords: [50.0755, 14.4378], zoom: 9 });
  assert.equal(env.run("homeVisitorLocation.latitude"), 50.0755);
});

test("visitors abroad see a Czech listing when there are offers", () => {
  const env = createEnvironment();
  env.run(`homeMapLoadState = "ready";
    homeMapLayer = { clearLayers() {}, getLayers() { return []; } };
    homeMapOffers = [{
      id: "offer-prague", name: "Pila", city: "Praha",
      map_latitude: 50.0755, map_longitude: 14.4378, price_per_day: 100,
      ratingCount: 0, averageRating: 0
    }];
    renderHomeOffersMap();
  `);
  assert.equal(env.views.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(env.views[0])), { type: "setView", coords: [50.0755, 14.4378], zoom: 11 });
  env.run("applyVisitorLocation({ coords: { latitude: 48.1486, longitude: 17.1077 } });");
  assert.equal(env.views.length, 1, "Foreign geolocation must not override the Czech offer");
});

test("returning from listing detail keeps the stored map view and bypasses geolocation", () => {
  const env = createEnvironment("", { rentuloHomeMapView: { latitude: 49.8, longitude: 15.5, zoom: 8 } });
  env.run("centerHomeMapOnVisitor();");
  assert.equal(env.views.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(env.views[0])), { type: "setView", coords: [49.8, 15.5], zoom: 8 });
  assert.equal(env.locations.length, 0);
});

test("first confirmation landing displays a localized notice only for the Supabase callback", () => {
  const accepted = createEnvironment(pendingFirstConfirmation);
  accepted.run("showHomeEmailChangeConfirmationNotice();");
  assert.equal(accepted.byId.emailChangeNotice.hidden, false);

  for (const hash of ["", "#message=Other+message", "#message=Confirmation+link+accepted.", "#error=access_denied"]) {
    const ignored = createEnvironment(hash);
    ignored.run("showHomeEmailChangeConfirmationNotice();");
    assert.equal(ignored.byId.emailChangeNotice.hidden, true, hash);
  }

  const page = read("index.html");
  assert.match(page, /id="emailChangeNotice"[^>]+role="status"[^>]+hidden/);
  assert.match(page, /class="email-change-notice\[hidden\]"|\.email-change-notice\[hidden\]/);
});

test("notice, settings help and pending status are translated into all five languages", () => {
  const env = createEnvironment();
  const keys = [
    "auth.emailChangeFirstConfirmedTitle",
    "auth.emailChangeFirstConfirmedText",
    "settings.emailChangeNote",
    "settings.profileSavedEmailConfirmation",
    "settings.emailConfirmationPending"
  ];
  for (const language of languages) {
    for (const key of keys) {
      const translation = env.window.rentuloTranslate(key, language);
      assert.notEqual(translation, key, `${language}: ${key}`);
      assert.ok(translation.length >= 25, `${language}: ${key}`);
    }
    assert.ok(env.window.rentuloTranslate("settings.emailConfirmationPending", language).includes("{email}"));
  }
});

test("the email-change template explains both confirmations and retains its safe placeholders", () => {
  const mail = read("supabase/auth-email-templates/change-email-address/Body.html");
  assert.equal((mail.match(/href="{{ \.ConfirmationURL }}"/g) || []).length, 6);
  assert.equal((mail.match(/{{ \.NewEmail }}/g) || []).length, 6);
  for (const lang of languages) {
    assert.ok(mail.includes(`{{else if eq .Data.preferred_language "${lang}"}}`) || mail.includes(`{{if eq .Data.preferred_language "${lang}"}}`), lang);
  }
  for (const message of [
    "potvrzení na původní i novou",
    "potvrdenie na pôvodnú aj novú",
    "confirmation to both your current and new",
    "Bestätigung an die bisherige und die neue",
    "potwierdzenie na stary i nowy"
  ]) {
    assert.ok(mail.includes(message), message);
  }
});
