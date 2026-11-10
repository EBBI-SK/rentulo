const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const config = JSON.parse(readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));

test('Permissions-Policy keeps security restrictions without obsolete browsing-topics directive', () => {
  const globalRules = config.headers.filter(rule => rule.source === '/(.*)' && !rule.has && !rule.missing);
  assert.equal(globalRules.length, 1);
  const permissions = globalRules[0].headers.filter(header => header.key.toLowerCase() === 'permissions-policy');
  assert.equal(permissions.length, 1);
  assert.equal(permissions[0].value, 'camera=(), microphone=(), geolocation=(self), usb=()');
  assert.ok(!permissions[0].value.includes('browsing-topics'));
});
