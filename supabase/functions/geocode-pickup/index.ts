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

// Use the current site for TEST and the future site for PROD. Never identify
// a geocoding request using the retired Vercel domain or a legacy email.
function geocodingUserAgent(supabaseUrl: string | undefined): string | null {
  const projectUrl = (supabaseUrl || "").trim().replace(/\/+$/, "");
  const siteUrl =
    projectUrl === "https://vspposovhdgvbeukoivh.supabase.co" ? "https://rentulo.eu" :
    projectUrl === "https://tfvgxrdjrpicgtvovehl.supabase.co" ? "https://rentulo.com" : null;
  return siteUrl ? `Rentulo/1.0 (${siteUrl}; contact: rentulo@rentulo.com)` : null;
}

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

// All address data is sent server-to-server to Geoapify's EU-focused endpoint.
async function geocodeWithGeoapify(
  street: string,
  city: string,
  postalCode: string,
  userAgent: string,
  apiKey: string,
): Promise<GeocodeResult> {
  const url = new URL("https://api-eu.geoapify.com/v1/geocode/search");
  const parts = splitStreetAndHouseNumber(street);
  url.searchParams.set("format", "json");
  url.searchParams.set("filter", "countrycode:cz");
  url.searchParams.set("lang", "cs");
  url.searchParams.set("limit", "1");
  if (parts.street) url.searchParams.set("street", parts.street);
  if (parts.houseNumber) url.searchParams.set("housenumber", parts.houseNumber);
  url.searchParams.set("city", city);
  url.searchParams.set("postcode", postalCode.replace(/\s+/g, ""));
  url.searchParams.set("apiKey", apiKey);

  let response: Response;
  try {
    response = await fetchWithTimeout(url.toString(), {
      headers: { Accept: "application/json", "User-Agent": userAgent },
    });
  } catch {
    // Never log the address or the URL, which includes the private API key.
    console.warn("geocode-pickup: Geoapify unavailable");
    return { kind: "error", provider: "geoapify", detail: "network" };
  }

  if (!response.ok) {
    console.warn("geocode-pickup: Geoapify HTTP", response.status);
    return { kind: "error", provider: "geoapify", detail: `HTTP ${response.status}` };
  }

  try {
    const data = await response.json();
    const first = Array.isArray(data?.results) ? data.results[0] : null;
    const latitude = first?.lat;
    const longitude = first?.lon;
    if (!first || typeof latitude !== "number" || typeof longitude !== "number" ||
        !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        String(first.country_code || "").toLowerCase() !== "cz") {
      return { kind: "not_found", provider: "geoapify" };
    }
    return { kind: "ok", latitude, longitude, provider: "geoapify" };
  } catch {
    return { kind: "error", provider: "geoapify", detail: "invalid_response" };
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
  const userAgent = geocodingUserAgent(supabaseUrl);
  const apiKey = (denoRuntime.env.get("GEOAPIFY_API_KEY") || "").trim();

  if (!supabaseUrl || !anonKey || !userAgent) {
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

  if (!apiKey) {
    return jsonResponse({ ok: false, reason: "unavailable" }, 503);
  }

  const geocode = await geocodeWithGeoapify(street, city, postalCode, userAgent, apiKey);
  if (geocode.kind === "ok") {
    return jsonResponse({ ok: true, latitude: geocode.latitude, longitude: geocode.longitude });
  }
  if (geocode.kind === "not_found") {
    return jsonResponse({ ok: false, reason: "not_found" });
  }
  return jsonResponse({ ok: false, reason: "unavailable" }, 503);
});
