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

test("geocode-pickup identifies TEST and PROD correctly and refuses unknown projects", () => {
  const agentForProject = loadTsFunction(geocode, "geocodingUserAgent");
  assert.match(agentForProject(testProject), /https:\/\/rentulo\.eu; contact: rentulo@rentulo\.com/);
  assert.match(agentForProject(prodProject + "/"), /https:\/\/rentulo\.com; contact: rentulo@rentulo\.com/);
  assert.equal(agentForProject("https://unknown.supabase.co"), null);
  assert.match(geocode, /geocodeWithGeoapify\(street, city, postalCode, userAgent, apiKey\)/);
  assert.match(geocode, /api-eu\.geoapify\.com/);
  assert.doesNotMatch(geocode, /nominatim\.openstreetmap|photon\.komoot/);
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
