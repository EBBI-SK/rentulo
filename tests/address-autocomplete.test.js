"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");

const root = path.join(__dirname, "..");
const serverCode = stripTypeScriptTypes(fs.readFileSync(path.join(root, "supabase", "functions", "address-suggestions", "index.ts"), "utf8"));
const createSource = fs.readFileSync(path.join(root, "js", "offer-form-page.js"), "utf8");
const editSource = fs.readFileSync(path.join(root, "js", "edit-offer.js"), "utf8");
const testProject = "https://vspposovhdgvbeukoivh.supabase.co";

function photonFeature(street, number, city, postalCode, latitude, longitude) {
  return { properties: { street, housenumber: number, city, postcode: postalCode }, geometry: { coordinates: [longitude, latitude] } };
}

const photonFeatures = [
  photonFeature("Václavské náměstí", "846/1", "Praha 1", "110 00", 50.082300, 14.423000),
  photonFeature("náměstí Václava Havla", "1", "Praha", "110 00", 50.095000, 14.415000),
  photonFeature("Václavské náměstí", "846/1", "Praha", "110 00", 50.082315, 14.423021),
  photonFeature("Václavské náměstí", "1", "Praha", "110 00", 50.083200, 14.424500),
  photonFeature("Václavské náměstí", "1", "Příbram", "261 01", 49.690000, 14.010000),
];

function runServer(features = photonFeatures, project = testProject) {
  let handler;
  const upstreamRequests = [];
  const context = {
    Deno: { env: { get(key) { return key === "SUPABASE_URL" ? project : undefined; } }, serve(fn) { handler = fn; } },
    Request, Response, URL, AbortController, setTimeout, clearTimeout, console,
    async fetch(url) {
      upstreamRequests.push(new URL(url));
      return new Response(JSON.stringify({ features }), { status: 200, headers: { "content-type": "application/json" } });
    }
  };
  vm.runInNewContext(serverCode, context, { timeout: 2500 });
  return {
    context, upstreamRequests,
    async query(query, city = "", postalCode = "") {
      const request = new Request(`${project}/functions/v1/address-suggestions`, {
        method: "POST", headers: { Origin: "https://rentulo.eu", "content-type": "application/json" },
        body: JSON.stringify({ query, city, postalCode, language: "cs" })
      });
      const res = await handler(request);
      assert.equal(res.status, 200);
      return (await res.json()).suggestions;
    }
  };
}

function pure(context, expression) {
  return JSON.parse(JSON.stringify(vm.runInNewContext(expression, context)));
}

test("recognizes street, house number and city in one field without a comma", () => {
  const { context } = runServer();
  const parsed = pure(context, 'parseAddressQuery("Václavské náměstí 1 Praha")');
  assert.deepEqual(parsed, { streetQuery: "Václavské náměstí 1", city: "Praha", postalCode: "", cityMayBePartial: true });
});

test("accepts an abbreviated Prague query while the city is still being typed", () => {
  const { context } = runServer();
  const parsed = pure(context, 'parseAddressQuery("Vaclavske nam. 1 pra")');
  assert.deepEqual(parsed, { streetQuery: "Vaclavske nam. 1", city: "pra", postalCode: "", cityMayBePartial: true });
  assert.equal(vm.runInNewContext('cityMatches("Praha", "pra", true)', context), true);
  assert.equal(vm.runInNewContext('cityMatches("Praha", "pra")', context), false);
});

test("keeps comma-separated city, postal code and separate city input compatible", () => {
  const { context } = runServer();
  const parsed = pure(context, 'parseAddressQuery("Václavské náměstí 1, Praha, 110 00")');
  assert.deepEqual(parsed, { streetQuery: "Václavské náměstí 1", city: "Praha", postalCode: "110 00", cityMayBePartial: false });
  const parsedInlinePostal = pure(context, 'parseAddressQuery("Václavské náměstí 1, Praha 11000")');
  assert.equal(parsedInlinePostal.city, "Praha");
  assert.equal(parsedInlinePostal.postalCode, "110 00");
});

test("preserves house numbers when the street name already includes a number", () => {
  const { context } = runServer();
  assert.equal(vm.runInNewContext('buildStreet({street:"17. listopadu",housenumber:"17"})', context), "17. listopadu 17");
  assert.equal(vm.runInNewContext('buildStreet({street:"Národní 10",housenumber:"10"})', context), "Národní 10");
});

test("sorts the exact Prague house first and merges nearby duplicate localities", () => {
  const { context } = runServer();
  context.testFeatures = { features: photonFeatures };
  const results = pure(context, 'mapPhotonFeatures(testFeatures, "1", "Praha", "", "Václavské náměstí")');
  assert.equal(results[0].street, "Václavské náměstí 1");
  assert.equal(results[0].city, "Praha");
  assert.equal(results.filter(x => x.street === "Václavské náměstí 846/1").length, 1);
  assert.equal(results.some(x => x.city === "Příbram"), false);
  assert.equal(results[0].latitude, 50.0832);
  assert.equal(results[0].longitude, 14.4245);
});

