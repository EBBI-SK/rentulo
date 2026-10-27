"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");

const root = path.join(__dirname, "..");
const code = stripTypeScriptTypes(fs.readFileSync(
  path.join(root, "supabase", "functions", "address-suggestions", "index.ts"), "utf8"
));
const endpoint = "https://vspposovhdgvbeukoivh.supabase.co/functions/v1/address-suggestions";
const prague = {
  key: "1153291", // mock ArcGIS objectid, not RÚIAN address code
  text: "Václavské náměstí 846/1, Nové Město, 11000 Praha 1",
  psc: 11000
};
const pribram = {
  key: "1153292",
  text: "Václavské náměstí 11/1, Příbram I, 26101 Příbram",
  psc: 26101
};
const ostrava = {
  key: "1153293",
  text: "Václavské náměstí 100/1, Moravská Ostrava, 70200 Ostrava",
  psc: 70200
};

function harness({ records = [prague, pribram, ostrava], missingGeoapifyKey = false, errors = {}, stopCombinedCity = false } = {}) {
  let handler;
  const urls = [];
  const log = [];
  const env = {
    SUPABASE_URL: "https://vspposovhdgvbeukoivh.supabase.co",
    GEOAPIFY_API_KEY: missingGeoapifyKey ? undefined : "provider-test-secret"
  };
  const sandbox = {
    Deno: {
      env: { get(name) { return env[name]; } },
      serve(cb) { handler = cb; }
    },
    URL, Request, Response, AbortController, setTimeout, clearTimeout,
    console: { warn(...args) { log.push(args.join(" ")); } },
    async fetch(address) {
      const url = new URL(address);
      urls.push(url);
      if (url.pathname.endsWith("/suggest")) {
        if (errors.suggest) return new Response("service error", { status: 503 });
        const isCombined = url.searchParams.get("text")?.includes("Praha");
        const suggestions = stopCombinedCity && isCombined ? [] : records.map(item => ({
          magicKey: item.key, text: item.text, type: "AdresniMisto", isCollection: false
        }));
        return Response.json({ suggestions });
      }
      if (url.pathname.endsWith("/1/query")) {
        if (errors.query) return new Response("service error", { status: 503 });
        const ids = (url.searchParams.get("objectIds") || "").split(",");
        return Response.json({ features: records.filter(item => ids.includes(item.key)).map(item => ({
          attributes: {
            objectid: Number(item.key), kod: 25000000 + Number(item.key),
            psc: item.psc, adresa: item.text, platido: item.platido ?? null,
            nespravny: item.nespravny ?? null
          }
        })) });
      }
      if (url.hostname === "api-eu.geoapify.com") return Response.json({ results: [
        { street: "Václavské náměstí", housenumber: "1", city: "Praha", postcode: "121 32", country_code: "cz", lat: 50, lon: 14 }
      ] });
      throw Error("Unexpected upstream URL: " + url.hostname);
    }
  };
  vm.runInNewContext(code, sandbox, { timeout: 2500 });
  return {
    urls, log,
    async query(query, city = "", postalCode = "", source = "ruian", origin = "https://rentulo.eu") {
      const r = await handler(new Request(endpoint, {
        method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ source, query, city, postalCode, language: "cs" })
      }));
      return { status: r.status, payload: await r.json() };
    }
  };
}

test("registration gets official Prague postcode 110 00, never wrong Geoapify value", async () => {
  const h = harness();
  const result = await h.query("Václavské náměstí 1", "Praha");
  assert.equal(result.status, 200);
  assert.equal(result.payload.suggestions.length, 1);
  assert.deepEqual(result.payload.suggestions[0], {
    source: "ruian", verified: true,
    street: "Václavské náměstí 846/1", city: "Praha", postalCode: "110 00",
    label: prague.text
  });
  assert.deepEqual(h.urls.map(u => u.hostname), ["ags.cuzk.gov.cz", "ags.cuzk.gov.cz"]);
  assert.equal(h.urls[0].pathname.endsWith("/tables/1/suggest"), true);
  assert.equal(h.urls[1].pathname.endsWith("/MapServer/1/query"), true);
  assert.equal(h.urls[1].searchParams.get("outFields"), "objectid,kod,adresa,psc,nespravny,platido");
  assert.equal(h.urls[0].searchParams.get("text"), "Václavské náměstí 1 Praha");
  assert.equal(h.urls[1].searchParams.get("returnGeometry"), "false");
});

