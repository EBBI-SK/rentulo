"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const NAVIGATION_PATH = path.join(PROJECT_ROOT, "js", "navigation.js");

function navigationSource() {
  return fs.readFileSync(NAVIGATION_PATH, "utf8");
}

function notificationLoaderSource(source) {
  const start = source.indexOf("async function navLoadNotificationCountFromSupabase");
  const end = source.indexOf("\nwindow.refreshRentuloNotificationBadge", start);

  assert.notEqual(start, -1, "notification loader must exist");
  assert.notEqual(end, -1, "notification loader must end before the public refresh helper");

  return source.slice(start, end);
}

test("shared navigation owns its notification data dependency", () => {
  const source = navigationSource();
  const loader = notificationLoaderSource(source);

  assert.match(loader, /navGetSupabaseClient\(\)/, "notification loader must use the shared navigation Supabase client");
  assert.match(loader, /\.rpc\(\s*["']get_my_reservations["']\s*\)/, "notification loader must call get_my_reservations directly");
  assert.doesNotMatch(source, /\bapiGetReservations\b/, "shared navigation must not depend on api.js for notification badges");
});

test("auth transition pages skip account profile and notification loads", () => {
  const source = navigationSource();

  assert.match(
    source,
    /function navShouldLoadAccountData\(page\)[\s\S]*"prihlaseni"[\s\S]*"registrace"[\s\S]*"ucet-vytvoren"/,
    "auth transition pages must be excluded from account data loading"
  );
  assert.match(
    source,
    /const shouldLoadAccountData = navShouldLoadAccountData\(page\)/,
    "shared navigation must evaluate the account-data guard for the active page"
  );
  assert.match(
    source,
    /if \(navVerifiedUser && shouldLoadAccountData\)[\s\S]*navLoadProfileSummary\(navVerifiedUser\)/,
    "profile summary loading must respect the auth-page guard"
  );
  assert.match(
    source,
    /if \(shouldLoadAccountData\)[\s\S]*navLoadNotificationCountFromSupabase\(page\)/,
    "notification loading must respect the auth-page guard"
  );

  const guardedProfileLoads = source.match(
    /if \(navVerifiedUser && shouldLoadAccountData\)/g
  ) || [];

  assert.equal(
    guardedProfileLoads.length,
    2,
    "both initial load and auth-state refresh must guard profile/account requests"
  );
});



test("red notifications reflect owner approvals and renter payments, not paid rentals", async () => {
  const vm = require("node:vm");
  const source = navigationSource();
  const start = source.indexOf("function navGetReservationStatus(");
  const end = source.indexOf("function navInjectStyles(", start);
  const loaderStart = source.indexOf("async function navLoadNotificationCountFromSupabase(");
  const loaderEnd = source.indexOf("function navInvalidateReservationsData(", loaderStart);
  assert.ok(start >= 0 && end > start && loaderStart >= 0 && loaderEnd > loaderStart);

  const allReservations = [
    { id: "r1", owner_id: "owner", renter_id: "renter", status: "pending" },
    { id: "r2", owner_id: "owner", renter_id: "renter", status: "paid" },
    { id: "r3", owner_id: "owner", renter_id: "renter", status: "picked_up" },
    { id: "r4", owner_id: "owner", renter_id: "renter", status: "approved" },
    { id: "r5", owner_id: "owner", renter_id: "other", status: "approved" }
  ];
  const extensions = [
    { reservation_id: "r2", status: "pending" },
    { reservation_id: "r3", status: "approved" },
    { reservation_id: "r4", status: "paid" }
  ];
  let user = { id: "owner", email: "" };
  let navigationRenders = 0;
  let extensionFailure = false;
  const sandbox = {
    window: {},
    console: { warn() {} },
    navGetCurrentUser: () => user,
    navGetSupabaseClient: () => ({
      async rpc(name) {
        assert.equal(name, "get_my_reservation_extensions");
        return extensionFailure ? { data: null, error: new Error("offline") } : { data: extensions, error: null };
      }
    }),
    navGetReservationsData: async () => ({ data: allReservations, error: null }),
    navGetUserEmail: (item) => item.email,
    navNormalizeEmail: (value) => String(value || "").toLowerCase(),
    renderSharedNavigation: () => { navigationRenders += 1; }
  };
  vm.createContext(sandbox);
  vm.runInContext("let navNotificationLoadSeq = 0;\n" + source.slice(start, end) + source.slice(loaderStart, loaderEnd) +
    "\nthis.loadNotifications = navLoadNotificationCountFromSupabase;", sandbox);

  await sandbox.loadNotifications("moje-nabidky");
  assert.equal(sandbox.window.rentuloAccountNotificationCounts.offers, 2,
    "owner sees a new reservation and a new extension, never ongoing paid rentals");
  assert.equal(sandbox.window.rentuloAccountNotificationCounts.reservations, 0,
    "empty emails must not cause a foreign renter's approved booking to count");

  user = { id: "renter", email: "renter@example.com" };
  await sandbox.loadNotifications("moje-rezervace");
  assert.equal(sandbox.window.rentuloAccountNotificationCounts.offers, 0);
  assert.equal(sandbox.window.rentuloAccountNotificationCounts.reservations, 2,
    "renter sees an unpaid approved reservation and an approved extension supplement");

  // Payment confirmation removes the red alerts without any 'mark as read' step.
  allReservations[3].status = "paid";
  extensions[1].status = "paid";
  await sandbox.loadNotifications("moje-rezervace");
  assert.equal(sandbox.window.rentuloAccountNotificationCount, 0);

  user = { id: "owner", email: "" };
  extensionFailure = true;
  await sandbox.loadNotifications("moje-nabidky");
  assert.equal(sandbox.window.rentuloAccountNotificationCount, 1,
    "extension RPC errors must not hide ordinary pending reservation approvals");
  assert.ok(navigationRenders >= 4);
});

test("explicit badge refresh invalidates cached reservations", () => {
  const source = navigationSource();
  assert.match(source,
    /window\.refreshRentuloNotificationBadge = async function \(\) \{[\s\S]*navInvalidateReservationsData\(\);[\s\S]*await navLoadNotificationCountFromSupabase\(activePage\);/);
});