test("precise street matching accepts normal forms and partial street words, not another street", () => {
  const { context } = runServer();
  assert.equal(vm.runInNewContext('matchesRequestedStreet("Václavské náměstí", "Vaclavske nam.")', context), true);
  assert.equal(vm.runInNewContext('matchesRequestedStreet("Václavské náměstí", "Vacl")', context), true);
  assert.equal(vm.runInNewContext('matchesRequestedStreet("Václavské náměstí", "Václavské náměstí")', context), true);
  assert.equal(vm.runInNewContext('matchesRequestedStreet("Na Václavce", "Vaclavske nam")', context), false);
  assert.equal(vm.runInNewContext('matchesRequestedStreet("náměstí Václava Havla", "Vaclavske nam")', context), false);
});

test("specific Prague house does not include similarly named buildings on another street", async () => {
  const mock = runServer([
    photonFeature("Na Václavce", "117/1", "Praha", "150 00", 50.073, 14.398),
    photonFeature("Václavské náměstí", "846/1", "Praha 1", "110 00", 50.0823, 14.423),
    photonFeature("Václavské náměstí", "1", "Praha", "110 00", 50.0832, 14.4245),
    photonFeature("náměstí Václava Havla", "1", "Praha", "110 00", 50.095, 14.415)
  ]);
  const results = await mock.query("Vaclavske nam. 1 pra");
  assert.equal(results.length, 2);
  assert.equal(results[0].street, "Václavské náměstí 1");
  assert.equal(results.every(item => item.street.startsWith("Václavské náměstí")), true);
});

test("without a house number, autocomplete retains broad street suggestions", async () => {
  const mock = runServer([
    photonFeature("Václavské náměstí", "1", "Praha", "110 00", 50.0832, 14.4245),
    photonFeature("Na Václavce", "117/1", "Praha", "150 00", 50.073, 14.398)
  ]);
  const results = await mock.query("Vacl", "Praha");
  assert.equal(results.length, 2);
});

test("does not merge similarly named houses at different physical locations", () => {
  const { context } = runServer();
  context.testFeatures = { features: [
    photonFeature("U Lomu", "1", "Praha", "110 00", 50.08, 14.42),
    photonFeature("U Lomu", "1", "Praha 1", "110 00", 50.1, 14.44)
  ] };
  assert.equal(pure(context, 'mapPhotonFeatures(testFeatures,"1","Praha","","U Lomu")').length, 2);
});

test("full address in one input builds structured Photon query and filters out other cities", async () => {
  const mock = runServer();
  const result = await mock.query("Václavské náměstí 1 Praha");
  assert.equal(result[0].street, "Václavské náměstí 1");
  assert.equal(result.every(x => x.city.startsWith("Praha")), true);
  assert.equal(mock.upstreamRequests[0].searchParams.get("street"), "Václavské náměstí");
  assert.equal(mock.upstreamRequests[0].searchParams.get("housenumber"), "1");
  assert.equal(mock.upstreamRequests[0].searchParams.get("city"), "Praha");
});

test("incomplete city inside the street input filters candidates by the city prefix", async () => {
  const mock = runServer();
  const result = await mock.query("Vaclavske nam. 1 pra");
  assert.equal(result.some(x => x.city === "Příbram"), false);
  assert.equal(result[0].street, "Václavské náměstí 1");
});

test("a partial city falls back to a broader query while still filtering the returned city", async () => {
  let handler;
  const requests = [];
  const context = {
    Deno: { env: { get(name) { return name === "SUPABASE_URL" ? testProject : undefined; } }, serve(fn) { handler = fn; } },
    URL, Request, Response, AbortController, setTimeout, clearTimeout, console,
    async fetch(url) {
      const request = new URL(url);
      requests.push(request);
      // Simulate Photon not understanding the short city in either its
      // structured endpoint or the forward search endpoint.
      const features = request.pathname === "/structured" && !request.searchParams.has("city")
        ? photonFeatures : [];
      return new Response(JSON.stringify({ features }), { status: 200 });
    }
  };
  vm.runInNewContext(serverCode, context);
  const request = new Request(`${testProject}/functions/v1/address-suggestions`, {
    method: "POST", headers: { Origin: "https://rentulo.eu", "content-type": "application/json" },
    body: JSON.stringify({ query: "Vaclavske nam. 1 pra" })
  });
  const result = await handler(request);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.ok(data.suggestions.length > 0);
  assert.equal(data.suggestions.every(item => item.city.startsWith("Praha")), true);
  assert.equal(requests.at(-1).searchParams.has("city"), false);
});

