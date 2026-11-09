// Stable category slugs for the six real V1 Rentulo listing categories.
// Do not infer subcategories or create city pages without corresponding public offers.
export const SEO_CATEGORIES = Object.freeze([
  Object.freeze({ slug: 'domacnost', name: 'Domácnost', description: 'Prohlédněte si věci do domácnosti, které lidé v České republice nabízejí k zapůjčení na Rentulu.' }),
  Object.freeze({ slug: 'zahrada', name: 'Zahrada', description: 'Prohlédněte si nabídky vybavení na zahradu k zapůjčení od lidí v České republice na Rentulu.' }),
  Object.freeze({ slug: 'stavba', name: 'Stavba', description: 'Prohlédněte si vybavení na stavbu, opravy a práci k zapůjčení od lidí v České republice na Rentulu.' }),
  Object.freeze({ slug: 'hobby', name: 'Hobby', description: 'Objevte aktuální nabídky věcí pro hobby a volný čas od lidí v České republice na Rentulu.' }),
  Object.freeze({ slug: 'party', name: 'Párty', description: 'Najděte vybavení na oslavy a akce, které lidé v České republice nabízejí k zapůjčení na Rentulu.' }),
  Object.freeze({ slug: 'ostatni', name: 'Ostatní', description: 'Prohlédněte si další věci k zapůjčení od lidí v České republice na Rentulu.' })
]);

const bySlug = new Map(SEO_CATEGORIES.map(category => [category.slug, category]));
const byName = new Map(SEO_CATEGORIES.map(category => [category.name, category.slug]));

export function getSeoCategoryBySlug(slug) {
  return typeof slug === 'string' ? bySlug.get(slug) || null : null;
}

export function getSeoCategorySlug(name) {
  return typeof name === 'string' ? byName.get(name.trim()) || null : null;
}
