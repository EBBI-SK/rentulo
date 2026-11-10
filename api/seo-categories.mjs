// Stable category slugs for the six real V1 Rentulo listing categories.
// SEO titles and descriptions describe categories, never imply specific stock.
// Do not infer subcategories or create city pages without corresponding public offers.
export const SEO_CATEGORIES = Object.freeze([
  Object.freeze({
    slug: 'domacnost', name: 'Domácnost', seoTitle: 'Vybavení do domácnosti k půjčení',
    description: 'Vybavení do domácnosti k půjčení od lidí v Česku. Prohlédněte si zveřejněné nabídky, denní ceny a města předání na Rentulu.'
  }),
  Object.freeze({
    slug: 'zahrada', name: 'Zahrada', seoTitle: 'Zahradní technika a vybavení k půjčení',
    description: 'Technika a vybavení na zahradu k půjčení. Prohlédněte si veřejné nabídky, ceny za den a města předání u jednotlivých věcí na Rentulu.'
  }),
  Object.freeze({
    slug: 'stavba', name: 'Stavba', seoTitle: 'Nářadí a stavební vybavení k půjčení',
    description: 'Nářadí a vybavení pro stavbu, opravy nebo dílnu k půjčení od lidí v Česku. Projděte si zveřejněné nabídky, denní ceny a města předání.'
  }),
  Object.freeze({
    slug: 'hobby', name: 'Hobby', seoTitle: 'Vybavení pro hobby a volný čas k půjčení',
    description: 'Hledáte vybavení pro hobby a volný čas? Na Rentulu najdete veřejné nabídky k půjčení od lidí, cenu za den a informace o městě vyzvednutí.'
  }),
  Object.freeze({
    slug: 'party', name: 'Párty', seoTitle: 'Vybavení na oslavy a akce k půjčení',
    description: 'Vybavení na oslavy a akce k půjčení od lidí v Česku. Prohlédněte si aktuální veřejné nabídky, denní ceny a města předání na Rentulu.'
  }),
  Object.freeze({
    slug: 'ostatni', name: 'Ostatní', seoTitle: 'Další věci a vybavení k půjčení',
    description: 'Další věci k půjčení mimo hlavní kategorie Rentula. Prohlédněte si zveřejněné nabídky od lidí, ceny za den a informace o městě předání.'
  })
]);

const bySlug = new Map(SEO_CATEGORIES.map(category => [category.slug, category]));
const byName = new Map(SEO_CATEGORIES.map(category => [category.name, category.slug]));

export function getSeoCategoryBySlug(slug) {
  return typeof slug === 'string' ? bySlug.get(slug) || null : null;
}

export function getSeoCategorySlug(name) {
  return typeof name === 'string' ? byName.get(name.trim()) || null : null;
}
