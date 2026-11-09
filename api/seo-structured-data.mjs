// Structured data for the public, server-rendered Rentulo pages.
// Never infer ratings, reservation availability, owner identity, or a sale price.
const CONTEXT = 'https://schema.org';
const LEASE_OUT = 'http://purl.org/goodrelations/v1#LeaseOut';
const JSON_ESCAPE = Object.freeze({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029' });

export function renderJsonLd(document) {
  const json = JSON.stringify(document).replace(/[<>&\u2028\u2029]/g, char => JSON_ESCAPE[char]);
  return `<script type="application/ld+json">${json}</script>`;
}

function breadcrumbs(steps) {
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: steps.map((step, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: step.name,
      item: step.url
    }))
  };
}

export function renderOfferJsonLd(values) {
  if (!values || !Number.isSafeInteger(values.pricePerDay) || values.pricePerDay <= 0) return '';
  const url = new URL(values.canonicalUrl);
  if (url.protocol !== 'https:') return '';
  const origin = url.origin;
  const product = {
    '@context': CONTEXT,
    '@type': 'Product',
    '@id': `${values.canonicalUrl}#product`,
    name: values.name,
    url: values.canonicalUrl,
    ...(values.offerDescription ? { description: values.offerDescription } : {}),
    ...(values.hasOfferPhoto ? { image: values.imageUrl } : {}),
    category: values.category,
    offers: {
      '@type': 'Offer',
      url: values.canonicalUrl,
      businessFunction: LEASE_OUT,
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: values.pricePerDay,
        priceCurrency: 'CZK',
        billingDuration: 'P1D'
      }
    }
  };
  return renderJsonLd([
    breadcrumbs([
      { name: 'Rentulo', url: `${origin}/` },
      { name: 'Všechny nabídky', url: `${origin}/nabidky` },
      { name: values.name, url: values.canonicalUrl }
    ]),
    product
  ]);
}

export function renderCollectionJsonLd({ canonical, title, description, items, crumbs }) {
  if (!Array.isArray(items) || !Array.isArray(crumbs) || crumbs.length < 2) return '';
  const collection = {
    '@context': CONTEXT,
    '@type': 'CollectionPage',
    '@id': `${canonical}#webpage`,
    url: canonical,
    name: title,
    description,
    ...(items.length ? {
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: items.length,
        itemListElement: items.map((item, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: item.name,
          url: item.url
        }))
      }
    } : {})
  };
  return renderJsonLd([breadcrumbs(crumbs), collection]);
}
