// Generated into dist/js/seo.js with the server-side metadata catalog.
// Keep canonical URLs and index/noindex policies in the static HTML build.
(function () {
  const page = window.location.pathname.split('/').pop() || 'index.html';
  const publicPage = RENTULO_SEO_DATA.public[page];
  const privatePage = RENTULO_SEO_DATA.private[page];
  const locales = { cs: 'cs_CZ', sk: 'sk_SK', en: 'en_US', de: 'de_DE', pl: 'pl_PL' };

  function updateMeta(selector, value) {
    const meta = document.head.querySelector(selector);
    if (meta) meta.setAttribute('content', value);
  }

  function updateSeo() {
    const selected = typeof window.getRentuloLanguage === 'function'
      ? window.getRentuloLanguage()
      : 'cs';
    const language = Object.hasOwn(locales, selected) ? selected : 'cs';

    if (publicPage) {
      const content = publicPage.translations[language] || publicPage.translations.cs;
      document.title = content.title;
      updateMeta('meta[name="description"]', content.description);
      updateMeta('meta[property="og:title"]', content.title);
      updateMeta('meta[property="og:description"]', content.description);
      updateMeta('meta[property="og:locale"]', locales[language]);
    } else if (privatePage) {
      // i18n.js already translates the document title on private pages.
      updateMeta('meta[name="description"]', privatePage[language] || privatePage.cs);
    }
  }

  document.addEventListener('DOMContentLoaded', updateSeo);
  document.addEventListener('rentuloLanguageChanged', updateSeo);
})();
