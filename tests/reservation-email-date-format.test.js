"use strict";

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

test("reservation email dates use the recipient language locale", () => {
  assert.match(source, /cs:\s*"cs-CZ"/);
  assert.match(source, /sk:\s*"sk-SK"/);
  assert.match(source, /en:\s*"en-GB"/);
  assert.match(source, /de:\s*"de-DE"/);
  assert.match(source, /pl:\s*"pl-PL"/);
  assert.match(source, /new Intl\.DateTimeFormat\(dateLocales\[language\]/);
  assert.match(source, /timeZone:\s*"UTC"/);
});

test("reservation email date range formats both database dates", () => {
  assert.match(
    source,
    /formatReservationDate\(reservation\.start_date, language\)[\s\S]*formatReservationDate\(reservation\.end_date, language\)/
  );
  assert.doesNotMatch(
    source,
    /const dateText = `\$\{reservation\.start_date\}[^`]*\$\{reservation\.end_date\}`;/
  );
});
