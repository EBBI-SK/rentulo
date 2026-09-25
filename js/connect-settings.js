(function () {
  const SUPPORTED_LANGUAGES = ["cs", "sk", "en", "de", "pl"];
  const COPY = {
    cs: {
      title: "V\u00fdplaty za pron\u00e1jmy",
      description: "Pro p\u0159ij\u00edm\u00e1n\u00ed v\u00fdplat za pron\u00e1jmy dokon\u010dete zabezpe\u010den\u00e9 nastaven\u00ed p\u0159es Stripe. Bankovn\u00ed a ov\u011b\u0159ovac\u00ed \u00fadaje zad\u00e1v\u00e1te p\u0159\u00edmo u Stripe.",
      statusLabel: "Stav",
      loading: "Na\u010d\u00edt\u00e1m stav\u2026",
      notStarted: "V\u00fdplaty nejsou nastaven\u00e9",
      onboarding: "Nastaven\u00ed nen\u00ed dokon\u010den\u00e9",
      restricted: "Stripe vy\u017eaduje dopln\u011bn\u00ed \u00fadaj\u016f",
      ready: "P\u0159ipraveno na v\u00fdplaty",
      guidanceTitle: "Co v\u00e1s \u010dek\u00e1 ve Stripe",
      guidanceIdentity: "Stripe ov\u011b\u0159\u00ed va\u0161i toto\u017enost a bankovn\u00ed \u00fa\u010det, aby v\u00e1m mohl Rentulo pos\u00edlat v\u00fdplaty.",
      guidancePrivate: "Pokud pronaj\u00edm\u00e1te jako soukrom\u00e1 osoba, nejde o registraci \u017eivnosti ani firmy.",
      guidanceWebsite: "Pokud se Stripe zept\u00e1 na webovou str\u00e1nku, pou\u017eijte https://rentulo.eu.",
      guidancePrivacy: "Bankovn\u00ed a ov\u011b\u0159ovac\u00ed \u00fadaje zad\u00e1v\u00e1te p\u0159\u00edmo Stripe; Rentulo je neukl\u00e1d\u00e1.",
      note: "Rentulo je zat\u00edm provozov\u00e1no pouze v \u010cesk\u00e9 republice. Stripe \u00fa\u010det pro v\u00fdplaty bude proto zalo\u017een pro \u010cesko.",
      start: "Nastavit v\u00fdplaty p\u0159es Stripe",
      continue: "Pokra\u010dovat v nastaven\u00ed",
      loadingButton: "Otev\u00edr\u00e1m Stripe\u2026",
      readyButton: "V\u00fdplaty jsou nastaven\u00e9",
      error: "Stav v\u00fdplat se nepoda\u0159ilo na\u010d\u00edst. Zkuste to pros\u00edm znovu.",
      openError: "Stripe nastaven\u00ed se nepoda\u0159ilo otev\u0159\u00edt. Zkuste to pros\u00edm znovu."
    },
    sk: {
      title: "V\u00fdplaty za pren\u00e1jmy",
      description: "Na prij\u00edmanie v\u00fdplat za pren\u00e1jmy dokon\u010dite zabezpe\u010den\u00e9 nastavenie cez Stripe. Bankov\u00e9 a overovacie \u00fadaje zad\u00e1vate priamo v Stripe.",
      statusLabel: "Stav",
      loading: "Na\u010d\u00edtavam stav\u2026",
      notStarted: "V\u00fdplaty nie s\u00fa nastaven\u00e9",
      onboarding: "Nastavenie nie je dokon\u010den\u00e9",
      restricted: "Stripe vy\u017eaduje doplnenie \u00fadajov",
      ready: "Pripraven\u00e9 na v\u00fdplaty",
      guidanceTitle: "\u010co v\u00e1s \u010dak\u00e1 v Stripe",
      guidanceIdentity: "Stripe over\u00ed va\u0161u toto\u017enos\u0165 a bankov\u00fd \u00fa\u010det, aby v\u00e1m mohlo Rentulo posiela\u0165 v\u00fdplaty.",
      guidancePrivate: "Ak prenaj\u00edmate ako s\u00fakromn\u00e1 osoba, nejde o registr\u00e1ciu \u017eivnosti ani firmy.",
      guidanceWebsite: "Ak sa Stripe op\u00fdta na webov\u00fa str\u00e1nku, pou\u017eite https://rentulo.eu.",
      guidancePrivacy: "Bankov\u00e9 a overovacie \u00fadaje zad\u00e1vate priamo Stripe; Rentulo ich neuklad\u00e1.",
      note: "Rentulo je zatia\u013e prev\u00e1dzkovan\u00e9 iba v \u010ceskej republike. Stripe \u00fa\u010det pre v\u00fdplaty bude preto zalo\u017een\u00fd pre \u010cesko.",
      start: "Nastavi\u0165 v\u00fdplaty cez Stripe",
      continue: "Pokra\u010dova\u0165 v nastaven\u00ed",
      loadingButton: "Otv\u00e1ram Stripe\u2026",
      readyButton: "V\u00fdplaty s\u00fa nastaven\u00e9",
      error: "Stav v\u00fdplat sa nepodarilo na\u010d\u00edta\u0165. Sk\u00faste to znova.",
      openError: "Nastavenie Stripe sa nepodarilo otvori\u0165. Sk\u00faste to znova."
    },
    en: {
      title: "Rental payouts",
      description: "Complete secure Stripe onboarding to receive rental payouts. Bank and verification details are entered directly with Stripe.",
      statusLabel: "Status",
      loading: "Loading status\u2026",
      notStarted: "Payouts are not set up",
      onboarding: "Setup is not complete",
      restricted: "Stripe requires more information",
      ready: "Ready for payouts",
      guidanceTitle: "What to expect in Stripe",
      guidanceIdentity: "Stripe verifies your identity and bank account so Rentulo can send you payouts.",
      guidancePrivate: "If you rent out items as a private individual, this does not register you as a business or sole trader.",
      guidanceWebsite: "If Stripe asks for a website, use https://rentulo.eu.",
      guidancePrivacy: "You enter bank and verification details directly with Stripe; Rentulo does not store them.",
      note: "Rentulo currently operates only in the Czech Republic, so the Stripe payout account is created for Czechia.",
      start: "Set up payouts with Stripe",
      continue: "Continue setup",
      loadingButton: "Opening Stripe\u2026",
      readyButton: "Payouts are set up",
      error: "Payout status could not be loaded. Please try again.",
      openError: "Stripe setup could not be opened. Please try again."
    },
    de: {
      title: "Auszahlungen f\u00fcr Vermietungen",
      description: "Schlie\u00dfen Sie das sichere Stripe-Onboarding ab, um Auszahlungen f\u00fcr Vermietungen zu erhalten. Bank- und Verifizierungsdaten geben Sie direkt bei Stripe ein.",
      statusLabel: "Status",
      loading: "Status wird geladen\u2026",
      notStarted: "Auszahlungen sind nicht eingerichtet",
      onboarding: "Einrichtung ist nicht abgeschlossen",
      restricted: "Stripe ben\u00f6tigt weitere Angaben",
      ready: "Bereit f\u00fcr Auszahlungen",
      guidanceTitle: "Was Sie bei Stripe erwartet",
      guidanceIdentity: "Stripe pr\u00fcft Ihre Identit\u00e4t und Ihr Bankkonto, damit Rentulo Ihnen Auszahlungen senden kann.",
      guidancePrivate: "Wenn Sie als Privatperson vermieten, werden Sie dadurch nicht als Unternehmen oder Gewerbetreibender registriert.",
      guidanceWebsite: "Wenn Stripe nach einer Website fragt, verwenden Sie https://rentulo.eu.",
      guidancePrivacy: "Bank- und Verifizierungsdaten geben Sie direkt bei Stripe ein; Rentulo speichert diese Daten nicht.",
      note: "Rentulo wird derzeit nur in Tschechien betrieben. Das Stripe-Auszahlungskonto wird daher f\u00fcr Tschechien erstellt.",
      start: "Auszahlungen mit Stripe einrichten",
      continue: "Einrichtung fortsetzen",
      loadingButton: "Stripe wird ge\u00f6ffnet\u2026",
      readyButton: "Auszahlungen sind eingerichtet",
      error: "Der Auszahlungsstatus konnte nicht geladen werden. Bitte versuchen Sie es erneut.",
      openError: "Die Stripe-Einrichtung konnte nicht ge\u00f6ffnet werden. Bitte versuchen Sie es erneut."
    },
    pl: {
      title: "Wyp\u0142aty za wynajem",
      description: "Doko\u0144cz bezpieczn\u0105 konfiguracj\u0119 Stripe, aby otrzymywa\u0107 wyp\u0142aty za wynajem. Dane bankowe i weryfikacyjne podajesz bezpo\u015brednio w Stripe.",
      statusLabel: "Status",
      loading: "Wczytywanie statusu\u2026",
      notStarted: "Wyp\u0142aty nie s\u0105 skonfigurowane",
      onboarding: "Konfiguracja nie jest uko\u0144czona",
      restricted: "Stripe wymaga uzupe\u0142nienia danych",
      ready: "Gotowe do wyp\u0142at",
      guidanceTitle: "Czego spodziewa\u0107 si\u0119 w Stripe",
      guidanceIdentity: "Stripe zweryfikuje Twoj\u0105 to\u017csamo\u015b\u0107 i konto bankowe, aby Rentulo mog\u0142o wysy\u0142a\u0107 Ci wyp\u0142aty.",
      guidancePrivate: "Je\u015bli wynajmujesz jako osoba prywatna, nie oznacza to rejestracji dzia\u0142alno\u015bci gospodarczej ani firmy.",
      guidanceWebsite: "Je\u015bli Stripe poprosi o stron\u0119 internetow\u0105, u\u017cyj https://rentulo.eu.",
      guidancePrivacy: "Dane bankowe i weryfikacyjne podajesz bezpo\u015brednio Stripe; Rentulo ich nie przechowuje.",
      note: "Rentulo dzia\u0142a obecnie wy\u0142\u0105cznie w Czechach, dlatego konto Stripe do wyp\u0142at zostanie utworzone dla Czech.",
      start: "Skonfiguruj wyp\u0142aty przez Stripe",
      continue: "Kontynuuj konfiguracj\u0119",
      loadingButton: "Otwieranie Stripe\u2026",
      readyButton: "Wyp\u0142aty s\u0105 skonfigurowane",
      error: "Nie uda\u0142o si\u0119 wczyta\u0107 statusu wyp\u0142at. Spr\u00f3buj ponownie.",
      openError: "Nie uda\u0142o si\u0119 otworzy\u0107 konfiguracji Stripe. Spr\u00f3buj ponownie."
    }
  };

  let currentStatus = "loading";

  function language() {
    const value = typeof window.getRentuloLanguage === "function" ? window.getRentuloLanguage() : "cs";
    return SUPPORTED_LANGUAGES.includes(value) ? value : "cs";
  }

  function client() {
    return window.rentuloSupabase || (typeof rentuloSupabase !== "undefined" ? rentuloSupabase : null);
  }

  function setLoading(loading) {
    const button = document.getElementById("connectSettingsButton");
    if (!button) return;
    button.classList.toggle("is-loading", loading);
    button.disabled = loading || currentStatus === "ready" || currentStatus === "loading";
    button.setAttribute("aria-busy", loading ? "true" : "false");
  }

  function setMessage(text, type) {
    const element = document.getElementById("connectSettingsMessage");
    if (!element) return;
    element.textContent = text || "";
    element.className = "message";
    if (text && type) element.classList.add(type);
  }

  function render() {
    const text = COPY[language()] || COPY.cs;
    const title = document.getElementById("connectSettingsTitle");
    const description = document.getElementById("connectSettingsDescription");
    const statusLabel = document.getElementById("connectSettingsStatusLabel");
    const status = document.getElementById("connectSettingsStatus");
    const guidance = document.getElementById("connectSettingsGuidance");
    const guidanceTitle = document.getElementById("connectSettingsGuidanceTitle");
    const guidanceIdentity = document.getElementById("connectSettingsGuidanceIdentity");
    const guidancePrivate = document.getElementById("connectSettingsGuidancePrivate");
    const guidanceWebsite = document.getElementById("connectSettingsGuidanceWebsite");
    const guidancePrivacy = document.getElementById("connectSettingsGuidancePrivacy");
    const note = document.getElementById("connectSettingsNote");
    const button = document.getElementById("connectSettingsButton");
    const buttonLabel = document.getElementById("connectSettingsButtonLabel");
    const buttonLoading = document.getElementById("connectSettingsButtonLoading");
    if (title) title.textContent = text.title;
    if (description) description.textContent = text.description;
    if (statusLabel) statusLabel.textContent = text.statusLabel;
    if (guidance) guidance.hidden = currentStatus === "ready" || currentStatus === "loading";
    if (guidanceTitle) guidanceTitle.textContent = text.guidanceTitle;
    if (guidanceIdentity) guidanceIdentity.textContent = text.guidanceIdentity;
    if (guidancePrivate) guidancePrivate.textContent = text.guidancePrivate;
    if (guidanceWebsite) guidanceWebsite.textContent = text.guidanceWebsite;
    if (guidancePrivacy) guidancePrivacy.textContent = text.guidancePrivacy;
    if (note) note.textContent = text.note;
    if (buttonLoading) buttonLoading.textContent = text.loadingButton;
    if (status) {
      status.dataset.status = currentStatus;
      status.textContent = currentStatus === "ready" ? text.ready : currentStatus === "restricted" ? text.restricted : currentStatus === "onboarding" ? text.onboarding : currentStatus === "not_started" ? text.notStarted : text.loading;
    }
    if (buttonLabel) buttonLabel.textContent = currentStatus === "ready" ? text.readyButton : currentStatus === "not_started" ? text.start : text.continue;
    if (button) button.disabled = currentStatus === "ready" || currentStatus === "loading";
  }

  async function loadStatus() {
    const supabase = client();
    if (!supabase) return;
    currentStatus = "loading";
    render();
    setMessage("", "");
    const { data, error } = await supabase.functions.invoke("get-connect-status", { body: {} });
    if (error || !data || !["not_started", "onboarding", "restricted", "ready"].includes(data.status)) {
      console.error("Stripe Connect status load failed", error || data);
      currentStatus = "not_started";
      render();
      setMessage((COPY[language()] || COPY.cs).error, "error");
      return;
    }
    currentStatus = data.status;
    render();
  }

  async function openOnboarding() {
    const supabase = client();
    if (!supabase || currentStatus === "ready") return;
    setMessage("", "");
    setLoading(true);
    try {
      if (currentStatus === "not_started") {
        const created = await supabase.functions.invoke("create-connect-account", { body: {} });
        if (created.error) throw created.error;
      }
      const link = await supabase.functions.invoke("create-connect-onboarding-link", { body: {} });
      if (link.error || !link.data || typeof link.data.url !== "string" || !link.data.url.startsWith("https://")) throw link.error || new Error("Missing Stripe onboarding URL");
      window.location.href = link.data.url;
    } catch (error) {
      console.error("Stripe Connect onboarding failed", error);
      setMessage((COPY[language()] || COPY.cs).openError, "error");
      setLoading(false);
    }
  }

  async function initialize() {
    const button = document.getElementById("connectSettingsButton");
    if (!button) return;
    button.addEventListener("click", openOnboarding);
    await loadStatus();
    const params = new URLSearchParams(window.location.search);
    if (params.get("connect") === "refresh" && currentStatus !== "ready") {
      await openOnboarding();
    } else if (params.has("connect")) {
      params.delete("connect");
      const query = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (query ? "?" + query : ""));
    }
  }

  document.addEventListener("rentuloLanguageChanged", render);
  document.addEventListener("DOMContentLoaded", function () { void initialize(); });
})();
