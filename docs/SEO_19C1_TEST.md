# Rentulo SEO 19C/1 - JSON-LD (TEST)

## Ciel
Strojovo citatelne, fakticky spravne schema.org informacie v povodnej serverovej odpovedi. Ziadne zmeny UI, rezervacii, cien, migracii, indexacnych pravidiel alebo produkcnej databazy.

## Co sa pridava
- `api/seo-structured-data.mjs` - jeden pomocny modul na serializaciu JSON-LD, bezpecne escapovanie pre HTML `<script>`.
- `api/offer-page.mjs` - `BreadcrumbList` a `Product` s `Offer.businessFunction = LeaseOut` a `UnitPriceSpecification` v CZK na den (`billingDuration = P1D`). Do strukturovanych udajov sa dava len verejna povolena fotografia; pri fallback logu sa pole `image` vynecha.
- `api/category-page.mjs` - `BreadcrumbList`, `CollectionPage`, `ItemList` z realnych verejnych ponuk. Automaticky pouziju aj existujuce podkategorie a stranky kategoria + mesto.
- `api/offers-directory.mjs` - totozne schema pre verejny katalog `/nabidky` a jeho strankovanie.
- `tests/seo-structured-data.test.mjs` - cielene testy pre sanitizaciu, fakta, zhodu so zobrazovanym obsahom, bezpecnost a neexistujuce ponuky.

## Bezpecnost a pravdivost
- Nikdy nevymyslat hodnotenia, pocet recenzii, dostupnost na termin, majitela, adresu prevzatia ani datum dostupnosti.
- `priceSpecification.price` je jednotkova **cena za jeden den prenajmu**. Nepridavat plochu `Offer.price`, ktora by bez kontextu mohla vyzerat ako predajna cena.
- `Product` + prenajomny `Offer` podla schema.org nie je zarukou Google Product rich results. Google nemusi zobrazit cenu ani obrazok.
- JSON-LD sa vklada len do existujucej uspesnej serverovej stranky s verejnymi datami. Chybove odpovede 404/503 neobsahuju ponuky ani JSON-LD.
- TEST dalej ostava `noindex`; PROD nemenit pred samostatnym schvalenim.
- Novy kod nevola DB, AI ani externu API sluzbu nad ramec sucasnej serverovej logiky.

## TEST workflow
1. Vychodisko: `main` po merge PR #145, commit `462991a` (pred vlozenim ZIP skontrolovat aktualny stav).
2. Vytvorit novu cistu vetvu, rozbalit ZIP len do korena repozitara.
3. Spustit `node --test tests/seo-structured-data.test.mjs`, `npm test`, `npm run build`, `git diff --check`.
4. Commitovat iba tychto 6 suborov, push, PR len do `main`, overit CI, merge po schvaleni.
5. Supabase SQL migracia nie je potrebna. Ziadny zasah do `production`, `rentulo.com` alebo Supabase PROD.

## Dokumentacia
- Google Search Central: https://developers.google.com/search/docs/appearance/structured-data/breadcrumb
- Google Product snippets: https://developers.google.com/search/docs/appearance/structured-data/product-snippet
- Schema.org businessFunction: https://schema.org/BusinessFunction

## Prve lokalne overenie balika
- Cielene testy vo vyvojovej kopii: 16/16.
- Kompletny repozitar (840+ testov) a realny Vercel build v tejto kopii **neboli vykonane**; vykonaju sa po vlozeni ZIP vo VS Code a potom v GitHub CI.
