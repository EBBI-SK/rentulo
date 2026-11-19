"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const NAVIGATION_PATH = path.join(PROJECT_ROOT, "js", "navigation.js");

const PAGE_PATHS = [
  path.join(PROJECT_ROOT, "js", "reservations-page.js"),
  path.join(PROJECT_ROOT, "js", "offers-page.js"),
  path.join(PROJECT_ROOT, "js", "history-page.js")
];

function source(pathname) {
  return fs.readFileSync(pathname, "utf8");
}

function directReservationRpcCount(text) {
  return (text.match(/\.rpc\(\s*["']get_my_reservations["']\s*\)/g) || []).length;
}

function reservationHelperSource(navigationSource) {
  const start = navigationSource.indexOf("function navInvalidateReservationsData()");
  const end = navigationSource.indexOf("window.refreshRentuloNotificationBadge", start);

  assert.notEqual(start, -1, "shared reservation cache helper must exist");
  assert.notEqual(end, -1, "shared reservation cache helper must end before notification refresh");

  return navigationSource.slice(start, end);
}

function authRefreshPlanSource(navigationSource) {
  const start = navigationSource.indexOf("function navGetAuthStateRefreshPlan(");
  const end = navigationSource.indexOf("async function initializeSharedNavigation()", start);

  assert.notEqual(start, -1, "auth refresh plan helper must exist");
  assert.notEqual(end, -1, "auth refresh plan helper must end before navigation initialization");

  return navigationSource.slice(start, end);
}

test("shared navigation owns the only direct get_my_reservations RPC", () => {
  const navigation = source(NAVIGATION_PATH);

  assert.match(navigation, /let navReservationsDataCache = null;/);
  assert.match(navigation, /window\.getRentuloReservationsData = navGetReservationsData;/);
  assert.match(navigation, /window\.invalidateRentuloReservationsData = navInvalidateReservationsData;/);
  assert.equal(
    directReservationRpcCount(navigation),
    1,
    "navigation must contain exactly one direct get_my_reservations RPC"
  );
});

test("retired browser API shim is absent from the project and reservation pages", () => {
  assert.equal(fs.existsSync(path.join(PROJECT_ROOT, "js/api.js")), false);
  for (const page of ["detail.html", "moje-nabidky.html"]) {
    assert.doesNotMatch(
      source(path.join(PROJECT_ROOT, page)),
      /<script\b[^>]*\bsrc=["']js\/api\.js["']/i,
      `${page} must not load the retired browser API shim`
    );
  }
});

test("account pages consume shared reservation data instead of sending duplicate RPCs", () => {
  PAGE_PATHS.forEach((pathname) => {
    const pageSource = source(pathname);

    assert.match(
      pageSource,
      /window\.getRentuloReservationsData/,
      `${path.basename(pathname)} must use the shared reservation loader`
    );
    assert.equal(
      directReservationRpcCount(pageSource),
      0,
      `${path.basename(pathname)} must not call get_my_reservations directly`
    );
  });

  assert.match(
    source(PAGE_PATHS[0]),
    /window\.invalidateRentuloReservationsData/,
    "reservations page must invalidate shared data before explicit reloads"
  );
  assert.match(
    source(PAGE_PATHS[1]),
    /window\.invalidateRentuloReservationsData/,
    "offers page must invalidate shared data after reservation mutations"
  );
});

test("shared reservation loader deduplicates concurrent reads and can be invalidated", async () => {
  const navigation = source(NAVIGATION_PATH);
  const helperSource = reservationHelperSource(navigation);

  let activeUser = { id: "user-1" };
  let rpcCalls = 0;
  let resolveRequest = null;

  const sandbox = {
    window: {},
    Promise,
    Error,
    Array,
    String,
    navGetCurrentUser() {
      return activeUser;
    },
    navGetSupabaseClient() {
      return {
        rpc(name) {
          assert.equal(name, "get_my_reservations");
          rpcCalls += 1;
          return new Promise((resolve) => {
            resolveRequest = resolve;
          });
        }
      };
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(
    "let navReservationsDataCache = null;\n" + helperSource,
    sandbox
  );

  const first = sandbox.window.getRentuloReservationsData();
  const second = sandbox.window.getRentuloReservationsData();

  assert.equal(rpcCalls, 1, "concurrent consumers must share one RPC");

  resolveRequest({
    data: [{ id: "reservation-1" }],
    error: null
  });

  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.data.length, 1);
  assert.equal(secondResult.data.length, 1);
  assert.notStrictEqual(
    firstResult.data,
    secondResult.data,
    "callers must receive separate arrays so one page cannot mutate another page's view"
  );

  const cached = await sandbox.window.getRentuloReservationsData();
  assert.equal(rpcCalls, 1, "resolved data must remain cached for the current page load");
  assert.equal(cached.data[0].id, "reservation-1");

  sandbox.window.invalidateRentuloReservationsData();

  const afterInvalidation = sandbox.window.getRentuloReservationsData();
  assert.equal(rpcCalls, 2, "explicit invalidation must force a fresh RPC");
  resolveRequest({ data: [], error: null });
  await afterInvalidation;

  activeUser = { id: "user-2" };
  const afterUserChange = sandbox.window.getRentuloReservationsData();
  assert.equal(rpcCalls, 3, "a different user must never reuse the previous user's cache");

  const loadError = new Error("temporary reservation load failure");
  resolveRequest({ data: [], error: loadError });
  const failedResult = await afterUserChange;
  assert.strictEqual(failedResult.error, loadError);

  const afterError = sandbox.window.getRentuloReservationsData();
  assert.equal(rpcCalls, 4, "failed reservation loads must not stay cached");
  resolveRequest({ data: [], error: null });
  await afterError;
});

test("auth refresh plan skips same-user session noise and keeps intentional refreshes", () => {
  const navigation = source(NAVIGATION_PATH);
  const helperSource = authRefreshPlanSource(navigation);
  const sandbox = {};

  vm.createContext(sandbox);
  vm.runInContext(
    helperSource + "\nthis.getAuthRefreshPlan = navGetAuthStateRefreshPlan;",
    sandbox
  );

  ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED"].forEach((event) => {
    const plan = sandbox.getAuthRefreshPlan(event, "user-1", "user-1");

    assert.equal(plan.userChanged, false, `${event} must not look like a user change`);
    assert.equal(plan.refreshProfile, false, `${event} must not reload profile data for the same user`);
    assert.equal(plan.refreshNotifications, false, `${event} must not reload notification data for the same user`);
  });

  const profileUpdate = sandbox.getAuthRefreshPlan("USER_UPDATED", "user-1", "user-1");
  assert.equal(profileUpdate.userChanged, false);
  assert.equal(profileUpdate.refreshProfile, true, "USER_UPDATED must refresh profile data");
  assert.equal(profileUpdate.refreshNotifications, false, "USER_UPDATED must not reload reservation notifications");

  const userChange = sandbox.getAuthRefreshPlan("SIGNED_IN", "user-1", "user-2");
  assert.equal(userChange.userChanged, true);
  assert.equal(userChange.refreshProfile, true);
  assert.equal(userChange.refreshNotifications, true);

  const signOut = sandbox.getAuthRefreshPlan("SIGNED_OUT", "user-1", "");
  assert.equal(signOut.userChanged, true);
  assert.equal(signOut.refreshProfile, true);
  assert.equal(signOut.refreshNotifications, true);
});

test("auth state listener invalidates and reloads account data only when the refresh plan requires it", () => {
  const navigation = source(NAVIGATION_PATH);
  const authStateStart = navigation.indexOf("supabaseClient.auth.onAuthStateChange");
  const authStateEnd = navigation.indexOf("    });", authStateStart);

  assert.notEqual(authStateStart, -1, "auth state listener must exist");
  assert.notEqual(authStateEnd, -1, "auth state listener must have a callback body");

  const callbackSource = navigation.slice(authStateStart, authStateEnd);

  assert.match(
    callbackSource,
    /navGetAuthStateRefreshPlan\(event, previousUserId, nextUserId\)/,
    "auth listener must classify same-user auth events before reloading account data"
  );
  assert.match(
    callbackSource,
    /if \(refreshPlan\.userChanged\) \{[\s\S]*navInvalidateReservationsData\(\)/,
    "only a real user change may clear shared reservation data"
  );
  assert.match(
    callbackSource,
    /if \(!refreshPlan\.refreshProfile && !refreshPlan\.refreshNotifications\) \{\s*return;/,
    "same-user session noise must exit before profile or notification reloads"
  );
  assert.match(
    callbackSource,
    /if \(refreshPlan\.refreshProfile\) \{[\s\S]*navLoadProfileSummary\(navVerifiedUser\)/,
    "profile loads must be gated by the refresh plan"
  );
  assert.match(
    callbackSource,
    /if \(refreshPlan\.refreshNotifications\) \{[\s\S]*navLoadNotificationCountFromSupabase\(page\)/,
    "notification loads must be gated by the refresh plan"
  );
});
