const ADDRESS_SUGGESTION_MIN_LENGTH = 3;
const ADDRESS_SUGGESTION_DELAY_MS = 450;

let registrationSubmitInProgress = false;
let registrationErrorState = null;
let registrationAddressSuggestions = [];
let registrationAddressActiveIndex = -1;
let registrationAddressRequestId = 0;
let registrationAddressTimer = null;

function registrationT(key, fallback) {
  if (typeof window.rentuloTranslate === "function") {
    return window.rentuloTranslate(key);
  }

  return fallback || key;
}


function registrationNormalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function registrationIsValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function registrationRenderError() {
  const errorBox = document.getElementById("registrationError");

  if (!errorBox) {
    return;
  }

  if (!registrationErrorState) {
    errorBox.textContent = "";
    errorBox.classList.remove("active");
    return;
  }

  errorBox.textContent = registrationT(
    registrationErrorState.key,
    registrationErrorState.fallback
  );
  errorBox.classList.add("active");
}

function registrationShowError(key, fallback) {
  registrationErrorState = {
    key: key,
    fallback: fallback || key
  };
  registrationRenderError();
}

function registrationHideError() {
  registrationErrorState = null;
  registrationRenderError();
}

function registrationClearErrors() {
  const fields = document.querySelectorAll("#registrationForm input");

  fields.forEach(function (field) {
    field.classList.remove("input-error");
    field.removeAttribute("aria-invalid");
  });
}

function registrationMarkError(input) {
  if (input) {
    input.classList.add("input-error");
    input.setAttribute("aria-invalid", "true");
  }
}

function registrationFocusFirstError() {
  const firstInvalidField = document.querySelector(
    "#registrationForm input[aria-invalid='true']"
  );

  if (firstInvalidField && typeof firstInvalidField.focus === "function") {
    firstInvalidField.focus();
  }
}

function registrationSetButtonState(isSubmitting) {
  const submitButton = document.getElementById("registrationSubmitButton");

  if (!submitButton) {
    return;
  }

  submitButton.disabled = Boolean(isSubmitting);
  submitButton.setAttribute(
    "aria-busy",
    isSubmitting ? "true" : "false"
  );
  submitButton.textContent = registrationT(
    isSubmitting ? "registration.submitting" : "registration.submit",
    isSubmitting ? "Vytvářím účet..." : "Vytvořit účet"
  );
}

function registrationIsEmpty(value) {
  return String(value || "").trim() === "";
}

function registrationCloseAddressSuggestions() {
  const streetInput = document.getElementById("street");
  const suggestionsBox = document.getElementById("addressSuggestions");

  registrationAddressRequestId += 1;

  if (registrationAddressTimer) {
    window.clearTimeout(registrationAddressTimer);
    registrationAddressTimer = null;
  }

  registrationAddressSuggestions = [];
  registrationAddressActiveIndex = -1;

  if (suggestionsBox) {
    suggestionsBox.innerHTML = "";
    suggestionsBox.hidden = true;
  }

  if (streetInput) {
    streetInput.setAttribute("aria-expanded", "false");
    streetInput.removeAttribute("aria-activedescendant");
  }
}

function registrationRenderAddressSuggestions(items) {
  const streetInput = document.getElementById("street");
  const suggestionsBox = document.getElementById("addressSuggestions");

  if (!streetInput || !suggestionsBox) {
    return;
  }

  registrationAddressSuggestions = Array.isArray(items) ? items.slice(0, 5) : [];
  registrationAddressActiveIndex = -1;

  if (!registrationAddressSuggestions.length) {
    registrationCloseAddressSuggestions();
    return;
  }

  suggestionsBox.innerHTML = registrationAddressSuggestions
    .map(function (item, index) {
      const main = String(item.street || "").trim();
      const meta = [item.city, item.postalCode]
        .map(function (part) { return String(part || "").trim(); })
        .filter(Boolean)
        .join(", ");

      return `
        <button
          type="button"
          class="address-suggestion"
          id="addressSuggestion${index}"
          role="option"
          data-address-index="${index}"
          aria-selected="false"
        >
          <span class="address-suggestion-main">${escapeHtml(main)}</span>
          <span class="address-suggestion-meta">${escapeHtml(meta)}</span>
        </button>
      `;
    })
    .join("") +
    '<div class="address-attribution">© OpenStreetMap contributors</div>';

  suggestionsBox.hidden = false;
  streetInput.setAttribute("aria-expanded", "true");
}

