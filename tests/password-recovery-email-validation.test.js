"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const RECOVERY_PATH = path.join(PROJECT_ROOT, "js", "password-recovery-page.js");

function source() {
  return fs.readFileSync(RECOVERY_PATH, "utf8");
}

function extractBlock(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);

  assert.notEqual(start, -1, `${startMarker} must exist`);
  assert.notEqual(end, -1, `${endMarker} must exist after ${startMarker}`);

  return text.slice(start, end);
}

function buildRecoverySandbox(emailValue) {
  const text = source();
  const helperSource = extractBlock(
    text,
    "function normalizeEmail(",
    "function markRecoverySessionActive("
  );
  const handleRequestSource = extractBlock(
    text,
    "async function handleRequest(",
    "async function handleNewPassword("
  );

  const elements = {
    recoveryEmail: {
      value: emailValue,
      focused: false,
      focus() {
        this.focused = true;
      }
    },
    requestResetButton: {
      disabled: false,
      textContent: ""
    },
    requestMessage: {
      textContent: "",
      type: ""
    }
  };

  let resetCalls = 0;

  const sandbox = {
    document: {
      getElementById(id) {
        return elements[id] || null;
      }
    },
    t(_key, fallback) {
      return fallback;
    },
    setMessage(element, text, type) {
      if (!element) return;
      element.textContent = text || "";
      element.type = type || "";
    },
    console
  };

  vm.createContext(sandbox);
  vm.runInContext(
    helperSource +
      "\n" +
      handleRequestSource +
      "\nthis.handleRequest = handleRequest; this.isValidEmail = isValidEmail;",
    sandbox
  );

  const client = {
    auth: {
      async resetPasswordForEmail() {
        resetCalls += 1;
        return { error: null };
      }
    }
  };

  return {
    sandbox,
    elements,
    client,
    getResetCalls() {
      return resetCalls;
    }
  };
}

test("password recovery uses full email format validation", () => {
  const { sandbox } = buildRecoverySandbox("");

  for (const email of [
    "user@example.com",
    "name+tag@example.co.uk"
  ]) {
    assert.equal(sandbox.isValidEmail(email), true, email);
  }

  for (const email of [
    "",
    "test@",
    "@test.cz",
    "test",
    "test@example",
    "test @example.cz",
    "test@example .cz"
  ]) {
    assert.equal(sandbox.isValidEmail(email), false, email);
  }
});

test("malformed recovery email is rejected before Supabase request", async () => {
  const { sandbox, elements, client, getResetCalls } = buildRecoverySandbox("test@");

  await sandbox.handleRequest(
    {
      preventDefault() {}
    },
    client
  );

  assert.equal(getResetCalls(), 0);
  assert.equal(elements.requestMessage.textContent, "Zadejte platný e-mail.");
  assert.equal(elements.requestMessage.type, "error");
  assert.equal(elements.recoveryEmail.focused, true);
});