test("city entered in its own field restricts results without silently changing it", async () => {
  const mock = runServer();
  const result = await mock.query("Václavské náměstí 1", "Praha");
  assert.equal(result[0].street, "Václavské náměstí 1");
  assert.equal(result.every(x => x.city.startsWith("Praha")), true);
  assert.equal(mock.upstreamRequests[0].searchParams.get("city"), "Praha");
});

function slice(source, start, end) {
  const i = source.indexOf(start), j = source.indexOf(end, i + start.length);
  assert.ok(i >= 0 && j > i, `Missing markers: ${start} / ${end}`);
  return source.slice(i, j);
}

function createFormHarness(source, kind) {
  const isCreate = kind === "create";
  const counter = isCreate ? "offerAddressRequestId" : "editAddressRequestId";
  const variable = isCreate ? "offerAddressSuggestions" : "editAddressSuggestions";
  const selected = isCreate ? "offerSelectedPickupCoordinates" : "editSelectedPickupCoordinates";
  const timer = isCreate ? "offerAddressTimer" : "editAddressTimer";
  const active = isCreate ? "offerAddressActiveIndex" : "editAddressActiveIndex";
  const close = isCreate ? "closeOfferAddressSuggestions" : "closeEditAddressSuggestions";
  const select = isCreate ? "selectOfferAddress" : "selectEditAddress";
  const setup = isCreate ? "setupPickupAddressAutocomplete" : "setupEditPickupAddressAutocomplete";
  const fields = isCreate
    ? ["pickupStreet", "pickupCity", "pickupPostalCode", "pickupAddressSuggestions"]
    : ["edit-pickup-street", "edit-city", "edit-postal-code", "editPickupAddressSuggestions"];
  const elements = Object.fromEntries(fields.map(id => [id, {
    value: "", innerHTML: "old", hidden: false, listeners: {},
    classList: { remove() {} },
    setAttribute() {}, removeAttribute() {},
    addEventListener(type, fn) { this.listeners[type] = fn; }
  }]));
  elements[fields[0]].value = "Václavské náměstí 1";
  elements[fields[1]].value = "Praha";
  let timerNumber = 0;
  const context = {
    document: {
      getElementById(id) { return elements[id] || null; },
      addEventListener() {}, querySelectorAll() { return []; }
    },
    window: { clearTimeout() {}, setTimeout() { return ++timerNumber; } }
  };
  const code = [
    `let ${variable} = [{street:"U Lomu 1",city:"Praha",postalCode:"110 00",latitude:50,longitude:14}];`,
    `let ${counter} = 4; let ${timer} = null; let ${active} = -1;`,
    `let ${selected} = {latitude: 50, longitude: 14};`,
    `const ${isCreate ? "OFFER" : "EDIT"}_ADDRESS_SUGGESTION_MIN_LENGTH = 3;`,
    `const ${isCreate ? "OFFER" : "EDIT"}_ADDRESS_SUGGESTION_DELAY_MS = 450;`,
    slice(source, `function ${close}() {`, isCreate ? "function renderOfferAddressSuggestions(" : "function renderEditAddressSuggestions("),
    slice(source, `function ${select}(index) {`, isCreate ? "async function loadOfferAddressSuggestions(" : "async function loadEditAddressSuggestions("),
    slice(source, `function ${setup}() {`, isCreate ? "async function fillProfileAddressAsDefault(" : "function normalizeEditPickupAddress("),
    `globalThis.harness = { setup: ${setup}, select: ${select}, getState: () => ({request: ${counter}, selected: ${selected}, suggestions: ${variable}.length}) };`
  ].join("\n");
  vm.runInNewContext(code, context);
  return { elements, fields, harness: context.harness };
}

for (const [label, source] of [["create", createSource], ["edit", editSource]]) {
  test(`${label} form hides old suggestions and invalidates pending search when city changes`, () => {
    const { elements, fields, harness } = createFormHarness(source, label);
    harness.setup();
    elements[fields[1]].value = "Brno";
    elements[fields[1]].listeners.input();
    assert.equal(elements[fields[3]].hidden, true);
    assert.equal(elements[fields[3]].innerHTML, "");
    assert.equal(harness.getState().suggestions, 0);
    assert.equal(harness.getState().selected, null);
    assert.equal(harness.getState().request, 5);
  });

  test(`${label} form fills street, city, postcode and coordinates upon selection`, () => {
    const { elements, fields, harness } = createFormHarness(source, label);
    harness.select(0);
    assert.equal(elements[fields[0]].value, "U Lomu 1");
    assert.equal(elements[fields[1]].value, "Praha");
    assert.equal(elements[fields[2]].value, "110 00");
    assert.deepEqual(JSON.parse(JSON.stringify(harness.getState().selected)), { latitude: 50, longitude: 14 });
    assert.equal(elements[fields[3]].hidden, true);
    assert.equal(harness.getState().request, 5);
  });
}
