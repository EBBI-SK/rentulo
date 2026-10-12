# Rentulo

Rentulo je webová platforma na požičiavanie vecí medzi súkromnými osobami v **Českej republike**. Prvá verzia (V1) nie je určená podnikateľom. Prevádzkovateľom je **EBBI s. r. o.**

> **Stav dokumentácie: 12. 10. 2026.** Referenčný GitHub `main`: `8ef44e2` (11. 10. 2026); GitHub CI **#391 úspešné, 367/367 testov**. Je to stav k uvedenému commitu, nie trvalá garancia. Aplikácia sa vyvíja a testuje na `rentulo.eu`; verejná produkcia `rentulo.com` **nebola spustená**.

## Technológie a architektúra

- HTML, CSS a vanilla JavaScript; bez frontendového frameworku a bundlera.
- **Node.js build** (`npm run build`) generuje statický web do `dist/`, vrátane SEO metadát a oddelenej TEST/PROD konfigurácie.
- **Supabase**: Auth, PostgreSQL, RLS/RPC, Storage, Edge Functions a databázové migrácie.
- **Stripe**: Checkout, Connect, serverový webhook, refundy a transfery prenajímateľom; aktuálne sa používajú **testovacie Stripe platby**.
- **Vercel**: hosting, build a serverless API pre SEO detail ponuky a dynamickú sitemap.
- **Resend**: rezervačné e-maily; Supabase Auth má vlastné jazykové e-mailové šablóny.
- **OpenStreetMap**, **Nominatim** a **Photon**: mapa, geokódovanie a návrhy adries.

## Štruktúra repozitára

```text
/
├── .github/workflows/ci.yml     # GitHub Actions kontroly
├── api/                          # SEO detail ponuky a sitemap (Vercel)
├── assets/                       # logo a statické súbory
├── css/                          # štýly
├── js/                           # frontendová logika, i18n a Supabase klient
├── scripts/                      # build a SEO katalóg
├── supabase/
│   ├── auth-email-templates/     # zdrojové šablóny Auth e-mailov
│   ├── functions/                # Supabase Edge Functions (17)
│   ├── migrations/               # aktuálne SQL migrácie
│   ├── migrations-archive/       # historický archív; nespúšťať znovu
│   └── snippets/                # pomocné SQL
├── tests/                        # automatizované testy (node:test)
├── *.html                        # stránky aplikácie
├── package.json
├── package-lock.json
└── vercel.json                   # build, smerovanie, CSP a ďalšie hlavičky
```

Dôležité stránky: `index.html`, `vysledky.html`, `detail.html`, `nabidnout.html`, `edit-nabidka.html`, `moje-nabidky.html`, `moje-rezervace.html`, `historie.html`, `nastaveni.html`, `registrace.html`, `prihlaseni.html`, `obnova-hesla.html`, `jak-to-funguje.html`, `kontakt.html`, `obchodni-podminky.html` a `ochrana-osobnich-udaju.html`.

## Lokálna práca a testovanie

V koreňovom priečinku projektu (napríklad vo VS Code na Windows):

```powershell
npm ci
npm test
npm run build
```

- `npm ci` nainštaluje závislosti podľa `package-lock.json`; používame Supabase CLI ako vývojovú závislosť.
- `npm test` spustí Node.js testy v `tests/`. Na referenčnom commite `8ef44e2` prešlo **367/367**.
- `npm run build` predvolene vytvorí **TEST** web v `dist/`. Výstup je možné lokálne prehliadať cez HTTP server (napríklad VS Code Live Server).
- Build **neaplikuje databázové migrácie, nenasadzuje Supabase Edge Functions ani neprepína PROD**.

`RENTULO_DEPLOY_TARGET=prod` vyžaduje samostatné produkčné Supabase nastavenia a je určený iba pre výslovne schválené produkčné nasadenie. **Na bežnú prácu nepoužívať PROD build ani produkčné kľúče.**

## Funkcie V1 v TEST prostredí

- Registrácia a prihlásenie cez Supabase Auth; nastavenia profilu a účtu.
- Ponuky vecí, vyhľadávanie, cenové a geografické filtre, približná verejná mapa.
- Automatické nemenné čísla ponúk `N-000001...` a rezervácií `R-000001...`.
- Rezervačný tok `pending` → `approved` → `paid` → `picked_up` → `returned`; samostatné zamietnutie a zrušenie podľa pravidiel.
- Stripe Checkout a Connect: minimálna cena ponuky **100 CZK/deň**, platformový poplatok **10 % zo sumy rezervácie, minimálne 50 CZK**.
- Po zaplatení odomknutie chránených kontaktných údajov a prístup k šesťmiestnemu PIN na odovzdanie. **PIN možno použiť na prevzatie iba v dohodnutý kalendárny deň podľa `Europe/Prague`**; po uplynutí dňa sa už nezobrazí. Po úspešnom potvrdení sa zneplatní. Tri nesprávne pokusy znamenajú 15-minútový zámok.
- Po potvrdení prevzatia sa iniciuje Stripe transfer prenajímateľovi; pri dočasnej chybe existuje automatický retry. To neznamená okamžité pripísanie na bankový účet.
- Storno a refund zaplatenej rezervácie; náklady pri storne nájomcu, plný refund nájomcovi pri storne prenajímateľa a prípadný dlh prenajímateľa voči platforme.
- Päť jazykov: **CZ (`cs`), SK (`sk`), EN, DE, PL**. Predvolený jazyk je čeština.

