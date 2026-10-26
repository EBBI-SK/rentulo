import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const theme = load('css/rentulo-theme.css');
const home = load('index.html');
const offer = load('nabidnout.html');
const navigation = load('js/navigation.js');
const myOffers = load('css/my-offers.css');
const howItWorks = load('jak-to-funguje.html');

test('action buttons use the approved Rentulo green', () => {
  assert.match(theme, /--rentulo-action-green: #00835a;/);
  for (const control of ['.btn-register', '.search-button', '#results-search-button', '.btn-primary',
    '.owner-debt-pay', '.pickup-confirm-ready', '.reservation-primary-action.orange',
    '.small-button.orange', '.reservation-modal-pay', '.top-action-button', '.result-button']) {
    assert.ok(theme.includes(control), `${control} has a sitewide action-color rule`);
  }
  assert.match(theme, /body \.search-button:hover/);
});

test('map markers are green and header/menu notification counters are red on all pages', () => {
  assert.match(home, /\.home-map-marker\s*\{[^}]*background: #00835a;/);
  for (const file of [home, theme, myOffers, navigation]) {
    assert.match(file, /\.nav-notification-badge\s*\{[^}]*background: #DC3545(?: !important)?;/);
  }
  for (const file of [home, theme, myOffers]) {
    assert.match(file, /\.nav-account-link:hover \.nav-notification-badge\s*\{[^}]*background: #DC3545(?: !important)?;/);
  }
  assert.match(navigation, /\.nav-menu-notification-badge\s*\{[^}]*background: #DC3545;/);
  assert.match(howItWorks, /\.nav-notification-badge\s*\{[^}]*background: #DC3545 !important;/);
  assert.match(theme, /body \.nav-menu-notification-badge,[\s\S]*?--rentulo-attention-red/);
});

test('orange visual states are semantic on offers and reservations', () => {
  assert.match(theme, /--rentulo-attention-red: #DC3545;/);
  assert.match(theme, /--rentulo-attention-soft: #FFF0F1;/);
  assert.match(theme, /--rentulo-passive-bg: #EEF1F2;/);
  for (const selector of [
    'body[data-navigation-page="moje-rezervace"] .status-pending',
    'body[data-navigation-page="moje-rezervace"] .status-approved',
    'body[data-navigation-page="moje-rezervace"] .payment-box.waiting',
    'body[data-navigation-page="moje-rezervace"] .reservation-page-notice.error',
    'body[data-navigation-page="moje-nabidky"] .request-status:not(.paid):not(.active):not(.finished)',
    'body[data-navigation-page="moje-nabidky"] .owner-debt-status:not(.is-paid):not(.is-waived)',
    'body[data-navigation-page="moje-nabidky"] .request-note',
  ]) assert.ok(theme.includes(selector), `${selector} gets semantic attention or neutral palette`);
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
