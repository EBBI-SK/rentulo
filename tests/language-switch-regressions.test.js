"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (filename) => fs.readFileSync(path.join(root, filename), "utf8");
const languages = ["cs", "sk", "en", "de", "pl"];

function createElement() {
  const listeners = new Map();
  const attributes = {};
  const element = {
    textContent: "",
    innerHTML: "",
    className: "",
    dataset: {},
    attributes,
    hidden: false,
    disabled: false,
    value: "",
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    setAttribute(name, value) {
      attributes[name] = String(value);
      if (name === "data-i18n") this.dataset.i18n = String(value);
    },
    removeAttribute(name) {
      delete attributes[name];
      if (name === "data-i18n") delete this.dataset.i18n;
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    insertAdjacentElement() {},
    focus() { this.focused = true; },
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(callback);
    },
    emit(name, event = { preventDefault() {} }) {
      return (listeners.get(name) || []).map((callback) => callback(event));
    }
  };
  return element;
}

function createEnvironment() {
  const byId = {};
  const bySelector = {};
  const listeners = new Map();
  const store = new Map();
  const session = new Map();
  const document = {
    documentElement: { lang: "cs" },
    body: { dataset: {}, appendChild(element) { bySelector[".site-message"] = element; } },
    title: "",
    getElementById(id) { return byId[id] || null; },
    querySelector(selector) { return bySelector[selector] || null; },
    querySelectorAll(selector) {
      if (selector === "[data-i18n]") {
        return [...new Set([...Object.values(byId), ...Object.values(bySelector)])]
          .filter((element) => Object.hasOwn(element.dataset || {}, "i18n"));
      }
      if (selector === "[data-i18n-placeholder]") {
        return [...new Set([...Object.values(byId), ...Object.values(bySelector)])]
          .filter((element) => Object.hasOwn(element.dataset || {}, "i18nPlaceholder"));
      }
      return [];
    },
    createElement() { return createElement(); },
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(callback);
    },
    dispatchEvent(event) {
      (listeners.get(event.type) || []).forEach((callback) => callback(event));
    },
    async ready() {
      for (const callback of listeners.get("DOMContentLoaded") || []) {
        await callback();
      }
    }
  };
  const window = {
    history: { state: null },
    location: {
      href: "https://rentulo.eu/obnova-hesla.html",
      origin: "https://rentulo.eu",
      pathname: "/obnova-hesla.html",
      search: "",
      hash: "",
      replace() {}
    },
    sessionStorage: {
      getItem: (key) => session.get(key) || null,
      setItem: (key, value) => session.set(key, value),
      removeItem: (key) => session.delete(key)
    },
    setTimeout() {}
  };
  const context = vm.createContext({
    document,
    window,
    console: { ...console, error() {} },
    navigator: { platform: "Win32" },
    URL,
    URLSearchParams,
    setTimeout() {},
    clearTimeout() {},
    localStorage: {
      getItem: (key) => store.get(key) || null,
      setItem: (key, value) => store.set(key, value)
    },
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options.detail;
      }
    }
  });
  vm.runInContext(read("js/i18n.js"), context, { timeout: 5000 });
  return { context, document, window, byId, bySelector };
}

function runScript(env, filename) {
  vm.runInContext(read(filename), env.context, { timeout: 5000 });
}

function translated(env, key, language) {
  return env.window.rentuloTranslate(key, language);
}

test("all five legal handover instructions use the actual localized confirmation button label", () => {
  const env = createEnvironment();
  const buttonLabels = {
    cs: "Předat věc",
    sk: "Odovzdať vec",
    en: "Hand over item",
    de: "Gegenstand übergeben",
    pl: "Przekaż przedmiot"
  };

  for (const language of languages) {
    const instruction = translated(env, "terms.section8.item1", language);
    assert.notEqual(instruction, "terms.section8.item1");
    assert.ok(instruction.includes(buttonLabels[language]), language);
    if (language !== "cs") assert.ok(!instruction.includes("Předat věc"), language);
  }

  // Confirmation action is currently localized separately in the pickup module.
  const pickup = read("js/pickup-security.js");
  for (const label of Object.values(buttonLabels)) {
    assert.ok(pickup.includes('confirmAction: "' + label + '"'));
  }
});

