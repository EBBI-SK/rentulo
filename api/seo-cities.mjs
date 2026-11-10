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

// Keep the stored, real Czech city name unchanged; many names cannot be
// grammatically inflected by replacing a suffix. City pages exist only for
// public offers in that city, never for generated/empty location combinations.
const CITY_TOPICS = Object.freeze({
  domacnost: Object.freeze({ title: 'Vybavení do domácnosti', description: 'Vybavení do domácnosti' }),
  zahrada: Object.freeze({ title: 'Zahradní technika a vybavení', description: 'Zahradní technika a vybavení' }),
  stavba: Object.freeze({ title: 'Nářadí a stavební vybavení', description: 'Nářadí a stavební vybavení' }),
  hobby: Object.freeze({ title: 'Vybavení pro hobby a volný čas', description: 'Vybavení pro hobby a volný čas' }),
  party: Object.freeze({ title: 'Vybavení na oslavy a akce', description: 'Vybavení na oslavy a akce' }),
  ostatni: Object.freeze({ title: 'Další věci', description: 'Další věci' })
});

export function citySeoTitle(category, cityName) {
  const subject = CITY_TOPICS[category?.slug]?.title || category?.name || 'Věci';
  return `${subject} k půjčení – ${cityName}`;
}

export function citySeoDescription(category, cityName) {
  const subject = CITY_TOPICS[category?.slug]?.description || category?.name || 'Věci';
  return `${subject} k půjčení – ${cityName}. Prohlédněte si veřejné nabídky od lidí, denní ceny a podrobnosti zveřejněných nabídek na Rentulu.`;
}
