"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const settings = fs.readFileSync(path.join(root, "js/settings-page.js"), "utf8");
const i18n = fs.readFileSync(path.join(root, "js/i18n.js"), "utf8");
const sql = fs.readFileSync(
  path.join(root, "supabase/migrations/20261013090000_reset_sms_opt_in_on_phone_change.sql"), "utf8"
);

function extract(startMarker, endMarker) {
  const start = settings.indexOf(startMarker);
  const end = settings.indexOf(endMarker, start);
  assert.ok(start !== -1 && end !== -1, `${startMarker} must precede ${endMarker}`);
  return settings.slice(start, end);
}

const helperCode = extract("function profileValuesEqual(", "function applyLanguage(");
const saveCode = extract("async function saveProfile(", "async function changePassword(");

function makeFixture({ storedPhone = "+420 777 123 456", optedIn = false } = {}) {
  const initial = {
    fullName: "Example User", email: "example@domain.cz", phone: storedPhone,
    street: "Dlouha 1", city: "Praha", postalCode: "11000"
  };
  const user = { id: "test-user", email: initial.email, new_email: "", user_metadata: {} };
  const db = { ...initial, sms_notifications: optedIn };
  const messages = [];
  const writes = [];
  let authWrites = 0;
  const button = () => ({ disabled: false, classList: { toggle() {} }, setAttribute() {} });
  const elements = {
    profileFullName: { value: initial.fullName },
    profileEmail: { value: initial.email },
    profilePhone: { value: initial.phone },
    profileStreet: { value: initial.street },
    profileCity: { value: initial.city },
    profilePostalCode: { value: initial.postalCode },
    saveProfileButton: button(), profileMessage: {},
    settingsSmsEnabled: { checked: optedIn },
    settingsSaveSmsButton: button(), settingsSmsMessage: {}
  };
  const sandbox = {
    document: { getElementById(id) { return elements[id] || null; } },
    normalizeText(value) { return String(value || "").trim(); },
    normalizeEmail(value) { return String(value || "").trim().toLowerCase(); },
    isValidEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); },
    setMessage() {},
    setTranslatedMessage(_element, key, fallback, type) { messages.push({ key, fallback, type }); },
    setButtonLoading(buttonElement, busy) { if (buttonElement) buttonElement.disabled = busy; },
    Date, console
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `let savedProfileValues = ${JSON.stringify(initial)};\n` +
    `let savedSmsEnabled = ${JSON.stringify(optedIn)};\n` +
    helperCode + "\n" + saveCode +
    "\nthis.saveProfile = saveProfile; this.saveSmsPreference = saveSmsPreference;",
    sandbox
  );

  const client = {
    auth: {
      async updateUser(payload) {
        authWrites++;
        assert.ok(payload.data);
        return {
          data: { user: { ...user, user_metadata: { ...user.user_metadata, ...payload.data } } },
          error: null
        };
      }
    },
    from(table) {
      assert.equal(table, "profiles");
      return {
        update(payload) {
          const filters = {};
          const query = {
            eq(field, value) { filters[field] = value; return this; },
            select() { return this; },
            async maybeSingle() { return applyUpdate(); },
            then(resolve, reject) { return Promise.resolve(applyUpdate()).then(resolve, reject); }
          };
          function applyUpdate() {
            writes.push({ payload, filters: { ...filters } });
            if (filters.id !== user.id || ("phone" in filters && filters.phone !== db.phone)) {
              return { data: null, error: null };
            }
            const oldPhone = db.phone;
            if ("phone" in payload) db.phone = payload.phone;
            if ("sms_notifications" in payload) db.sms_notifications = payload.sms_notifications;
            // Simulate the BEFORE UPDATE OF phone trigger, including a combined update.
            if (oldPhone !== db.phone) db.sms_notifications = false;
            return { data: { id: user.id }, error: null };
          }
          return query;
        }
      };
    }
  };
  return { client, db, elements, messages, writes, user, sandbox, get authWrites() { return authWrites; } };
}

