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

// Determine the allowed browser origins from the actual Supabase project, not
// from a client-controlled request header. An unknown project is denied.
function allowedOriginsForProject(supabaseUrl: string | undefined): Set<string> {
  const projectUrl = (supabaseUrl || "").trim().replace(/\/+$/, "");
  if (projectUrl === "https://vspposovhdgvbeukoivh.supabase.co") {
    return new Set([
      "https://rentulo.eu",
      "https://www.rentulo.eu",
      "http://localhost:3000",
      "http://localhost:5500",
      "http://127.0.0.1:5500"
    ]);
  }
  if (projectUrl === "https://tfvgxrdjrpicgtvovehl.supabase.co") {
    return new Set(["https://rentulo.com", "https://www.rentulo.com"]);
  }
  return new Set();
}

const ALLOWED_ORIGINS = allowedOriginsForProject(denoRuntime.env.get("SUPABASE_URL"));
const GEOCODING_USER_AGENT = ALLOWED_ORIGINS.has("https://rentulo.com")
  ? "Rentulo/1.0 (https://rentulo.com; contact: rentulo@rentulo.com)"
  : "Rentulo/1.0 (https://rentulo.eu; contact: rentulo@rentulo.com)";

// Server-only API key; never send it back to browsers or log the query URL.
const GEOAPIFY_API_KEY = (denoRuntime.env.get("GEOAPIFY_API_KEY") || "").trim();
const GEOAPIFY_EU_URL = "https://api-eu.geoapify.com";

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 120;
const cache = new Map<string, CacheEntry>();

