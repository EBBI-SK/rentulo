# Rentulo – produkčné zosúladenie SEO 19A–19C a homepage (10. 11. 2026)

**Zdroj porovnania:** používateľské exporty `rentulo-prod-source.zip` (`origin/production`) a `rentulo-test-source.zip` (`origin/main`, merge PR #156). V pracovnej vetve `feat/prod-seo-homepage` používajte len výsledný balík zmien. NEMERGEOVAŤ celý `main` do `production`; vetvy majú ďalšie nezávislé zmeny.

## Rozsah

- Finálna homepage zo schváleného TEST PR #150: CTA „Prohlédnout nabídky“ zarovnané s kategóriami, finálny text vo všetkých 5 jazykoch.
- SEO: zmysluplné titulky detailov a stránok kategórií/podkategórií/miest, štruktúrované dáta JSON-LD, interne prelinkované reálne verejné ponuky, dynamická sitemap, optimalizované fotografie, jazykové balíky.
- SSR výsledkov na TEST **aj PROD**: Vercel funkcia vracia prvé 4 verejné ponuky priamo v HTML (iba bez aktívnych filtrov), z produkčnej databázy pri `RENTULO_DEPLOY_TARGET=prod`. Pri výpadku DB/filtri zostáva klientské vyhľadávanie; produkčné HTML súbory nesmú zatieniť rewrite.
- **Zachovať predspúšťací `noindex`** pre `rentulo.com`, `rentulo.eu` a preview v `vercel.json`; na stránke výsledkov aj v SSR odpovediach. Zapnutie indexovania pri verejnom štarte je samostatný krok 19D.
- Produkčné projektové identifikátory Supabase a publishable key sa vyberajú z existujúcich produkčných environment variables. **Neukladať žiadne nové tajné kľúče.**
- **Nie sú zahrnuté:** rezervácie, PIN, výplaty, Stripe, e-maily, telefóny, RLS aplikácie mimo SEO a iné TEST zmeny.

## Nevyhnutná závislosť: Supabase PROD

Produkčné SEO stránky potrebujú existujúcu bezpečnú `public.public_offers` s dvomi novými verejnými odvodenými stĺpcami (`subcategory_slug`, `seo_city_slug`). TEST používa dva SQL skripty **výslovne TEST-only**, ktoré nemožno spustiť na PROD. Preto sú samostatne pripravené **dva nové PROD SQL skripty** v `supabase/prod-release-20261110-seo/migrations/`, nie v automatickom priečinku `supabase/migrations/`.

**Pred akýmkoľvek produkčným SQL:**

1. Na správnom Supabase PROD projekte otvoriť SQL Editor a spustiť *iba* `supabase/prod-release-20261110-seo/seo19_read_only_preflight.sql`.
2. Výsledok manuálne posúdiť. `correct_prod_project`, `offers_exists` a `admin_guard_exists` musia byť `true`. `public_columns` musí mať presne 15 pôvodných verejných polí končiacich `min_rental_days` (v poradí uvedenom v migrácii). `view_options` musí obsahovať `security_invoker=false`, `security_barrier=true`. Obidva nové stĺpce musia zatiaľ chýbať.
3. **Ak čokoľvek nesedí – STOP**, bez SQL zmien. Reálna produkčná schéma nebola v poskytnutých ZIP súboroch overená, takže ju nemožno považovať za automaticky zhodnú s TEST. Tiež vopred skontrolovať backup/snapshot DB a časový rámec na prípadné DDL zámky.
4. Po výslovnom schválení spustiť **raz** `20261110110000_seo19b2_automatic_subcategories_PROD.sql`, skontrolovať 16 stĺpcov pohľadu, audit a generovaný `subcategory_slug`, potom **raz** `20261110120000_seo19b3_category_cities_PROD.sql`, skontrolovať 17 stĺpcov a `seo_city_slug` (Zlín → zlin). Obe migrácie sú transakčné, odmietajú nesprávny projekt a opakované spustenie.
5. Po úspešnom dokončení SQL je bezpečné pokračovať k webovému PR a produkčnému nasadeniu. **Nedeployovať nové kategórie/miesta pred dokončením SQL** – ich API očakáva nové polia.
6. SQL nebolo v rámci prípravy spustené na skutočnej PROD databáze, ani overené PostgreSQL runtime testom. Testy overujú jeho štruktúru a deterministickú klasifikáciu.

## Workflow vo VS Code (zachovať postup jeden krok naraz)

1. Aktuálna vetva: `feat/prod-seo-homepage` z `origin/production`. Skontrolovať `git status --short --branch`.
2. Rozbaliť tento ZIP do koreňa `pujc-naradi` (kopírovať obsah ZIP-u, nie nadradený priečinok). Iba uvedené zmenené/nové súbory.
3. Skontrolovať `git status --short --branch` a porovnať zoznam zmenených súborov s manifestom `docs/SEO_19_PROD_RELEASE_20261110.md` (samostatný súbor kontrolných súčtov môže byť dodaný popri ZIP-e). Žiadne ďalšie zmeny.
4. `npm test`, `npm run build`, `node --test tests/seo-prod-transfer.test.mjs` a `git diff --check`. Test `deployment-config` navyše simuluje PROD build s falošným, nezverejňovaným publishable kľúčom.
5. Pred SQL potvrdením vetvu/PR **nemergovať**. Po schválenom úspešnom produkčnom SQL a zelenom CI – commit, push, PR do `production`, review, merge.
6. Overiť na `rentulo.com`: vizuál homepage (desktop/mobil), jazykové verzie, `view-source` výsledkov, funkciu kategórií + podkategórií + miest, odkazy, sitemap a správne `noindex`. Výsledky SSR overiť aj pri 0 ponukách a s aktívnym filtrom; klientské výsledky musia fungovať.
7. Nevykonávať žiadny transfer medzi TEST a PROD DB. TEST ostáva samostatný; produkčná sitemap nesmie použiť TEST ponuky.

## Merania a limity

- TEST po poslednej SSR úprave: Lighthouse Performance 99, LCP 2,3 s. **Toto nie je meranie PROD**; skutočný produkčný výkon bude nutné overiť po release.
- Pre tento nový produkčný návrh boli spustené lokálne Node testy na kóde zostavenom z produkčnej vetvy (počty v odovzdanej správe), vrátane simulácie PROD prostredia. **Nebolo vykonané produkčné SQL ani živé produkčné nasadenie**.
- Pri budúcom indexovaní (19D) treba cielene odstrániť `noindex`, overiť Search Console a novú sitemap, nie skôr.
