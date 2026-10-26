"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");

const root = path.join(__dirname, "..");
const geocodeSource = fs.readFileSync(
  path.join(root, "supabase/functions/geocode-pickup/index.ts"), "utf8",
);
const addressSource = fs.readFileSync(
  path.join(root, "supabase/functions/address-suggestions/index.ts"), "utf8",
);
const geocodeScript = stripTypeScriptTypes(
  geocodeSource.replace(/^import \{ createClient \} from [^\n]+\n/, ""),
);
const testProject = "https://vspposovhdgvbeukoivh.supabase.co";

function createGeocodeHarness({ key = "test-eu-secret", authenticated = true, fetchResponse, fetchError } = {}) {
  let handle;
  const requests = [];
  const env = {
    SUPABASE_URL: testProject,
    SUPABASE_ANON_KEY: "test-anon-key",
    GEOAPIFY_API_KEY: key,
  };
  const sandbox = {
    Deno: { env: { get(name) { return env[name]; } }, serve(fn) { handle = fn; } },
    Request, Response, URL, AbortController, setTimeout, clearTimeout, console,
    createClient() {
      return { auth: { async getUser() {
        return authenticated
          ? { data: { user: { id: "fictional-test-user" } }, error: null }
          : { data: { user: null }, error: new Error("Unauthorized") };
      } } };
    },
    async fetch(url) {
      requests.push(new URL(url));
      if (fetchError) throw new Error("Mocked connection failed: " + fetchError);
      return fetchResponse || new Response(JSON.stringify({
        results: [{ lat: 50.087, lon: 14.421, country_code: "cz" }],
      }), { status: 200 });
    },
  };
  vm.runInNewContext(geocodeScript, sandbox, { timeout: 2500 });
  return {
    requests,
    async geocode(address = { street: "Národní 10", city: "Praha", postalCode: "110 00" }) {
      const result = await handle(new Request(`${testProject}/functions/v1/geocode-pickup`, {
        method: "POST",
        headers: { Authorization: "Bearer fictional-test-token", "content-type": "application/json" },
        body: JSON.stringify(address),
      }));
      return { status: result.status, body: await result.json() };
    },
  };
}

test("V1 sends precise addresses only to the Geoapify EU geocoding API", async () => {
  const harness = createGeocodeHarness();
  const result = await harness.geocode();
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(result.body)), {
    ok: true, latitude: 50.087, longitude: 14.421,
  });
  assert.equal(harness.requests.length, 1);
  const url = harness.requests[0];
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "api-eu.geoapify.com");
  assert.equal(url.pathname, "/v1/geocode/search");
  assert.equal(url.searchParams.get("filter"), "countrycode:cz");
  assert.equal(url.searchParams.get("format"), "json");
  assert.equal(url.searchParams.get("street"), "Národní");
  assert.equal(url.searchParams.get("housenumber"), "10");
  assert.equal(url.searchParams.get("city"), "Praha");
  assert.equal(url.searchParams.get("postcode"), "11000");
  assert.equal(url.searchParams.get("apiKey"), "test-eu-secret");
  assert.equal(JSON.stringify(result.body).includes("test-eu-secret"), false);
});

test("V1 refuses unauthorized geocode requests before contacting Geoapify", async () => {
  const harness = createGeocodeHarness({ authenticated: false });
  const result = await harness.geocode();
  assert.equal(result.status, 401);
  assert.equal(harness.requests.length, 0);
});

test("V1 refuses to contact any provider when Geoapify secret is missing", async () => {
  const harness = createGeocodeHarness({ key: "" });
  const result = await harness.geocode();
  assert.equal(result.status, 503);
  assert.equal(result.body.reason, "unavailable");
  assert.equal(harness.requests.length, 0);
});

test("V1 handles Geoapify outages without falling back to public address providers", async () => {
  const harness = createGeocodeHarness({ fetchError: "offline" });
  const result = await harness.geocode();
  assert.equal(result.status, 503);
  assert.equal(result.body.reason, "unavailable");
  assert.equal(harness.requests.length, 1);
});

test("V1 does not accept a non-Czech geocoding result", async () => {
  const harness = createGeocodeHarness({ fetchResponse: new Response(JSON.stringify({
    results: [{ lat: 48.14, lon: 17.1, country_code: "sk" }],
  }), { status: 200 }) });
  const result = await harness.geocode();
  assert.equal(result.status, 200);
  assert.equal(result.body.reason, "not_found");
});

test("Both Rentulo address functions use Geoapify's EU endpoint without browser keys", () => {
  for (const source of [geocodeSource, addressSource]) {
    assert.match(source, /api-eu\.geoapify\.com/);
    assert.match(source, /GEOAPIFY_API_KEY/);
    assert.doesNotMatch(source, /photon\.komoot|nominatim\.openstreetmap|https:\/\/api\.geoapify\.com/);
  }
});
