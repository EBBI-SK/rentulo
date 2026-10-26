import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const cssFiles = readdirSync(new URL('../css/', import.meta.url)).filter(file => file.endsWith('.css'));
const pages = ['index.html', 'jak-to-funguje.html', 'moje-rezervace.html', 'moje-nabidky.html',
  'detail.html', 'nabidnout.html', 'vysledky.html'];

// Safety net for returning old visual styles in future changes.
test('Rentulo V1 has no obsolete orange hex/glows in page CSS or shared navigation', () => {
  const sources = [
    ...cssFiles.map(file => `css/${file}`),
    ...pages,
    'js/navigation.js'
  ];
  for (const source of sources) {
    assert.doesNotMatch(read(source), /#(?:ff6a00|e85f00)\b|rgba\(255,\s*106,\s*0,/i, `${source}: obsolete orange action styling`);
  }
});

test('confirmed actions and informational statuses retain their agreed colors', () => {
  const theme = read('css/rentulo-theme.css');
  assert.match(theme, /--rentulo-action-green: #00835a;/);
  assert.match(theme, /--rentulo-attention-red: #DC3545;/);
  assert.match(theme, /--rentulo-passive-bg: #EEF1F2;/);
  assert.match(read('index.html'), /\.home-map-marker\s*\{[^}]*background: #00835a;/);
  assert.match(read('moje-rezervace.html'), /\.status-approved\s*\{[^}]*background: #fff0f1 !important;/);
  assert.match(read('moje-rezervace.html'), /\.status-pending\s*\{[^}]*background: #eef1f2 !important;/);
  assert.match(read('moje-nabidky.html'), /\.request-note\s*\{[^}]*background: #eef1f2 !important;/);
  assert.match(read('moje-nabidky.html'), /\.request-row \.small-button\.orange:hover\s*\{[^}]*background: #006846 !important;/);
  assert.match(read('css/auth.css'), /\.auth-error-message,\s*\.status-message\.error\s*\{[^}]*background: #fff0f1;/);
  assert.match(read('css/registration.css'), /\.registration-error\s*\{[^}]*background: #fff0f1;/);
  assert.match(read('css/contact.css'), /\.contact-test-badge\s*\{[^}]*background: #eef1f2;/);
  assert.match(read('css/terms.css'), /\.terms-warning\s*\{[^}]*background: #eef1f2;/);
  assert.match(read('css/privacy.css'), /\.privacy-warning\s*\{[^}]*background: #eef1f2;/);
});

test('shared styles keep notification counters red, error text red, and text links legible', () => {
  assert.match(read('js/navigation.js'), /\.nav-menu-notification-badge\s*\{[^}]*background: #DC3545;/);
  assert.match(read('css/my-offers.css'), /\.return-issue-reported\s*\{[^}]*background: #fff0f1;/);
  assert.match(read('css/my-offers-flow.css'), /\.owner-debt-overdue-warning\s*\{[^}]*rgba\(255, 240, 241, 0\.94\)/);
  for (const path of [...cssFiles.map(file => `css/${file}`), ...pages]) {
    // Previously used light greens on white are too pale for normal text.
    assert.doesNotMatch(read(path), /(?<![\w-])color:\s*#(?:4f9b35|4f9f2f|54a63b|3f8e28|3f8f2d)\b/i, `${path}: pale green text`);
  }
});
