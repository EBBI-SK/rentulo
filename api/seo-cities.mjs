// SEO 19B/3: stable CZ city slugs. A listing must already contain a public city;
// this module never invents locations or attempts geolocation.
const DISALLOWED = new Set([
  'cz', 'cr', 'cesko', 'ceska-republika', 'czech-republic',
  'neuvedeno', 'nezname', 'neznamy', 'online', 'test'
]);
const SLUG = /^[a-z](?:[a-z0-9]*)(?:-[a-z0-9]+)*$/;

export function isSeoCitySlug(value) {
  return typeof value === 'string' && value.length >= 2 && value.length <= 64 &&
    SLUG.test(value) && !DISALLOWED.has(value);
}

export function getSeoCitySlug(value) {
  if (typeof value !== 'string') return null;
  const city = value.trim();
  if (city.length < 2 || city.length > 80 || /[<>\/@?#]/.test(city)) return null;
  const slug = city.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0142/g, 'l').replace(/\u0111/g, 'd').replace(/\u00f8/g, 'o')
    .replace(/\u00df/g, 'ss').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return isSeoCitySlug(slug) ? slug : null;
}

// No grammatical location suffixes: Czech city names have irregular declensions.
// An exact, natural city label is taken only from an active public offer.
export function citySeoTitle(category, cityName) {
  const subjects = {
    domacnost: 'Vybaven\u00ed dom\u00e1cnosti',
    zahrada: 'Zahradn\u00ed technika',
    stavba: 'Stavebn\u00ed n\u00e1\u0159ad\u00ed',
    hobby: 'Vybaven\u00ed pro hobby',
    party: 'P\u00e1rty vybaven\u00ed',
    ostatni: 'Dal\u0161\u00ed v\u011bci'
  };
  const subject = subjects[category?.slug] || category?.name || 'V\u011bci';
  return `${subject} k p\u016fj\u010den\u00ed \u2013 ${cityName}`;
}

export function citySeoDescription(category, cityName) {
  return `Prohl\u00e9dn\u011bte si aktu\u00e1ln\u00ed ve\u0159ejn\u00e9 nab\u00eddky v kategorii ${category.name} ` +
    `v lokalit\u011b ${cityName}. P\u016fj\u010dte si v\u011bci od lid\u00ed jednodu\u0161e p\u0159es Rentulo.`;
}
