(function () {
  const translations = {
    cs: {
      show: "Zobrazit heslo",
      hide: "Skrýt heslo",
      confirmLabel: "Potvrzení hesla",
      confirmPlaceholder: "Zadejte heslo znovu",
      confirmRequired: "Potvrďte prosím heslo.",
      mismatch: "Zadaná hesla se neshodují.",
      helperText: "Jméno, telefon a přesná adresa se druhé straně zobrazí až po zaplacení rezervace."
    },
    sk: {
      show: "Zobraziť heslo",
      hide: "Skryť heslo",
      confirmLabel: "Potvrdenie hesla",
      confirmPlaceholder: "Zadajte heslo znova",
      confirmRequired: "Potvrďte prosím heslo.",
      mismatch: "Zadané heslá sa nezhodujú.",
      helperText: "Meno, telefón a presná adresa sa druhej strane zobrazia až po zaplatení rezervácie."
    },
    en: {
      show: "Show password",
      hide: "Hide password",
      confirmLabel: "Confirm password",
      confirmPlaceholder: "Enter the password again",
      confirmRequired: "Please confirm your password.",
      mismatch: "The passwords do not match.",
      helperText: "Your name, phone number and exact address are shown to the other party only after the reservation is paid."
    },
    de: {
      show: "Passwort anzeigen",
      hide: "Passwort verbergen",
      confirmLabel: "Passwort bestätigen",
      confirmPlaceholder: "Passwort erneut eingeben",
      confirmRequired: "Bitte bestätigen Sie Ihr Passwort.",
      mismatch: "Die eingegebenen Passwörter stimmen nicht überein.",
      helperText: "Ihr Name, Ihre Telefonnummer und Ihre genaue Adresse werden der anderen Partei erst nach der Bezahlung der Reservierung angezeigt."
    },
    pl: {
      show: "Pokaż hasło",
      hide: "Ukryj hasło",
      confirmLabel: "Potwierdź hasło",
      confirmPlaceholder: "Wpisz hasło ponownie",
      confirmRequired: "Potwierdź hasło.",
      mismatch: "Wprowadzone hasła nie są takie same.",
      helperText: "Imię i nazwisko, numer telefonu i dokładny adres pojawią się drugiej stronie dopiero po opłaceniu rezerwacji."
    }
  };

  function getLanguage() {
    if (typeof window.getRentuloLanguage === "function") {
      return window.getRentuloLanguage();
    }

    try {
      return window.localStorage.getItem("rentuloLanguage") || "cs";
    } catch (_error) {
      return "cs";
    }
  }

  function text(key) {
    const i18nKeys = {
      show: "passwordVisibility.show",
      hide: "passwordVisibility.hide",
      confirmLabel: "registration.confirmPasswordLabel",
      confirmPlaceholder: "registration.confirmPasswordPlaceholder",
      confirmRequired: "registration.error.confirmPasswordRequired",
      mismatch: "registration.error.passwordMismatch"
    };
    const i18nKey = i18nKeys[key];

    if (i18nKey && typeof window.rentuloTranslate === "function") {
      const translated = window.rentuloTranslate(i18nKey);
      if (translated && translated !== i18nKey) {
        return translated;
      }
    }

    const language = getLanguage();
    const map = translations[language] || translations.cs;
    return map[key] || translations.cs[key] || key;
  }

  function eyeMarkup() {
    return `
      <svg class="password-eye" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path>
        <circle cx="12" cy="12" r="2.8"></circle>
      </svg>
      <svg class="password-eye-off" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M3 3l18 18"></path>
        <path d="M10.6 6.2A10.6 10.6 0 0 1 12 6c6 0 9.5 6 9.5 6a15.8 15.8 0 0 1-3 3.7"></path>
        <path d="M6.2 6.2C3.8 8 2.5 12 2.5 12s3.5 6 9.5 6a9.8 9.8 0 0 0 3.2-.5"></path>
      </svg>
    `;
  }

  function updateButtonLabel(button, input) {
    const isVisible = input.type === "text";
    const label = text(isVisible ? "hide" : "show");
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.setAttribute("aria-pressed", isVisible ? "true" : "false");
  }

  function togglePassword(input, button, restoreInputFocus) {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const direction = input.selectionDirection;
    const nextType = input.type === "password" ? "text" : "password";

    input.type = nextType;
    updateButtonLabel(button, input);

    window.requestAnimationFrame(function () {
      try {
        if (start !== null && end !== null) {
          input.setSelectionRange(start, end, direction || "none");
        }
      } catch (_error) {}

      if (restoreInputFocus) {
        try {
          input.focus({ preventScroll: true });
        } catch (_error) {
          input.focus();
        }
      }
    });
  }

  function enhanceInput(input) {
    if (!input || input.dataset.passwordVisibilityReady === "true") {
      return;
    }

    input.dataset.passwordVisibilityReady = "true";

    const wrapper = document.createElement("div");
    wrapper.className = "password-input-wrap";
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "password-visibility-button";
    button.innerHTML = eyeMarkup();
    updateButtonLabel(button, input);
    wrapper.appendChild(button);

    const typeObserver = new MutationObserver(function () {
      updateButtonLabel(button, input);
    });
    typeObserver.observe(input, { attributes: true, attributeFilter: ["type"] });

    let restoreInputFocus = false;

    button.addEventListener("pointerdown", function () {
      restoreInputFocus = document.activeElement === input;
    });

    button.addEventListener("click", function () {
      togglePassword(input, button, restoreInputFocus);
      restoreInputFocus = false;
    });
  }

  function clearRegistrationPasswordError() {
    const errorBox = document.getElementById("registrationError");
    const confirmInput = document.getElementById("passwordConfirm");

    if (confirmInput) {
      confirmInput.classList.remove("input-error");
      confirmInput.removeAttribute("aria-invalid");
    }

    if (errorBox && errorBox.dataset.passwordErrorKey) {
      errorBox.textContent = "";
      errorBox.classList.remove("active");
      delete errorBox.dataset.passwordErrorKey;
    }
  }

  function showRegistrationPasswordError(key) {
    const errorBox = document.getElementById("registrationError");
    const confirmInput = document.getElementById("passwordConfirm");

    if (confirmInput) {
      confirmInput.classList.add("input-error");
      confirmInput.setAttribute("aria-invalid", "true");
    }

    if (errorBox) {
      errorBox.dataset.passwordErrorKey = key;
      errorBox.textContent = text(key);
      errorBox.classList.add("active");
    }

    if (confirmInput) {
      confirmInput.focus();
    }
  }

  function initializeRegistrationConfirmation() {
    const form = document.getElementById("registrationForm");
    const passwordInput = document.getElementById("password");
    const confirmInput = document.getElementById("passwordConfirm");

    if (!form || !passwordInput || !confirmInput) {
      return;
    }

    const clearOwnError = function () {
      const errorBox = document.getElementById("registrationError");
      if (errorBox && errorBox.dataset.passwordErrorKey) {
        clearRegistrationPasswordError();
      }
    };

    passwordInput.addEventListener("input", clearOwnError);
    confirmInput.addEventListener("input", clearOwnError);

  }

  window.showRentuloRegistrationPasswordError = showRegistrationPasswordError;

  function refreshTranslations() {
    document.querySelectorAll(".password-visibility-button").forEach(function (button) {
      const wrapper = button.closest(".password-input-wrap");
      const input = wrapper ? wrapper.querySelector("input") : null;
      if (input) {
        updateButtonLabel(button, input);
      }
    });

    document.querySelectorAll("[data-password-confirm-label]").forEach(function (label) {
      label.textContent = text("confirmLabel");
    });

    document.querySelectorAll("[data-password-confirm-placeholder]").forEach(function (input) {
      input.setAttribute("placeholder", text("confirmPlaceholder"));
    });

    document.querySelectorAll("[data-registration-helper-text]").forEach(function (element) {
      element.textContent = text("helperText");
    });

    const errorBox = document.getElementById("registrationError");
    if (errorBox && errorBox.dataset.passwordErrorKey) {
      errorBox.textContent = text(errorBox.dataset.passwordErrorKey);
    }
  }

  function initialize() {
    document.querySelectorAll('input[type="password"]').forEach(enhanceInput);
    initializeRegistrationConfirmation();
    refreshTranslations();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }

  document.addEventListener("rentuloLanguageChanged", refreshTranslations);
})();
