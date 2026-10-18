"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const migration = read("supabase/migrations/20261018130000_bod02_gdpr_deactivation_cleanup_TEST.sql");
const edge = read("supabase/functions/account-deactivation/index.ts");

function getPhotoCleanupFunction() {
  const body = edge.split("// BOD02_PHOTO_CLEANUP_START")[1]?.split("// BOD02_PHOTO_CLEANUP_END")[0];
  assert.ok(body, "photo-cleanup function must exist in the deployed Edge source");
  const plain = body
    .replace(/async function deleteOwnerOfferPhotos\([\s\S]*?\): Promise<number> \{/, "async function deleteOwnerOfferPhotos(admin, ownerId) {")
    .replace(/new Set<string>\(\)/g, "new Set()")
    .replace(/folders\.shift\(\)!/g, "folders.shift()")
    .replace(/const files: string\[\] = \[\];/g, "const files = [];")
    .replace(/const subfolders: string\[\] = \[\];/g, "const subfolders = [];");
  assert.doesNotMatch(plain, /: Promise<number>|: string|Set<string>|string\[\]|shift\(\)!/);
  const sandbox = { Error, Set };
  vm.runInNewContext(plain + "\nthis.cleanup = deleteOwnerOfferPhotos;", sandbox);
  return sandbox.cleanup;
}

function mockStorage(initialObjects, options = {}) {
  const objects = new Set(initialObjects);
  const removedPaths = [];
  let failRemovals = options.failRemovals ?? 0;
  let failListings = options.failListings ?? 0;
  const bucket = {
    async list(folder, paging) {
      if (failListings-- > 0) return { data: null, error: new Error("temporary list failure") };
      const children = new Map();
      for (const fullPath of objects) {
        if (!fullPath.startsWith(folder + "/")) continue;
        const suffix = fullPath.slice(folder.length + 1);
        const [name, ...rest] = suffix.split("/");
        if (rest.length) children.set(name, { name, id: null });
        else if (!children.has(name)) children.set(name, { name, id: "object-id" });
      }
      return {
        data: [...children.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(paging.offset, paging.offset + paging.limit),
        error: null,
      };
    },
    async remove(paths) {
      if (failRemovals-- > 0) return { data: null, error: new Error("temporary remove failure") };
      for (const item of paths) {
        objects.delete(item);
        removedPaths.push(item);
      }
      return { data: paths, error: null };
    },
  };
  return {
    admin: { storage: { from(name) { assert.equal(name, "offer-photos"); return bucket; } } },
    objects,
    removedPaths,
  };
}

test("GDPR migration cannot be run on PROD by mistake", () => {
  assert.match(migration, /vault\.decrypted_secrets/);
  assert.match(migration, /s\.name = 'rentulo_project_url'/);
  assert.match(migration, /vspposovhdgvbeukoivh\.supabase\.co/);
  assert.match(migration, /raise exception 'BOD02 GDPR account cleanup migration is TEST-only'/);
});

test("GDPR migration keeps active-profile validation while permitting empty deactivated fields", () => {
  for (const field of ["full_name", "email", "phone", "street", "city", "postal_code"]) {
    assert.match(migration, new RegExp("profiles_" + (field === "postal_code" ? "postal_code" : field) + "_length_check"));
    assert.match(migration, new RegExp("account_status = 'deactivated' or char_length\\(trim\\(" + field + "\\)\\)"));
    assert.match(migration, new RegExp(field + " = ''"));
  }
  assert.match(migration, /sms_notifications = false/);
  assert.match(migration, /anonymized_at = coalesce\(p\.anonymized_at, now\(\)\)/);
  assert.match(migration, /p\.account_status = 'active'/, "auth e-mail trigger must not restore PII after deactivation");
});

test("trusted profile trigger rejects browser account-state spoofing without weakening Stripe protection", () => {
  assert.match(migration, /create or replace function public\.protect_profile_update\(\)/);
  assert.match(migration, /auth\.role\(\), ''\) <> 'service_role'/);
  for (const key of ["account_status", "deactivation_requested_at", "deactivated_at", "anonymized_at"]) {
    assert.match(migration, new RegExp("new\\." + key + " is distinct from old\\." + key));
  }
  for (const key of ["stripe_connected_account_id", "stripe_connect_status", "stripe_connect_details_submitted", "stripe_connect_transfers_enabled", "stripe_connect_updated_at"]) {
    assert.ok(migration.includes("new." + key + " is distinct from old." + key));
  }
});

test("GDPR finalizer retains required financial blockers, transactional history and trusted permissions", () => {
  for (const name of [
    "public.reservations r", "public.owner_cancellation_debts d",
    "public.reservation_cancellations c", "public.payments p",
    "v_unfinished_refunds", "v_unresolved_transfers",
    "pg_advisory_xact_lock(860808", "where p.id = target_user_id",
  ]) assert.ok(migration.includes(name), "missing guard: " + name);
  assert.match(migration, /if v_account_status = 'active' then[\s\S]*?Account has active reservations[\s\S]*?Account has unresolved financial obligations/);
  assert.match(migration, /update public.offers o[\s\S]*?status = 'deleted'[\s\S]*?pickup_phone = ''[\s\S]*?pickup_latitude = null/);
  // An existing banned-vehicle category must not make the BOD02 V1
  // BEFORE UPDATE offer policy reject deactivation of a deleted offer.
  assert.match(migration, /category = 'Ostatní'/);
  assert.match(migration, /photo_url = null/);
  assert.match(migration, /update public.profiles p[\s\S]*?account_status = 'deactivated'/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.(reservations|payments|reviews|profiles|offers)/i);
  assert.match(migration, /revoke all on function public\.finalize_account_deactivation\(uuid\)[\s\S]*?from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.finalize_account_deactivation\(uuid\)[\s\S]*?to service_role/);
});

test("photo cleanup deletes only authenticated owner files, including nested and paginated files", async () => {
  const cleanup = getPhotoCleanupFunction();
  const own = Array.from({ length: 126 }, (_, i) => `owner-a/photo-${String(i).padStart(3, "0")}.jpg`);
  const nested = ["owner-a/archive/sub/a.png", "owner-a/archive/b.png"];
  const other = "owner-b/private.jpg";
  const mock = mockStorage([...own, ...nested, other]);
  const count = await cleanup(mock.admin, "owner-a");
  assert.equal(count, own.length + nested.length);
  assert.deepEqual([...mock.objects], [other]);
  assert.equal(mock.removedPaths.some(name => name.startsWith("owner-b/")), false);
});

test("partial Storage delete error fails closed; retry removes remaining photos idempotently", async () => {
  const cleanup = getPhotoCleanupFunction();
  const mock = mockStorage(["owner-a/a.jpg", "owner-a/b.jpg"], { failRemovals: 1 });
  await assert.rejects(cleanup(mock.admin, "owner-a"), /Photo cleanup remove failed/);
  assert.equal(mock.objects.size, 2);
  assert.equal(await cleanup(mock.admin, "owner-a"), 2);
  assert.equal(await cleanup(mock.admin, "owner-a"), 0);
});

test("Storage list failure prevents silent success and account soft-delete runs only after cleanup", async () => {
  const cleanup = getPhotoCleanupFunction();
  const mock = mockStorage(["owner-a/a.jpg"], { failListings: 1 });
  await assert.rejects(cleanup(mock.admin, "owner-a"), /Photo cleanup list failed/);
  assert.equal(mock.objects.size, 1);
  assert.match(edge, /await deleteOwnerOfferPhotos\(admin, actor\.id\)/);
  const cleanupPos = edge.lastIndexOf("await deleteOwnerOfferPhotos(admin, actor.id)");
  const authDeletePos = edge.lastIndexOf("admin.auth.admin.deleteUser(actor.id, true)");
  assert.ok(authDeletePos > cleanupPos, "Auth must be soft-deleted after successful Storage cleanup");
  assert.match(edge, /code: "PHOTO_CLEANUP_FAILED"[\s\S]*?503/);
  assert.match(edge, /if \(status.account_status === "active" && !status.can_deactivate\)/);
  assert.match(edge, /status.account_status !== "active" && status.account_status !== "deactivated"/);
});