Čas `pickup_time` naďalej určuje **šesťhodinovú hranicu storna**; samotné potvrdenie prevzatia PIN-om je viazané na *deň*, nie na konkrétnu hodinu. Detailné pravidlá sú v [HANDOVER.md](HANDOVER.md).

## TEST a PROD – striktne oddelené

| | TEST | PROD – zatiaľ neverejný |
| --- | --- | --- |
| Doména | `https://rentulo.eu` | plánované `https://rentulo.com` |
| GitHub vetva | `main` | `production` |
| Vercel projekt | `rentulo` | `rentulo-prod` |
| Supabase projekt | `vspposovhdgvbeukoivh` | `tfvgxrdjrpicgtvovehl` |
| Build target | `test` | `prod` |
| Indexovanie | `noindex` | `noindex` do samostatného schválenia |

PROD doména, DNS, databáza, serverové tajomstvá ani platby sa bez nového výslovného súhlasu nemenia. **`rentulo.eu` sa nesmie automaticky presmerovať na `rentulo.com`**; po budúcom spustení ostáva samostatným TEST prostredím. Podrobný release a rollback plán je v kapitole 12 dokumentu [HANDOVER.md](HANDOVER.md).

## Nasadzovanie a automatické kontroly

Schválený vývojový postup: **aktuálny `main` a história → návrh → súhlas → ZIP zmien → lokálne testy → commit → push do `main` → GitHub CI → kontrola TEST nasadenia**. Produkcia je nezávislá.

Workflow `.github/workflows/ci.yml` je spustený pri push/PR na `main` aj `production` a kontroluje syntax JavaScriptu, JSON, konfliktné značky, zakázané súbory, `npm audit --audit-level=high`, `npm test`, TEST build a Deno typecheck Supabase Edge Functions. Úspešné CI **nenahrádza** test reálnych procesov v Supabase a Stripe ani schválenie PROD.

SEO: build pridáva metadata, canonical a Open Graph; `api/offer-page.mjs` generuje verejný detail ponuky a `api/sitemap.mjs` dynamickú sitemap aktívnych ponúk. TEST sitemap vracia 404 a TEST/preview zostávajú bez indexovania. Povolenie indexovania PROD je osobitný release krok.

## Bezpečnosť a prevádzkové upozornenia

- Verejná `SUPABASE_PUBLISHABLE_KEY` vo frontende nie je servisný kľúč. Práva vynucuje RLS a bezpečné RPC/Edge Functions. `SUPABASE_SERVICE_ROLE_KEY`, Stripe, Resend a ostatné tajomstvá **nikdy neukladať do repozitára ani do ZIP-u**.
- Staršia klientsky použiteľná testovacia platobná RPC `mark_my_reservation_paid_test` bola odstránená migráciou z 11. 10. 2026; historická tabuľka `test_payment_users` ostáva bez prístupov pre `public`, `anon` a `authenticated`. Účinok migrácií na konkrétnom prostredí treba preveriť osobitne.
- `vercel.json` nastavuje CSP, HSTS, ochranné HTTP hlavičky a `X-Robots-Tag: noindex` na príslušných hostoch.
- Bezpečnostné výsledky CodeQL (0 otvorených / 6 uzavretých) pochádzajú **z 18. 8. 2026**; nie sú novým bezpečnostným auditom.
- Právne dokumenty a kontakty pre V1 sú pripravené v zdrojovom kóde; pred ostrým spustením je nutné overiť ich finálnu účinnosť, právnu správnosť a skutočnú funkčnosť e-mailových schránok.

**Aplikácia nie je automaticky pripravená na ostrú prevádzku len preto, že CI prešlo.** Zostáva samostatná kontrola PROD nastavení, migrácií, Stripe live integrácie, Auth a Resend, bezpečnosti, právnych údajov, DNS/TLS a end-to-end smoke testov. Úplný odovzdávací dokument a kontrolný zoznam: **[HANDOVER.md](HANDOVER.md)**.
