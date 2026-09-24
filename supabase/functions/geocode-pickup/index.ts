import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RentuloDenoRuntime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: {
    get(name: string): string | undefined;
  };
};

const denoRuntime = (
  globalThis as typeof globalThis & { Deno: RentuloDenoRuntime }
).Deno;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type GeocodePayload = {
  street?: string;
  city?: string;
  postalCode?: string;
};

type GeocodeResult =
  | { kind: "ok"; latitude: number; longitude: number; provider: string }
  | { kind: "not_found"; provider: string }
  | { kind: "error"; provider: string; detail: string };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function cleanAddressPart(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function splitStreetAndHouseNumber(value: string): {
  street: string;
  houseNumber: string;
} {
  const match = value.match(/^(.*\S)\s+(\d+[A-Za-z]?(?:[/-]\d+[A-Za-z]?)?)$/u);

  if (!match) {
    return { street: value, houseNumber: "" };
  }

  return {
    street: match[1].trim(),
    houseNumber: match[2].trim(),
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 4500,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function geocodeWithNominatim(
  street: string,
  city: string,
  postalCode: string,
): Promise<GeocodeResult> {
  const url = new URL("https://nominatim.openstreetmap.org/search");

  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "cz");
  url.searchParams.set("city", city);
  url.searchParams.set("postalcode", postalCode);

  if (street) {
    url.searchParams.set("street", street);
  }

  let response: Response;

  try {
    response = await fetchWithTimeout(url.toString(), {
      headers: {
        Accept: "application/json",
        "Accept-Language": "cs",
        "User-Agent":
          "Rentulo/1.0 (https://rentulo-seven.vercel.app; contact: info@rentulo.cz)",
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn("geocode-pickup: Nominatim request failed", detail);
    return { kind: "error", provider: "nominatim", detail };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = `HTTP ${response.status}${body ? `: ${body.slice(0, 240)}` : ""}`;
    console.warn("geocode-pickup: Nominatim returned an error", detail);
    return { kind: "error", provider: "nominatim", detail };
  }

  try {
    const results = await response.json();
    const first = Array.isArray(results) ? results[0] : null;
    const latitude = Number(first?.lat);
    const longitude = Number(first?.lon);

    if (!first || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return { kind: "not_found", provider: "nominatim" };
    }

    return { kind: "ok", latitude, longitude, provider: "nominatim" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn("geocode-pickup: Nominatim response could not be parsed", detail);
    return { kind: "error", provider: "nominatim", detail };
  }
}

async function geocodeWithPhoton(
  street: string,
  city: string,
  postalCode: string,
): Promise<GeocodeResult> {
  const url = new URL("https://photon.komoot.io/structured");
  const streetParts = splitStreetAndHouseNumber(street);

  if (streetParts.street) {
    url.searchParams.set("street", streetParts.street);
  }

  if (streetParts.houseNumber) {
    url.searchParams.set("housenumber", streetParts.houseNumber);
  }

  url.searchParams.set("city", city);
  url.searchParams.set("postcode", postalCode.replace(/\s+/g, ""));
  url.searchParams.set("countrycode", "CZ");
  url.searchParams.set("limit", "1");

  let response: Response;

  try {
    response = await fetchWithTimeout(url.toString(), {
      headers: {
        Accept: "application/json",
        "Accept-Language": "cs",
        "User-Agent":
          "Rentulo/1.0 (https://rentulo-seven.vercel.app; contact: info@rentulo.cz)",
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn("geocode-pickup: Photon request failed", detail);
    return { kind: "error", provider: "photon", detail };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = `HTTP ${response.status}${body ? `: ${body.slice(0, 240)}` : ""}`;
    console.warn("geocode-pickup: Photon returned an error", detail);
    return { kind: "error", provider: "photon", detail };
  }

  try {
    const data = await response.json();
    const first = Array.isArray(data?.features) ? data.features[0] : null;
    const coordinates = first?.geometry?.coordinates;
    const longitude = Number(Array.isArray(coordinates) ? coordinates[0] : NaN);
    const latitude = Number(Array.isArray(coordinates) ? coordinates[1] : NaN);

    if (!first || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return { kind: "not_found", provider: "photon" };
    }

    return { kind: "ok", latitude, longitude, provider: "photon" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn("geocode-pickup: Photon response could not be parsed", detail);
    return { kind: "error", provider: "photon", detail };
  }
}

denoRuntime.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = denoRuntime.env.get("SUPABASE_URL");
  const anonKey = denoRuntime.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !anonKey) {
    return jsonResponse({ error: "Missing server configuration" }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();

  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let payload: GeocodePayload;

  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const street = cleanAddressPart(payload.street, 180);
  const city = cleanAddressPart(payload.city, 120);
  const postalCode = cleanAddressPart(payload.postalCode, 24);

  if (!city || !postalCode) {
    return jsonResponse({ error: "Incomplete pickup location" }, 400);
  }

  const nominatimResult = await geocodeWithNominatim(street, city, postalCode);
  if (nominatimResult.kind === "ok") {
    return jsonResponse({
      ok: true,
      latitude: nominatimResult.latitude,
      longitude: nominatimResult.longitude,
    });
  }

  // Public geocoding services may occasionally reject shared cloud IPs or be temporarily unavailable.
  // Use Photon as a fallback so creating an offer does not depend on a single provider.
  const photonResult = await geocodeWithPhoton(street, city, postalCode);
  if (photonResult.kind === "ok") {
    return jsonResponse({
      ok: true,
      latitude: photonResult.latitude,
      longitude: photonResult.longitude,
    });
  }

  if (
    nominatimResult.kind === "not_found" &&
    photonResult.kind === "not_found"
  ) {
    return jsonResponse({ ok: false, reason: "not_found" });
  }

  console.error("geocode-pickup: all providers failed", {
    nominatim: nominatimResult,
    photon: photonResult,
  });

  return jsonResponse({ ok: false, reason: "unavailable" }, 503);
});
