(function () {
  function t(key, fallback) {
    if (typeof window.rentuloTranslate === "function") {
      return window.rentuloTranslate(key);
    }
    return fallback || key;
  }

  function setMessage(element, text, type) {
    if (!element) return;
    element.textContent = text || "";
    element.className = "status-message";
    if (text) element.classList.add("active", type || "success");
  }

  const RECOVERY_SESSION_KEY = "rentulo.passwordRecoveryActive";

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function markRecoverySessionActive() {
    try {
      window.sessionStorage.setItem(RECOVERY_SESSION_KEY, "1");
    } catch (_) {}
  }

  function clearRecoverySessionActive() {
    try {
      window.sessionStorage.removeItem(RECOVERY_SESSION_KEY);
    } catch (_) {}
  }

  function isRecoverySessionActive() {
    try {
      return window.sessionStorage.getItem(RECOVERY_SESSION_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function isEmailRateLimitError(error) {
    const code = String((error && error.code) || "").toLowerCase();
    const message = String((error && error.message) || "").toLowerCase();

    return code === "over_email_send_rate_limit" || message.includes("email rate limit exceeded");
  }

  function isSameAsOldPasswordError(error) {
    const code = String((error && error.code) || "").toLowerCase();
    const message = String((error && error.message) || "").toLowerCase();

    return (
      code === "same_password" ||
      message.includes("new password should be different from the old password")
    );
  }

  function getRequestErrorMessage(error) {
    if (isEmailRateLimitError(error)) {
      return t(
        "passwordRecovery.error.rateLimit",
        "Odkaz pro obnovu teď nelze odeslat. Zkuste to prosím později."
      );
    }

    return t(
      "passwordRecovery.error.generic",
      "Obnovu hesla se nepodařilo dokončit. Zkuste to znovu."
    );
  }

  function getRecoveryLinkError() {
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
    const error = hashParams.get("error") || searchParams.get("error") || "";
    const errorCode = hashParams.get("error_code") || searchParams.get("error_code") || "";
    const errorDescription = hashParams.get("error_description") || searchParams.get("error_description") || "";

    if (errorCode === "otp_expired") return "invalid_link";
    if (error === "access_denied" && /invalid|expired/i.test(errorDescription)) return "invalid_link";
    return "";
  }

  function getSafeReturnTo() {
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

      return returnPath === "detail.html"
        ? "detail.html?id=" + encodeURIComponent(id)
        : "edit-nabidka.html?id=" + encodeURIComponent(id);
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

  function getLoginUrl() {
    const returnTo = getSafeReturnTo();
    return returnTo
      ? "prihlaseni.html?returnTo=" + encodeURIComponent(returnTo)
      : "prihlaseni.html";
  }

  function getPostResetDestination() {
    return getSafeReturnTo() || "index.html";
  }

  function updateBackToLoginLinks() {
    const loginUrl = getLoginUrl();
    document
      .querySelectorAll('a[data-i18n="passwordRecovery.backToLogin"]')
      .forEach(function (link) {
        link.href = loginUrl;
      });
  }

  function getRedirectUrl() {
    const returnTo = getSafeReturnTo();
    const url = new URL(window.location.origin + window.location.pathname);

    if (returnTo) {
      url.searchParams.set("returnTo", returnTo);
    }

    return url.toString();
  }

  function showRequestSentState() {
    const requestForm = document.getElementById("requestResetForm");
    const title = document.getElementById("recoveryTitle");
    const description = document.getElementById("recoveryDescription");
    const message = document.getElementById("requestMessage");

    if (requestForm) {
      requestForm
        .querySelectorAll(".form-group, .auth-button, .auth-note")
        .forEach(function (element) {
          element.classList.add("hidden");
        });
    }

    if (title) {
      title.dataset.i18n = "passwordRecovery.sentTitle";
      title.textContent = t("passwordRecovery.sentTitle", "Zkontrolujte e-mail");
    }

    if (description) {
      description.dataset.i18n = "passwordRecovery.sentDescription";
      description.textContent = t(
        "passwordRecovery.sentDescription",
        "Další krok najdete v e-mailu. Na této stránce už není potřeba nic dalšího dělat."
      );
    }

    if (message) {
      message.dataset.i18n = "passwordRecovery.sent";
    }
  }

  function showPasswordForm() {
    const requestForm = document.getElementById("requestResetForm");
    const passwordForm = document.getElementById("setPasswordForm");
    const title = document.getElementById("recoveryTitle");
    const description = document.getElementById("recoveryDescription");

    if (requestForm) requestForm.classList.add("hidden");
    if (passwordForm) passwordForm.classList.remove("hidden");
    if (title) {
      title.dataset.i18n = "passwordRecovery.newTitle";
      title.textContent = t("passwordRecovery.newTitle", "Nastavit nové heslo");
    }
    if (description) {
      description.dataset.i18n = "passwordRecovery.newDescription";
      description.textContent = t("passwordRecovery.newDescription", "Použijte alespoň 8 znaků, včetně malého a velkého písmene, číslice a symbolu (např. ! nebo @).");
    }
  }

  async function handleRequest(event, client) {
    event.preventDefault();
    const emailInput = document.getElementById("recoveryEmail");
    const button = document.getElementById("requestResetButton");
    const message = document.getElementById("requestMessage");
    const email = normalizeEmail(emailInput && emailInput.value);

    setMessage(message, "", "");
    if (!isValidEmail(email)) {
      setMessage(message, t("passwordRecovery.error.emailRequired", "Zadejte platný e-mail."), "error");
      if (emailInput) emailInput.focus();
      return;
    }

    if (button) {
      button.disabled = true;
      button.textContent = t("passwordRecovery.sending", "Odesílám...");
    }

    try {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: getRedirectUrl()
      });

      if (error) {
        console.error(error);
        setMessage(message, getRequestErrorMessage(error), "error");
        return;
      }

      setMessage(message, t("passwordRecovery.sent", "Pokud je e-mail registrovaný, poslali jsme na něj odkaz pro obnovu hesla."), "success");
      showRequestSentState();
      if (emailInput) emailInput.value = "";
    } catch (error) {
      console.error(error);
      setMessage(message, getRequestErrorMessage(error), "error");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = t("passwordRecovery.send", "Poslat odkaz pro obnovu");
      }
    }
  }

  async function handleNewPassword(event, client) {
    event.preventDefault();
    const passwordInput = document.getElementById("newPassword");
    const confirmInput = document.getElementById("confirmPassword");
    const button = document.getElementById("savePasswordButton");
    const message = document.getElementById("passwordMessage");
    const password = passwordInput ? passwordInput.value : "";
    const confirmation = confirmInput ? confirmInput.value : "";

    setMessage(message, "", "");
    if (!meetsRentuloPasswordRequirements(password)) {
      setMessage(
        message,
        t(
          "passwordRecovery.error.passwordRequirements",
          "Heslo musí mít alespoň 8 znaků a obsahovat malé písmeno, velké písmeno, číslici a symbol."
        ),
        "error"
      );
      if (passwordInput) passwordInput.focus();
      return;
    }
    if (password !== confirmation) {
      setMessage(message, t("passwordRecovery.error.passwordMismatch", "Zadaná hesla se neshodují."), "error");
      return;
    }

    let passwordUpdated = false;

    if (button) {
      button.disabled = true;
      button.textContent = t("passwordRecovery.saving", "Ukládám...");
    }

    try {
      const { error } = await client.auth.updateUser({ password: password });
      if (error) {
        console.error(error);
        if (isRentuloWeakPasswordError(error)) {
          setMessage(
            message,
            t(
              "passwordRecovery.error.passwordRequirements",
              "Heslo musí mít alespoň 8 znaků a obsahovat malé písmeno, velké písmeno, číslici a symbol."
            ),
            "error"
          );
        } else if (isSameAsOldPasswordError(error)) {
          setMessage(
            message,
            t(
              "passwordRecovery.error.sameAsOldPassword",
              "Nové heslo musí být jiné než současné heslo."
            ),
            "error"
          );
        } else {
          setMessage(message, t("passwordRecovery.error.invalidLink", "Odkaz pro obnovu hesla je neplatný nebo vypršel. Požádejte o nový odkaz."), "error");
        }
        return;
      }

      passwordUpdated = true;
      clearRecoverySessionActive();
      if (passwordInput) passwordInput.value = "";
      if (confirmInput) confirmInput.value = "";
      setMessage(message, t("passwordRecovery.updated", "Heslo bylo změněno."), "success");

      window.setTimeout(function () {
        window.location.replace(getPostResetDestination());
      }, 900);
    } catch (error) {
      console.error(error);
      setMessage(message, t("passwordRecovery.error.generic", "Obnovu hesla se nepodařilo dokončit. Zkuste to znovu."), "error");
    } finally {
      if (button && !passwordUpdated) {
        button.disabled = false;
        button.textContent = t("passwordRecovery.save", "Uložit nové heslo");
      }
    }
  }

  document.addEventListener("DOMContentLoaded", async function () {
    updateBackToLoginLinks();

    const client = typeof getSupabaseClient === "function" ? getSupabaseClient() : null;
    const requestForm = document.getElementById("requestResetForm");
    const passwordForm = document.getElementById("setPasswordForm");
    const requestMessage = document.getElementById("requestMessage");

    if (!client) {
      setMessage(requestMessage, t("passwordRecovery.error.generic", "Obnovu hesla se nepodařilo dokončit. Zkuste to znovu."), "error");
      return;
    }

    if (requestForm) requestForm.addEventListener("submit", function (event) { handleRequest(event, client); });
    if (passwordForm) passwordForm.addEventListener("submit", function (event) { handleNewPassword(event, client); });

    if (getRecoveryLinkError() === "invalid_link") {
      clearRecoverySessionActive();
      setMessage(
        requestMessage,
        t(
          "passwordRecovery.error.invalidLink",
          "Odkaz pro obnovu hesla je neplatný nebo vypršel. Pošlete si nový odkaz."
        ),
        "error"
      );
      return;
    }

    client.auth.onAuthStateChange(function (event) {
      if (event === "PASSWORD_RECOVERY") {
        markRecoverySessionActive();
        showPasswordForm();
      } else if (event === "SIGNED_OUT") {
        clearRecoverySessionActive();
      }
    });

    const urlText = window.location.href;
    if (urlText.includes("type=recovery") || urlText.includes("access_token=")) {
      markRecoverySessionActive();
      showPasswordForm();
    } else {
      const { data } = await client.auth.getSession();
      if (data && data.session && (isRecoverySessionActive() || window.location.hash)) {
        markRecoverySessionActive();
        showPasswordForm();
      } else if (!data || !data.session) {
        clearRecoverySessionActive();
      }
    }
  });
})();
