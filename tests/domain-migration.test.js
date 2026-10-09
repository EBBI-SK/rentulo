"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");

const root = path.join(__dirname, "..");
const readFunction = name => fs.readFileSync(
  path.join(root, "supabase", "functions", name, "index.ts"), "utf8",
);
const address = readFunction("address-suggestions");
const geocode = readFunction("geocode-pickup");
const reservationEmail = readFunction("send-reservation-email");
const overdueReminder = readFunction("send-overdue-owner-debt-reminders");
const testProject = "https://vspposovhdgvbeukoivh.supabase.co";
const prodProject = "https://tfvgxrdjrpicgtvovehl.supabase.co";

function loadTsFunction(source, name, context = {}) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} not found`);
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `End of ${name} not found`);
  const snippet = stripTypeScriptTypes(source.slice(start, end + 2));
  return vm.runInNewContext(`${snippet}\n${name}`, context);
}

test("address suggestions permit the existing TEST origin and local development without PROD", () => {
  const origins = loadTsFunction(address, "allowedOriginsForProject")(testProject + "/");
  for (const origin of [
    "https://rentulo.eu", "https://www.rentulo.eu",
    "http://localhost:3000", "http://localhost:5500", "http://127.0.0.1:5500",
  ]) assert.equal(origins.has(origin), true, origin);
  for (const origin of [
    "https://rentulo.com", "https://www.rentulo.com",
    "https://rentulo-seven.vercel.app", "https://rentulo-prod.vercel.app",
  ]) assert.equal(origins.has(origin), false, origin);
});

test("address suggestions permit only the official PROD domains on PROD", () => {
  const origins = loadTsFunction(address, "allowedOriginsForProject")(prodProject);
  assert.deepEqual([...origins].sort(), ["https://rentulo.com", "https://www.rentulo.com"].sort());
});

test("unknown Supabase projects are not permitted for address suggestions", () => {
  const allowed = loadTsFunction(address, "allowedOriginsForProject");
  for (const url of ["https://another-project.supabase.co", "http://localhost:54321", undefined, "https://rentulo.eu"]) {
    assert.equal(allowed(url).size, 0);
  }
});

test("address suggestions CORS reflects only origins already allowed for the active project", () => {
  const origins = loadTsFunction(address, "allowedOriginsForProject")(testProject);
  const getCorsHeaders = loadTsFunction(address, "getCorsHeaders", { ALLOWED_ORIGINS: origins });
  assert.equal(getCorsHeaders("https://rentulo.eu")["Access-Control-Allow-Origin"], "https://rentulo.eu");
  for (const origin of ["https://rentulo.com", "https://rentulo-seven.vercel.app", null]) {
    assert.equal(getCorsHeaders(origin)["Access-Control-Allow-Origin"], undefined);
  }
  assert.match(address, /if \(origin && !ALLOWED_ORIGINS\.has\(origin\)\)/);
  assert.match(address, /if \(!origin \|\| !ALLOWED_ORIGINS\.has\(origin\)\)/);
  assert.doesNotMatch(address, /"Access-Control-Allow-Origin": "\*"/);
});

test("address suggestions use the active environment's website in geocoding User-Agent", () => {
  const allowed = loadTsFunction(address, "allowedOriginsForProject");
  const agentExpression = address.match(/const GEOCODING_USER_AGENT = ([\s\S]+?);\n/);
  assert.ok(agentExpression);
  for (const [project, website] of [[testProject, "rentulo.eu"], [prodProject, "rentulo.com"]]) {
    const agent = vm.runInNewContext(agentExpression[1], { ALLOWED_ORIGINS: allowed(project) });
    assert.match(agent, new RegExp(`https://${website.replace('.', '\\.')}`));
    assert.match(agent, /rentulo@rentulo\.com/);
  }
  assert.match(address, /"User-Agent": GEOCODING_USER_AGENT/);
  assert.doesNotMatch(address, /rentulo-seven\.vercel\.app|info@rentulo\.cz/);
});

test("geocode-pickup identifies TEST and PROD correctly and refuses unknown projects", () => {
  const agentForProject = loadTsFunction(geocode, "geocodingUserAgent");
  assert.match(agentForProject(testProject), /https:\/\/rentulo\.eu; contact: rentulo@rentulo\.com/);
  assert.match(agentForProject(prodProject + "/"), /https:\/\/rentulo\.com; contact: rentulo@rentulo\.com/);
  assert.equal(agentForProject("https://unknown.supabase.co"), null);
  assert.match(geocode, /geocodeWithNominatim\(street, city, postalCode, userAgent\)/);
  assert.match(geocode, /geocodeWithPhoton\(street, city, postalCode, userAgent\)/);
  assert.doesNotMatch(geocode, /rentulo-seven\.vercel\.app|info@rentulo\.cz/);
});

for (const [label, source] of [
  ["reservation email", reservationEmail],
  ["overdue owner debt reminder", overdueReminder],
]) {
  test(`${label} links stay within their Supabase environment`, () => {
    const site = loadTsFunction(source, "resolveRentuloSiteUrl");
    assert.equal(site(testProject, undefined), "https://rentulo.eu");
    assert.equal(site(testProject, "https://rentulo.eu/"), "https://rentulo.eu");
    assert.equal(site(prodProject, undefined), "https://rentulo.com");
    assert.equal(site(prodProject, "https://rentulo.com"), "https://rentulo.com");
    for (const [project, value] of [
      [testProject, "https://rentulo.com"],
      [prodProject, "https://rentulo.eu"],
      [testProject, "https://rentulo-seven.vercel.app"],
      [prodProject, "https://rentulo-prod.vercel.app"],
      [prodProject, "http://rentulo.com"],
      [prodProject, "https://rentulo.com/path"],
      [prodProject, "https://www.rentulo.com"],
      [testProject, "https://rentulo.eu?next=https://rentulo.com"],
    ]) assert.equal(site(project, value), null, `${project} / ${value}`);
    assert.equal(site("https://unknown.supabase.co", "https://rentulo.eu"), null);
    assert.match(source, /!siteUrl\)\s*\{/);
    assert.doesNotMatch(source, /rentulo-seven\.vercel\.app/);
  });
}

test("TEST, PROD and preview remain noindex until the explicitly approved launch", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  for (const rule of config.headers.filter(r => r.headers?.some(h => h.key === "X-Robots-Tag"))) {
    assert.equal(rule.headers.find(h => h.key === "X-Robots-Tag").value, "noindex");
  }
  assert.equal(config.redirects.some(r => /rentulo\.(?:eu|com)/.test(r.source + r.destination)), false);
});

test("handover requires reviewing history and current main before any new step", () => {
  const handover = fs.readFileSync(path.join(root, "HANDOVER.md"), "utf8");
  assert.match(handover, /pred každým krokom/);
  assert.match(handover, /históriu predchádzajúcich prác/);
  assert.match(handover, /aktuálny GitHub `main`/);
  assert.match(handover, /hotové kroky neopakovať/);
});
