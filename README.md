# Rentulo

Rentulo je webová platforma na požičiavanie vecí medzi súkromnými osobami v **Českej republike**. Prvá verzia (V1) nie je určená podnikateľom. Prevádzkovateľom je **EBBI s. r. o.**

> **Stav dokumentácie: 20. 10. 2026.** GitHub `main` pred etapou 3: `bd03fca` (zlúčený PR #32). Po inštalácii etáp 1 a 2 v Supabase TEST bol overený kód 645/645 testami; pripravená etapa 3 má v lokálnej pracovnej kópii **657/657 testov** a úspešný TEST build, ale vyžaduje nový PR, CI a kontrolu živého TEST webu. Historické údaje nižšie sú zachované s pôvodnými dátumami. Verejný PROD `rentulo.com` nebol spustený.


> **BOD 02 (20. 10. 2026, TEST):** V1 je určená iba súkromným osobám v ČR a nepovoľuje dopravné prostriedky. Etapa 1 (PR #31) a etapa 2 (PR #32) sú zlúčené, všetkých **5 SQL migrácií** bolo nainštalovaných do Supabase TEST. GDPR/DSA evidencie, retencia, právne pozastavenia a Edge worker fotografií prešli základnými prevádzkovými kontrolami; všetky mazacie brány zostávajú **OFF**. Etapa 3 dopĺňa explicitné GPS vyžiadanie, žiadne súradnice v URL, 5 jazykov a kontrolný zoznam dodávateľov. **DPA/medzinárodné prenosy a finálny právny súhlas nie sú bez dokladov overené.** PROD sa nemení. [Etapa 3](docs/BOD02_ETAPA3_WEB_GPS_PRAVNE_TEXTY_TEST.md), [dodávatelia a DPIA/DPO](docs/BOD02_ETAPA3_DODAVATELIA_DPA_DPIA_TEST.md).

## Technológie a architektúra

- HTML, CSS a vanilla JavaScript; bez frontendového frameworku a bundlera.
- **Node.js build** (`npm run build`) generuje statický web do `dist/`, vrátane SEO metadát a oddelenej TEST/PROD konfigurácie.
- **Supabase**: Auth, PostgreSQL, RLS/RPC, Storage, Edge Functions a databázové migrácie.
- **Stripe**: Checkout, Connect, serverový webhook, refundy a transfery prenajímateľom; aktuálne sa používajú **testovacie Stripe platby**.
- **Vercel**: hosting, build a serverless API pre SEO detail ponuky a dynamickú sitemap.
- **Resend** a **BulkGate**: rezervačné e-maily a voliteľné SMS cez spoločnú databázovú frontu a bezpečný worker; Supabase Auth má vlastné jazykové e-mailové šablóny.
- **cron-job.org**: nezávislý externý plánovač bezpečnostného monitoringu notifikácií iba pre TEST; samotné spracovanie fronty naďalej používa databázový Supabase `pg_cron`. GitHub Actions má len manuálny diagnostický workflow.
- **OpenStreetMap**: mapa; **Geoapify EU** (`api-eu.geoapify.com`): iba serverové geokódovanie ručne zadanej adresy miesta vyzdvihnutia cez `geocode-pickup`. V registrácii, profile a pri vytváraní/úprave ponuky nie sú automatické návrhy adries. Serverový secret `GEOAPIFY_API_KEY` zostáva potrebný pre geokódovanie. Legacy funkcia `address-suggestions` sa po overení tejto zmeny v TEST vyradí samostatným krokom.

## Štruktúra repozitára

```text
/
├── .github/workflows/ci.yml     # GitHub Actions kontroly
├── .github/workflows/rentulo-test-notification-monitor.yml # iba manuálna TEST diagnostika
├── api/                          # SEO detail ponuky a sitemap (Vercel)
├── assets/                       # logo a statické súbory
├── css/                          # štýly
├── js/                           # frontendová logika, i18n a Supabase klient
├── scripts/                      # build a SEO katalóg
├── supabase/
│   ├── auth-email-templates/     # zdrojové šablóny Auth e-mailov
│   ├── functions/                # Supabase Edge Functions (vrátane TEST GDPR foto workera)
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
- `npm test` spustí Node.js testy v `tests/`. Staršia referencia 423/423 (#402) platila k 13. 10.; k 20. 10. bola etapa 2 overená **645/645** a etapa 3 v lokálnej príprave **657/657**. Po novom PR treba overiť **nový** GitHub CI; lokálne číslo nie je dôkazom nasadenia.
- `npm run build` predvolene vytvorí **TEST** web v `dist/`. Výstup je možné lokálne prehliadať cez HTTP server (napríklad VS Code Live Server).
- Build **neaplikuje databázové migrácie, nenasadzuje Supabase Edge Functions ani neprepína PROD**.

`RENTULO_DEPLOY_TARGET=prod` vyžaduje samostatné produkčné Supabase nastavenia a je určený iba pre výslovne schválené produkčné nasadenie. **Na bežnú prácu nepoužívať PROD build ani produkčné kľúče.**

## Funkcie V1 v TEST prostredí

- Registrácia a prihlásenie cez Supabase Auth; nastavenia profilu a účtu.
- Ponuky vecí, vyhľadávanie, cenové a geografické filtre, približná verejná mapa.
- Automatické nemenné čísla ponúk `N-000001...` a rezervácií `R-000001...`.
- Rezervačný tok `pending` → `approved` → `paid` → `picked_up` → `returned`; samostatné zamietnutie, zrušenie a kontrolovaná **24-hodinová expirácia nezaplatených rezervácií** (stav `expired`). Bezpečné uvoľnenie termínu musí zohľadniť rozpracovanú platbu Stripe; výsledok živého časového testu je samostatná kontrola.
- Stripe Checkout a Connect: minimálna cena ponuky **100 CZK/deň**, platformový poplatok **10 % zo sumy rezervácie, minimálne 50 CZK**.
- Po zaplatení odomknutie chránených kontaktných údajov a prístup k šesťmiestnemu PIN na odovzdanie. **Pripravovaný KROK 79 v TEST:** PIN bude použiteľný na odovzdanie od `start_date + pickup_time` do `end_date + pickup_time` v `Europe/Prague`, najviac jedenkrát. Po potvrdení prevzatia sa okamžite zneplatní a spustí sa Stripe transfer; bez prevzatia nastane no-show až po presnom plánovanom čase vrátenia. Tento kód ešte nie je nasadený v databáze. Tri nesprávne pokusy znamenajú 15-minútový zámok.
- Po potvrdení prevzatia sa iniciuje Stripe transfer prenajímateľovi; pri dočasnej chybe existuje automatický retry. To neznamená okamžité pripísanie na bankový účet.
- Storno a refund zaplatenej rezervácie; náklady pri storne nájomcu, plný refund nájomcovi pri storne prenajímateľa a prípadný dlh prenajímateľa voči platforme.
- Päť jazykov: **CZ (`cs`), SK (`sk`), EN, DE, PL**. Predvolený jazyk je čeština.
- Rezervačné e-maily a voliteľné SMS cez jednotnú serverovú frontu; užívateľské SMS upozornenia sa aktivujú opt-in v `nastaveni.html`. SMS bez PIN-u a kontaktných údajov.

Čas `pickup_time` naďalej určuje **šesťhodinovú hranicu storna**; pripravované potvrdenie prevzatia PIN-om bude možné v ktorýkoľvek zaplatený deň od prvého po posledný (vrátane), nie iba v prvý deň. Detailné pravidlá sú v [HANDOVER.md](HANDOVER.md).

## BOD 13 – rezervačné e-maily a SMS (TEST)

Zjednotený systém používa tabuľku `reservation_notification_deliveries` a serverový worker `process-reservation-notifications`; udalosti vznikajú databázovo a spracúvajú sa asynchrónne (**Supabase databázový cron každú minútu**, nie externý monitorovací cron). **E-maily fungujú nezávisle od zapnutia SMS.** SMS sú voliteľné, vyžadujú platné telefónne číslo a súhlas v nastaveniach profilu. Podporované základné SMS udalosti: **nová žiadosť, schválenie, zaplatenie, zrušenie**; špeciálne zaplatené storno sa vyhodnocuje až po potvrdenom refunde/finančnom uzavretí.

**Reálny TEST 12. 10. 2026:** pri rezervácii `R-000019` prišli SMS za novú žiadosť, schválenie a zaplatenie; pri `R-000020` prišla SMS za zrušenie. **4/4 SMS prevzaté na testovacom mobile**, všetky mali v databáze `status=sent`, BulkGate ID a `attempt_count=1`, bez chyby; e-mailové udalosti boli `sent`. Nová žiadosť `R-000020` bola v `dry_run` iba `simulated`. BulkGate TEST aplikácia mala v okamihu kontroly využitie **4/5 SMS denne**.

- **Supabase TEST (`rentulo.eu`):** pre skúšky sa dočasne použilo `SMS_SEND_MODE=live` iba s `SMS_ALLOWED_NUMBERS`; po skončení bol režim podľa vykonaného administrátorského postupu obnovený na **`dry_run`**. Hodnoty secrets nemožno overiť z maskovaného screenshotu; pred ďalším testom znovu skontrolovať režim.
- **PROD (`rentulo.com`):** SMS neaktivované. Aktuálny kód dokonca blokuje `live` mimo TEST projektu. Produkčné nasadenie vyžaduje osobitné schválenie, bezpečnostnú kontrolu, nezávislé nastavenia a overenie vlastníctva telefónneho čísla. Žiadny TEST výsledok neznamená pripravenosť PROD.

Podrobnosti o migráciách, crone, bezpečnosti, diagnostike a ďalších obmedzeniach sú v [HANDOVER.md – BOD 13](HANDOVER.md#21-bod-13--zjednotené-rezervačné-notifikácie-test).

## BOD 12 – P1-4: nezávislý monitoring notifikácií (TEST)

**Aktivovaný v TEST podľa prevádzkového testu 13. 10. 2026; ponechať zapnutý.** Opakovanú kontrolu notifikácií vykonáva **cron-job.org**, ktorý cez chránený HTTP `POST` volá Supabase Edge Function `monitor-reservation-notifications`. Sleduje zlyhané, oneskorené a zaseknuté notifikácie i chýbajúci úspešný heartbeat workera. Po samostatnom redeployi TEST Edge Function v BODE 03A budú alerty cez Resend smerovať na `support@rentulo.com`, s ochranou proti opakovanému odoslaniu toho istého incidentu; samotný merge adresáta bežiacej funkcie nezmení. Postup 03A: `docs/BOD03A_INCIDENTY_ADMIN_TEST.md`.

**Nezamieňať dva plánovače:** bežné rezervácie a notifikácie spracúva Supabase `pg_cron`; **cron-job.org iba monitoruje**. `.github/workflows/rentulo-test-notification-monitor.yml` zostáva po tejto zmene výlučne **manuálnym diagnostickým nástrojom** (`workflow_dispatch`, len `main`), bez GitHub `schedule` a bez závislosti od `RENTULO_TEST_MONITOR_ENABLED`. Frekvenciu, úspešnosť volaní a prípadné nedostupnosti kontrolovať v cron-job.org; samotný commit jeho nastavenia nemení. Pri úplnom výpadku Supabase nemusí monitor poslať e-mail, preto je dôležité sledovať aj stav HTTP behov externého plánovača.

Pri skúške P1-4 databáza evidovala testovací alarm `qa-p1-4-alarm-20261013-01` so `sent_at` **13. 10. 2026 14:10:18 UTC**, `attempt_count=1`, bez chyby. **Zápis `sent_at` nie je potvrdením doručenia do schránky.** Kompletný prevádzkový postup a bezpečnostné upozornenia: [docs/BOD12_P1-4_monitoring_TEST.md](docs/BOD12_P1-4_monitoring_TEST.md) a [HANDOVER.md – kapitola 22](HANDOVER.md#22-bod-12--p1-4-nezávislý-monitoring-notifikácií-test).

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

- Verejná `SUPABASE_PUBLISHABLE_KEY` vo frontende nie je servisný kľúč. Práva vynucuje RLS a bezpečné RPC/Edge Functions. `SUPABASE_SERVICE_ROLE_KEY`, Stripe, Resend, BulkGate a ostatné tajomstvá **nikdy neukladať do repozitára ani do ZIP-u**.
- Staršia klientsky použiteľná testovacia platobná RPC `mark_my_reservation_paid_test` bola odstránená migráciou z 11. 10. 2026; historická tabuľka `test_payment_users` ostáva bez prístupov pre `public`, `anon` a `authenticated`. Účinok migrácií na konkrétnom prostredí treba preveriť osobitne.
- `vercel.json` nastavuje CSP, HSTS, ochranné HTTP hlavičky a `X-Robots-Tag: noindex` na príslušných hostoch.
- Bezpečnostné výsledky CodeQL (0 otvorených / 6 uzavretých) pochádzajú **z 18. 8. 2026**; nie sú novým bezpečnostným auditom.
- Právne dokumenty a kontakty pre V1 sú pripravené v zdrojovom kóde; pred ostrým spustením je nutné overiť ich finálnu účinnosť, právnu správnosť a skutočnú funkčnosť e-mailových schránok.

**Aplikácia nie je automaticky pripravená na ostrú prevádzku len preto, že CI prešlo.** Zostáva samostatná kontrola PROD nastavení, migrácií, Stripe live integrácie, Auth, Resend a produkčných SMS, bezpečnosti, právnych údajov, DNS/TLS a end-to-end smoke testov. Úplný odovzdávací dokument a kontrolný zoznam: **[HANDOVER.md](HANDOVER.md)**.

### BOD 03B – výnimočné vysporiadanie sporov (pripravené pre TEST)

Schválený rozsah: jeden zdokumentovaný incident, nezmeniteľná autorizácia majiteľovi
alebo úplný refund nájomcovi, súkromné dôkazy, RLS/audit, TEST-only finančný
worker; bez falošného potvrdenia vrátenia, bez automatickej náhrady škody.
Nasadenie **nie je automatické po merge**. Poradie, riziká, SQL a prevádzkový
postup: `docs/BOD03B_SPORY_VYSPORIADANIE_TEST.md`.
PROD, Stripe live a test R-000040 bez zásahu.
