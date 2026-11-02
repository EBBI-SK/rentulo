"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const SOURCE = {
  signup: "confirm-sign-up",
  recovery: "reset-password",
  email_change: "change-email-address",
};
const load = () => import(pathToFileURL(path.join(root, "supabase/functions/_shared/auth-email-render.mjs")).href);
const base = {
  user: { email: "owner@example.org", user_metadata: { preferred_language: "cs" } },
  email_data: {
    email_action_type: "signup",
    token_hash: "a".repeat(64),
    redirect_to: "https://rentulo.eu/login.html",
    site_url: "https://rentulo.eu",
  },
};
const options = { supabaseUrl: "https://vspposovhdgvbeukoivh.supabase.co" };
const clone = () => structuredClone(base);

test("AUTH hook templates match the already approved five-language Rentulo templates", async () => {
  const { AUTH_SOURCE_TEMPLATES } = await load();
  for (const [action, dirname] of Object.entries(SOURCE)) {
    assert.equal(AUTH_SOURCE_TEMPLATES[action].body,
      read(`supabase/auth-email-templates/${dirname}/Body.html`), action);
    assert.equal(AUTH_SOURCE_TEMPLATES[action].subject,
      read(`supabase/auth-email-templates/${dirname}/Subject.txt`).trim(), action);
  }
});

