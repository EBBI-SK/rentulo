function loginTranslate(key, fallback) {
  if (typeof window.rentuloTranslate === "function") {
    return window.rentuloTranslate(key);
  }

  return fallback || key;
}

let loginSubmitInProgress = false;
let loginErrorState = null;

function loginNormalizeEmail(email) {
      return String(email || "").trim().toLowerCase();
    }

    function loginGetSafeReturnTo() {
      const rawReturnTo = new URLSearchParams(window.location.search).get("returnTo") || "";

      if (!rawReturnTo) {
        return "";
      }

      let returnUrl;

      try {
        returnUrl = new URL(rawReturnTo, window.location.origin + "/");
      } catch (_error) {
        return "";
      }

      if (returnUrl.origin !== window.location.origin) {
        return "";
      }

      const returnPath = returnUrl.pathname.replace(/^\/+/, "");

      if (returnPath === "detail.html" || returnPath === "edit-nabidka.html") {
        const id = returnUrl.searchParams.get("id") || "";
        const isSafeId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

        if (!isSafeId) {
          return "";
        }

        if (returnPath === "edit-nabidka.html") {
          return "edit-nabidka.html?id=" + encodeURIComponent(id);
        }
        const safeParams = new URLSearchParams({ id });
        const from = returnUrl.searchParams.get("od") || "";
        const to = returnUrl.searchParams.get("do") || "";
        if (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
          const start = new Date(from + "T00:00:00Z");
          const end = new Date(to + "T00:00:00Z");
          const days = (end.getTime() - start.getTime()) / 86400000;
          if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) &&
              start.toISOString().slice(0, 10) === from && end.toISOString().slice(0, 10) === to &&
              Number.isInteger(days) && days >= 1 && days <= 365) {
            safeParams.set("od", from);
            safeParams.set("do", to);
          }
        }
        return "detail.html?" + safeParams.toString();
      }

      switch (returnPath) {
        case "historie.html":
          return "historie.html";
        case "moje-nabidky.html":
          return "moje-nabidky.html";
        case "moje-rezervace.html":
          return "moje-rezervace.html";
        case "nabidnout.html":
          return "nabidnout.html";
        case "nastaveni.html":
          return "nastaveni.html";
        default:
          return "";
      }
    }

    function loginUpdateRecoveryLink() {
      const recoveryLink = document.querySelector(
        'a[data-i18n="login.forgotPassword"]'
      );

      if (!recoveryLink) {
        return;
      }

      const returnTo = loginGetSafeReturnTo();
      recoveryLink.href = returnTo
        ? "obnova-hesla.html?returnTo=" + encodeURIComponent(returnTo)
        : "obnova-hesla.html";
    }

    function loginIsValidEmail(email) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function renderLoginError() {
      const errorBox = document.getElementById("loginError");

      if (!errorBox) {
        return;
      }

      if (!loginErrorState) {
        errorBox.textContent = "";
        errorBox.classList.remove("active");
        return;
      }

      errorBox.textContent = loginTranslate(
        loginErrorState.key,
        loginErrorState.fallback
      );
      errorBox.classList.add("active");
    }

    function showLoginError(key, fallback) {
      loginErrorState = {
        key: key,
        fallback: fallback || key
      };
      renderLoginError();
    }

    function hideLoginError() {
      loginErrorState = null;
      renderLoginError();
    }

    function clearLoginErrors() {
      const fields = document.querySelectorAll("#loginForm input");

      fields.forEach(function (field) {
        field.classList.remove("input-error");
        field.removeAttribute("aria-invalid");
      });
    }

    function markLoginError(input) {
      if (input) {
        input.classList.add("input-error");
        input.setAttribute("aria-invalid", "true");
      }
    }

    function setLoginButtonState(isSubmitting) {
      const submitButton = document.getElementById("loginSubmitButton");

      if (!submitButton) {
        return;
      }

      submitButton.disabled = Boolean(isSubmitting);
      submitButton.setAttribute(
        "aria-busy",
        isSubmitting ? "true" : "false"
      );
      submitButton.textContent = loginTranslate(
        isSubmitting ? "login.submitting" : "login.submit",
        isSubmitting ? "Přihlašuji..." : "Přihlásit se"
      );
    }

    function saveRememberLogin(rememberLogin) {
      try {
        localStorage.setItem(
          "rentuloRememberLogin",
          rememberLogin ? "true" : "false"
        );
      } catch (_error) {
        // Supabase will fall back to session storage when persistence is blocked.
      }
    }

    function loadRememberLogin() {
      try {
        return localStorage.getItem("rentuloRememberLogin") === "true";
      } catch (_error) {
        return false;
      }
    }

    async function loginLoadProfile(supabaseClient, user) {
      if (!user || !user.id) {
        return null;
      }

      const { data, error } = await supabaseClient
        .from("profiles")
        .select("preferred_language")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        console.warn(loginTranslate("login.console.profileLoad", "Profil se nepodařilo načíst."));
        return null;
      }

      return data || null;
    }

    function loginApplyPreferredLanguage(user, profile) {
      const supportedLanguages = ["cs", "sk", "en", "de", "pl"];
      const metadata = user && user.user_metadata ? user.user_metadata : {};
      const preferredLanguage = String(
        (profile && profile.preferred_language) ||
        metadata.preferred_language ||
        "cs"
      ).toLowerCase();
      const language = supportedLanguages.includes(preferredLanguage)
        ? preferredLanguage
        : "cs";

      try {
        localStorage.setItem("rentuloLanguage", language);
      } catch (_error) {
        // Continue without persistence when browser storage is unavailable.
      }
    }

    async function handleLoginSubmit(event) {
      event.preventDefault();

      if (loginSubmitInProgress) {
        return;
      }

      hideLoginError();
      clearLoginErrors();

      const targetPage = loginGetSafeReturnTo() || "index.html";

      const supabaseClient = getSupabaseClient();

      if (!supabaseClient) {
        showLoginError(
          "login.error.supabase",
          "Přihlášení je dočasně nedostupné. Obnovte stránku a zkuste to znovu."
        );
        return;
      }

      const emailInput = document.getElementById("loginEmail");
      const passwordInput = document.getElementById("loginPassword");
      const rememberInput = document.getElementById("rememberLogin");
      const email = loginNormalizeEmail(emailInput.value);
      const password = String(passwordInput.value || "");

      let hasError = false;

      if (!email) {
        markLoginError(emailInput);
        hasError = true;
      }

      if (!password) {
        markLoginError(passwordInput);
        hasError = true;
      }

      if (hasError) {
        showLoginError(
          "login.error.required",
          "Vyplňte prosím e-mail i heslo."
        );
        return;
      }

      if (!loginIsValidEmail(email)) {
        markLoginError(emailInput);
        showLoginError(
          "login.error.invalidEmail",
          "Zadejte platný e-mail."
        );
        return;
      }

      loginSubmitInProgress = true;
      saveRememberLogin(Boolean(rememberInput && rememberInput.checked));
      setLoginButtonState(true);

      try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
          email: email,
          password: password
        });

        if (error) {
          const code = String(error.code || "").toLowerCase();

          if (
            code === "invalid_credentials" ||
            code === "user_not_found"
          ) {
            markLoginError(emailInput);
            markLoginError(passwordInput);
            showLoginError(
              "login.error.invalidCredentials",
              "E-mail nebo heslo není správné."
            );
            return;
          }

          if (code === "email_not_confirmed") {
            showLoginError(
              "login.error.emailNotConfirmed",
              "E-mail ještě není potvrzený. Zkontrolujte prosím e-mailovou schránku."
            );
            return;
          }

          console.error(loginTranslate("login.console.failed", "Přihlášení se nepodařilo."), error);
          showLoginError(
            "login.error.generic",
            "Přihlášení se nepodařilo. Zkuste to prosím znovu."
          );
          return;
        }

        if (!data || !data.user) {
          showLoginError(
            "login.error.userMissing",
            "Přihlášení se nepodařilo. Uživatel nebyl načten."
          );
          return;
        }

        const profile = await loginLoadProfile(supabaseClient, data.user);

        loginApplyPreferredLanguage(data.user, profile);
        window.location.href = targetPage;
      } catch (error) {
        console.error(loginTranslate("login.console.failed", "Přihlášení se nepodařilo."), error);
        showLoginError(
          "login.error.connection",
          "Přihlášení se nepodařilo. Zkontrolujte připojení a zkuste to znovu."
        );
      } finally {
        loginSubmitInProgress = false;
        setLoginButtonState(false);
      }
    }

    function handleLoginLanguageChange() {
      renderLoginError();
      setLoginButtonState(loginSubmitInProgress);
    }

    document.addEventListener("DOMContentLoaded", function () {
      loginUpdateRecoveryLink();

      const loginForm = document.getElementById("loginForm");
      const rememberInput = document.getElementById("rememberLogin");

      if (rememberInput) {
        rememberInput.checked = loadRememberLogin();
      }

      if (loginForm) {
        loginForm.addEventListener("submit", handleLoginSubmit);

        loginForm.addEventListener("input", function (event) {
          const field = event.target;

          if (field && field.matches("input")) {
            field.classList.remove("input-error");
            field.removeAttribute("aria-invalid");
          }
        });
      }
    });

    document.addEventListener(
      "rentuloLanguageChanged",
      handleLoginLanguageChange
    );
