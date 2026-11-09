// SEO 19B/2: stable V1 subcategory slugs. User chooses only one of the six
// existing main categories; the server assigns the subcategory automatically.
// These are public labels and URLs, not a client-side classification engine.
const definitions = [
  ['domacnost', 'uklid', 'Úklid a čištění'],
  ['domacnost', 'kuchynske-pristroje', 'Kuchyňské přístroje'],
  ['domacnost', 'domaci-spotrebice', 'Domácí spotřebiče'],
  ['domacnost', 'vybaveni-domacnosti', 'Vybavení domácnosti'],
  ['zahrada', 'sekacky', 'Sekačky a vertikutátory'],
  ['zahrada', 'krovinorezy-pily', 'Křovinořezy a motorové pily'],
  ['zahrada', 'kultivatory', 'Kultivátory a půdní technika'],
  ['zahrada', 'cerpadla', 'Čerpadla a zavlažování'],
  ['stavba', 'vrtacky', 'Vrtačky a šroubováky'],
  ['stavba', 'pily-brusky', 'Pily a brusky'],
  ['stavba', 'merici-technika', 'Měřicí technika'],
  ['stavba', 'zebriky-leseni', 'Žebříky a lešení'],
  ['stavba', 'betonovani-bourani', 'Betonování a bourání'],
  ['hobby', 'foto-video', 'Foto a video'],
  ['hobby', 'hudebni-nastroje', 'Hudební nástroje'],
  ['hobby', 'sport-fitness', 'Sport a fitness'],
  ['hobby', 'kempovani', 'Kempování a turistika'],
  ['party', 'ozvuceni', 'Ozvučení'],
  ['party', 'osvetleni-efekty', 'Osvětlení a efekty'],
  ['party', 'stany-pristresky', 'Stany a přístřešky'],
  ['party', 'stoly-zidle', 'Stoly a židle'],
  ['party', 'gastro-vycep', 'Gastro a výčepní vybavení'],
  ['ostatni', 'kancelar-prezentace', 'Kancelář a prezentace'],
  ['ostatni', 'detske-vybaveni', 'Dětské vybavení'],
  ['ostatni', 'sezonni-vybaveni', 'Sezónní vybavení'],
  ['ostatni', 'jine', 'Jiné'] // Only the SQL Editor owner may assign this manually.
];

export const SEO_SUBCATEGORIES = Object.freeze(definitions.map(([categorySlug, slug, name]) => Object.freeze({
  categorySlug, slug, name,
  description: `${name} k půjčení na Rentulu. Prohlédněte si aktuální nabídky lidí v České republice.`
})));
const byPath = new Map(SEO_SUBCATEGORIES.map(item => [`${item.categorySlug}/${item.slug}`, item]));
const byCategory = new Map();
for (const item of SEO_SUBCATEGORIES) {
  if (!byCategory.has(item.categorySlug)) byCategory.set(item.categorySlug, []);
  byCategory.get(item.categorySlug).push(item);
}
for (const [key, values] of byCategory) byCategory.set(key, Object.freeze(values));

export function getSeoSubcategory(categorySlug, slug) {
  return typeof categorySlug === 'string' && typeof slug === 'string'
    ? byPath.get(`${categorySlug}/${slug}`) || null
    : null;
}

export function getSeoSubcategories(categorySlug) {
  return byCategory.get(categorySlug) || [];
}
