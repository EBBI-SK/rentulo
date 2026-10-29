'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const homeHtml = read('index.html');
const resultsHtml = read('vysledky.html');
const homeJs = read('js/home-page.js');
const resultsJs = read('js/results-page.js');
const i18n = read('js/i18n.js');

function orderedMarkup(html, ids) {
  const offsets = ids.map((id) => html.indexOf(`id="${id}"`));
  assert.ok(offsets.every((offset) => offset >= 0), `Missing ID in ${ids.join(', ')}`);
  assert.deepEqual(offsets, offsets.slice().sort((a, b) => a - b));
  for (const id of ids) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
  }
}

test('homepage search has exactly three visible segments: CO / KDY / KDE (not a second row)', () => {
  const bar = homeHtml.slice(homeHtml.indexOf('<form class="search-box" id="homeSearchForm">'));
  orderedMarkup(bar, ['home-search-what', 'home-when-heading', 'home-search-when', 'home-search-where']);
  assert.match(bar, /id="home-date-from" type="date"/);
  assert.match(bar, /id="home-date-to" type="date"/);
  assert.match(bar, /id="home-date-clear"/);
  assert.match(homeHtml, /grid-template-columns: minmax\(0, 1\.13fr\) minmax\(0, \.96fr\) minmax\(0, \.91fr\) 66px/);
  assert.match(homeHtml, /\.search-box\s*\{\s*grid-template-columns: 1fr;/);
  assert.match(homeHtml, /id="homeNearbySearchButton"/);
  assert.match(homeHtml, /id="homeOffersMap"/);
  assert.match(homeHtml, /\.search-field-where \{ grid-template-columns: minmax\(0, 1fr\) 26px/);
  assert.match(homeHtml, /\.search-date-popover \{[\s\S]*?left: 50%/);
  assert.match(homeHtml, /\.search-date-picker > summary \{[\s\S]*?border: 0; background: transparent/);
});

test('results search matches CO / KDY / KDE in one bar and retains category/price filters', () => {
  const barStart = resultsHtml.indexOf('<div class="results-searchbar"');
  const filtersStart = resultsHtml.indexOf('<section class="results-layout">');
  const bar = resultsHtml.slice(barStart, filtersStart);
  assert.ok(barStart > 0 && filtersStart > barStart);
  orderedMarkup(bar, ['results-search-what', 'results-when-heading', 'results-search-when', 'results-search-where']);
  assert.match(bar, /id="results-date-from" type="date"/);
  assert.match(bar, /id="results-date-to" type="date"/);
  assert.match(bar, /id="results-search-button"/);
  assert.match(bar, /id="results-date-status"/);
  assert.match(resultsHtml, /id="categoryFilter"/);
  assert.match(resultsHtml, /id="priceFilter"/);
  assert.match(resultsHtml, /\.results-searchbar \{ grid-template-columns: 1fr;/);
  assert.match(resultsJs, /refreshResultsWhenSummary\(\)/);
  assert.match(resultsHtml, /\.results-searchbar \{[\s\S]*?grid-template-columns: minmax\(0, 1\.13fr\) minmax\(0, \.96fr\) minmax\(0, \.91fr\) 66px/);
  assert.match(resultsHtml, /\.search-date-popover \{[\s\S]*?left: 50%/);
});

test('CO and KDE placeholders remain short in all five languages', () => {
  const placeholders = ['home.searchWhatPlaceholder', 'home.searchWherePlaceholder',
    'results.searchWhatPlaceholder', 'results.searchWherePlaceholder'];
  for (const key of placeholders) {
    const expressions = [...i18n.matchAll(new RegExp(`"${key.replace('.', '\\.')}": "([^"]+)"`, 'g'))];
    assert.equal(expressions.length, 5, key);
    for (const match of expressions) assert.ok(match[1].length <= 25, `${key}: ${match[1]}`);
  }
});

test('date picker labels and validation messages are translated into all five languages', () => {
  const keys = [
    'search.whenLabel', 'search.whenPlaceholder', 'search.dateFrom', 'search.dateTo',
    'search.dateClear', 'search.dateBoth', 'search.dateInvalid', 'search.datePast'
  ];
  for (const key of keys) {
    assert.equal((i18n.match(new RegExp(`"${key.replace('.', '\\.')}"`, 'g')) || []).length, 5, key);
  }
});

function element(value = '') {
  const handlers = {};
  const el = {
    value, min: '', hidden: false, textContent: '', open: false, dataset: {},
    classList: { toggle() {} },
    addEventListener(event, callback) { handlers[event] = callback; },
    contains() { return true; },
    querySelector() { return { focus() {} }; },
    fire(event, arg) { assert.ok(handlers[event], `Missing listener for ${event}`); handlers[event](arg || {}); }
  };
  return el;
}

function homeEnvironment() {
  const nodes = {
    homeSearchForm: element(),
    'home-search-what': element(),
    'home-search-where': element(),
    'home-search-when': element(),
    'home-when-value': element(),
    'home-date-from': element(),
    'home-date-to': element(),
    'home-date-clear': element(),
    'home-date-error': element()
  };
  const location = { href: '', hash: '' };
  const button = element();
  button.dataset.category = 'Stavba';
  const context = {
    console, Intl, URLSearchParams, Date, Set, Map, Number,
    navigator: { platform: 'Win32' },
    document: {
      getElementById(id) { return nodes[id] || null; },
      addEventListener() {},
      querySelectorAll(selector) { return selector === '.home-point-button' ? [button] : []; }
    },
    window: {
      history: { state: null }, location,
      getRentuloLanguage() { return 'cs'; },
      rentuloTranslate(key) { return key; }
    }
  };
  vm.createContext(context);
  vm.runInContext(homeJs, context);
  context.setupHomeSearch();
  context.setupCategorySearch();
  return { nodes, context, location, button };
}

test('homepage sends selected dates to results and remains unchanged when no dates are chosen', () => {
  const { nodes, location } = homeEnvironment();
  nodes['home-search-what'].value = 'vrtačka';
  nodes['home-search-where'].value = 'Praha';
  nodes.homeSearchForm.fire('submit', { preventDefault() {} });
  let params = new URL('https://rentulo.eu/' + location.href).searchParams;
  assert.equal(params.get('co'), 'vrtačka');
  assert.equal(params.get('kde'), 'Praha');
  assert.equal(params.has('od'), false);
  nodes['home-date-from'].value = '2035-12-01';
  nodes['home-date-from'].fire('change');
  nodes['home-date-to'].value = '2035-12-04';
  nodes['home-date-to'].fire('change');
  nodes.homeSearchForm.fire('submit', { preventDefault() {} });
  params = new URL('https://rentulo.eu/' + location.href).searchParams;
  assert.equal(params.get('od'), '2035-12-01');
  assert.equal(params.get('do'), '2035-12-04');
  assert.match(nodes['home-when-value'].textContent, /1.*4/);
  assert.equal(nodes['home-search-when'].open, false);
});

test('homepage refuses incomplete/invalid dates and clear action restores optional search', () => {
  const { nodes, location, button } = homeEnvironment();
  nodes['home-date-from'].value = '2035-12-01';
  nodes['home-date-from'].fire('change');
  nodes.homeSearchForm.fire('submit', { preventDefault() {} });
  assert.equal(location.href, '');
  assert.equal(nodes['home-search-when'].open, true);
  assert.equal(nodes['home-date-error'].hidden, false);
  nodes['home-date-to'].value = '2035-11-30';
  nodes['home-date-to'].fire('change');
  nodes.homeSearchForm.fire('submit', { preventDefault() {} });
  assert.equal(location.href, '');
  nodes['home-date-to'].value = '2035-12-04';
  nodes['home-date-to'].fire('change');
  button.fire('click');
  let params = new URL('https://rentulo.eu/' + location.href).searchParams;
  assert.equal(params.get('kategorie'), 'Stavba');
  assert.equal(params.get('od'), '2035-12-01');
  nodes['home-date-clear'].fire('click');
  assert.equal(nodes['home-date-from'].value, '');
  assert.equal(nodes['home-date-to'].value, '');
  nodes.homeSearchForm.fire('submit', { preventDefault() {} });
  params = new URL('https://rentulo.eu/' + location.href).searchParams;
  assert.equal(params.has('od'), false);
  assert.equal(params.has('do'), false);
});
