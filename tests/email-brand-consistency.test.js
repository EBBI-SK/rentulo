"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sources = [
  "supabase/auth-email-templates/confirm-sign-up/Body.html",
  "supabase/auth-email-templates/change-email-address/Body.html",
  "supabase/auth-email-templates/reset-password/Body.html",
  "supabase/functions/send-reservation-email/index.ts",
  "supabase/functions/send-overdue-owner-debt-reminders/index.ts",
];

for (const filename of sources) {
  test(`Rentulo email branding and CTA colors match across: ${filename}`, () => {
    const html = readFileSync(path.join(root, filename), "utf8");
    // All customer emails use the same mobile-friendly card, header and footer.
    assert.match(html, /<div style="margin:0;padding:32px 16px;background:#f5f8f6;/);
    assert.match(html, /<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e9e5;border-radius:18px;overflow:hidden;/);
    assert.match(html, /<div style="padding:28px 32px;background:#e9f4ee;/);
    assert.match(html, /<div style="font-size:30px;font-weight:700;color:#0e5037;">Rentulo<\/div>/);
    assert.match(html, /<div style="padding:20px 32px;border-top:1px solid #e5e9e5;/);
    // Every rendered action, including the five languages and the fallback, is white on #00835a.
    const buttons = [...html.matchAll(/<a href="[^"]+" style="[^"]+">/g)];
    assert.ok(buttons.length > 0, `${filename}: no action buttons`);
    for (const [button] of buttons) {
      assert.match(button, /background:#00835a;color:#ffffff;/, `${filename}: inconsistent action button`);
    }
    assert.doesNotMatch(html, /#(?:75d94f|70d84b|7ed957|73d64f)\b/i, `${filename}: obsolete lime-green button`);
  });
}
