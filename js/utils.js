"use strict";

function meetsRentuloPasswordRequirements(password) {
  const value = String(password || "");
  const allowedSymbols = "!@#$%^&*()_+-=[]{};'\\\":|<>?,./`~";

  return (
    value.length >= 8 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /[0-9]/.test(value) &&
    Array.prototype.some.call(value, function (character) {
      return allowedSymbols.indexOf(character) !== -1;
    })
  );
}

function isRentuloWeakPasswordError(error) {
  const code = String((error && (error.code || error.error_code)) || "").toLowerCase();
  const message = String((error && error.message) || "").toLowerCase();

  return (
    code === "weak_password" ||
    message.includes("weak password") ||
    message.includes("password should contain") ||
    message.includes("password must contain")
  );
}

function getSupabaseClient() {
  if (window.rentuloSupabase) {
    return window.rentuloSupabase;
  }

  if (typeof rentuloSupabase !== "undefined") {
    return rentuloSupabase;
  }

  return null;
}

async function getCurrentSupabaseUser() {
  if (typeof navGetVerifiedUser === "function") {
    return await navGetVerifiedUser();
  }

  const supabaseClient = getSupabaseClient();

  if (!supabaseClient) {
    return null;
  }

  const { data, error } = await supabaseClient.auth.getUser();

  if (error || !data || !data.user) {
    return null;
  }

  return data.user;
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeText(value) {
  return String(value === undefined || value === null ? "" : value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// Czech V1 addresses are entered manually. Check the PSČ format only;
// this does not claim the street or address physically exists.
function formatRentuloCzechPostalCode(value) {
  const match = String(value === null || value === undefined ? "" : value)
    .trim().match(/^(\d{3}) ?(\d{2})$/);
  return match ? match[1] + " " + match[2] : null;
}
