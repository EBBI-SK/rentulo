let registrationSubmitInProgress = false;
let registrationErrorState = null;

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
  const fields = document.querySelectorAll("#registrationForm input, #registrationForm select");

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
    "#registrationForm [aria-invalid='true']"
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

function resetRegistrationConsentCheckboxes() {
  const termsBusiness = document.getElementById("termsBusiness");
  const termsPrivacy = document.getElementById("termsPrivacy");
  const privateIndividualConfirmation = document.getElementById("privateIndividualConfirmation");

  [termsBusiness, termsPrivacy, privateIndividualConfirmation].forEach(function (checkbox) {
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
  const countryInput = document.getElementById("countryCode");
  const streetInput = document.getElementById("street");
  const cityInput = document.getElementById("city");
  const postalCodeInput = document.getElementById("postalCode");
  const passwordInput = document.getElementById("password");
  const passwordConfirmInput = document.getElementById("passwordConfirm");
  const termsBusiness = document.getElementById("termsBusiness");
  const termsPrivacy = document.getElementById("termsPrivacy");
  const privateIndividualConfirmation = document.getElementById("privateIndividualConfirmation");
  const requiredFields = [
    fullNameInput,
    emailInput,
    phoneInput,
    countryInput,
    streetInput,
    cityInput,
    passwordInput,
    passwordConfirmInput
  ];

  if (
    requiredFields.some(function (field) { return !field; }) ||
    !termsBusiness ||
    !termsPrivacy ||
    !privateIndividualConfirmation
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

  [termsBusiness, termsPrivacy, privateIndividualConfirmation].forEach(function (field) {
    if (!field.checked) {
      registrationMarkError(field);
      hasError = true;
    }
  });

  if (hasError) {
    registrationShowError(
      "registration.error.required",
      "Vyplňte prosím všechna pole a zaškrtněte všechna tři povinná políčka."
    );
    registrationFocusFirstError();
    return;
  }

  const countryCode = window.rentuloCountries.validCountry(countryInput.value);
  if (!countryCode) {
    registrationMarkError(countryInput);
    registrationShowError("country.required", "Vyberte zemi bydliště.");
    registrationFocusFirstError();
    return;
  }
  const normalizedPostalCode = window.rentuloCountries.normalizePostal(countryCode, postalCodeInput.value);
  if (normalizedPostalCode === null) {
    registrationMarkError(postalCodeInput);
    registrationShowError("country.invalidPostalCode", "Zkontrolujte poštovní směrovací číslo pro vybranou zemi.");
    registrationFocusFirstError();
    return;
  }
  postalCodeInput.value = normalizedPostalCode;

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
          country_code: countryCode,
          preferred_language: preferredLanguage,
          terms_business_accepted: true,
          terms_privacy_accepted: true,
          private_individual_confirmed: true,
          private_individual_confirmed_at: now,
          terms_version: "1.0-test-2026-10-20",
          privacy_notice_version: "1.0-test-2026-10-20",
          terms_language: preferredLanguage,
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
}

document.addEventListener("DOMContentLoaded", function () {
  window.rentuloCountries.setupSelect("countryCode", "postalCode");
  resetRegistrationConsentCheckboxes();

  window.setTimeout(resetRegistrationConsentCheckboxes, 0);

  const registrationForm = document.getElementById("registrationForm");

  if (registrationForm) {
    registrationForm.addEventListener("submit", createUserAccount);
    registrationForm.addEventListener("input", function (event) {
      const field = event.target;

      if (field && field.matches("input, select")) {
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
