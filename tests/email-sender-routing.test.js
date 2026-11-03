"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const get = p => fs.readFileSync(path.join(root, p), "utf8");
const customer = [
  "supabase/functions/send-auth-email/index.ts",
  "supabase/functions/send-reservation-email/index.ts",
  "supabase/functions/send-overdue-owner-debt-reminders/index.ts",
];
const monitor = "supabase/functions/monitor-reservation-notifications/index.ts";
const prodMonitor = "supabase/functions/monitor-reservation-notifications-prod/index.ts";

test("Customer transactional email senders and reply-to are always rentulo@rentulo.com", () => {
  for (const filename of customer) {
    const code = get(filename);
    assert.match(code, /(?:const from|const emailFrom) = "Rentulo <rentulo@rentulo\.com>";/,
      filename + ": incorrect customer sender");
    assert.match(code, /reply_to: "rentulo@rentulo\.com"/, filename + ": incorrect reply-to");
    assert.doesNotMatch(code, /env\.get\(["']EMAIL_FROM["']\)/,
      filename + ": customer sender must never inherit technical configuration");
    assert.doesNotMatch(code, /support@rentulo\.com/,
      filename + ": technical address must not be used for customer mail");
  }
});

test("Technical alerts use only support@rentulo.com, independent of customer configuration", () => {
  const code = get(monitor);
  assert.match(code, /const TEST_ALERT_TO = "support@rentulo\.com";/);
  assert.match(code, /const TEST_ALERT_FROM = "Rentulo Monitoring <support@rentulo\.com>";/);
  assert.match(code, /reply_to: TEST_ALERT_TO/);
  assert.match(code, /sendAlert\(alert, resendKey, TEST_ALERT_FROM\)/);
  assert.doesNotMatch(code, /env\.get\(["']EMAIL_FROM["']\)/);
});

test("PROD technical alerts use support@rentulo.com and cannot inherit customer sender", () => {
  const code = get(prodMonitor);
  assert.match(code, /const PROD_SUPABASE_URL = "https:\/\/tfvgxrdjrpicgtvovehl\.supabase\.co";/);
  assert.match(code, /const ALERT_TO = "support@rentulo\.com";/);
  assert.match(code, /const ALERT_FROM = "Rentulo Monitoring <support@rentulo\.com>";/);
  assert.match(code, /reply_to: ALERT_TO/);
  assert.match(code, /from: ALERT_FROM/);
  assert.match(code, /subject: `Rentulo PROD/);
  assert.doesNotMatch(code, /env\.get\(["']EMAIL_FROM["']\)/);
  assert.doesNotMatch(code, /rentulo@rentulo\.com/);
});

test("All Resend senders in the Edge Function tree have an audited customer/technical role", () => {
  const base = path.join(root, "supabase", "functions");
  const found = fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory())
    .map(d => `supabase/functions/${d.name}/index.ts`)
    .filter(file => fs.existsSync(path.join(root, file)))
    .filter(file => get(file).includes("https://api.resend.com/emails"))
    .sort();
  assert.deepEqual(found, [...customer, monitor, prodMonitor].sort());
});
