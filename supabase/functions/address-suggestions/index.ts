type RentuloDenoRuntime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: {
    get(name: string): string | undefined;
  };
};

const denoRuntime = (
  globalThis as typeof globalThis & { Deno: RentuloDenoRuntime }
).Deno;

type AddressSuggestionPayload = {
  query?: string;
  city?: string;
  postalCode?: string;
  language?: string;
};

type AddressSuggestion = {
  street: string;
  city: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  label: string;
};

type CacheEntry = {
  expiresAt: number;
  suggestions: AddressSuggestion[];
};

const ALLOWED_ORIGINS = new Set([
  "https://rentulo-seven.vercel.app",
  "https://rentulo.eu",
  "https://www.rentulo.eu",
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
]);

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 120;
const cache = new Map<string, CacheEntry>();

function getCorsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://rentulo-seven.vercel.app";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
}

function jsonResponse(
  body: unknown,
  status: number,
  origin: string | null
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeLanguage(value: unknown): string {
  const language = cleanText(value, 5).toLowerCase();
  return ["cs", "sk", "en", "de", "pl"].includes(language) ? language : "cs";
}

function normalizePostalCode(value: unknown): string {
  const raw = cleanText(value, 16);
  const digits = raw.replace(/\D/g, "");

  if (digits.length === 5) {
    return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  }

  return raw;
}

function normalizeComparableText(value: unknown): string {
  return cleanText(value, 160)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizePostalDigits(value: unknown): string {
  return cleanText(value, 16).replace(/\D/g, "");
}

function buildStreet(properties: Record<string, unknown>): string {
  const streetName = cleanText(properties.street || properties.name, 140);
  const houseNumber = cleanText(properties.housenumber, 24);

  if (!streetName) {
    return "";
  }

  if (!houseNumber || streetName.includes(houseNumber)) {
    return streetName;
  }

  return `${streetName} ${houseNumber}`;
}

function buildCity(properties: Record<string, unknown>): string {
  return cleanText(
    properties.city ||
      properties.town ||
      properties.village ||
      properties.municipality ||
      properties.locality,
    100
  );
}

function normalizeHouseNumber(value: unknown): string {
  return cleanText(value, 24).replace(/\s+/g, "").toLowerCase();
}

function houseNumberMatches(candidate: unknown, required: unknown): boolean {
  const normalizedCandidate = normalizeHouseNumber(candidate);
  const normalizedRequired = normalizeHouseNumber(required);

  if (!normalizedCandidate || !normalizedRequired) {
    return false;
  }

  if (normalizedCandidate === normalizedRequired) {
    return true;
  }

  return normalizedCandidate.split("/").includes(normalizedRequired);
}

function cityMatches(candidate: unknown, required: unknown): boolean {
  const normalizedCandidate = normalizeComparableText(candidate);
  const normalizedRequired = normalizeComparableText(required);

  if (!normalizedCandidate || !normalizedRequired) {
    return false;
  }

  return (
    normalizedCandidate === normalizedRequired ||
    normalizedCandidate.startsWith(`${normalizedRequired} `) ||
    normalizedCandidate.endsWith(` ${normalizedRequired}`) ||
    normalizedRequired.startsWith(`${normalizedCandidate} `)
  );
}

function postalCodeMatches(candidate: unknown, required: unknown): boolean {
  const normalizedCandidate = normalizePostalDigits(candidate);
  const normalizedRequired = normalizePostalDigits(required);

  return Boolean(
    normalizedCandidate &&
    normalizedRequired &&
    normalizedCandidate === normalizedRequired
  );
}

function parseStreetAndHouseNumber(query: string): { street: string; houseNumber: string } | null {
  const match = query.match(/^(.+?)\s+(\d+(?:\/\d+)?[a-zA-Z]?)$/);

  if (!match) {
    return null;
  }

  const street = cleanText(match[1], 140);
  const houseNumber = cleanText(match[2], 24);

  if (!street || !houseNumber) {
    return null;
  }

  return { street, houseNumber };
}

function parseAddressQuery(query: string): {
  streetQuery: string;
  city: string;
  postalCode: string;
} {
  const parts = query
    .split(",")
    .map((part) => cleanText(part, 160))
    .filter(Boolean);

  if (parts.length <= 1) {
    return {
      streetQuery: query,
      city: "",
      postalCode: ""
    };
  }

  const streetQuery = parts.shift() || query;
  let city = "";
  let postalCode = "";

  for (const part of parts) {
    const digits = normalizePostalDigits(part);

    if (!postalCode && digits.length === 5 && /^[\d\s]+$/.test(part)) {
      postalCode = normalizePostalCode(part);
      continue;
    }

    city = cleanText([city, part].filter(Boolean).join(" "), 100);
  }

  return {
    streetQuery,
    city,
    postalCode
  };
}

function mapPhotonFeatures(
  data: unknown,
  requiredHouseNumber = "",
  requiredCity = "",
  requiredPostalCode = ""
): AddressSuggestion[] {
  const features = Array.isArray((data as { features?: unknown[] })?.features)
    ? (data as { features: unknown[] }).features
    : [];
  const suggestions: AddressSuggestion[] = [];
  const seen = new Set<string>();

  for (const feature of features) {
    const properties =
      feature && typeof feature === "object" &&
      (feature as { properties?: unknown }).properties &&
      typeof (feature as { properties: unknown }).properties === "object"
        ? ((feature as { properties: Record<string, unknown> }).properties)
        : {};

    const propertyHouseNumber = cleanText(properties.housenumber, 24);

    if (requiredHouseNumber && !houseNumberMatches(propertyHouseNumber, requiredHouseNumber)) {
      continue;
    }

    const street = buildStreet(properties);
    const city = buildCity(properties);
    const postalCode = normalizePostalCode(properties.postcode);
    const geometry =
      feature && typeof feature === "object"
        ? (feature as { geometry?: { coordinates?: unknown } }).geometry
        : undefined;
    const coordinates = Array.isArray(geometry?.coordinates)
      ? geometry.coordinates
      : [];
    const longitude = Number(coordinates[0]);
    const latitude = Number(coordinates[1]);

    if (
      !street ||
      !city ||
      !postalCode ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      continue;
    }

    if (requiredCity && !cityMatches(city, requiredCity)) {
      continue;
    }

    if (requiredPostalCode && !postalCodeMatches(postalCode, requiredPostalCode)) {
      continue;
    }

    const dedupeKey = `${street}|${city}|${postalCode}`.toLocaleLowerCase("cs-CZ");

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    suggestions.push({
      street,
      city,
      postalCode,
      latitude,
      longitude,
      label: `${street}, ${city}, ${postalCode}`
    });

    if (suggestions.length >= 5) {
      break;
    }
  }

  return suggestions;
}

function readCache(key: string): AddressSuggestion[] | null {
  const entry = cache.get(key);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.suggestions;
}

function writeCache(key: string, suggestions: AddressSuggestion[]): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }

  cache.set(key, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    suggestions
  });
}

