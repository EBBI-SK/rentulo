# Rentulo – SEO 19C/3: kvalita SEO obsahu (TEST)

**Základ:** GitHub `main`, merge PR #147, commit `fe9a0a6` (9. 11. 2026).

**Prostredie:** najprv `main` (TEST, `rentulo.eu`). Do `production` nemergovať. Indexácia na TEST zostáva vypnutá.

## Účel

Zlepšiť **SEO titulky a meta descriptions** tak, aby opisovali skutočný obsah Rentula, namiesto všeobecných alebo opakovaných šablón. Nepridáva sa reklama na nedostupný tovar, vymyslené hodnotenia, záruky dostupnosti ani automaticky generované mestá.

- **6 hlavných kategórií:** vlastný opisný SEO `title` a jedinečný obsahový `description` pre kategóriu. Zostávajú pôvodné názvy kategórií, URL a nadpisy H1.
- **26 automatických podkategórií:** vlastné, prirodzené SEO titulky aj popisy; slugs, poradie, kategórie a automatická klasifikácia sa nemenia. Zostávajú pôvodné H1.
- **Kategória + mesto:** čitateľnejší názov a popis podľa kategórie a reálne uvedeného mesta. Nepoužívajú sa nesprávne české gramatické pády. Stránky vznikajú len pri aktívnych verejných ponukách.
- **Detail ponuky:** SEO titulok uvádza prenájom, názov ponuky a (ak je známe) mesto, bez duplicitného „k půjčení“. Popis obsahuje výhradne skutočný verejný názov, dennú cenu a kategóriu; nikdy nekopíruje ľubovoľný používateľský opis ani súkromné kontakty, PIN či rezervácie.
- **Katalóg:** opisná `meta description`, ktorá odlišuje ďalšie stránky stránkovania.

## Príklady

- Kategória Stavba: `Nářadí a stavební vybavení k půjčení | Rentulo`
- Podkategória Vrtačky: `Vrtačky a šroubováky k půjčení | Rentulo`
- Mesto: `Nářadí a stavební vybavení k půjčení – Zlín | Rentulo`
- Detail: `Aku vrtačka Bosch k půjčení – Zlín | Rentulo`

SEO úpravy nezaručujú umiestnenie vo vyhľadávači ani konkrétnu podobu úryvku v Google.

## Bezpečnostné hranice

- Žiadne databázové migrácie a žiadne nové používateľské polia.
- Nemeníme pôvodné názvy a opisy, ktoré ľudia zadali, ani fotografie a spôsob ich nahrávania.
- Žiadne zmeny canonical URL, robotických pravidiel, RLS, filtrov verejných ponúk, Stripe, PIN, rezervácií či dizajnu.
- SEO texty z verejnej ponuky sú HTML escapované pri vložení do HTML; JSON-LD používa existujúce bezpečné serializovanie.
- PROD zostáva pod pôvodnou predspúšťacou ochranou a `noindex`; samotný TEST PR nemá meniť vetvu `production`.
- Údaj o konkrétnom meste sa zobrazuje iba pri reálnej verejnej ponuke, nepublikujeme „doorway“ stránky bez obsahu.

## Zmenené súbory

1. `api/seo-categories.mjs`
2. `api/seo-subcategories.mjs`
3. `api/seo-cities.mjs`
4. `api/category-page.mjs`
5. `api/offer-page.mjs`
6. `api/offers-directory.mjs`
7. `tests/seo-category-pages.test.js`
8. `tests/seo-subcategory-pages.test.js`
9. `tests/seo-city-pages.test.js`
10. `tests/seo-offer-page.test.js`
11. `tests/seo-content-quality.test.mjs` (nový)
12. `docs/SEO_19C3_TEST.md` (tento dokument, nový)

**12 súborov: 10 upravených + 2 nové.** ZIP neobsahuje patch, celý repozitár, kľúče, SQL migrácie ani produkčné konfigurácie.

## Overenia vykonané pri príprave

- Pred úpravou bol obsah **10 existujúcich dotknutých súborov** presne porovnaný s GitHub `main` (commit `fe9a0a6`); všetky sa zhodovali.
- 62/62 cielených testov existujúcich stránok a nových SEO obsahových kontrol: úspešné.
- 876/876 testov dostupnej pracovnej kópie: úspešné, 0 chýb.
- `npm run build` pre TEST: úspešný.
- Syntax `.mjs` súborov: úspešná.
- **Plnú sadu testov v používateľovom aktuálnom lokálnom repozitári je stále potrebné vykonať pred commitom.** Pracovná kópia tu obsahuje menej testov než plný repozitár vo VS Code; 876 preto nesmieme vydávať za počet všetkých jeho testov.

## Pred merge

Na lokálnej pracovnej vetve z `main` commitu `fe9a0a6` rozbaliť ZIP, spustiť `npm test`, `npm run build`, `git diff --check`. Overiť presne 12 súborov. PR smeruje **iba do `main`**. Merge až po úspešných GitHub CI kontrolách. Už vykonané kroky v projekte zbytočne neopakovať.
