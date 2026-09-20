"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const SETTINGS_PATH = path.join(PROJECT_ROOT, "js", "settings-page.js");

function source() {
  return fs.readFileSync(SETTINGS_PATH, "utf8");
}

function extractFunction(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);

  assert.notEqual(start, -1, `${startMarker} must exist`);
  assert.notEqual(end, -1, `${endMarker} must exist after ${startMarker}`);

  return text.slice(start, end);
}

function createElements(values) {
  const button = {
    disabled: false,
    classList: { toggle() {} },
    setAttribute() {}
  };

  return {
    profileFullName: { value: values.fullName },
    profileEmail: { value: values.email },
    profilePhone: { value: values.phone },
    profileStreet: { value: values.street },
    profileCity: { value: values.city },
    profilePostalCode: { value: values.postalCode },
    saveProfileButton: button,
    profileMessage: {}
  };
}

function buildSandbox(settingsSource, initialValues) {
  const helperSource = extractFunction(
    settingsSource,
    "function profileValuesEqual(",
    "function applyLanguage("
  );
  const saveProfileSource = extractFunction(
    settingsSource,
    "async function saveProfile(",
    "async function changePassword("
  );
  const elements = createElements(initialValues);
  const messages = [];
  const sandbox = {
    document: {
      getElementById(id) {
        return elements[id] || null;
      }
    },
    normalizeText(value) {
      return String(value || "").trim();
    },
    normalizeEmail(value) {
      return String(value || "").trim().toLowerCase();
    },
    isValidEmail(value) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    },
    setMessage() {},
    setTranslatedMessage(_element, key, fallback, type) {
      messages.push({ key, fallback, type });
    },
    setButtonLoading(button, loading) {
      if (button) {
        button.disabled = Boolean(loading);
      }
    },
    Date,
    console
  };

  vm.createContext(sandbox);
  vm.runInContext(
    `let savedProfileValues = ${JSON.stringify(initialValues)};\n` +
      helperSource +
      "\n" +
      saveProfileSource +
      "\nthis.saveProfile = saveProfile;",
    sandbox
  );

  return { sandbox, elements, messages };
}

const INITIAL_VALUES = {
  fullName: "Jaroslav Chynoransky",
  email: "user@example.com",
  phone: "+420 000 000 000",
  street: "Dlouha 12",
  city: "Praha",
  postalCode: "110 00"
};

const USER = {
  id: "user-1",
  email: INITIAL_VALUES.email,
  new_email: "",
  user_metadata: {
    full_name: INITIAL_VALUES.fullName,
    phone: INITIAL_VALUES.phone,
    street: INITIAL_VALUES.street,
    city: INITIAL_VALUES.city,
    postal_code: INITIAL_VALUES.postalCode
  }
};

test("unchanged profile save skips Supabase auth and profile writes", async () => {
  const settingsSource = source();
  const { sandbox, messages } = buildSandbox(settingsSource, INITIAL_VALUES);
  let authCalls = 0;
  let profileCalls = 0;

  const client = {
    auth: {
      async updateUser() {
        authCalls += 1;
        throw new Error("auth update must not run for an unchanged profile");
      }
    },
    from() {
      profileCalls += 1;
      throw new Error("profile update must not run for an unchanged profile");
    }
  };

  const result = await sandbox.saveProfile(client, USER);

  assert.strictEqual(result, USER);
  assert.equal(authCalls, 0);
  assert.equal(profileCalls, 0);
  assert.deepEqual(messages.at(-1), {
    key: "settings.profileSaved",
    fallback: "Osobní údaje byly uloženy.",
    type: "success"
  });
});

test("successful changed profile becomes the new no-op baseline", async () => {
  const settingsSource = source();
  const { sandbox, elements } = buildSandbox(settingsSource, INITIAL_VALUES);
  let authCalls = 0;
  let profileCalls = 0;

  elements.profileCity.value = "Brno";

  const client = {
    auth: {
      async updateUser(payload) {
        authCalls += 1;
        assert.equal(payload.data.city, "Brno");
        return {
          data: {
            user: {
              ...USER,
              user_metadata: {
                ...USER.user_metadata,
                city: "Brno"
              }
            }
          },
          error: null
        };
      }
    },
    from(table) {
      assert.equal(table, "profiles");
      return {
        update(payload) {
          profileCalls += 1;
          assert.equal(payload.city, "Brno");
          return {
            async eq(column, id) {
              assert.equal(column, "id");
              assert.equal(id, USER.id);
              return { error: null };
            }
          };
        }
      };
    }
  };

  const updatedUser = await sandbox.saveProfile(client, USER);
  assert.equal(authCalls, 1);
  assert.equal(profileCalls, 1);
  assert.equal(updatedUser.user_metadata.city, "Brno");

  const secondResult = await sandbox.saveProfile(client, updatedUser);
  assert.strictEqual(secondResult, updatedUser);
  assert.equal(authCalls, 1, "second unchanged save must not repeat auth.updateUser");
  assert.equal(profileCalls, 1, "second unchanged save must not repeat profiles.update");
});

test("no-op guard runs before loading state and network writes", () => {
  const settingsSource = source();
  const saveProfileSource = extractFunction(
    settingsSource,
    "async function saveProfile(",
    "async function changePassword("
  );

  const guardIndex = saveProfileSource.indexOf(
    "if (profileValuesEqual(savedProfileValues, profileValues))"
  );
  const loadingIndex = saveProfileSource.indexOf("setButtonLoading(button, true)");
  const authIndex = saveProfileSource.indexOf("client.auth.updateUser");
  const profileIndex = saveProfileSource.indexOf('.from("profiles")');

  assert.ok(guardIndex >= 0, "unchanged profile guard must exist");
  assert.ok(guardIndex < loadingIndex, "no-op guard must run before loading state");
  assert.ok(guardIndex < authIndex, "no-op guard must run before auth writes");
  assert.ok(guardIndex < profileIndex, "no-op guard must run before profile writes");
});
