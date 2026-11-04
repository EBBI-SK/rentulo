"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const APP_ORIGIN = "https://rentulo.test";

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8");
}

function createBaseContext(search) {
  const context = {
    URL,
    URLSearchParams,
    console,
    document: {
      addEventListener() {},
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      getElementById() {
        return null;
      }
    },
    location: {
      origin: APP_ORIGIN,
      pathname: "/prihlaseni.html",
      search,
      hash: "",
      href: APP_ORIGIN + "/prihlaseni.html" + search
    }
  };

  context.window = context;
  return context;
}

function getLoginSafeReturnTo(returnTo) {
  const search = returnTo
    ? "?returnTo=" + encodeURIComponent(returnTo)
    : "";
  const context = createBaseContext(search);

  vm.createContext(context);
  vm.runInContext(
    readProjectFile("js/login-page.js"),
    context,
    { filename: "js/login-page.js" }
  );

  assert.equal(typeof context.loginGetSafeReturnTo, "function");
  return context.loginGetSafeReturnTo();
}

async function getRecoveryBackLink(returnTo) {
  const search = returnTo
    ? "?returnTo=" + encodeURIComponent(returnTo)
    : "";
  const context = createBaseContext(search);
  const backLink = { href: "" };
  let domContentLoadedHandler = null;

  context.location.pathname = "/obnova-hesla.html";
  context.location.href = APP_ORIGIN + "/obnova-hesla.html" + search;
  context.document.addEventListener = function (eventName, handler) {
    if (eventName === "DOMContentLoaded") {
      domContentLoadedHandler = handler;
    }
  };
  context.document.querySelectorAll = function (selector) {
    if (selector === 'a[data-i18n="passwordRecovery.backToLogin"]') {
      return [backLink];
    }
    return [];
  };

  vm.createContext(context);
  vm.runInContext(
    readProjectFile("js/password-recovery-page.js"),
    context,
    { filename: "js/password-recovery-page.js" }
  );

  assert.equal(typeof domContentLoadedHandler, "function");
  await domContentLoadedHandler();
  return backLink.href;
}

const safeUuid = "123e4567-e89b-42d3-a456-426614174000";

test("login redirect allowlist accepts only approved internal destinations", () => {
  const cases = [
    ["historie.html", "historie.html"],
    ["moje-nabidky.html", "moje-nabidky.html"],
    ["moje-rezervace.html", "moje-rezervace.html"],
    ["nabidnout.html", "nabidnout.html"],
    ["nastaveni.html", "nastaveni.html"],
    ["detail.html?id=" + safeUuid, "detail.html?id=" + safeUuid],
    ["edit-nabidka.html?id=" + safeUuid, "edit-nabidka.html?id=" + safeUuid],
    [APP_ORIGIN + "/nastaveni.html", "nastaveni.html"]
  ];

  for (const [input, expected] of cases) {
    assert.equal(getLoginSafeReturnTo(input), expected, input);
  }
});

test("login redirect allowlist rejects external, executable and malformed destinations", () => {
  const rejected = [
    "https://evil.example/phishing",
    "//evil.example/phishing",
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "index.html",
    "muj-ucet.html",
    APP_ORIGIN + "/muj-ucet.html",
    "detail.html?id=not-a-uuid",
    "edit-nabidka.html?id=123"
  ];

  for (const input of rejected) {
    assert.equal(getLoginSafeReturnTo(input), "", input);
  }
});

test("email reservation links survive login without carrying untrusted parameters", () => {
  for (const page of ["moje-nabidky.html", "moje-rezervace.html", "historie.html"]) {
    assert.equal(getLoginSafeReturnTo(`${page}?reservation=${safeUuid}`), `${page}?reservation=${safeUuid}`);
    assert.equal(getLoginSafeReturnTo(`${page}?reservation=not-a-uuid`), page);
    assert.equal(getLoginSafeReturnTo(`${page}?reservation=${safeUuid}&next=https://evil.example`),
      `${page}?reservation=${safeUuid}`);
  }
  assert.equal(getLoginSafeReturnTo("https://evil.example/moje-nabidky.html?reservation=" + safeUuid), "");
});

test("password recovery keeps the same safe return target when going back to login", async () => {
  assert.equal(
    await getRecoveryBackLink("nastaveni.html"),
    "prihlaseni.html?returnTo=nastaveni.html"
  );

  assert.equal(
    await getRecoveryBackLink("detail.html?id=" + safeUuid),
    "prihlaseni.html?returnTo=" + encodeURIComponent("detail.html?id=" + safeUuid)
  );
});

test("password recovery drops unsafe return targets", async () => {
  assert.equal(
    await getRecoveryBackLink("https://evil.example/phishing"),
    "prihlaseni.html"
  );

  assert.equal(
    await getRecoveryBackLink("muj-ucet.html"),
    "prihlaseni.html"
  );

  assert.equal(
    await getRecoveryBackLink("detail.html?id=not-a-uuid"),
    "prihlaseni.html"
  );
});
