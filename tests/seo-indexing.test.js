const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const vercel = JSON.parse(readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));

function matchingHeaders(hostname) {
  return vercel.headers
    .filter(rule => {
      const matchesHost = condition => {
        assert.equal(condition.type, 'host');
        assert.ok(condition.value?.re, 'Host condition must have an explicit regex');
        return new RegExp(condition.value.re).test(hostname);
      };
      return (rule.has || []).every(matchesHost) &&
        (rule.missing || []).every(condition => !matchesHost(condition));
    })
    .flatMap(rule => rule.headers);
}

function assertNotIndexable(hostname) {
  const headers = matchingHeaders(hostname);
  const robots = headers.filter(header => header.key.toLowerCase() === 'x-robots-tag');
  assert.equal(robots.length, 1, `Exactly one X-Robots-Tag expected for ${hostname}`);
  assert.equal(robots[0].value, 'noindex', `Indexing must be disabled for ${hostname}`);
  assert.equal(
    headers.filter(header => header.key === 'Content-Security-Policy').length,
    1,
    `Existing CSP must remain present for ${hostname}`
  );
}

test('TEST and Vercel deployment / preview domains are never indexable', () => {
  for (const hostname of [
    'rentulo.eu',
    'www.rentulo.eu',
    'rentulo.vercel.app',
    'rentulo-prod.vercel.app',
    'rentulo-git-main-example.vercel.app',
    'rentulo-preview.vercel.app'
  ]) {
    assertNotIndexable(hostname);
  }
});

test('PROD custom domain remains noindex until the approved public launch', () => {
  for (const hostname of ['rentulo.com', 'www.rentulo.com']) {
    assertNotIndexable(hostname);
  }
});
