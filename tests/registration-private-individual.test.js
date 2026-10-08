"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function makeElement(value = "") {
  const attributes = new Map();
  const classes = new Set();
  return {
    value,
    checked: false,
    defaultChecked: false,
    textContent: "",
    disabled: false,
    focused: false,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name)
    },
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: (name) => attributes.get(name) ?? null,
    removeAttribute: (name) => attributes.delete(name),
    focus() { this.focused = true; }
  };
}

function createFixture() {
  const values = {
    fullName: "Jan Novak",
    email: "jan@example.cz",
    phone: "+420 777 123 456",
    street: "Dlouha 12",
    city: "Praha",
    postalCode: "110 00",
    password: "GoodPass9!",
    passwordConfirm: "GoodPass9!"
  };
  const elements = Object.fromEntries(
    Object.entries(values).map(([id, value]) => [id, makeElement(value)])
  );
  for (const id of ["termsBusiness", "termsPrivacy", "privateIndividualConfirmation"]) {
    elements[id] = makeElement();
    elements[id].checked = true;
  }
  elements.registrationError = makeElement();
  elements.registrationSubmitButton = makeElement();
  const signUps = [];
  const document = {
    getElementById(id) { return elements[id] || null; },
    querySelectorAll(selector) {
      if (selector === "#registrationForm input") {
        return Object.entries(elements)
          .filter(([id]) => !["registrationError", "registrationSubmitButton"].includes(id))
          .map(([, element]) => element);
      }
      return [];
    },
    querySelector(selector) {
      if (selector === "#registrationForm input[aria-invalid='true']") {
        return Object.values(elements).find(e => e.getAttribute("aria-invalid") === "true") || null;
      }
      return null;
    },
    addEventListener() {}
  };
  const context = {
    document,
    console,
    location: { href: "registrace.html" },
    getSupabaseClient: () => ({
      auth: {
        async signUp(payload) {
          signUps.push(payload);
          return { data: { user: { id: "new-user", identities: [{ id: "identity" }] } }, error: null };
        }
      }
    }),
    meetsRentuloPasswordRequirements: () => true,
    addEventListener() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    getRentuloLanguage: () => "cs"
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read("js/registration-page.js"), context, { filename: "js/registration-page.js" });
  return { context, elements, signUps };
}

async function submit(fixture) {
  let prevented = false;
  await fixture.context.createUserAccount({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
}

test("registration displays one private-individual checkbox and translates it in all five languages", () => {
  const html = read("registrace.html");
  const i18n = read("js/i18n.js");
  assert.match(html, /id="privateIndividualConfirmation"/);
  assert.match(html, /data-i18n="registration\.privateIndividualConfirmation"/);
  assert.ok(html.indexOf('id="termsPrivacy"') < html.indexOf('id="privateIndividualConfirmation"'));
  assert.ok(html.indexOf('id="privateIndividualConfirmation"') < html.indexOf('id="registrationSubmitButton"'));
  assert.equal((i18n.match(/"registration\.privateIndividualConfirmation":/g) || []).length, 5);
  assert.equal((i18n.match(/"registration\.error\.required":/g) || []).length, 5);
  assert.doesNotMatch(i18n, /"registration\.error\.required": "[^"]*(both agreements|oba souhlasy|oba súhlasy)[^"]*"/);
});

test("registration rejects submission until each of three confirmations is checked", async () => {
  for (const unchecked of ["termsBusiness", "termsPrivacy", "privateIndividualConfirmation"]) {
    const fixture = createFixture();
    fixture.elements[unchecked].checked = false;
    await submit(fixture);
    assert.equal(fixture.signUps.length, 0, `No signUp without ${unchecked}`);
    assert.equal(fixture.elements[unchecked].getAttribute("aria-invalid"), "true");
    assert.match(fixture.elements.registrationError.textContent, /tři povinná políčka/);
    assert.equal(fixture.context.location.href, "registrace.html");
  }
});

test("registration stores the confirmed private status and timestamp on successful signup", async () => {
  const fixture = createFixture();
  await submit(fixture);
  assert.equal(fixture.signUps.length, 1);
  const metadata = fixture.signUps[0].options.data;
  assert.equal(metadata.private_individual_confirmed, true);
  assert.match(metadata.private_individual_confirmed_at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(metadata.private_individual_confirmed_at, metadata.terms_accepted_at);
  assert.equal(metadata.terms_business_accepted, true);
  assert.equal(metadata.terms_privacy_accepted, true);
  assert.equal(fixture.context.location.href, "ucet-vytvoren.html");
});

test("registration resets all confirmations on entry or returning to the page", () => {
  const fixture = createFixture();
  fixture.context.resetRegistrationConsentCheckboxes();
  for (const id of ["termsBusiness", "termsPrivacy", "privateIndividualConfirmation"]) {
    assert.equal(fixture.elements[id].checked, false, id);
    assert.equal(fixture.elements[id].defaultChecked, false, id);
  }
});

test("registration fails closed if private confirmation control is absent", async () => {
  const fixture = createFixture();
  delete fixture.elements.privateIndividualConfirmation;
  await submit(fixture);
  assert.equal(fixture.signUps.length, 0);
  assert.match(fixture.elements.registrationError.textContent, /dočasně nedostupná/);
});