function registrationSetAddressActiveIndex(nextIndex) {
  const streetInput = document.getElementById("street");
  const suggestionButtons = Array.from(
    document.querySelectorAll("#addressSuggestions .address-suggestion")
  );

  if (!streetInput || !suggestionButtons.length) {
    return;
  }

  const maxIndex = suggestionButtons.length - 1;
  let normalizedIndex = nextIndex;

  if (normalizedIndex < 0) {
    normalizedIndex = maxIndex;
  }

  if (normalizedIndex > maxIndex) {
    normalizedIndex = 0;
  }

  registrationAddressActiveIndex = normalizedIndex;

  suggestionButtons.forEach(function (button, index) {
    const isActive = index === normalizedIndex;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  const activeButton = suggestionButtons[normalizedIndex];
  if (activeButton) {
    streetInput.setAttribute("aria-activedescendant", activeButton.id);
    activeButton.scrollIntoView({ block: "nearest" });
  }
}

function registrationSelectAddress(index) {
  const item = registrationAddressSuggestions[index];
  const streetInput = document.getElementById("street");
  const cityInput = document.getElementById("city");
  const postalCodeInput = document.getElementById("postalCode");

  if (!item || !streetInput || !cityInput || !postalCodeInput) {
    return;
  }

  streetInput.value = String(item.street || "").trim();
  cityInput.value = String(item.city || "").trim();
  postalCodeInput.value = String(item.postalCode || "").trim();
  [streetInput, cityInput, postalCodeInput].forEach(function (field) {
    field.classList.remove("input-error");
    field.removeAttribute("aria-invalid");
  });

  registrationCloseAddressSuggestions();
}

async function registrationLoadAddressSuggestions(query, requestId) {
  const supabaseClient = getSupabaseClient();

  if (!supabaseClient) {
    return;
  }

  try {
    const language =
      typeof window.getRentuloLanguage === "function"
        ? window.getRentuloLanguage()
        : "cs";

    const { data, error } = await supabaseClient.functions.invoke(
      "address-suggestions",
      {
        body: {
          query: query,
          language: language
        }
      }
    );

    if (requestId !== registrationAddressRequestId) {
      return;
    }

    if (error || !data || !Array.isArray(data.suggestions)) {
      registrationCloseAddressSuggestions();
      return;
    }

    registrationRenderAddressSuggestions(data.suggestions);
  } catch (_error) {
    if (requestId === registrationAddressRequestId) {
      registrationCloseAddressSuggestions();
    }
  }
}

function setupAddressAutocomplete() {
  const streetInput = document.getElementById("street");
  const cityInput = document.getElementById("city");
  const postalCodeInput = document.getElementById("postalCode");
  const suggestionsBox = document.getElementById("addressSuggestions");

  if (!streetInput || !cityInput || !postalCodeInput || !suggestionsBox) {
    return;
  }

  streetInput.addEventListener("input", function () {
    const query = streetInput.value.trim();

    cityInput.value = "";
    postalCodeInput.value = "";
    [cityInput, postalCodeInput].forEach(function (field) {
      field.classList.remove("input-error");
      field.removeAttribute("aria-invalid");
    });

    registrationAddressRequestId += 1;
    const requestId = registrationAddressRequestId;

    if (registrationAddressTimer) {
      window.clearTimeout(registrationAddressTimer);
      registrationAddressTimer = null;
    }

    if (query.length < ADDRESS_SUGGESTION_MIN_LENGTH) {
      registrationCloseAddressSuggestions();
      return;
    }

    registrationAddressTimer = window.setTimeout(function () {
      registrationLoadAddressSuggestions(query, requestId);
    }, ADDRESS_SUGGESTION_DELAY_MS);
  });

  streetInput.addEventListener("keydown", function (event) {
    if (suggestionsBox.hidden || !registrationAddressSuggestions.length) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      registrationSetAddressActiveIndex(registrationAddressActiveIndex + 1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      registrationSetAddressActiveIndex(registrationAddressActiveIndex - 1);
      return;
    }

    if (event.key === "Enter" && registrationAddressActiveIndex >= 0) {
      event.preventDefault();
      registrationSelectAddress(registrationAddressActiveIndex);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      registrationCloseAddressSuggestions();
    }
  });

  suggestionsBox.addEventListener("mousedown", function (event) {
    event.preventDefault();
  });

  suggestionsBox.addEventListener("click", function (event) {
    const button = event.target.closest("[data-address-index]");

    if (!button) {
      return;
    }

    registrationSelectAddress(Number(button.dataset.addressIndex));
  });

  document.addEventListener("click", function (event) {
    if (!event.target.closest(".address-autocomplete")) {
      registrationCloseAddressSuggestions();
    }
  });
}

function resetRegistrationConsentCheckboxes() {
  const termsBusiness = document.getElementById("termsBusiness");
  const termsPrivacy = document.getElementById("termsPrivacy");

  [termsBusiness, termsPrivacy].forEach(function (checkbox) {
    if (!checkbox) {
      return;
    }

    checkbox.checked = false;
    checkbox.defaultChecked = false;
    checkbox.classList.remove("input-error");
    checkbox.removeAttribute("aria-invalid");
  });
}

function registrationHandleAuthError(error, emailInput, passwordInput) {
  const code = String(error && error.code ? error.code : "").toLowerCase();

  if (
    code === "email_exists" ||
    code === "user_already_exists" ||
    code === "identity_already_exists"
  ) {
    registrationMarkError(emailInput);
    registrationShowError(
      "registration.error.exists",
      "Uživatel s tímto e-mailem už existuje. Zkuste se přihlásit."
    );
    return;
  }

  if (code === "email_address_invalid") {
    registrationMarkError(emailInput);
    registrationShowError(
      "registration.error.invalidEmail",
      "Zadejte platný e-mail."
    );
    return;
  }

  if (code === "weak_password") {
    registrationMarkError(passwordInput);
    registrationShowError(
      "registration.error.weakPassword",
      "Heslo musí mít alespoň 8 znaků a obsahovat malé písmeno, velké písmeno, číslici a symbol."
    );
    return;
  }

  if (
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit"
  ) {
    registrationShowError(
      "registration.error.rateLimit",
      "Proběhlo příliš mnoho pokusů. Počkejte chvíli a zkuste to znovu."
    );
    return;
  }

  if (
    code === "signup_disabled" ||
    code === "email_provider_disabled" ||
    code === "provider_disabled"
  ) {
    registrationShowError(
      "registration.error.unavailable",
      "Registrace je dočasně nedostupná. Zkuste to prosím později."
    );
    return;
  }

  console.error(
    registrationT("registration.console.failed", "Registrace se nepodařila."),
    error
  );
  registrationShowError(
    "registration.error.generic",
    "Registrace se nepodařila. Zkuste to prosím znovu."
  );
}

async function createUserAccount(event) {
  event.preventDefault();

  if (registrationSubmitInProgress) {
    return;
  }

  registrationHideError();
  registrationClearErrors();
  registrationCloseAddressSuggestions();

  const supabaseClient = getSupabaseClient();

  if (!supabaseClient) {
    registrationShowError(
      "registration.error.supabase",
      "Služba je dočasně nedostupná. Obnovte stránku a zkuste to znovu."
    );
    return;
  }

  const fullNameInput = document.getElementById("fullName");
  const emailInput = document.getElementById("email");
  const phoneInput = document.getElementById("phone");
  const streetInput = document.getElementById("street");
  const cityInput = document.getElementById("city");
  const postalCodeInput = document.getElementById("postalCode");
  const passwordInput = document.getElementById("password");
  const passwordConfirmInput = document.getElementById("passwordConfirm");
  const termsBusiness = document.getElementById("termsBusiness");
  const termsPrivacy = document.getElementById("termsPrivacy");
  const requiredFields = [
    fullNameInput,
    emailInput,
    phoneInput,
    streetInput,
    cityInput,
    postalCodeInput,
    passwordInput,
    passwordConfirmInput
  ];

  if (
    requiredFields.some(function (field) { return !field; }) ||
    !termsBusiness ||
    !termsPrivacy
  ) {
    registrationShowError(
      "registration.error.supabase",
      "Služba je dočasně nedostupná. Obnovte stránku a zkuste to znovu."
    );
    return;
  }

  let hasError = false;

  requiredFields.forEach(function (field) {
    if (registrationIsEmpty(field.value)) {
      registrationMarkError(field);
      hasError = true;
    }
  });

  [termsBusiness, termsPrivacy].forEach(function (field) {
    if (!field.checked) {
      registrationMarkError(field);
      hasError = true;
    }
  });

  if (hasError) {
    registrationShowError(
      "registration.error.required",
      "Vyplňte prosím všechna pole a potvrďte oba souhlasy."
    );
    registrationFocusFirstError();
    return;
  }

  const email = registrationNormalizeEmail(emailInput.value);

  if (!registrationIsValidEmail(email)) {
    registrationMarkError(emailInput);
    registrationShowError(
      "registration.error.invalidEmail",
      "Zadejte platný e-mail."
    );
    registrationFocusFirstError();
    return;
  }

  if (!meetsRentuloPasswordRequirements(passwordInput.value)) {
    registrationMarkError(passwordInput);
    registrationShowError(
      "registration.error.passwordRequirements",
      "Heslo musí mít alespoň 8 znaků a obsahovat malé písmeno, velké písmeno, číslici a symbol."
    );
    registrationFocusFirstError();
    return;
  }

  if (passwordInput.value !== passwordConfirmInput.value) {
    if (typeof window.showRentuloRegistrationPasswordError === "function") {
      window.showRentuloRegistrationPasswordError("mismatch");
    } else {
      registrationMarkError(passwordConfirmInput);
      const errorBox = document.getElementById("registrationError");

      if (errorBox) {
        errorBox.textContent = "Zadaná hesla se neshodují.";
        errorBox.classList.add("active");
      }

      registrationFocusFirstError();
    }

    return;
  }

  const fullName = fullNameInput.value.trim();
  const phone = phoneInput.value.trim();
  const street = streetInput.value.trim();
  const city = cityInput.value.trim();
  const postalCode = postalCodeInput.value.trim();
  const now = new Date().toISOString();
  const preferredLanguage =
    typeof window.getRentuloLanguage === "function"
      ? window.getRentuloLanguage()
      : "cs";

  registrationSubmitInProgress = true;
  registrationSetButtonState(true);

  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email: email,
      password: passwordInput.value,
      options: {
        data: {
          full_name: fullName,
          phone: phone,
          street: street,
          city: city,
          postal_code: postalCode,
          preferred_language: preferredLanguage,
          terms_business_accepted: true,
          terms_privacy_accepted: true,
          terms_accepted_at: now
        }
      }
    });

    if (error) {
      registrationHandleAuthError(error, emailInput, passwordInput);
      registrationFocusFirstError();
      return;
    }

    if (!data || !data.user) {
      registrationShowError(
        "registration.error.userMissing",
        "Účet se nepodařilo bezpečně vytvořit. Zkuste to prosím znovu."
      );
      return;
    }

    if (
      Array.isArray(data.user.identities) &&
      data.user.identities.length === 0
    ) {
      registrationMarkError(emailInput);
      registrationShowError(
        "registration.error.exists",
        "Uživatel s tímto e-mailem už existuje. Zkuste se přihlásit."
      );
      registrationFocusFirstError();
      return;
    }

    window.location.href = "ucet-vytvoren.html";
  } catch (error) {
    console.error(
      registrationT("registration.console.failed", "Registrace se nepodařila."),
      error
    );
    registrationShowError(
      "registration.error.connection",
      "Registrace se nepodařila. Zkontrolujte připojení a zkuste to znovu."
    );
  } finally {
    registrationSubmitInProgress = false;
    registrationSetButtonState(false);
  }
}

function handleRegistrationLanguageChange() {
  registrationRenderError();
  registrationSetButtonState(registrationSubmitInProgress);
  registrationCloseAddressSuggestions();
}

document.addEventListener("DOMContentLoaded", function () {
  setupAddressAutocomplete();
  resetRegistrationConsentCheckboxes();

  window.setTimeout(resetRegistrationConsentCheckboxes, 0);

  const registrationForm = document.getElementById("registrationForm");

  if (registrationForm) {
    registrationForm.addEventListener("submit", createUserAccount);
    registrationForm.addEventListener("input", function (event) {
      const field = event.target;

      if (field && field.matches("input")) {
        field.classList.remove("input-error");
        field.removeAttribute("aria-invalid");
      }
    });
  }
});

window.addEventListener("pageshow", function () {
  resetRegistrationConsentCheckboxes();
});

document.addEventListener(
  "rentuloLanguageChanged",
  handleRegistrationLanguageChange
);