test("AUTH hook signup and reset: five languages, correct confirmation URL and original styling", async () => {
  const { buildAuthEmailMessages } = await load();
  for (const kind of ["signup", "recovery"]) {
    for (const lang of ["cs", "sk", "en", "de", "pl"]) {
      const e = clone();
      e.user.user_metadata.preferred_language = lang;
      e.email_data.email_action_type = kind;
      const [m] = buildAuthEmailMessages(e, options);
      assert.equal(m.to, e.user.email);
      assert.match(m.subject, /Rentulo/);
      assert.match(m.html, /background:#00835a/);
      assert.match(m.html, /border-radius:10px/);
      assert.match(m.html, /vspposovhdgvbeukoivh\.supabase\.co\/auth\/v1\/verify/);
      assert.match(m.html, new RegExp(`type=${kind}`));
      assert.match(m.html, /redirect_to=https%3A%2F%2Frentulo\.eu%2Flogin\.html/);
      assert.doesNotMatch(m.html, /{{|<script/i);
    }
  }
});

test("AUTH hook maintains each old template's unspecified-language fallback", async () => {
  const { buildAuthEmailMessages } = await load();
  for (const kind of ["signup", "recovery"]) {
    const e = clone();
    e.user.user_metadata = {};
    e.email_data.email_action_type = kind;
    const [m] = buildAuthEmailMessages(e, options);
    if (kind === "signup") assert.match(m.html, /Confirm your email address/);
    else assert.match(m.html, /Obnova hesla/);
  }
});

test("AUTH hook secure email change addresses old/new recipients with the CORRECT distinct hashes", async () => {
  const { buildAuthEmailMessages } = await load();
  const e = clone();
  e.email_data.email_action_type = "email_change";
  e.user.new_email = "new@example.org";
  e.email_data.token_hash = "b".repeat(64);
  e.email_data.token_hash_new = "c".repeat(64);
  const [old, fresh] = buildAuthEmailMessages(e, options);
  assert.equal(old.to, "owner@example.org");
  assert.equal(fresh.to, "new@example.org");
  assert.equal(old.suffix, "old");
  assert.equal(fresh.suffix, "new");
  assert.match(old.html, new RegExp("c".repeat(64)));
  assert.doesNotMatch(old.html, new RegExp("b".repeat(64)));
  assert.match(fresh.html, new RegExp("b".repeat(64)));
  assert.doesNotMatch(fresh.html, new RegExp("c".repeat(64)));
  assert.match(old.html, /new@example.org/);
  assert.doesNotMatch(fresh.html, /{{/);
});

test("AUTH hook secure email-change templates work in all five languages", async () => {
  const { buildAuthEmailMessages } = await load();
  for (const language of ["cs", "sk", "en", "de", "pl"]) {
    const e = clone();
    e.user.user_metadata.preferred_language = language;
    e.user.new_email = "new@example.org";
    e.email_data.email_action_type = "email_change";
    e.email_data.token_hash_new = "c".repeat(64);
    const messages = buildAuthEmailMessages(e, options);
    assert.equal(messages.length, 2);
    for (const message of messages) {
      assert.match(message.subject, /Rentulo/);
      assert.match(message.html, /background:#00835a/);
      assert.doesNotMatch(message.html, /{{/);
    }
  }
});

test("AUTH hook single-step email change sends ONLY to the new address", async () => {
  const { buildAuthEmailMessages } = await load();
  const e = clone();
  e.email_data.email_action_type = "email_change";
  e.user.new_email = "new@example.org";
  const messages = buildAuthEmailMessages(e, options);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, "new@example.org");
  assert.match(messages[0].html, /token=aaaaaaaa/);
  assert.doesNotMatch(messages[0].html, /obou zpráv/);
});

test("AUTH hook magic-link and invitation preserve correct verification link types", async () => {
  const { buildAuthEmailMessages } = await load();
  for (const kind of ["magiclink", "invite", "magic_link"]) {
    const e = clone(); e.email_data.email_action_type = kind;
    const [m] = buildAuthEmailMessages(e, options);
    assert.match(m.html, new RegExp(`type=${kind === "magic_link" ? "magiclink" : kind}`));
    assert.match(m.html, /Rentulo/);
  }
});

test("AUTH hook reauthentication sends a code, never a clickable auth token", async () => {
  const { buildAuthEmailMessages } = await load();
  const e = clone(); e.email_data.email_action_type = "reauthentication";
  e.email_data.token = "291042";
  const [m] = buildAuthEmailMessages(e, options);
  assert.match(m.html, /291042/);
  assert.doesNotMatch(m.html, /\/auth\/v1\/verify/);
});

test("AUTH hook supports security notification types with no confirmation token", async () => {
  const { buildAuthEmailMessages } = await load();
  for (const kind of [
    "password_changed_notification", "email_changed_notification", "phone_changed_notification",
    "identity_linked_notification", "identity_unlinked_notification",
    "mfa_factor_enrolled_notification", "mfa_factor_unenrolled_notification"
  ]) {
    const e = clone();
    e.email_data = { email_action_type: kind };
    const [m] = buildAuthEmailMessages(e, options);
    assert.equal(m.to, "owner@example.org");
    assert.match(m.subject, /Rentulo/);
    assert.match(m.html, /rentulo@rentulo\.com/);
  }
});

test("AUTH hook escapes untrusted email/redirect content and rejects unexpected origins", async () => {
  const { buildAuthEmailMessages } = await load();
  const e = clone();
  e.email_data.email_action_type = "email_change";
  e.user.new_email = "test<script>@example.org";
  assert.throws(() => buildAuthEmailMessages(e, options), /new email/);
  const hostile = clone();
  hostile.email_data.redirect_to = "https://evil.example/steal";
  assert.throws(() => buildAuthEmailMessages(hostile, options), /Untrusted Auth redirect/);
  const badHost = { supabaseUrl: "https://fake.example" };
  assert.throws(() => buildAuthEmailMessages(clone(), badHost), /Untrusted Supabase/);
  const badType = clone(); badType.email_data.email_action_type = "some_unexpected_auth_action";
  assert.throws(() => buildAuthEmailMessages(badType, options), /Unsupported/);
});

test("AUTH hook server requires signed events, returns success only after provider success, and uses Reply-To", () => {
  const src = read("supabase/functions/send-auth-email/index.ts");
  assert.match(src, /new Webhook\(/);
  assert.match(src, /webhook\.verify\(raw,/);
  assert.match(src, /no-verify-jwt|No JWT verification/);
  assert.match(src, /reply_to: "rentulo@rentulo\.com"/);
  assert.match(src, /https:\/\/api\.resend\.com\/emails/);
  assert.match(src, /Idempotency-Key/);
  assert.match(src, /if \(deliveries\.some\(\(result\) => !result\?\.ok\)\)/);
  assert.match(src, /Promise\.all\(messages\.map/);
  assert.match(src, /Retry-After/);
  assert.match(src, /return jsonResponse\(200/);
  assert.doesNotMatch(src, /console\.log|console\.error/);
  assert.doesNotMatch(src, /service_role|SUPABASE_SERVICE_ROLE_KEY/);
});