test("map zoom-controls accessible label follows CZ/SK/EN/DE/PL switches", () => {
  const env = createEnvironment();
  const map = createElement();
  const controls = createElement();
  const mapStatus = createElement();
  env.byId.homeOffersMap = map;
  env.byId.homeMapStatus = mapStatus;
  env.bySelector[".home-map-zoom-controls"] = controls;
  const html = read("index.html");
  assert.match(html, /class="home-map-zoom-controls"[^>]*data-i18n-aria-label="home\.mapZoomControlsAriaLabel"/);

  runScript(env, "js/home-page.js");

  for (const language of languages) {
    env.window.setRentuloLanguage(language);
    assert.equal(controls.attributes["aria-label"], translated(env, "home.mapZoomControlsAriaLabel", language));
    assert.equal(map.attributes["aria-label"], translated(env, "home.mapAriaLabel", language));
    assert.equal(mapStatus.textContent, translated(env, "home.mapLoading", language));
  }
});

test("editing a listing preserves unsaved input and selected filename across language switches", () => {
  const env = createEnvironment();
  const preview = createElement();
  const photoButton = createElement();
  const fileName = createElement();
  const saveButton = createElement();
  const input = createElement();
  const description = createElement();
  const toast = createElement();
  env.bySelector["#editPhotoPreview"] = preview;
  env.bySelector[".photo-file-button"] = photoButton;
  env.byId.editPhotoFileName = fileName;
  env.bySelector["#save-edit-button"] = saveButton;
  env.bySelector["#edit-name"] = input;
  env.bySelector["#edit-description"] = description;
  env.bySelector[".site-message"] = toast;
  input.value = "Moje rozepsaná nabídka";
  description.value = "Popis, který nesmí zmizet";

  runScript(env, "js/edit-offer.js");
  vm.runInContext(`editCurrentOffer = { name: "Vrtačka" };
    editOfferPhotoState = "new";
    editOfferSelectedPhotoFileName = "picture.png";
    editSaveInProgress = true;
    editShowTranslatedMessage("editOffer.validation", "Vyplňte prosím všechna povinná pole.");`, env.context);

  for (const language of languages) {
    env.window.setRentuloLanguage(language);
    assert.equal(input.value, "Moje rozepsaná nabídka");
    assert.equal(description.value, "Popis, který nesmí zmizet");
    assert.equal(fileName.textContent, "picture.png");
    assert.equal(photoButton.textContent, translated(env, "editOffer.chooseAnotherPhoto", language));
    assert.equal(preview.textContent, translated(env, "editOffer.noPhoto", language));
    assert.equal(saveButton.textContent, translated(env, "editOffer.saving", language));
    assert.equal(saveButton.disabled, true);
    assert.equal(toast.textContent, translated(env, "editOffer.validation", language));
    assert.equal(env.document.title, translated(env, "editOffer.title", language) + " - Vrtačka");
  }
});

test("existing edited photo is not replaced when only its accessible label changes", () => {
  const env = createEnvironment();
  const preview = createElement();
  const image = createElement();
  const photoButton = createElement();
  const fileName = createElement();
  const saveButton = createElement();
  preview.querySelector = (selector) => selector === "img" ? image : null;
  env.bySelector["#editPhotoPreview"] = preview;
  env.bySelector[".photo-file-button"] = photoButton;
  env.byId.editPhotoFileName = fileName;
  env.bySelector["#save-edit-button"] = saveButton;
  runScript(env, "js/edit-offer.js");
  vm.runInContext('editCurrentOffer = { name: "Stan" }; editOfferPhotoState = "current";', env.context);

  for (const language of languages) {
    env.window.setRentuloLanguage(language);
    assert.equal(image.alt, translated(env, "editOffer.photoTitle", language));
    assert.equal(photoButton.textContent, translated(env, "editOffer.changePhoto", language));
    assert.equal(fileName.textContent, translated(env, "editOffer.currentPhotoFile", language));
  }
  assert.equal(preview.innerHTML, "", "image is not re-rendered by the language change");
});

test("edit-offer error/forbidden screen and price-lock notice are marked for translation", () => {
  const env = createEnvironment();
  const editPage = createElement();
  const priceInput = createElement();
  let notice;
  priceInput.insertAdjacentElement = (_position, element) => {
    notice = element;
    env.bySelector[".edit-price-lock-notice"] = element;
  };
  env.bySelector[".edit-page"] = editPage;
  env.bySelector["#edit-price"] = priceInput;
  runScript(env, "js/edit-offer.js");

  vm.runInContext("showEditOfferNotFound()", env.context);
  for (const key of ["notFoundEyebrow", "notFoundTitle", "notFoundDescription", "backToListings"]) {
    assert.ok(editPage.innerHTML.includes('data-i18n="editOffer.' + key + '"'));
  }
  vm.runInContext("showEditOfferForbidden()", env.context);
  for (const key of ["forbiddenEyebrow", "forbiddenTitle", "forbiddenDescription", "backToListings"]) {
    assert.ok(editPage.innerHTML.includes('data-i18n="editOffer.' + key + '"'));
  }

  vm.runInContext("editLockPriceFields(true)", env.context);
  assert.equal(notice.dataset.i18n, "editOffer.priceLocked");
  env.window.setRentuloLanguage("de");
  assert.equal(notice.textContent, translated(env, "editOffer.priceLocked", "de"));
});

