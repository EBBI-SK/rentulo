const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const navigation = fs.readFileSync(path.join(root, 'js/navigation.js'), 'utf8');
const theme = fs.readFileSync(path.join(root, 'css/rentulo-theme.css'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'js/i18n.js'), 'utf8');
const footerTemplate = navigation.match(/footer\.innerHTML\s*=\s*`([\s\S]*?)`;/);

function footerHtml() {
  assert.ok(footerTemplate, 'shared footer template should exist');
  return new Function('return `' + footerTemplate[1] + '`')();
}

test('public footer contains the four agreed navigation links and the original EBBI link', () => {
  const html = footerHtml();
  const actualLinks = Array.from(html.matchAll(/<a\s+href="([^"]+)"/g), (match) => match[1]);
  assert.deepEqual(actualLinks, [
    'kontakt.html',
    'kontakt.html#nahlaseni-obsahu',
    'obchodni-podminky.html',
    'ochrana-osobnich-udaju.html',
    'https://ebbi.sk'
  ]);
  assert.match(html, /\u00a9 2026 Rentulo/);
  assert.match(html, /EBBI s\. r\. o\./);
  assert.match(html, /<a href="https:\/\/ebbi\.sk" target="_blank" rel="noopener noreferrer">EBBI s\. r\. o\.<\/a>/);
  assert.doesNotMatch(html, /social|facebook|instagram|youtube|FAQ|cookies/i);
  assert.ok(fs.readFileSync(path.join(root, 'kontakt.html'), 'utf8').includes('id="nahlaseni-obsahu"'));
});

test('footer translations work in the five supported languages', () => {
  const window = {};
  const document = { addEventListener() {} };
  vm.runInNewContext(i18n, { window, document, localStorage: { getItem: () => 'cs' } });
  for (const lang of ['cs', 'sk', 'en', 'de', 'pl']) {
    for (const key of [
      'contact.eyebrow', 'footer.reportIllegal', 'contact.termsLink',
      'contact.privacyLink', 'footer.operatorLabel', 'footer.linksLabel'
    ]) {
      const value = window.rentuloTranslate(key, lang);
      assert.ok(value && value !== key, `missing ${lang}: ${key}`);
    }
  }
  assert.equal(window.rentuloTranslate('footer.reportIllegal', 'cs'), 'Nahl\u00e1sit nez\u00e1konn\u00fd obsah');
  assert.equal(window.rentuloTranslate('footer.operatorLabel', 'cs'), 'Provozovatel:');
});

test('footer is shared on original public pages and refreshes labels on language change', () => {
  const list = navigation.match(/const navCreditPublicPages = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(list);
  const pages = Array.from(list[1].matchAll(/"([^"]+)"/g), (m) => m[1]);
  assert.equal(pages.length, 9);
  assert.ok(pages.includes('uvod'));
  assert.ok(pages.includes('obchodni-podminky'));
  assert.ok(pages.includes('ochrana-osobnich-udaju'));
  assert.match(navigation, /document\.addEventListener\("rentuloLanguageChanged"/);
  assert.match(navigation, /footer\.querySelectorAll\("\[data-i18n\]"\)/);
  assert.match(navigation, /footerLinks\.setAttribute\("aria-label", navTranslate\("footer\.linksLabel"/);
});

test('footer is in document flow, compact on desktop and vertically stacked on mobile', () => {
  const footerStyles = theme.slice(theme.indexOf('/* Shared public footer: compact'));
  const mobile = footerStyles.match(/@media \(max-width: 640px\) \{([\s\S]*?)\n\}\n\n/);
  assert.ok(mobile, 'mobile footer stylesheet exists');
  assert.match(footerStyles, /\.rentulo-credit-footer\s*\{\s*position: static;/);
  assert.match(footerStyles, /padding: 13px 0;/);
  assert.match(footerStyles, /\.rentulo-credit-footer-links a\s*\{[^}]*color: var\(--rentulo-muted\);[^}]*font-weight: 400;/);
  assert.match(footerStyles, /\.rentulo-credit-footer-operator a\s*\{[^}]*color: inherit;/);
  assert.match(mobile[1], /\.rentulo-credit-footer-links\s*\{\s*flex-direction: column;/);
  assert.match(mobile[1], /\.rentulo-credit-footer-meta\s*\{\s*flex-direction: column;/);
});
