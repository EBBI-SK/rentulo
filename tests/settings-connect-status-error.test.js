"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "js", "connect-settings.js"), "utf8");

function createElement() {
  const handlers = {};
  const classes = new Set();
  return {
    dataset: {},
    hidden: false,
    disabled: false,
    textContent: "",
    className: "",
    handlers,
    classList: {
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      add(name) { classes.add(name); },
      contains(name) { return classes.has(name); }
    },
    setAttribute() {},
    addEventListener(event, handler) { handlers[event] = handler; }
  };
}

function createHarness(responses, query = "", initialLang = "cs") {
  const nodes = new Map();
  const domHandlers = {};
  const calls = [];
  const replacedUrls = [];
  let lang = initialLang;
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, createElement());
    return nodes.get(id);
  };
  const location = { pathname: "/nastaveni.html", search: query, href: "https://rentulo.com/nastaveni.html" + query };
  const window = {
    rentuloSupabase: {
      functions: {
        async invoke(name) {
          calls.push(name);
          if (name === "get-connect-status") {
            const response = responses.shift();
            if (response instanceof Error) throw response;
            return response || { error: new Error("Unexpected extra request") };
          }
          if (name === "create-connect-account") return { data: { status: "onboarding" }, error: null };
          if (name === "create-connect-onboarding-link") return { data: { url: "https://connect.stripe.com/setup" }, error: null };
          throw new Error("Unexpected function: " + name);
        }
      }
    },
    location,
    history: { replaceState(_state, _title, url) { replacedUrls.push(url); } },
    getRentuloLanguage() { return lang; }
  };
  const document = {
    getElementById: get,
    addEventListener(name, callback) { domHandlers[name] = callback; }
  };
  vm.runInNewContext(source, { window, document, URLSearchParams, console: { error() {} } });
  const settle = async () => {
    for (let index = 0; index < 4; index += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  return {
    get,
    calls,
    location,
    replacedUrls,
    async start() { domHandlers.DOMContentLoaded(); await settle(); },
    async click() { get("connectSettingsButton").handlers.click(); await settle(); },
    async changeLanguage(value) { lang = value; domHandlers.rentuloLanguageChanged(); await settle(); }
  };
}

test("failed status request is explicitly unknown, never shown as not_started, and retry does not onboard", async () => {
  const app = createHarness([new Error("Network failure"), { data: { status: "not_started" }, error: null }]);
  await app.start();

  assert.equal(app.get("connectSettingsStatus").dataset.status, "error");
  assert.equal(app.get("connectSettingsStatus").textContent, "Stav výplat není dostupný");
  assert.equal(app.get("connectSettingsButtonLabel").textContent, "Načíst stav znovu");
  assert.equal(app.get("connectSettingsGuidance").hidden, true);
  assert.equal(app.get("connectSettingsButton").disabled, false);
  assert.match(app.get("connectSettingsMessage").textContent, /nepodařilo načíst/);
  assert.deepEqual(app.calls, ["get-connect-status"]);

  await app.click();
  assert.equal(app.get("connectSettingsStatus").dataset.status, "not_started");
  assert.deepEqual(app.calls, ["get-connect-status", "get-connect-status"]);
  assert.equal(app.location.href.includes("connect.stripe.com"), false);

  await app.click();
  assert.deepEqual(app.calls, ["get-connect-status", "get-connect-status", "create-connect-account", "create-connect-onboarding-link"]);
  assert.equal(app.location.href, "https://connect.stripe.com/setup");
});

test("invalid status from backend stays unknown and Stripe refresh callback cannot start onboarding", async () => {
  const app = createHarness([{ data: { status: "nonsense" }, error: null }], "?connect=refresh&source=test", "en");
  await app.start();

  assert.equal(app.get("connectSettingsStatus").dataset.status, "error");
  assert.equal(app.get("connectSettingsButtonLabel").textContent, "Reload payout status");
  assert.deepEqual(app.calls, ["get-connect-status"]);
  assert.deepEqual(app.replacedUrls, ["/nastaveni.html?source=test"]);
  assert.equal(app.get("connectSettingsGuidance").hidden, true);
});

test("error message and retry label translate with language changes", async () => {
  const app = createHarness([{ error: new Error("Gateway timeout") }], "", "cs");
  await app.start();
  await app.changeLanguage("sk");
  assert.equal(app.get("connectSettingsStatus").textContent, "Stav výplat nie je dostupný");
  assert.equal(app.get("connectSettingsButtonLabel").textContent, "Načítať stav znova");
  assert.match(app.get("connectSettingsMessage").textContent, /nepodarilo načítať/);
  await app.changeLanguage("de");
  assert.equal(app.get("connectSettingsButtonLabel").textContent, "Status erneut laden");
});

test("ready status keeps onboarding disabled", async () => {
  const app = createHarness([{ data: { status: "ready" }, error: null }]);
  await app.start();
  assert.equal(app.get("connectSettingsStatus").dataset.status, "ready");
  assert.equal(app.get("connectSettingsButton").disabled, true);
  await app.click();
  assert.deepEqual(app.calls, ["get-connect-status"]);
});
