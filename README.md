# Rentulo

**Aktuálny technický prehľad: 12. 11. 2026.** Podrobný stav, dôkazy nasadenia, bezpečnostné hranice a zostávajúce kroky sú v [HANDOVER.md](HANDOVER.md). Staršie verzie týchto súborov (august – október 2026) sú historické snímky v Git histórii, **nie aktuálne prevádzkové pokyny**.

**Rentulo** je platforma na prenájom vecí medzi **súkromnými osobami v Českej republike** (V1). Prevádzkovateľ: **EBBI s. r. o.**, Slovensko. Registrácia nie je obmedzená len na českú štátnu príslušnosť, samotné prenájmy vo V1 však prebiehajú iba v ČR. Rozhranie podporuje **CZ (predvolené), SK, EN, DE a PL**. Podnikatelia/PRO a dopyty patria až do budúcej verzie.

## Stav projektu

- **TEST:** `https://rentulo.eu`, GitHub `main`, Vercel `rentulo`, samostatný Supabase TEST a Stripe TEST. TEST zostáva oddelený a neindexovaný.
- **PROD:** `https://rentulo.com`, GitHub `production`, Vercel `rentulo-prod`, samostatný Supabase PROD. Produkčná doména už technicky funguje; **oficiálne verejné spustenie je plánované na 1. 12. 2026**, nie je synonymom úspešného deployu. Pred spustením zostáva `noindex` a samostatné schválenie otvorenia/indexovania.
- **Nasadenie hodnotení 12. 11. 2026:** PR [#171](https://github.com/EBBI-SK/rentulo/pull/171) zlúčený do `production` (merge `44f7dbe`), PROD SQL migrácia a dve Edge Functions nasadené, verejná stránka bez testovacích recenzií vizuálne overená. Automatické testy pred PR: **931/931**, GitHub kontroly **3/3**. Reálny produkčný scenár pozvánky po vrátení ešte čaká na český test.
- **SEO 19A–19C:** nasadené do PROD 10. 11. 2026 (PR #157); **19D – sprístupnenie indexovania a Search Console** až pri schválenom štarte.
- **Zostáva pred štartom:** skutočný český end-to-end prenájom s platbou, PIN, vrátením a transferom; následné overenie pozvánky/hodnotenia; aktivácia a skúška produkčných SMS podľa osobitného rozhodnutia (plán deň pred štartom); finálny launch postup bez testovacích dát. Detailný zoznam a hranice overenia sú v HANDOVER.

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
- `supabase/functions/` – serverové funkcie; `tests/` – automatické testy.
- `docs/` – špecializované runbooky; `HANDOVER.md` – aktuálna prevádzková príručka.

## Lokálne príkazy

```powershell
npm ci
npm test
npm run build
```

- `npm test` spúšťa kontrolné testy Node.js. Posledný doložený kompletný beh pri produkčnom balíku hodnotení **12. 11. 2026: 931/931, fail 0**; aktuálny výsledok sa vždy viaže na konkrétny commit.
- `npm run build` štandardne generuje **TEST** do `dist/`. **Nie je dôkazom funkčnosti PROD**.
- Produkčný build vyžaduje `RENTULO_DEPLOY_TARGET=prod`, `RENTULO_SUPABASE_URL` a `RENTULO_SUPABASE_PUBLISHABLE_KEY` z výslovne schváleného produkčného prostredia. Tajné hodnoty sa nikdy nedávajú do Gitu ani do chatu.
- Build **neaplikuje SQL migrácie ani nenasadzuje Edge Functions**. Na to existujú samostatné schválené release kroky.

## Zásady zmeny a nasadenia

**Jedna vec naraz:** návrh → súhlas → ZIP **iba zmenených súborov** → pracovná vetva → lokálna kontrola → commit/push → PR → CI → merge → kontrola správneho prostredia. TEST a PROD sú samostatné vetvy aj databázy; celý `main` sa kvôli jednej funkcii **nemerguje** do `production`. Produkčné SQL, Edge Functions, platby, DNS a indexovanie iba s konkrétnym schválením. Neopakovať už overené kontroly bez dôvodu.

## Ďalšie dôležité dokumenty

- [HANDOVER.md](HANDOVER.md) – **aktuálny stav k 12. 11. 2026**, čo je hotové, čo ostáva, presné prevádzkové pravidlá a dôkazy.
- [Nasadenie hodnotení do PROD](docs/PLATFORM_REVIEWS_V1_PROD.md) – pôvodný release runbook; kroky „pred nasadením“ sú už **historicky vykonané** 12. 11. 2026.
- [SEO 19A–19C PROD](docs/SEO_19_PROD_RELEASE_20261110.md) – zdrojový release plán; 19D je samostatný launch krok.
- [POHODA provízie](docs/POHODA_PROVIZIE_TEST.md) – metodika exportu a výnimky, najmä ECB a potvrdené vrátenie.

**Dôležité:** technické nasadenie ≠ potvrdený reálny prenájom ≠ oficiálne verejné spustenie. Stav jednotlivých oblastí je rozlíšený v HANDOVER.