function prepareRecovery(env, auth) {
  const requestForm = createElement();
  const passwordForm = createElement();
  const requestButton = createElement();
  const saveButton = createElement();
  const requestMessage = createElement();
  const passwordMessage = createElement();
  const email = createElement();
  const newPassword = createElement();
  const confirmPassword = createElement();
  env.byId.requestResetForm = requestForm;
  env.byId.setPasswordForm = passwordForm;
  env.byId.requestResetButton = requestButton;
  env.byId.savePasswordButton = saveButton;
  env.byId.requestMessage = requestMessage;
  env.byId.passwordMessage = passwordMessage;
  env.byId.recoveryEmail = email;
  env.byId.newPassword = newPassword;
  env.byId.confirmPassword = confirmPassword;
  env.context.getSupabaseClient = () => ({ auth: {
    onAuthStateChange() {},
    async getSession() { return { data: { session: null } }; },
    ...auth
  } });
  env.context.meetsRentuloPasswordRequirements = () => true;
  env.context.isRentuloWeakPasswordError = () => false;
  runScript(env, "js/password-recovery-page.js");
  return { requestForm, passwordForm, requestButton, saveButton, requestMessage, passwordMessage, email, newPassword, confirmPassword };
}

function finishAsyncHandlers() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("recovery request keeps 'sending' localized while in flight and re-translates an error", async () => {
  const env = createEnvironment();
  let completeRequest;
  const recovery = prepareRecovery(env, {
    resetPasswordForEmail: () => new Promise((resolve) => { completeRequest = resolve; })
  });
  recovery.requestButton.dataset.i18n = "passwordRecovery.send";
  recovery.email.value = "user@example.com";
  await env.document.ready();
  recovery.requestForm.emit("submit");
  assert.equal(recovery.requestButton.disabled, true);

  env.window.setRentuloLanguage("de");
  assert.equal(recovery.requestButton.textContent, translated(env, "passwordRecovery.sending", "de"));

  completeRequest({ error: { code: "over_email_send_rate_limit" } });
  await finishAsyncHandlers();
  assert.equal(recovery.requestMessage.dataset.i18n, "passwordRecovery.error.rateLimit");
  assert.equal(recovery.requestButton.disabled, false);

  env.window.setRentuloLanguage("pl");
  assert.equal(recovery.requestMessage.textContent, translated(env, "passwordRecovery.error.rateLimit", "pl"));
  recovery.email.value = "invalid";
  recovery.requestForm.emit("submit");
  assert.equal(recovery.requestMessage.dataset.i18n, "passwordRecovery.error.emailRequired");
  env.window.setRentuloLanguage("sk");
  assert.equal(recovery.requestMessage.textContent, translated(env, "passwordRecovery.error.emailRequired", "sk"));
});

test("recovery password reset keeps 'saving' localized and refreshes password error", async () => {
  const env = createEnvironment();
  env.window.location.href += "?type=recovery";
  env.window.location.search = "?type=recovery";
  let completeRequest;
  const recovery = prepareRecovery(env, {
    updateUser: () => new Promise((resolve) => { completeRequest = resolve; })
  });
  recovery.saveButton.dataset.i18n = "passwordRecovery.save";
  recovery.newPassword.value = "Example!123";
  recovery.confirmPassword.value = "Example!123";
  await env.document.ready();
  recovery.passwordForm.emit("submit");
  assert.equal(recovery.saveButton.disabled, true);

  env.window.setRentuloLanguage("en");
  assert.equal(recovery.saveButton.textContent, translated(env, "passwordRecovery.saving", "en"));

  completeRequest({ error: { code: "same_password" } });
  await finishAsyncHandlers();
  assert.equal(recovery.passwordMessage.dataset.i18n, "passwordRecovery.error.sameAsOldPassword");
  assert.equal(recovery.saveButton.disabled, false);

  env.window.setRentuloLanguage("sk");
  assert.equal(recovery.passwordMessage.textContent, translated(env, "passwordRecovery.error.sameAsOldPassword", "sk"));
});
