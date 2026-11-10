import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { createContext, runInContext, runInNewContext } from 'node:vm';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
let output;
const read = file => readFileSync(join(output, file), 'utf8');
const allLanguages = ['cs', 'sk', 'en', 'de', 'pl'];

before(() => {
  output = mkdtempSync(join(tmpdir(), 'rentulo-i18n-'));
  execFileSync(process.execPath, [join(root, 'scripts/build-site.mjs'), output], {
    cwd: root,
    env: { ...process.env, RENTULO_DEPLOY_TARGET: 'test', RENTULO_SUPABASE_URL: '', RENTULO_SUPABASE_PUBLISHABLE_KEY: '' },
    stdio: 'pipe'
  });
});
after(() => {
  if (output) rmSync(output, { recursive: true, force: true });
});

function createRuntime(language = 'cs') {
  const state = new Map([['rentuloLanguage', language]]);
  const events = new Map();
  const pendingScripts = [];
  const emitted = [];
  const warnings = [];
  const logger = { warn: (...args) => warnings.push(args) };
  const phrase = { dataset: { i18n: 'home.nearbyAction' }, textContent: '' };
  const placeholder = { dataset: { i18nPlaceholder: 'home.searchWhatPlaceholder' }, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } };
  const document = {
    readyState: 'loading',
    documentElement: { lang: 'cs' },
    body: { dataset: { i18nDocumentTitle: 'home.documentTitle' } },
    title: '',
    currentScript: { src: 'https://rentulo.eu/js/i18n.js' },
    querySelectorAll(selector) {
      if (selector === '[data-i18n]') return [phrase];
      if (selector === '[data-i18n-placeholder]') return [placeholder];
      return [];
    },
    addEventListener(type, callback) {
      const callbacks = events.get(type) || [];
      callbacks.push(callback);
      events.set(type, callbacks);
    },
    dispatchEvent(event) {
      emitted.push(event);
      for (const callback of events.get(event.type) || []) callback(event);
    },
    createElement(type) {
      assert.equal(type, 'script');
      return { onload: null, onerror: null, async: false, src: '' };
    },
    head: { appendChild(script) { pendingScripts.push(script); } }
  };
  const localStorage = {
    getItem(key) { return state.get(key) || null; },
    setItem(key, value) { state.set(key, value); }
  };
  class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init.detail; }
  }
  const window = {};
  const context = createContext({ window, document, localStorage, CustomEvent, console: logger, Promise });
  runInContext(read('js/i18n.js'), context);
  function fireDomReady() {
    document.readyState = 'interactive';
    document.dispatchEvent({ type: 'DOMContentLoaded' });
  }
  function deliver(index = 0) {
    const script = pendingScripts.splice(index, 1)[0];
    assert.ok(script, 'language script must be requested');
    assert.match(script.src, /^https:\/\/rentulo\.eu\/js\/i18n-(?:sk|en|de|pl)\.js$/);
    runInContext(read('js/' + script.src.split('/').pop()), context);
    script.onload();
  }
  return { window, document, state, emitted, warnings, pendingScripts, phrase, placeholder, fireDomReady, deliver };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('TEST build publishes only the Czech fallback at startup, not the complete source catalog', () => {
  const original = readFileSync(join(root, 'js/i18n.js'));
  const runtime = readFileSync(join(output, 'js/i18n.js'));
  assert.ok(runtime.length < original.length / 4, 'large i18n transfer was not eliminated');
  assert.ok(gzipSync(runtime).length < gzipSync(original).length / 3, 'compressed runtime must be substantially smaller');
  assert.deepEqual(readdirSync(join(output, 'js')).filter(name => /^i18n-(sk|en|de|pl)\.js$/.test(name)).sort(),
    ['i18n-de.js', 'i18n-en.js', 'i18n-pl.js', 'i18n-sk.js']);
  for (const language of allLanguages.slice(1)) {
    assert.ok(statSync(join(output, `js/i18n-${language}.js`)).size > 20000);
  }
  // TEST results HTML is rendered by the SSR function using the same source
  // page and generated /js/i18n.js runtime, not emitted as a static file.
  assert.match(readFileSync(join(root, 'vysledky.html'), 'utf8'), /<script src="js\/i18n\.js"><\/script>/);
  assert.match(readFileSync(join(root, 'api/results-page.mjs'), 'utf8'), /rel=\"preconnect\"/);
});

test('Czech visitors get synchronous translations with no additional network request', () => {
  const state = createRuntime('cs');
  assert.equal(state.pendingScripts.length, 0);
  state.fireDomReady();
  assert.equal(state.document.documentElement.lang, 'cs');
  assert.equal(state.document.title, 'Rentulo - půjčovna věcí');
  assert.equal(state.phrase.textContent, 'Klikni pro hledání v okolí');
  assert.equal(state.placeholder.attributes.placeholder, 'např. vrtačka');
  assert.equal(state.emitted.filter(e => e.type === 'rentuloLanguageChanged').length, 0);
});

test('A saved non-Czech language is fetched once and applied after it loads', async () => {
  const state = createRuntime('de');
  assert.equal(state.pendingScripts.length, 1);
  assert.ok(state.pendingScripts[0].src.endsWith('/i18n-de.js'));
  state.fireDomReady();
  assert.equal(state.document.documentElement.lang, 'cs', 'fallback language must match displayed text');
  state.deliver();
  await flush();
  assert.equal(state.document.documentElement.lang, 'de');
  assert.notEqual(state.document.title, 'Rentulo - půjčovna věcí');
  assert.equal(state.window.rentuloTranslate('home.category.garden', 'de'), 'Garten');
  assert.equal(state.emitted.filter(e => e.type === 'rentuloLanguageChanged').length, 1);
});

test('Language switch waits for the requested dictionary before notifying dependent modules', async () => {
  const state = createRuntime('cs');
  state.fireDomReady();
  state.window.setRentuloLanguage('pl');
  assert.equal(state.state.get('rentuloLanguage'), 'pl', 'chosen language persists immediately, as before');
  assert.equal(state.document.documentElement.lang, 'cs', 'visible text remains in the available language');
  assert.equal(state.emitted.filter(e => e.type === 'rentuloLanguageChanged').length, 0);
  state.deliver();
  await flush();
  assert.equal(state.state.get('rentuloLanguage'), 'pl');
  assert.equal(state.document.documentElement.lang, 'pl');
  assert.equal(state.window.rentuloTranslate('home.category.garden'), 'Ogród');
  assert.equal(state.emitted.filter(e => e.type === 'rentuloLanguageChanged').length, 1);
  state.window.setRentuloLanguage('pl');
  assert.equal(state.pendingScripts.length, 0, 'previously fetched dictionaries must not be loaded twice');
});

test('Failed loads preserve the previous language and can be retried; newer choices win', async () => {
  const state = createRuntime('cs');
  state.fireDomReady();
  state.window.setRentuloLanguage('de');
  state.pendingScripts.shift().onerror();
  await flush();
  assert.equal(state.state.get('rentuloLanguage'), 'de', 'language choice persists for a later retry');
  assert.equal(state.warnings.length, 1, 'expected failed request is handled without crashing');
  state.window.setRentuloLanguage('de');
  state.window.setRentuloLanguage('sk');
  assert.equal(state.pendingScripts.length, 2);
  state.deliver(1); // Slovak arrives first and is the newest selection.
  await flush();
  state.deliver(0); // Old German request finishes later.
  await flush();
  assert.equal(state.state.get('rentuloLanguage'), 'sk');
  assert.equal(state.window.rentuloTranslate('home.category.garden'), 'Záhrada');
  assert.equal(state.emitted.filter(e => e.type === 'rentuloLanguageChanged').length, 1);
});


test('All five deployment catalogs preserve every original translation key and value', async () => {
  const source = readFileSync(join(root, 'js/i18n.js'), 'utf8');
  const match = source.match(/  const translations = (\{[\s\S]*?\n  \});/);
  assert.ok(match);
  const catalog = runInNewContext(`(${match[1]})`);
  for (const lang of allLanguages) {
    const state = createRuntime(lang);
    if (lang !== 'cs') {
      state.deliver();
      await flush();
    }
    for (const [key, value] of Object.entries(catalog[lang])) {
      assert.equal(state.window.rentuloTranslate(key, lang), value, `${lang}: ${key}`);
    }
  }
});