test("without city, suggestions are official addresses with visible distinct cities and postal codes", async () => {
  const result = await harness().query("Václavské náměstí 1");
  assert.equal(result.status, 200);
  assert.ok(result.payload.suggestions.length >= 2);
  assert.equal(result.payload.suggestions.some(i => i.city === "Příbram" && i.postalCode === "261 01"), true);
  assert.equal(result.payload.suggestions.some(i => i.city === "Praha" && i.postalCode === "110 00"), true);
});

test("entered postal code filters out addresses in same-named streets in other cities", async () => {
  const result = await harness().query("Václavské náměstí 1", "Praha", "11000");
  assert.equal(result.payload.suggestions.length, 1);
  assert.equal(result.payload.suggestions[0].postalCode, "110 00");
  const none = await harness().query("Václavské náměstí 1", "Praha", "26101");
  assert.equal(none.payload.suggestions.length, 0);
});

test("house number is exact: changing orientation number does not offer wrong house", async () => {
  const result = await harness().query("Václavské náměstí 2", "Praha");
  assert.equal(result.payload.suggestions.length, 0);
});

test("RÚIAN number and PSČ must agree between official suggest and official attribute", async () => {
  const h = harness({ records: [{ ...prague, psc: 12132 }] });
  const result = await h.query("Václavské náměstí 1", "Praha");
  assert.equal(result.status, 200);
  assert.deepEqual(result.payload.suggestions, []);
});

test("withdrawn or erroneous RÚIAN address records are excluded", async () => {
  const expired = harness({ records: [{ ...prague, platido: 1790000000000 }] });
  const invalid = harness({ records: [{ ...prague, nespravny: "1" }] });
  assert.equal((await expired.query("Václavské náměstí 1", "Praha")).payload.suggestions.length, 0);
  assert.equal((await invalid.query("Václavské náměstí 1", "Praha")).payload.suggestions.length, 0);
});

test("missing Geoapify secret does not block official address search, Geoapify mode stays separate", async () => {
  const h = harness({ missingGeoapifyKey: true });
  const found = await h.query("Václavské náměstí 1", "Praha");
  assert.equal(found.status, 200);
  assert.equal(found.payload.suggestions[0].postalCode, "110 00");
  const other = await h.query("Václavské náměstí 1", "Praha", "", "geoapify");
  assert.equal(other.status, 503);
  assert.equal(h.urls.every(url => url.hostname === "ags.cuzk.gov.cz"), true);
});

test("legacy Geoapify mode remains unchanged for offering/editing a listing", async () => {
  const h = harness();
  const result = await h.query("Václavské náměstí 1", "Praha", "", "geoapify");
  assert.equal(result.status, 200);
  assert.equal(result.payload.suggestions[0].postalCode, "121 32");
  assert.equal(result.payload.suggestions[0].verified, undefined);
  assert.equal(h.urls.every(url => url.hostname === "api-eu.geoapify.com"), true);
});

test("on RÚIAN outage, no unverified fallback and no address leaked to logs", async () => {
  const h = harness({ errors: { suggest: true } });
  const result = await h.query("Václavské náměstí 1", "Praha");
  assert.equal(result.status, 503);
  assert.equal(result.payload.error, "Verified address lookup unavailable");
  assert.ok(!h.urls.some(url => url.hostname === "api-eu.geoapify.com"));
  assert.ok(!h.log.join(" ").includes("Václavské"));
  assert.ok(!h.log.join(" ").includes("apiKey"));
});

test("without an official query result the service does not trust an autocomplete label", async () => {
  const h = harness({ errors: { query: true } });
  const result = await h.query("Václavské náměstí 1", "Praha");
  assert.equal(result.status, 503);
  assert.equal(result.payload.suggestions, undefined);
});

test("city query falls back to street-only search only when needed, then filters city", async () => {
  const h = harness({ stopCombinedCity: true });
  const result = await h.query("Václavské náměstí 1", "Praha");
  assert.equal(result.status, 200);
  assert.equal(result.payload.suggestions.length, 1);
  assert.equal(h.urls.filter(url => url.pathname.endsWith("/suggest")).length, 2);
});

test("CORS denies an unapproved origin without calling RÚIAN", async () => {
  const h = harness();
  const response = await h.query("Václavské náměstí 1", "Praha", "", "ruian", "https://unknown.example");
  assert.equal(response.status, 403);
  assert.equal(h.urls.length, 0);
});

test("repeat RÚIAN searches use in-memory cache rather than another registry round-trip", async () => {
  const h = harness();
  const first = await h.query("Václavské náměstí 1", "Praha");
  const second = await h.query("Václavské náměstí 1", "Praha");
  assert.deepEqual(second.payload, first.payload);
  assert.equal(h.urls.length, 2);
});