test("SMS can be enabled only using the phone already saved in the profile", async () => {
  const f = makeFixture();
  f.elements.settingsSmsEnabled.checked = true;
  await f.sandbox.saveSmsPreference(f.client, f.user);
  assert.equal(f.db.sms_notifications, true);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].filters.phone, f.db.phone, "DB conditional UPDATE must match phone");
  assert.equal(f.messages.at(-1).key, "settings.smsSaved");
});

test("valid but unsaved phone cannot activate SMS and does not write to Supabase", async () => {
  const f = makeFixture();
  f.elements.profilePhone.value = "+420777999888";
  f.elements.settingsSmsEnabled.checked = true;
  await f.sandbox.saveSmsPreference(f.client, f.user);
  assert.equal(f.db.sms_notifications, false);
  assert.equal(f.writes.length, 0);
  assert.equal(f.elements.settingsSmsEnabled.checked, false);
  assert.equal(f.messages.at(-1).key, "settings.smsUnsavedPhone");
});

test("invalid phone cannot activate SMS", async () => {
  const f = makeFixture({ storedPhone: "xyz" });
  f.elements.settingsSmsEnabled.checked = true;
  await f.sandbox.saveSmsPreference(f.client, f.user);
  assert.equal(f.writes.length, 0);
  assert.equal(f.messages.at(-1).key, "settings.smsInvalidPhone");
});

test("concurrent phone change cannot enable SMS on stale profile", async () => {
  const f = makeFixture();
  f.db.phone = "+420777999888"; // phone was changed in another tab/device
  f.elements.settingsSmsEnabled.checked = true;
  await f.sandbox.saveSmsPreference(f.client, f.user);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].filters.phone, "+420 777 123 456");
  assert.equal(f.db.sms_notifications, false);
  assert.equal(f.elements.settingsSmsEnabled.checked, false);
  assert.equal(f.messages.at(-1).key, "settings.smsUnsavedPhone");
});

test("disabling SMS always works, even with unsaved phone changes", async () => {
  const f = makeFixture({ optedIn: true });
  f.elements.profilePhone.value = "+420777999888";
  f.elements.settingsSmsEnabled.checked = false;
  await f.sandbox.saveSmsPreference(f.client, f.user);
  assert.equal(f.db.sms_notifications, false);
  assert.ok(!("phone" in f.writes.at(-1).filters), "disabling SMS must not depend on phone");
});

test("saving a changed phone atomically disables SMS and resets the UI", async () => {
  const f = makeFixture({ optedIn: true });
  f.elements.profilePhone.value = "+420777999888";
  await f.sandbox.saveProfile(f.client, f.user);
  assert.equal(f.db.phone, "+420777999888");
  assert.equal(f.db.sms_notifications, false);
  assert.equal(f.elements.settingsSmsEnabled.checked, false);
  assert.equal(f.messages.at(-1).key, "settings.profileSavedSmsReset");
  assert.equal(f.authWrites, 1);
});

test("editing other profile fields does not turn off SMS", async () => {
  const f = makeFixture({ optedIn: true });
  f.elements.profileCity.value = "Brno";
  await f.sandbox.saveProfile(f.client, f.user);
  assert.equal(f.db.sms_notifications, true);
  assert.equal(f.elements.settingsSmsEnabled.checked, true);
  assert.equal(f.messages.at(-1).key, "settings.profileSaved");
});

test("migration resets opt-in at database level for all phone changes", () => {
  assert.match(sql, /begin;[\s\S]*commit;/);
  assert.match(sql, /if new\.phone is distinct from old\.phone then\s+new\.sms_notifications := false;/i);
  assert.match(sql, /before update of phone on public\.profiles/i);
  assert.match(sql, /for each row[\s\S]*execute function public\.reset_sms_opt_in_on_phone_change\(\)/i);
  assert.match(sql, /revoke all on function public\.reset_sms_opt_in_on_phone_change\(\)/i);
  assert.doesNotMatch(sql, /update public\.profiles set/i, "migration must not mass-disable previous preferences");
});

test("new safety messages exist in all five supported languages", () => {
  for (const key of [
    "settings.smsUnsavedPhone",
    "settings.profileSavedSmsReset",
    "settings.profileSavedEmailConfirmationSmsReset"
  ]) {
    assert.equal((i18n.match(new RegExp(`"${key.replace(/\./g, "\\.")}"`, "g")) || []).length, 5, key);
  }
});