function getCorsHeaders(origin: string | null): Record<string, string> {
  return {
    ...(origin && ALLOWED_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
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

  // A number elsewhere in a street name (e.g. "17. listopadu") is not
  // the house number. A full existing suffix such as "846/1" is, however.
  const suffix = streetName.match(/\s+(\d+(?:\/\d+)?[a-zA-Z]?)$/);
  if (!houseNumber || (suffix && (
    houseNumberMatches(suffix[1], houseNumber) || houseNumberMatches(houseNumber, suffix[1])
  ))) {
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

function cityMatches(candidate: unknown, required: unknown, allowPrefix = false): boolean {
  const normalizedCandidate = normalizeComparableText(candidate);
  const normalizedRequired = normalizeComparableText(required);

  if (!normalizedCandidate || !normalizedRequired) {
    return false;
  }

  return (
    normalizedCandidate === normalizedRequired ||
    normalizedCandidate.startsWith(`${normalizedRequired} `) ||
    normalizedCandidate.endsWith(` ${normalizedRequired}`) ||
    normalizedRequired.startsWith(`${normalizedCandidate} `) ||
    (allowPrefix && normalizedRequired.length >= 3 && normalizedCandidate.startsWith(normalizedRequired))
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
  cityMayBePartial: boolean;
} {
  const parts = query
    .split(",")
    .map((part) => cleanText(part, 160))
    .filter(Boolean);

  let streetQuery = parts.shift() || query;
  let city = "";
  let postalCode = "";
  let cityMayBePartial = false;

  // People also type "Václavské náměstí 1 Praha" without a comma, or
  // "Vaclavske nam. 1 pra" while still entering the city.
  const combined = streetQuery.match(/^(.+?)\s+(\d+(?:\/\d+)?[a-zA-Z]?)\s+(.+)$/);
  if (combined) {
    const possibleCity = cleanText(combined[3], 100);
    if (possibleCity.length >= 3 && /^[\p{L}\p{M}][\p{L}\p{M}.\-\s]*(?:\s+\d{1,2})?$/u.test(possibleCity)) {
      streetQuery = `${cleanText(combined[1], 140)} ${combined[2]}`;
      city = possibleCity;
      cityMayBePartial = true;
    }
  }

  for (const part of parts) {
    const digits = normalizePostalDigits(part);
    if (!postalCode && digits.length === 5 && /^[\d\s]+$/.test(part)) {
      postalCode = normalizePostalCode(part);
      continue;
    }

    const cityAndPostal = part.match(/^(.+?)\s+(\d{3}\s?\d{2})$/);
    if (cityAndPostal) {
      city = cleanText([city, cityAndPostal[1]].filter(Boolean).join(" "), 100);
      postalCode = normalizePostalCode(cityAndPostal[2]);
      continue;
    }

    city = cleanText([city, part].filter(Boolean).join(" "), 100);
    cityMayBePartial = false;
  }

  return { streetQuery, city, postalCode, cityMayBePartial };
}

function normalizeStreetForMatch(value: unknown): string {
  return normalizeComparableText(value)
    .replace(/\bnam\.?(?=\s|$)/g, "namesti")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Once a house number is supplied, the street is specific enough to reject
// fuzzy Geoapify matches from other streets. Allow the last typed street word to
// be incomplete (e.g. "Vacl" or "nam"), without matching a different street.
function matchesRequestedStreet(candidate: unknown, requested: unknown): boolean {
  const candidateWords = normalizeStreetForMatch(candidate).split(" ").filter(Boolean);
  const requestedWords = normalizeStreetForMatch(requested).split(" ").filter(Boolean);

  if (!candidateWords.length || !requestedWords.length ||
      requestedWords.length > candidateWords.length) {
    return false;
  }

  return requestedWords.every((word, index) =>
    index === requestedWords.length - 1
      ? candidateWords[index].startsWith(word)
      : candidateWords[index] === word
  );
}

function suggestionScore(
  suggestion: AddressSuggestion,
  requestedStreet: string,
  requestedHouseNumber: string,
  requestedCity: string
): number {
  const parsed = parseStreetAndHouseNumber(suggestion.street);
  const candidateStreet = normalizeStreetForMatch(parsed ? parsed.street : suggestion.street);
  const expectedStreet = normalizeStreetForMatch(requestedStreet);
  let score = 0;

  if (expectedStreet && candidateStreet === expectedStreet) score += 60;
  else if (expectedStreet && (candidateStreet.startsWith(expectedStreet) || expectedStreet.startsWith(candidateStreet))) score += 20;

  if (requestedHouseNumber && parsed) {
    if (normalizeHouseNumber(parsed.houseNumber) === normalizeHouseNumber(requestedHouseNumber)) score += 50;
    else if (houseNumberMatches(parsed.houseNumber, requestedHouseNumber)) score += 10;
  }

  if (requestedCity && normalizeComparableText(suggestion.city) === normalizeComparableText(requestedCity)) score += 10;
  return score;
}

function samePhysicalAddress(a: AddressSuggestion, b: AddressSuggestion): boolean {
  return normalizeStreetForMatch(a.street) === normalizeStreetForMatch(b.street) &&
    normalizePostalDigits(a.postalCode) === normalizePostalDigits(b.postalCode) &&
    (cityMatches(a.city, b.city) || cityMatches(b.city, a.city)) &&
    Math.abs(a.latitude - b.latitude) <= 0.0008 &&
    Math.abs(a.longitude - b.longitude) <= 0.0012;
}

function mapGeoapifyFeatures(
  data: unknown,
  requiredHouseNumber = "",
  requiredCity = "",
  requiredPostalCode = "",
  requestedStreet = "",
  allowCityPrefix = false
): AddressSuggestion[] {
  const items = Array.isArray((data as { results?: unknown[] })?.results)
    ? (data as { results: unknown[] }).results
    : [];
  const results: AddressSuggestion[] = [];

  for (const item of items) {
    const properties = item && typeof item === "object"
      ? item as Record<string, unknown>
      : {};
    if (String(properties.country_code || "").toLowerCase() !== "cz") continue;

    const propertyHouseNumber = cleanText(properties.housenumber, 24);

    if (requiredHouseNumber && !houseNumberMatches(propertyHouseNumber, requiredHouseNumber)) {
      continue;
    }

    const street = buildStreet(properties);
    const city = buildCity(properties);
    const postalCode = normalizePostalCode(properties.postcode);
    const longitude = Number(properties.lon);
    const latitude = Number(properties.lat);

    if (
      !street ||
      !city ||
      !postalCode ||
      typeof properties.lat !== "number" ||
      typeof properties.lon !== "number" ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      continue;
    }

    if (requiredCity && !cityMatches(city, requiredCity, allowCityPrefix)) {
      continue;
    }

    if (requiredPostalCode && !postalCodeMatches(postalCode, requiredPostalCode)) {
      continue;
    }

    if (requiredHouseNumber && requestedStreet) {
      const candidate = parseStreetAndHouseNumber(street);
      const candidateName = candidate ? candidate.street : street;
      if (!matchesRequestedStreet(candidateName, requestedStreet)) {
        continue;
      }
    }

    results.push({
      street,
      city,
      postalCode,
      latitude,
      longitude,
      label: `${street}, ${city}, ${postalCode}`
    });
  }

  // Rank exact street + house first, then remove duplicate Geoapify records
  // (e.g. the same Prague address with "Praha" and "Praha 1" locality labels).
  results.sort((a, b) =>
    suggestionScore(b, requestedStreet, requiredHouseNumber, requiredCity) -
    suggestionScore(a, requestedStreet, requiredHouseNumber, requiredCity)
  );

  const suggestions: AddressSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of results) {
    const dedupeKey = [item.street, item.city, item.postalCode]
      .map((part) => normalizeComparableText(part)).join("|");
    if (seen.has(dedupeKey) || suggestions.some((other) => samePhysicalAddress(other, item))) {
      continue;
    }
    seen.add(dedupeKey);
    suggestions.push(item);
    if (suggestions.length >= 5) break;
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

async function fetchWithTimeout(url: URL, timeoutMs = 4500): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Geoapify requires the key as an API parameter. Never expose it to the client.
    url.searchParams.set("apiKey", GEOAPIFY_API_KEY);
    return await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": GEOCODING_USER_AGENT
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGeoapifySuggestions(
  url: URL,
  requiredHouseNumber = "",
  requiredCity = "",
  requiredPostalCode = "",
  requestedStreet = "",
  allowCityPrefix = false
): Promise<AddressSuggestion[]> {
  try {
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      console.warn("address-suggestions: Geoapify HTTP", response.status);
      return [];
    }

    const data = await response.json();
    return mapGeoapifyFeatures(
      data,
      requiredHouseNumber,
      requiredCity,
      requiredPostalCode,
      requestedStreet,
      allowCityPrefix
    );
  } catch (error) {
    // Do not risk logging the query URL (personal address + server API key).
    console.warn("address-suggestions: Geoapify request failed");
    return [];
  }
}

function createStructuredUrl(
  street: string,
  houseNumber: string,
  city: string,
  postalCode: string
): URL {
  const url = new URL(`${GEOAPIFY_EU_URL}/v1/geocode/search`);
  url.searchParams.set("format", "json");
  url.searchParams.set("lang", "cs");
  url.searchParams.set("filter", "countrycode:cz");
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
  return url;
}

function createForwardUrl(query: string): URL {
  const url = new URL(`${GEOAPIFY_EU_URL}/v1/geocode/autocomplete`);
  url.searchParams.set("text", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("lang", "cs");
  url.searchParams.set("filter", "countrycode:cz");
  url.searchParams.set("limit", "12");
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
  if (!GEOAPIFY_API_KEY) {
    return jsonResponse({ error: "Address search unavailable" }, 503, origin);
  }

  const parsedQuery = parseAddressQuery(query);
  const streetQuery = parsedQuery.streetQuery;
  const city = cleanText(payload.city, 100) || parsedQuery.city;
  const postalCode = normalizePostalCode(payload.postalCode) || parsedQuery.postalCode;
  const allowCityPrefix = !cleanText(payload.city, 100) && parsedQuery.cityMayBePartial;
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

    suggestions = await fetchGeoapifySuggestions(
      structuredUrl,
      houseNumber,
      city,
      postalCode,
      street,
      allowCityPrefix
    );

    if (suggestions.length === 0 && postalCode) {
      const cityOnlyUrl = createStructuredUrl(
        street,
        houseNumber,
        city,
        ""
      );

      suggestions = await fetchGeoapifySuggestions(
        cityOnlyUrl,
        houseNumber,
        city,
        "",
        street,
        allowCityPrefix
      );
    }
  }

  if (suggestions.length === 0) {
    const forwardQuery = [streetQuery, city, postalCode]
      .filter(Boolean)
      .join(", ");
    const forwardUrl = createForwardUrl(forwardQuery);

    suggestions = await fetchGeoapifySuggestions(
      forwardUrl,
      houseNumber,
      city,
      postalCode,
      street,
      allowCityPrefix
    );
  }

  if (suggestions.length === 0 && postalCode) {
    const forwardQuery = [streetQuery, city]
      .filter(Boolean)
      .join(", ");
    const forwardUrl = createForwardUrl(forwardQuery);

    suggestions = await fetchGeoapifySuggestions(
      forwardUrl,
      houseNumber,
      city,
      "",
      street,
      allowCityPrefix
    );
  }

  // A short city fragment ("pra") may not be accepted by Geoapify's
  // structured city parameter. Search the street/house more broadly as a
  // last resort, but STILL filter each result against the typed city.
  if (suggestions.length === 0 && allowCityPrefix && city && houseNumber) {
    const streetOnlyUrl = createStructuredUrl(street, houseNumber, "", postalCode);
    suggestions = await fetchGeoapifySuggestions(
      streetOnlyUrl, houseNumber, city, postalCode, street, true
    );
  }

  if (suggestions.length === 0 && houseNumber && !city && !postalCode) {
    const structuredUrl = createStructuredUrl(street, houseNumber, "", "");
    suggestions = await fetchGeoapifySuggestions(
      structuredUrl, houseNumber, "", "", street, allowCityPrefix
    );
  }

  writeCache(cacheKey, suggestions);
  return jsonResponse({ suggestions }, 200, origin);
});
