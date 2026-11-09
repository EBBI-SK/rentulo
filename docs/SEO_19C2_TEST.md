# Rentulo – SEO 19C/2: načítavanie fotografií (TEST)

**Základ:** GitHub `main` po PR #146, commit `e597487` (9. 11. 2026).
**Prostredie:** `rentulo.eu` / TEST. PR najprv výhradne do `main`; do `production` zatiaľ nemergovať.

## Zmysel úpravy

Zmeniť **iba správanie načítavania existujúcich fotografií**. Zachovať kvalitu a obsah súborov, existujúce URL v Supabase Storage, typy ponúk, SEO metaúdaje, vzhľad, výsledky vyhľadávania a rezervačnú funkcionalitu.

- **Detail ponuky (server a klient):** existujúca hlavná fotografia má `loading="eager"`, `decoding="async"`, `fetchpriority="high"`; pri chýbajúcej/neplatnej fotografii server neuprednostňuje náhradné logo.
- **Katalóg `/nabidky` a stránky kategórií/podkategórií/miest:** len prvá karta s reálnou fotografiou má vysokú prioritu; ostatné používajú `loading="lazy"`. Všetky obrázky sa dekódujú asynchrónne. Prvá karta s náhradným logom nedostáva `fetchpriority="high"`.
- **Interaktívne výsledky vyhľadávania:** prvá vykreslená fotografia je eager/high; ďalšie sú lazy a bez vysokej priority, vrátane zmeny filtrov a zoradenia.
- **Stabilita rozloženia:** už existujúce pevné rozmery obrázkov v detaile, katalógu a desktopových výsledkoch a `aspect-ratio: 16 / 9` na mobiloch zostávajú zachované. Nerobíme nepresné deklarácie prirodzených rozmerov fotografií (pomery strán pôvodných súborov môžu byť rôzne).
- **Popisy fotografií (`alt`):** naďalej používajú bezpečne HTML-escapovaný názov ponuky.

### Čo sa nemení

- Nahrávanie fotografií a existujúce obmedzenie na max. 900 px / JPEG kvalita `0.78` v `js/offer-form-page.js` a `js/edit-offer.js`.
- Schémy a migrácie Supabase; ani jeden SQL skript netreba spúšťať.
- HTTP cesty k obrázkom, oprávnenia Storage, SEO canonical, JSON-LD, robots/noindex, RLS, rezervácie, PIN, platby, UI.
- Fotografie na úvodnej mape už používali `loading="lazy"` a nemenia sa.
- Nevznikajú nové alternatívne formáty WebP/AVIF, nové CDN transformácie ani nové URL (to by bolo iné zadanie).

## Súbory v ZIP

1. `api/offer-page.mjs` – serverový detail, priority obrázka.
2. `api/category-page.mjs` – výpis v kategórii, podkategórii a meste.
3. `api/offers-directory.mjs` – verejný katalóg.
4. `js/detail-page.js` – klientsky detail.
5. `js/results-page.js` – interaktívne výsledky.
6. `tests/seo-image-loading.test.mjs` – 12 cielených regresných kontrol.
7. `docs/SEO_19C2_TEST.md` – tento dokument.

**Presne 7 súborov: 5 upravených, 2 nové.** ZIP je určený na rozbalenie do samostatnej vetvy založenej na `main` s commitom `e597487`; neobsahuje žiadny patch ani celý repozitár.

## Overenia vykonané pri príprave

- 12/12 nových cielených testov: úspešné.
- 868/868 testov dostupnej pracovnej kópie: úspešné (bez chyby).
- `npm run build`: úspešný TEST build.
- `node --check` zmenených `.mjs`/`.js`: úspešný.
- Východiskových **päť upravovaných zdrojových súborov** bolo pred úpravami obsahovo porovnaných s GitHub `main` (`e597487`), všetky sa zhodovali.

Pred commitom v **plnom lokálnom repozitári** spustiť `npm test`, `npm run build` a `git diff --check`, overiť presne sedem súborov. Až potom PR do `main` a GitHub CI. Po nasadení možno výkon objektívne zmerať cez PageSpeed / Core Web Vitals v 19C/4; tu netvrdíme žiadne namerané zrýchlenie.
