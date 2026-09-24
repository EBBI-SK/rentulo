"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const ADDRESS_SOURCE = fs.readFileSync(path.join(ROOT, "supabase", "functions", "address-suggestions", "index.ts"), "utf8");
const OFFER_SOURCE = fs.readFileSync(path.join(ROOT, "js", "offer-form-page.js"), "utf8");
const EDIT_SOURCE = fs.readFileSync(path.join(ROOT, "js", "edit-offer.js"), "utf8");

function extractFunction(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, "Missing function start: " + startMarker);
  assert.notEqual(end, -1, "Missing function end: " + endMarker);
  return source.slice(start, end);
}

function loadAsyncFunction(source, startMarker, endMarker, functionName) {
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(
    extractFunction(source, startMarker, endMarker) + "\nthis.fn = " + functionName + ";",
    sandbox
  );
  return sandbox.fn;
}

test("address suggestions preserve Photon coordinates", () => {
  assert.match(ADDRESS_SOURCE, /latitude:\s*number;/);
  assert.match(ADDRESS_SOURCE, /longitude:\s*number;/);
  assert.match(ADDRESS_SOURCE, /const longitude = Number\(coordinates\[0\]\);/);
  assert.match(ADDRESS_SOURCE, /const latitude = Number\(coordinates\[1\]\);/);
  assert.match(ADDRESS_SOURCE, /suggestions\.push\(\{[\s\S]*latitude,[\s\S]*longitude,/);
});

test("create offer reuses selected suggestion coordinates and invalidates them after manual edits", () => {
  assert.match(OFFER_SOURCE, /let offerSelectedPickupCoordinates = null;/);
  assert.match(OFFER_SOURCE, /offerSelectedPickupCoordinates =\s*Number\.isFinite\(latitude\)[\s\S]*longitude/);
  assert.match(OFFER_SOURCE, /function scheduleOfferAddressSuggestions\(\) \{\s*offerSelectedPickupCoordinates = null;/);
  assert.match(OFFER_SOURCE, /const pickupCoordinates = offerSelectedPickupCoordinates \|\|[\s\S]*await geocodePickupAddress/);
  assert.match(OFFER_SOURCE, /pickup_latitude: pickupCoordinates \? pickupCoordinates\.latitude : null/);
  assert.match(OFFER_SOURCE, /pickup_longitude: pickupCoordinates \? pickupCoordinates\.longitude : null/);
});

test("edit offer reuses selected suggestion coordinates and invalidates them after manual edits", () => {
  assert.match(EDIT_SOURCE, /let editSelectedPickupCoordinates = null;/);
  assert.match(EDIT_SOURCE, /editSelectedPickupCoordinates =\s*Number\.isFinite\(latitude\)[\s\S]*longitude/);
  assert.match(EDIT_SOURCE, /function scheduleEditAddressSuggestions\(\) \{\s*editSelectedPickupCoordinates = null;/);
  assert.match(EDIT_SOURCE, /editSelectedPickupCoordinates \|\|[\s\S]*await geocodeEditedPickupAddress/);
  assert.match(EDIT_SOURCE, /pickup_latitude: pickupCoordinates \? pickupCoordinates\.latitude : null/);
  assert.match(EDIT_SOURCE, /pickup_longitude: pickupCoordinates \? pickupCoordinates\.longitude : null/);
});

for (const [label, source, startMarker, endMarker, functionName] of [
  ["create", OFFER_SOURCE, "async function geocodePickupAddress(", "function createSupabaseOfferObject", "geocodePickupAddress"],
  ["edit", EDIT_SOURCE, "async function geocodeEditedPickupAddress(", "async function initializeEditOfferPage", "geocodeEditedPickupAddress"]
]) {
  test(label + " geocoding does not block saving during provider outages", async () => {
    const geocode = loadAsyncFunction(source, startMarker, endMarker, functionName);
    const client = {
      functions: {
        async invoke() {
          return { data: null, error: new Error("503") };
        }
      }
    };

    assert.equal(await geocode(client, { street: "A 1", city: "Praha", postalCode: "110 00" }), null);
  });

  test(label + " geocoding still rejects a confirmed not-found address", async () => {
    const geocode = loadAsyncFunction(source, startMarker, endMarker, functionName);
    const client = {
      functions: {
        async invoke() {
          return { data: { ok: false, reason: "not_found" }, error: null };
        }
      }
    };

    await assert.rejects(
      geocode(client, { street: "Missing 1", city: "Praha", postalCode: "110 00" }),
      (error) => error && error.code === "PICKUP_GEOCODING_NOT_FOUND"
    );
  });

  test(label + " geocoding returns valid coordinates when the provider succeeds", async () => {
    const geocode = loadAsyncFunction(source, startMarker, endMarker, functionName);
    const client = {
      functions: {
        async invoke() {
          return { data: { ok: true, latitude: 50.087, longitude: 14.421 }, error: null };
        }
      }
    };

    const result = await geocode(client, { street: "A 1", city: "Praha", postalCode: "110 00" });
    assert.deepEqual({ latitude: result.latitude, longitude: result.longitude }, { latitude: 50.087, longitude: 14.421 });
  });
}
