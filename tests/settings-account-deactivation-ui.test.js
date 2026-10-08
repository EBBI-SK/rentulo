"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "js", "settings-page.js"), "utf8");

function mockElement(overrides = {}) {
  const states = new Set();
  return {
    hidden: false,
    disabled: false,
    value: "",
    checked: false,
    dataset: {},
    textContent: "",
    className: "",
    classList: {
      toggle(key, active) { if (active) states.add(key); else states.delete(key); },
      add(key) { states.add(key); },
      contains(key) { return states.has(key); }
    },
    setAttribute() {},
    focus() {},
    ...overrides
  };
}

function harness() {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, mockElement());
    return elements.get(id);
  };
  const window = {};
  const document = {
    getElementById: get,
    addEventListener() {},
    querySelectorAll() { return []; },
    body: { contains() { return true; } }
  };
  const instrumented = source.replace(
    '  document.addEventListener("DOMContentLoaded", initializeSettingsPage);',
    '  window.__settingsTest = { checkAccountCancellation, cancelAccount, updateAccountCancellationButtonState };\n' +
      '  document.addEventListener("DOMContentLoaded", initializeSettingsPage);'
  );
  assert.notEqual(instrumented, source, "test instrumentation must attach to the real functions");
  vm.runInNewContext(instrumented, {
    window,
    document,
    console: { error() {}, warn() {} },
    Date,
    JSON,
    setTimeout() {}
  });
  return { get, api: window.__settingsTest };
}

const financialStatus = {
  account_status: "active",
  can_deactivate: false,
  blocking_reservations_count: 0,
  blocking_as_owner_count: 0,
  blocking_as_renter_count: 0,
  offers_to_close_count: 2,
  open_owner_debts_count: 1,
  unfinished_refunds_count: 2,
  unresolved_owner_transfers_count: 3
};

test("financial blocker response has real counts and does not expose permanent account cancellation", async () => {
  const { get, api } = harness();
  const result = await api.checkAccountCancellation({
    async rpc(name) {
      assert.equal(name, "get_my_account_deactivation_status_v2");
      return { data: [financialStatus], error: null };
    }
  });
  assert.equal(result, undefined);
  assert.equal(get("checkAccountCancellationButton").hidden, false);
  assert.equal(get("accountCancellationConfirmation").hidden, true);
  assert.match(get("accountCancellationMessage").textContent, /storno poplatky: 1/);
  assert.match(get("accountCancellationMessage").textContent, /vratky: 2/);
  assert.match(get("accountCancellationMessage").textContent, /výplaty: 3/);
});

test("reservation blocker still takes priority when both reservation and financial work are pending", async () => {
  const { get, api } = harness();
  await api.checkAccountCancellation({
    async rpc() {
      return { data: [{ ...financialStatus, blocking_reservations_count: 2, blocking_as_owner_count: 1, blocking_as_renter_count: 1 }], error: null };
    }
  });
  assert.match(get("accountCancellationMessage").textContent, /2 rozpracovaných rezervací/);
  assert.equal(get("accountCancellationConfirmation").hidden, true);
});

test("final confirmation failure caused by a new debt restores the check button and hides confirmation", async () => {
  const { get, api } = harness();
  await api.checkAccountCancellation({
    async rpc() {
      return { data: [{ ...financialStatus, can_deactivate: true, open_owner_debts_count: 0, unfinished_refunds_count: 0, unresolved_owner_transfers_count: 0 }], error: null };
    }
  });
  assert.equal(get("checkAccountCancellationButton").hidden, true);
  assert.equal(get("accountCancellationConfirmation").hidden, false);

  get("cancelAccountPassword").value = "good-password";
  get("cancelAccountAcknowledge").checked = true;
  api.updateAccountCancellationButtonState();
  assert.equal(get("cancelAccountButton").disabled, false);

  await api.cancelAccount({
    auth: { async signInWithPassword() { return { error: null }; } },
    functions: {
      async invoke(name) {
        assert.equal(name, "account-deactivation");
        return {
          error: {
            context: {
              async json() {
                return {
                  code: "ACCOUNT_HAS_FINANCIAL_OBLIGATIONS",
                  open_owner_debts_count: 1,
                  unfinished_refunds_count: 0,
                  unresolved_owner_transfers_count: 0
                };
              }
            }
          }
        };
      }
    }
  }, { email: "owner@example.com" });

  assert.equal(get("checkAccountCancellationButton").hidden, false);
  assert.equal(get("accountCancellationConfirmation").hidden, true);
  assert.equal(get("cancelAccountPassword").value, "");
  assert.equal(get("cancelAccountAcknowledge").checked, false);
  assert.equal(get("cancelAccountButton").disabled, true);
  assert.match(get("accountCancellationMessage").textContent, /storno poplatky: 1/);
});

test("concurrent blocker without refreshed counts shows a generic error rather than falsely claiming zero reservations", async () => {
  const { get, api } = harness();
  await api.checkAccountCancellation({
    async rpc() { return { data: [{ ...financialStatus, can_deactivate: true }], error: null }; }
  });
  get("cancelAccountPassword").value = "good-password";
  get("cancelAccountAcknowledge").checked = true;
  api.updateAccountCancellationButtonState();
  await api.cancelAccount({
    auth: { async signInWithPassword() { return { error: null }; } },
    functions: {
      async invoke() {
        return { error: { context: { async json() { return { code: "ACCOUNT_HAS_ACTIVE_RESERVATIONS" }; } } } };
      }
    }
  }, { email: "renter@example.com" });
  assert.equal(get("checkAccountCancellationButton").hidden, false);
  assert.equal(get("accountCancellationConfirmation").hidden, true);
  assert.match(get("accountCancellationMessage").textContent, /nepodařilo zkontrolovat/);
  assert.doesNotMatch(get("accountCancellationMessage").textContent, /0 rozpracovaných/);
});

test("stale zero financial counts are not presented as proof that nothing is pending", async () => {
  const { get, api } = harness();
  await api.checkAccountCancellation({
    async rpc() { return { data: [{ ...financialStatus, can_deactivate: true }], error: null }; }
  });
  get("cancelAccountPassword").value = "good-password";
  get("cancelAccountAcknowledge").checked = true;
  api.updateAccountCancellationButtonState();
  await api.cancelAccount({
    auth: { async signInWithPassword() { return { error: null }; } },
    functions: {
      async invoke() {
        return { error: { context: { async json() {
          return {
            code: "ACCOUNT_HAS_FINANCIAL_OBLIGATIONS",
            open_owner_debts_count: 0,
            unfinished_refunds_count: 0,
            unresolved_owner_transfers_count: 0
          };
        } } } };
      }
    }
  }, { email: "owner@example.com" });
  assert.match(get("accountCancellationMessage").textContent, /nedokončeným finančním operacím/);
  assert.doesNotMatch(get("accountCancellationMessage").textContent, /Neuhrazené storno poplatky: 0/);
  assert.equal(get("checkAccountCancellationButton").hidden, false);
});
