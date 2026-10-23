import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const theme = load('css/rentulo-theme.css');
const home = load('index.html');
const offer = load('nabidnout.html');

test('orange CTA buttons use brand green without altering map markers or alerts', () => {
  assert.match(theme, /--rentulo-action-green: #00835a;/);
  for (const control of ['.btn-register', '.search-button', '#results-search-button', '.btn-primary',
    '.owner-debt-pay', '.pickup-confirm-ready', '.reservation-primary-action.orange',
    '.small-button.orange', '.reservation-modal-pay', '.top-action-button', '.result-button']) {
    assert.ok(theme.includes(control), `${control} has a sitewide action-color rule`);
  }
  assert.match(theme, /body \.search-button:hover/);
  assert.match(home, /\.home-map-marker[\s\S]*?background: var\(--orange\)/);
  assert.match(theme, /\.nav-notification-badge[\s\S]*?var\(--rentulo-orange\)/);
});

test('mobile search and offer CTAs match; transport checkbox has pickup checkbox dimensions', () => {
  assert.match(home, /\.search-box \.search-button \{[\s\S]*?height: 61px;[\s\S]*?justify-self: start;[\s\S]*?margin-left: -8px;[\s\S]*?border-radius: 15px;/);
  assert.match(home, /\.home-offer-cta \{ min-height: 61px;[\s\S]*?border-radius: 15px;/);
  assert.match(offer, /#offerTransportConfirmation \{\s*min-height: 18px;\s*height: 18px;\s*width: 18px;\s*background: transparent;/);
  assert.match(offer, /\.pickup-checkbox input \{\s*width: 18px;\s*height: 18px;/);
});

test('source authentication email buttons use the approved brand green', () => {
  for (const name of ['confirm-sign-up', 'reset-password', 'change-email-address']) {
    const template = load(`supabase/auth-email-templates/${name}/Body.html`);
    assert.ok(template.includes('background:#00835a'), `${name} includes green CTA`);
    assert.ok(!template.includes('background:#ff6a00'), `${name} has no orange CTA`);
  }
});
