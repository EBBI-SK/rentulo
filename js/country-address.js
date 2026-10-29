// ISO 3166-1 countries for residence only; offer markets are enabled separately.
(function () {
  "use strict";
  const COUNTRY_CODES = ["AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ", "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS", "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE", "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM", "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW", "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI", "VN", "VU", "WF", "WS", "XK", "YE", "YT", "ZA", "ZM", "ZW"];
  const COUNTRY_SET = new Set(COUNTRY_CODES);
  const FEATURED = ["CZ", "SK", "PL", "AT", "DE", "HU"];
  const POSTCODE_REQUIRED = new Set(["CZ", "SK", "PL", "AT", "DE", "HU"]);

  function validCountry(value) {
    const code = String(value || "").trim().toUpperCase();
    return COUNTRY_SET.has(code) ? code : "";
  }

  function postalRequired(countryCode) {
    return POSTCODE_REQUIRED.has(validCountry(countryCode));
  }

  function normalizePostal(countryCode, value) {
    const code = validCountry(countryCode);
    const raw = String(value || "").trim().replace(/\s+/g, " ");
    if (!code) return null;
    if (!raw) return postalRequired(code) ? null : "";
    if (code === "CZ" || code === "SK") {
      const digits = raw.replace(/ /g, "");
      return /^\d{5}$/.test(digits) ? digits.slice(0, 3) + " " + digits.slice(3) : null;
    }
    if (code === "PL") {
      const digits = raw.replace(/[ -]/g, "");
      return /^\d{5}$/.test(digits) ? digits.slice(0, 2) + "-" + digits.slice(2) : null;
    }
    if (code === "AT" || code === "HU") return /^\d{4}$/.test(raw) ? raw : null;
    if (code === "DE") return /^\d{5}$/.test(raw) ? raw : null;
    const normalized = raw.toUpperCase();
    return normalized.length <= 20 && /^[\p{L}\p{N}][\p{L}\p{N} -]*$/u.test(normalized)
      ? normalized : null;
  }

  function currentLanguage() {
    const language = typeof window.getRentuloLanguage === "function"
      ? window.getRentuloLanguage() : "cs";
    return ["cs", "sk", "en", "de", "pl"].includes(language) ? language : "cs";
  }

  function countryName(code, language) {
    if (code === "XK") return "Kosovo";
    try {
      return new Intl.DisplayNames([language], { type: "region" }).of(code) || code;
    } catch (_error) {
      return code;
    }
  }

  function renderCountrySelect(select) {
    if (!select) return;
    const saved = select.value;
    const language = currentLanguage();
    const choice = typeof window.rentuloTranslate === "function"
      ? window.rentuloTranslate("country.choose") : "Vyberte zemi";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = choice;
    const otherCountries = COUNTRY_CODES.filter(code => !FEATURED.includes(code));
    const collator = new Intl.Collator(language, { sensitivity: "base" });
    otherCountries.sort((a,b) => collator.compare(countryName(a, language), countryName(b, language)));
    select.replaceChildren(placeholder);
    const append = code => {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = countryName(code, language);
      select.appendChild(option);
    };
    FEATURED.forEach(append);
    const divider = document.createElement("option");
    divider.disabled = true;
    divider.textContent = "──────────";
    select.appendChild(divider);
    otherCountries.forEach(append);
    select.value = validCountry(saved);
  }

  function syncPostalInput(select, input) {
    if (!select || !input) return;
    const code = validCountry(select.value);
    input.required = !code || postalRequired(code);
    input.maxLength = 20;
    input.inputMode = ["CZ", "SK", "PL", "AT", "DE", "HU"].includes(code) ? "numeric" : "text";
    input.placeholder = (code === "CZ" || code === "SK") ? "110 00"
      : code === "PL" ? "00-001" : code === "AT" || code === "HU" ? "1010"
      : code === "DE" ? "10115" : "";
  }

  function setupSelect(selectId, postalId) {
    const select = document.getElementById(selectId);
    const postal = document.getElementById(postalId);
    if (!select) return;
    renderCountrySelect(select);
    syncPostalInput(select, postal);
    select.addEventListener("change", function () {
      if (postal) postal.value = "";
      syncPostalInput(select, postal);
    });
    document.addEventListener("rentuloLanguageChanged", () => {
      renderCountrySelect(select);
      syncPostalInput(select, postal);
    });
  }

  window.rentuloCountries = {
    validCountry, postalRequired, normalizePostal, renderCountrySelect,
    syncPostalInput, setupSelect
  };
})();
