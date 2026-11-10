// Generated deployment runtime: only the Czech fallback is embedded.
// Other Rentulo dictionaries are loaded on demand from same-origin scripts.
(function () {
  "use strict";

  const DEFAULT_LANGUAGE = "cs";
  const SUPPORTED_LANGUAGES = ["cs", "sk", "en", "de", "pl"];
  const translations = { cs: __RENTULO_CS_DICTIONARY__ };
  const pendingLoads = Object.create(null);
  const source = document.currentScript && document.currentScript.src;
  const scriptPrefix = typeof source === "string"
    ? source.replace(/i18n\.js(?:[?#].*)?$/, "")
    : "js/";
  let languageChangeNumber = 0;
  let contentReady = document.readyState !== "loading";

  function normalizeLanguage(language) {
    return SUPPORTED_LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE;
  }

  function getRentuloLanguage() {
    try {
      return normalizeLanguage(localStorage.getItem("rentuloLanguage"));
    } catch {
      return DEFAULT_LANGUAGE;
    }
  }

  function translate(key, language) {
    const selected = normalizeLanguage(language || getRentuloLanguage());
    return (
      (translations[selected] && translations[selected][key]) ||
      translations[DEFAULT_LANGUAGE][key] ||
      key
    );
  }

  // Called exclusively by our same-origin, generated language payloads.
  window.rentuloRegisterTranslations = function (language, dictionary) {
    if (!SUPPORTED_LANGUAGES.includes(language) || language === DEFAULT_LANGUAGE ||
        !dictionary || typeof dictionary !== "object" || Array.isArray(dictionary)) {
      return;
    }
    translations[language] = dictionary;
  };

  function loadLanguage(language) {
    if (translations[language]) return Promise.resolve();
    if (pendingLoads[language]) return pendingLoads[language];

    pendingLoads[language] = new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      script.src = scriptPrefix + "i18n-" + language + ".js";
      script.async = true;
      script.onload = function () {
        if (translations[language]) resolve();
        else reject(new Error("Missing Rentulo translation dictionary: " + language));
      };
      script.onerror = function () {
        reject(new Error("Cannot load Rentulo translation dictionary: " + language));
      };
      document.head.appendChild(script);
    }).catch(function (error) {
      delete pendingLoads[language]; // A future change may retry a failed request.
      throw error;
    });

    return pendingLoads[language];
  }

  function applyRentuloTranslations(language) {
    const selected = normalizeLanguage(language || getRentuloLanguage());
    document.documentElement.lang = translations[selected] ? selected : DEFAULT_LANGUAGE;

    const titleKey = document.body && document.body.dataset
      ? document.body.dataset.i18nDocumentTitle
      : "";
    if (titleKey) document.title = translate(titleKey, selected);

    document.querySelectorAll("[data-i18n]").forEach(function (element) {
      element.textContent = translate(element.dataset.i18n, selected);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (element) {
      element.setAttribute("placeholder", translate(element.dataset.i18nPlaceholder, selected));
    });
  }

  function announceLanguage(language) {
    document.dispatchEvent(new CustomEvent("rentuloLanguageChanged", {
      detail: { language: language }
    }));
  }

  function setRentuloLanguage(language) {
    const selected = normalizeLanguage(language);
    const currentChange = ++languageChangeNumber;

    // Keep the existing API behavior: the user's choice is persisted immediately.
    // The visible language-change event waits until the dictionary is ready.
    try {
      localStorage.setItem("rentuloLanguage", selected);
    } catch {
      // Continue without persistence when storage is unavailable.
    }

    function finish() {
      if (currentChange !== languageChangeNumber) return; // A newer choice won.
      applyRentuloTranslations(selected);
      announceLanguage(selected);
    }

    if (translations[selected]) finish();
    else void loadLanguage(selected).then(finish).catch(function (error) {
      console.warn("Rentulo: language change was not applied.", error);
    });
  }

  window.getRentuloLanguage = getRentuloLanguage;
  window.setRentuloLanguage = setRentuloLanguage;
  window.applyRentuloTranslations = applyRentuloTranslations;
  window.rentuloTranslate = translate;

  document.addEventListener("DOMContentLoaded", function () {
    contentReady = true;
    applyRentuloTranslations();
  });

  const initialLanguage = getRentuloLanguage();
  if (initialLanguage !== DEFAULT_LANGUAGE) {
    const initialChange = languageChangeNumber;
    void loadLanguage(initialLanguage).then(function () {
      if (initialChange !== languageChangeNumber ||
          getRentuloLanguage() !== initialLanguage || !contentReady) return;
      // When loaded before DOMContentLoaded, the normal DOM handler applies it.
      // When loaded afterwards, refresh all dynamic page components as well.
      applyRentuloTranslations(initialLanguage);
      announceLanguage(initialLanguage);
    }).catch(function (error) {
      console.warn("Rentulo: using Czech fallback until translations are available.", error);
    });
  }
})();
