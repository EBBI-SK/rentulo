const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sourcePath = path.join(
  __dirname,
  "..",
  "supabase",
  "functions",
  "send-reservation-email",
  "index.ts"
);
const source = fs.readFileSync(sourcePath, "utf8");

test("active reservation email links follow the recipient account role", () => {
  assert.match(source, /const recipientIsOwner = profile\.id === reservation\.owner_id;/);
  assert.match(
    source,
    /const detailUrl = `\$\{siteUrl\}\/\$\{isExpirationNotice \? "historie\.html" : recipientIsOwner \? "moje-nabidky\.html" : "moje-rezervace\.html"\}`;/
  );
});

test("reservation email link is not hard-coded to renter reservations", () => {
  assert.doesNotMatch(
    source,
    /const detailUrl = `\$\{siteUrl\}\/moje-rezervace\.html`;/
  );
});

test("expired email links go to History, not an active reservations page", () => {
  assert.match(source, /const isExpirationNotice = event === "expired_pending" \|\| event === "expired_approved" \|\| event === "no_show";/);
  assert.match(source, /isExpirationNotice \? "historie\.html"/);
});
