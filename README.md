# Rentulo

**Aktuálny technický prehľad: 28. 11. 2026.** Podrobný stav, dôkazy nasadenia, bezpečnostné hranice a zostávajúce kroky sú v [HANDOVER.md](HANDOVER.md). Staršie verzie týchto súborov (august – október 2026) sú historické snímky v Git histórii, **nie aktuálne prevádzkové pokyny**.

**Rentulo** je platforma na prenájom vecí medzi **súkromnými osobami v Českej republike** (V1). Prevádzkovateľ: **EBBI s. r. o.**, Slovensko. Registrácia nie je obmedzená len na českú štátnu príslušnosť, samotné prenájmy vo V1 však prebiehajú iba v ČR. Rozhranie podporuje **CZ (predvolené), SK, EN, DE a PL**. Podnikatelia/PRO a dopyty patria až do budúcej verzie.

## Stav projektu

- **TEST:** `https://rentulo.eu`, GitHub `main`, Vercel `rentulo`, samostatný Supabase TEST a Stripe TEST. TEST zostáva oddelený a neindexovaný.
- **PROD:** `https://rentulo.com`, GitHub `production`, Vercel `rentulo-prod`, samostatný Supabase PROD. **27. 11. 2026 bol po schválení sprístupnený prístup na produkčnú doménu pre reálny český skúšobný test bez prihlásenia do Vercelu; Preview zostalo chránené.** Podľa dohodnutého postupu `noindex` na PROD zostáva až do schváleného oficiálneho štartu, plánovaného na 1. 12. 2026. Sprístupnenie a indexovanie sú dva samostatné úkony. Výsledok kompletného českého testu zatiaľ nie je potvrdený.
- **Nasadenie hodnotení 12. 11. 2026:** PR [#171](https://github.com/EBBI-SK/rentulo/pull/171) zlúčený do `production` (merge `44f7dbe`), PROD SQL migrácia a dve Edge Functions nasadené, verejná stránka bez testovacích recenzií vizuálne overená. Automatické testy pred PR: **931/931**, GitHub kontroly **3/3**. Reálny produkčný scenár pozvánky po vrátení ešte čaká na český test.
- **Štatistika Rentulo PROD pre Office (aktualizovaná 27. 11.):** pôvodná funkcia `office-platform-stats` z PR [#177](https://github.com/EBBI-SK/rentulo/pull/177) (merge `c221448`) je chránená tajomstvom `RENTULO_OFFICE_STATS_SECRET`. PR [#189](https://github.com/EBBI-SK/rentulo/pull/189), zdrojový commit `e5c48b3`, merge `a144d9e7` do `production`, rozšíril existujúci výstup o `users.total` a `users.day`. Počíta iba aktívne profily (`profiles.account_status = active`) celkovo a za vybraný deň podľa `created_at` v `Europe/Prague`; zachováva agregáty ponúk a rezervácií. **936/936 PASS** pred merge. Aktualizovaná funkcia bola nasadená do Supabase PROD; bez novej tabuľky, migrácie, cronu, ďalšieho API alebo osobných údajov. Office PR [#31](https://github.com/EBBI-SK/rentulo-office/pull/31), merge `2a0bb16` do Office `main`, **309/309 PASS**, sprístupnil tri ukazovatele v existujúcom Prehľade: **Používatelia / Ponuky / Rezervácie**, režimy Dnes / Vybrať deň / Celkovo. Office Production je už konzumentom zabezpečeného API; pôvodné nasadenie len v Preview z 18. 11. je historický stav. Pozri [HANDOVER.md](HANDOVER.md).
- **Monitoring automatických procesov Rentulo PROD → Office V2 (18. 11.):** PR [#179](https://github.com/EBBI-SK/rentulo/pull/179), produkčný merge `e4723d8`, lokálne **956/956 PASS**, Supabase Edge Function `office-platform-stats` bola vtedy **ACTIVE v3**. Zabezpečený režim `?view=processes` číta posledné stavy štyroch vybraných cronov a heartbeat notifikačného workera bez nových tabuliek, cronov, SQL migrácií či zverejnenia osobných údajov. Pri vtedajšom overení v Office Preview sa zobrazilo **4/4 posledných behov cronov úspešných** a potvrdený worker; **expirácia rezervácií zostáva neoverená**. Sekcia **Systém** bola overená aj s automatickým obnovovaním každých **60 sekúnd**. Stav webu a prihlasovania sa vtedy nepodarilo potvrdiť; pri platbách a notifikáciách „bez hlásených problémov“ neznamená úplný živý test. Podrobné hranice sú v [HANDOVER.md](HANDOVER.md).
- **Technické upratovanie 19. 11. 2026:** PR [#181](https://github.com/EBBI-SK/rentulo/pull/181), [#182](https://github.com/EBBI-SK/rentulo/pull/182) a [#183](https://github.com/EBBI-SK/rentulo/pull/183) (odstránené nepoužívané `js/reservation-utils.js`, `css/home.css`, verzia prehliadačovej knižnice Supabase JS `2.119.1`), PR [#184](https://github.com/EBBI-SK/rentulo/pull/184) (TEST) a [#185](https://github.com/EBBI-SK/rentulo/pull/185) (PROD) – CI Node.js 24, PR [#186](https://github.com/EBBI-SK/rentulo/pull/186) – odstránené `address-suggestions` a oprava upozornenia v teste, PR [#187](https://github.com/EBBI-SK/rentulo/pull/187) – odstránený nepotrebný `js/api.js`. PROD merge z upratovania **`b10ed835`**, Vercel **READY**, lokálny `production` bol čistý. TEST Supabase `address-suggestions` nemala; z PROD bola samostatne zmazaná, `geocode-pickup` zostala. Doména `www.rentulo.com` má presmerovanie **308** na `rentulo.com`. Staré vetvy boli upratané; dokončené pracovné vetvy sa odstraňujú po PR. Podrobnosti a hranice overení sú v HANDOVER.
- **Supabase Edge Functions – verzovanie:** audit 19. 11. zistil 24/26 zdrojových funkcií s importom Supabase JS iba cez `@2`, jedna má pevné `2.119.0`, jedna knižnicu nepoužíva. **Nerobiť hromadný redeploy**. Pri plánovanej úprave konkrétnej funkcie pripnúť presnú kompatibilnú verziu a cielene otestovať/nasadiť až po schválení.
- **Rentulo Office, bod 3 (15. 11.):** automatické zachytávanie a bezpečné odosielanie vybraných prevádzkových problémov z Rentulo PROD do samostatnej databázy Office je **AKTÍVNE / FUNKČNE OVERENÉ**. Produkčný outbox SQL iba **APPLIED / DO NOT RERUN**, Edge Function nasadená, cron každých 5 minút bez novej úlohy. Jedna neostrá udalosť doručená na prvý pokus a nezávisle prečítaná v Office DB. Vtedajší test overil technický prenos udalosti, nie kompletné spracovanie prípadu v Office. Pozri [Office udalosti PROD](docs/RENTULO_OFFICE_PROD_EVENTS_APPLIED.md).
- **SEO 19A–19C:** nasadené do PROD 10. 11. 2026 (PR #157); **19D – sprístupnenie indexovania a Search Console** až pri schválenom štarte.
- **Zostáva pred štartom:** verejný prístup k PROD je od 27. 11. povolený; vyhodnotiť skutočný český end-to-end prenájom s platbou, PIN, vrátením a transferom; následné overenie pozvánky/hodnotenia; aktivácia a skúška produkčných SMS podľa osobitného rozhodnutia (plán deň pred štartom); finálny launch postup bez testovacích dát. Detailný zoznam a hranice overenia sú v HANDOVER.

## Základné pravidlá V1

| Oblasť | Platné pravidlo |
| --- | --- |
| Ponuka | Minimálna cena **100 CZK za deň**; aspoň jedna fotografia pri aktívnej ponuke. |
| Poplatok Rentulo | **10 %** z ceny rezervácie, najmenej **70 CZK za rezerváciu**; odpočítava sa z podielu prenajímateľa. Historické sumy sa spätne nemenia. |
| Rezervácia | Žiadosť → schválenie → Stripe platba → PIN/prevzatie → potvrdené vrátenie. Existujú tiež expirácie, storná, `no_show` a výnimky. |
| Lehoty | Majiteľ má na rozhodnutie najviac 24 h (najneskôr pred prevzatím). Po neskorom schválení má nájomca na platbu najviac 30 minút, nikdy nie po čase prevzatia. |
| Bežné storno | Pri nových rezerváciách podľa podmienok V1.0 **viac než 24 h pred dohodnutým prevzatím**, aj pri zaplatenej rezervácii; refund podľa roly a skutočných nevratných Stripe nákladov. |
| PIN | Šesťmiestny, jednorazový; použiteľný od **2 h pred prevzatím** do času dohodnutého vrátenia; tri nesprávne pokusy → 15 minút blokácie. |
| Výplata majiteľovi | **Po majiteľom potvrdenom skutočnom vrátení**, nie pri zadaní PIN. Pri zaplatenom `no_show` automatické finančné vysporiadanie až po skončení dohodnutého obdobia. |
| Mena a platby | **CZK**; Stripe Checkout + Connect (separate charges & transfers), retry pri dočasnom zlyhaní. |
| Zakázané ponuky | Dopravné prostriedky (autá, motocykle, bicykle, kolobežky, lode, prívesy a pod.) a ďalšie protiprávne/nebezpečné veci. |

Rozhodujúce právne znenie je **Obchodné podmienky V1.0**, s účinnosťou **od 1. 12. 2026**, nie tento stručný technický súhrn. Práva z rezervácií vytvorených podľa starších podmienok sa posudzujú podľa vtedajších pravidiel.

## Funkcie

- Ponuky a vyhľadávanie podľa kategórie, mesta, dátumu, ceny a približnej polohy; verejné referencie `N-000001…`, `R-000001…`.
- Schvaľovanie, Stripe platby/refundy, kontakty odomknuté po platbe, PIN, predĺženia, potvrdenie vrátenia, `no_show`, história a obojstranné hodnotenia účastníkov.
- Bezpečnostné a prevádzkové mechanizmy: RLS, chránené RPC/Edge Functions, audit, moderovanie incidentov, správa deaktivácie účtu, notifikačný outbox, retry a crony.
- **Hodnotenia samotného Rentula** (`zkusenosti.html`): po potvrdenom prenájme; jedno upraviteľné hodnotenie na účet, pred zverejnením vecná moderácia, skrátené meno. Nová e-mailová pozvánka najskôr 24 h po prvom kvalifikovanom vrátení od aktivácie; **bez SMS**. Verejný kompaktný pás na homepage sa zobrazí až pri skutočných publikovaných hodnoteniach s textom.
- Viacjazyčné SEO metadata, `canonical`, JSON-LD, dynamická sitemap, stránky kategórií/miest a SSR prvých verejných výsledkov pre nefiltrované zobrazenie. PROD `noindex` sa do launch kroku 19D nemení.

## Technológie a priečinky

- **Frontend:** statické HTML/CSS/JavaScript, bez SPA frameworku.
- **Backend:** Supabase Auth, PostgreSQL, RLS, RPC, Storage a Edge Functions; Vercel hosting a serverless SEO API.
- **Integrácie:** Stripe, Resend, BulkGate (produkčné SMS zatiaľ neaktivovať), Geoapify EU, OpenStreetMap, cron-job.org.
- `api/` – SEO stránky, SSR výsledkov a sitemap; `css/`, `js/` – UI, lokalizácie a klient.
- `scripts/build-site.mjs` – oddelený TEST/PROD build; `scripts/seo-pages.json` – SEO katalóg.
- `supabase/migrations/` – historické/TEST migračné zdroje; **na PROD nič nespúšťať automaticky**.
- `supabase/prod-release-*/` – samostatné, výslovne schvaľované produkčné balíky SQL.
- `supabase/functions/` – serverové funkcie; `tests/` – automatické testy. Historické zdroje `address-suggestions` a `js/api.js` už nie sú súčasťou `production`.
- `docs/` – špecializované runbooky; `HANDOVER.md` – aktuálna prevádzková príručka.

## Lokálne príkazy

```powershell
npm ci
npm test
npm run build
```

- `npm test` spúšťa kontrolné testy Node.js. **27. 11. 2026: 936/936 PASS** pred zlúčením PR #189. **19. 11. 2026: 934/934 PASS** pri odstraňovaní `address-suggestions`, pred následnou malou opravou testu; po nej **3/3 cielené PASS** bez upozornenia Node.js. Pri PR #187 **22/22 cielených PASS**. Úspešné testy nie sú dôkazom reálneho prenájmu.
- `npm run build` štandardne generuje **TEST** do `dist/`. **Nie je dôkazom funkčnosti PROD**.
- Produkčný build vyžaduje `RENTULO_DEPLOY_TARGET=prod`, `RENTULO_SUPABASE_URL` a `RENTULO_SUPABASE_PUBLISHABLE_KEY` z výslovne schváleného produkčného prostredia. Tajné hodnoty sa nikdy nedávajú do Gitu ani do chatu.
- Build **neaplikuje SQL migrácie ani nenasadzuje Edge Functions**. Na to existujú samostatné schválené release kroky.

## Zásady zmeny a nasadenia

**Jedna vec naraz:** návrh → súhlas → ZIP **iba zmenených súborov** → pracovná vetva → lokálna kontrola → commit/push → PR → CI → merge → kontrola správneho prostredia. TEST a PROD sú samostatné vetvy aj databázy; celý `main` sa kvôli jednej funkcii **nemerguje** do `production`. Produkčné SQL, Edge Functions, platby, DNS a indexovanie iba s konkrétnym schválením. Neopakovať už overené kontroly bez dôvodu.

## Ďalšie dôležité dokumenty

- [HANDOVER.md](HANDOVER.md) – **stav aktualizovaný 28. 11. 2026**, čo je hotové, čo ostáva, presné prevádzkové pravidlá a dôkazy.
- [Nasadenie hodnotení do PROD](docs/PLATFORM_REVIEWS_V1_PROD.md) – pôvodný release runbook; kroky „pred nasadením“ sú už **historicky vykonané** 12. 11. 2026.
- [SEO 19A–19C PROD](docs/SEO_19_PROD_RELEASE_20261110.md) – zdrojový release plán; 19D je samostatný launch krok.
- [POHODA provízie](docs/POHODA_PROVIZIE_TEST.md) – metodika exportu a výnimky, najmä ECB a potvrdené vrátenie.

**Dôležité:** technické nasadenie ≠ potvrdený reálny prenájom ≠ oficiálne verejné spustenie. Stav jednotlivých oblastí je rozlíšený v HANDOVER.