async function fetchWithTimeout(url: string, timeoutMs = 4500): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "Rentulo/1.0 (https://rentulo.eu)"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPhotonSuggestions(
  url: URL,
  requiredHouseNumber = "",
  requiredCity = "",
  requiredPostalCode = ""
): Promise<AddressSuggestion[]> {
  try {
    const response = await fetchWithTimeout(url.toString());

    if (!response.ok) {
      console.warn("address-suggestions: Photon returned", response.status);
      return [];
    }

    const data = await response.json();
    return mapPhotonFeatures(
      data,
      requiredHouseNumber,
      requiredCity,
      requiredPostalCode
    );
  } catch (error) {
    console.warn(
      "address-suggestions: Photon request failed",
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
}

function createStructuredUrl(
  street: string,
  houseNumber: string,
  city: string,
  postalCode: string
): URL {
  const url = new URL("https://photon.komoot.io/structured");
  url.searchParams.set("street", street);

  if (houseNumber) {
    url.searchParams.set("housenumber", houseNumber);
  }

  if (city) {
    url.searchParams.set("city", city);
  }

  if (postalCode) {
    url.searchParams.set("postcode", postalCode);
  }

  url.searchParams.set("limit", "12");
  url.searchParams.set("countrycode", "CZ");

  if (houseNumber) {
    url.searchParams.append("layer", "house");
  } else {
    url.searchParams.append("layer", "house");
    url.searchParams.append("layer", "street");
  }

  return url;
}

function createForwardUrl(query: string): URL {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "12");
  url.searchParams.set("countrycode", "CZ");
  url.searchParams.append("layer", "house");
  url.searchParams.append("layer", "street");
  return url;
}

denoRuntime.serve(async (req) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return jsonResponse({ error: "Origin not allowed" }, 403, origin);
    }

    return new Response("ok", {
      headers: getCorsHeaders(origin)
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, origin);
  }

  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse({ error: "Origin not allowed" }, 403, origin);
  }

  let payload: AddressSuggestionPayload;

  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, origin);
  }

  const query = cleanText(payload.query, 160);
  const language = normalizeLanguage(payload.language);

  if (query.length < 3) {
    return jsonResponse({ suggestions: [] }, 200, origin);
  }

  const parsedQuery = parseAddressQuery(query);
  const streetQuery = parsedQuery.streetQuery;
  const city = cleanText(payload.city, 100) || parsedQuery.city;
  const postalCode = normalizePostalCode(payload.postalCode) || parsedQuery.postalCode;
  const parsedAddress = parseStreetAndHouseNumber(streetQuery);
  const street = parsedAddress ? parsedAddress.street : streetQuery;
  const houseNumber = parsedAddress ? parsedAddress.houseNumber : "";
  const cacheKey = [
    language,
    streetQuery.toLocaleLowerCase("cs-CZ"),
    city.toLocaleLowerCase("cs-CZ"),
    normalizePostalDigits(postalCode)
  ].join("|");
  const cached = readCache(cacheKey);

  if (cached) {
    return jsonResponse({ suggestions: cached }, 200, origin);
  }

  let suggestions: AddressSuggestion[] = [];

  if (city || postalCode) {
    const structuredUrl = createStructuredUrl(
      street,
      houseNumber,
      city,
      postalCode
    );

    suggestions = await fetchPhotonSuggestions(
      structuredUrl,
      houseNumber,
      city,
      postalCode
    );

    if (suggestions.length === 0 && postalCode) {
      const cityOnlyUrl = createStructuredUrl(
        street,
        houseNumber,
        city,
        ""
      );

      suggestions = await fetchPhotonSuggestions(
        cityOnlyUrl,
        houseNumber,
        city,
        ""
      );
    }
  }

  if (suggestions.length === 0) {
    const forwardQuery = [streetQuery, city, postalCode]
      .filter(Boolean)
      .join(", ");
    const forwardUrl = createForwardUrl(forwardQuery);

    suggestions = await fetchPhotonSuggestions(
      forwardUrl,
      houseNumber,
      city,
      postalCode
    );
  }

  if (suggestions.length === 0 && postalCode) {
    const forwardQuery = [streetQuery, city]
      .filter(Boolean)
      .join(", ");
    const forwardUrl = createForwardUrl(forwardQuery);

    suggestions = await fetchPhotonSuggestions(
      forwardUrl,
      houseNumber,
      city,
      ""
    );
  }

  if (suggestions.length === 0 && houseNumber && !city && !postalCode) {
    const structuredUrl = createStructuredUrl(
      street,
      houseNumber,
      "",
      ""
    );

    suggestions = await fetchPhotonSuggestions(
      structuredUrl,
      houseNumber,
      "",
      ""
    );
  }

  writeCache(cacheKey, suggestions);
  return jsonResponse({ suggestions }, 200, origin);
});
