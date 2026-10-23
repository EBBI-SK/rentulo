"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const html = read("index.html");
const home = read("js/home-page.js");
const navigation = read("js/navigation.js");
const pin = read("js/pickup-security.js");
const languageSource = read("js/i18n.js");

// Checks only approved UI; production backend, PIN security and monetary rules stay untouched.
test("approved homepage keeps the same search and map, with the green primary offer CTA", () => {
  assert.match(html, /class="home-offer-cta"/);
  assert.match(html, /data-i18n="home\.titleFirst"/);
  assert.match(html, /data-i18n="home\.titleSecond"/);
  assert.match(html, /id="homeSearchForm"/);
  assert.match(html, /id="homeNearbySearchButton"/);
  assert.match(html, /id="homeOffersMap"/);
  assert.match(html, /id="homeMapPreviews"/);
  assert.match(html, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(html, /Chci si půjčit/);
});

test("the six category photos match the user's selected 3-by-2 mockup", () => {
  const subjects = ["household", "garden", "construction", "hobby", "party", "other"];
  for (const subject of subjects) {
    assert.match(html, new RegExp(`assets/categories/${subject}\\.webp`));
    assert.ok(fs.statSync(path.join(root, `assets/categories/${subject}.webp`)).size > 1000);
  }
  assert.equal((html.match(/class="home-point-button"/g) || []).length, 6);
});

test("full headline and map previews are localized in all five Rentulo languages", () => {
  for (const key of ["home.titleFirst", "home.titleSecond", "home.latestInView"]) {
    const matches = languageSource.match(new RegExp(`"${key.replaceAll(".", "\\.")}"`, "g")) || [];
    assert.equal(matches.length, 5, `${key} must exist for CZ, SK, EN, DE and PL`);
  }
  for (const label of ["Zadat PIN", "Zadať PIN", "Enter PIN", "PIN eingeben", "Wpisz PIN"]) {
    assert.ok(navigation.includes(`pin: "${label}"`));
  }
});

test("approved homepage layout keeps original assets and search functionality", () => {
  const search = html.indexOf('<form class="search-box" id="homeSearchForm">');
  const mapCard = html.indexOf('<aside class="home-map-card">');
  const map = html.indexOf('id="homeOffersMap"');
  assert.ok(mapCard < search && search < map, "the search must appear above the map");
  assert.match(html, /data-i18n="home\.heroSupportingText"/);
  assert.match(html, /home-copy \.home-text/);
  assert.match(html, /justify-content: space-between/);
  assert.match(html, /home-map-previews \{ margin-top: auto; \}/);
  assert.match(html, /home-copy,\s*body\[data-navigation-page="uvod"\] \.home-map-card \{ display: contents; \}/);
  const locales = languageSource.match(/"home\.heroSupportingText"/g) || [];
  assert.equal(locales.length, 5, "the supporting copy is localized in all five languages");
});

test("desktop and mobile homepage PIN buttons open one modal and route to the correct owner row", () => {
  const home = read("index.html");
  const offers = read("moje-nabidky.html");
  assert.match(navigation, /function navPinLink\(\)/);
  assert.match(navigation, /function navEnsureMobilePinShortcut\(nav\)/);
  assert.match(navigation, /activePage === "uvod" \? navPinLink\(\)/);
  assert.match(navigation, /data-home-pin-open="true"/);
  assert.match(navigation, /link\.dataset\.homePinOpen = "true"/);
  assert.match(home, /id="homePinModal"/);
  assert.match(home, /id="homePinInput"/);
  assert.doesNotMatch(offers, /id="pickupHandoffEntry"/);
  assert.match(pin, /invoke\("resolve-pickup-pin", \{ pin: pin \}\)/);
  assert.match(pin, /moje-nabidky\.html#handoff-/);
  assert.match(pin, /invoke\("confirm-pickup", \{/);
});

test("latest three public map offers react to the visible bounds without dummy data", () => {
  const preview = {
    children: [], hidden: true,
    replaceChildren() { this.children = []; },
    appendChild(item) { this.children.push(item); }
  };
  function node(tag) {
    return {
      tag, children: [], textContent: "", className: "", href: "",
      addEventListener() {}, appendChild(child) { this.children.push(child); },
      append(...children) { this.children.push(...children); },
      setAttribute() {}
    };
  }
  const env = {
    console, Date, Number, Map, Set, URLSearchParams, encodeURIComponent,
    document: {
      addEventListener() {},
      getElementById(id) { return id === "homeMapPreviews" ? preview : null; },
      createElement: node
    },
    window: { location: { hash: "" }, history: { state: null } }
  };
  vm.createContext(env);
  vm.runInContext(home, env);
  vm.runInContext(`
    homeMap = { getBounds() { return { contains(pair) { return pair[1] > 14; } }; } };
    homeMapLoadState = "ready";
    homeMapOffers = [
      { id:"a", name:"old", city:"Praha", price_per_day:100, photo_url:"", created_at:"2026-09-01T00:00:00Z",map_latitude:50,map_longitude:14.5 },
      { id:"b", name:"newest", city:"Praha", price_per_day:200, photo_url:"", created_at:"2026-10-22T12:00:00Z",map_latitude:50,map_longitude:14.4 },
      { id:"c", name:"elsewhere", city:"Brno", price_per_day:300, photo_url:"", created_at:"2026-10-23T00:00:00Z",map_latitude:50,map_longitude:12.0 },
      { id:"d", name:"middle", city:"Praha", price_per_day:400, photo_url:"", created_at:"2026-10-21T00:00:00Z",map_latitude:50,map_longitude:14.2 },
      { id:"e", name:"second", city:"Praha", price_per_day:500, photo_url:"", created_at:"2026-10-22T00:00:00Z",map_latitude:50,map_longitude:14.6 }
    ];
    renderHomeMapPreviews();
  `, env);
  assert.equal(preview.hidden, false);
  assert.equal(preview.children.length, 3);
  assert.deepEqual(preview.children.map(n => n.href), ["detail.html?id=b", "detail.html?id=e", "detail.html?id=d"]);
  assert.deepEqual(preview.children.map(n => n.children[1].children[0].textContent), ["newest", "second", "middle"]);
  vm.runInContext('homeMap.getBounds = function () { return { contains() { return false; } }; }; renderHomeMapPreviews();', env);
  assert.equal(preview.hidden, true);
  assert.equal(preview.children.length, 0);
});
