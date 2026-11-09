// SEO 19B/2: stable V1 subcategory slugs. User chooses only one of the six
// existing main categories; the server assigns the subcategory automatically.
// SEO copy is editorial, not generated from private reservation or user data.
// These are public labels and URLs, not a client-side classification engine.
const definitions = [
  ['domacnost', 'uklid', 'Úklid a čištění', 'Úklidové vybavení k půjčení',
    'Potřebujete vybavení na jednorázový úklid či čištění? Prohlédněte si veřejné nabídky, denní ceny a města předání na Rentulu.'],
  ['domacnost', 'kuchynske-pristroje', 'Kuchyňské přístroje', 'Kuchyňské přístroje k půjčení',
    'Kuchyňské přístroje k půjčení pro přípravu jídla a vaření. Prohlédněte si zveřejněné nabídky od lidí, denní ceny a města předání.'],
  ['domacnost', 'domaci-spotrebice', 'Domácí spotřebiče', 'Domácí spotřebiče k půjčení',
    'Vyberte si domácí spotřebič k dočasnému používání. Prohlédněte si veřejné nabídky, porovnejte denní ceny a města vyzvednutí.'],
  ['domacnost', 'vybaveni-domacnosti', 'Vybavení domácnosti', 'Pomůcky do domácnosti k půjčení',
    'Praktické věci pro domácnost můžete místo koupě i půjčit. Prohlédněte si aktuálně zveřejněné nabídky a jejich ceny na Rentulu.'],
  ['zahrada', 'sekacky', 'Sekačky a vertikutátory', 'Sekačky a vertikutátory k půjčení',
    'Sekačky a vertikutátory na zahradní práce k půjčení. Podívejte se na aktuální nabídky od lidí, cenu za den a město předání.'],
  ['zahrada', 'krovinorezy-pily', 'Křovinořezy a motorové pily', 'Křovinořezy a motorové pily k půjčení',
    'Křovinořezy a motorové pily k půjčení pro práci na zahradě. Zjistěte denní ceny a města vyzvednutí u veřejných nabídek na Rentulu.'],
  ['zahrada', 'kultivatory', 'Kultivátory a půdní technika', 'Kultivátory a půdní technika k půjčení',
    'Vybavení pro přípravu a úpravu půdy nemusíte kupovat na jednu práci. Prohlédněte si kultivátory k půjčení a jejich denní ceny.'],
  ['zahrada', 'cerpadla', 'Čerpadla a zavlažování', 'Čerpadla a zavlažovací vybavení k půjčení',
    'Čerpadla a vybavení pro zavlažování zahrady k půjčení. Najděte zveřejněné nabídky od lidí podle ceny za den a města předání.'],
  ['stavba', 'vrtacky', 'Vrtačky a šroubováky', 'Vrtačky a šroubováky k půjčení',
    'Vrtačky a šroubováky k půjčení pro domácí opravy a práci v dílně. Prohlédněte si veřejné nabídky, denní ceny a města předání.'],
  ['stavba', 'pily-brusky', 'Pily a brusky', 'Pily a brusky k půjčení',
    'Pily a brusky pro řezání či broušení k půjčení od lidí v Česku. Podívejte se na ceny za den a města předání jednotlivých nabídek.'],
  ['stavba', 'merici-technika', 'Měřicí technika', 'Měřicí technika k půjčení',
    'Měřicí technika pro práci a opravy k půjčení. Prohlédněte si aktuálně zveřejněné nabídky, denní ceny a město vyzvednutí.'],
  ['stavba', 'zebriky-leseni', 'Žebříky a lešení', 'Žebříky a lešení k půjčení',
    'Žebříky a lešení k půjčení na krátkodobé práce ve výšce. Prohlédněte si veřejné nabídky, ceny za den a města předání.'],
  ['stavba', 'betonovani-bourani', 'Betonování a bourání', 'Vybavení na betonování a bourání k půjčení',
    'Připravujete stavební práci? Podívejte se na vybavení pro betonování a bourání k půjčení, jeho denní ceny a města vyzvednutí.'],
  ['hobby', 'foto-video', 'Foto a video', 'Foto a video vybavení k půjčení',
    'Fotografické a video vybavení k půjčení pro vlastní projekty. Projděte si veřejné nabídky od lidí, denní ceny a města předání.'],
  ['hobby', 'hudebni-nastroje', 'Hudební nástroje', 'Hudební nástroje k půjčení',
    'Hudební nástroje k půjčení na zkoušení i hraní. Zjistěte, jaké veřejné nabídky jsou zveřejněné, a porovnejte ceny za den.'],
  ['hobby', 'sport-fitness', 'Sport a fitness', 'Sportovní a fitness vybavení k půjčení',
    'Sportovní a fitness vybavení k půjčení od lidí. Podívejte se na zveřejněné nabídky, denní ceny a města vyzvednutí na Rentulu.'],
  ['hobby', 'kempovani', 'Kempování a turistika', 'Kempingové vybavení k půjčení',
    'Plánujete pobyt venku? Prohlédněte si kempingové a turistické vybavení k půjčení, denní ceny a města předání na Rentulu.'],
  ['party', 'ozvuceni', 'Ozvučení', 'Ozvučení k půjčení',
    'Ozvučovací vybavení na oslavu nebo akci k půjčení. Prohlédněte si aktuální veřejné nabídky, ceny za den a města předání.'],
  ['party', 'osvetleni-efekty', 'Osvětlení a efekty', 'Osvětlení a efekty k půjčení',
    'Osvětlení a efekty pro akce k půjčení od lidí v Česku. Vyberte ze zveřejněných nabídek podle denní ceny a města předání.'],
  ['party', 'stany-pristresky', 'Stany a přístřešky', 'Stany a přístřešky k půjčení',
    'Stany a přístřešky k půjčení pro soukromé oslavy a venkovní akce. Prohlédněte si veřejné nabídky a ceny za den na Rentulu.'],
  ['party', 'stoly-zidle', 'Stoly a židle', 'Stoly a židle k půjčení',
    'Stoly a židle k půjčení na oslavy a setkání. Prohlédněte si zveřejněné nabídky od lidí, denní ceny a města vyzvednutí.'],
  ['party', 'gastro-vycep', 'Gastro a výčepní vybavení', 'Gastro a výčepní vybavení k půjčení',
    'Gastro a výčepní vybavení k půjčení na soukromé akce. Porovnejte zveřejněné nabídky, ceny za den a města předání.'],
  ['ostatni', 'kancelar-prezentace', 'Kancelář a prezentace', 'Kancelářské a prezentační vybavení k půjčení',
    'Kancelářské a prezentační vybavení k půjčení na schůzky a práci. Prohlédněte si veřejné nabídky, denní ceny a města předání.'],
  ['ostatni', 'detske-vybaveni', 'Dětské vybavení', 'Dětské vybavení k půjčení',
    'Dětské vybavení k půjčení pro dočasné použití. Prohlédněte si zveřejněné nabídky od lidí, ceny za den a města vyzvednutí.'],
  ['ostatni', 'sezonni-vybaveni', 'Sezónní vybavení', 'Sezónní vybavení k půjčení',
    'Sezónní věci a pomůcky k půjčení podle potřeby. Zjistěte, jaké nabídky lidé zveřejnili, a podívejte se na denní ceny.'],
  ['ostatni', 'jine', 'Jiné', 'Ostatní věci k půjčení',
    'Další zveřejněné věci, které nespadají do běžných podkategorií. Prohlédněte si jejich denní ceny a města předání na Rentulu.'] // Only the SQL Editor owner may assign this manually.
];

export const SEO_SUBCATEGORIES = Object.freeze(definitions.map(([categorySlug, slug, name, seoTitle, description]) => Object.freeze({
  categorySlug, slug, name, seoTitle, description
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
