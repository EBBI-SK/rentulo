# Rentulo – HANDOVER

**Servisná a odovzdávacia dokumentácia.** Pôvodný dokument vznikol 18. 8. 2026; priebežné kapitoly obsahujú historické overenia z augusta až októbra. **Aktualizácia BOD 02: 20. 10. 2026**, referenčný GitHub `main` pred etapou 3 `bd03fca` (PR #32). Etapy 1 a 2 sú nasadené v Supabase TEST, etapa 3 je pripravená na vlastný PR a prehliadačový TEST. **Implementácia v Gite, úspešný TEST/CI a pripravenosť živého PROD sú tri odlišné veci.**

Tento dokument **nie je pokynom na spustenie produkcie**. Bez nového schválenia sa nemení vetva `production`, Vercel/Supabase PROD, Stripe live, domény, DNS ani indexovanie. [README.md](README.md) obsahuje stručný úvod; tu je technický stav, prevádzkové pravidlá a kontrolný zoznam pred spustením.


## BOD 02 – GDPR, DSA a právne zábrany (stav k 20. 10. 2026)

**V1:** CZ C2C medzi súkromnými osobami, zákaz dopravných prostriedkov, 5 jazykov. § 7a registrácia EBBI a rozsah DAC7 boli podľa projektového rozhodnutia posúdené; neotvárať ich ako nové úlohy bez zmeny okolností. Právny audit nie je automaticky potvrdením všetkých dodávateľských DPA/PSD2 podmienok ani schválením PROD.

- **Etapa 1 – PR #31 (`9bb6700`)**: GDPR registračné dôkazy, DSAR, DSA podnety, bezpečnostné incidenty a právne pozastavenia; TEST SQL inštalované a overené, 5 registrov s RLS, 3 triggery, mazanie kontaktov OFF.
- **Etapa 2 – PR #32 (`bd03fca`)**: 4 ďalšie SQL migrácie v Supabase TEST, 7 samostatne schvaľovaných kategórií, evidencie časov ukončenia, owner-contact minimizácia, fotografie; 645/645 testov pred merge. Kontroly: 2 časové stĺpce a triggery, 6 interných tabuliek RLS, 4 hlavné brány OFF, 0 povolených kategórií, 1 plánovač inertný. Edge `gdpr-cleanup-offer-photo` nasadený len na TEST s vlastným tajomstvom a `--no-verify-jwt`: autorizované volanie `{ok:true,claimed:0,removed:0}`; neautorizované HTTP 401. Žiadne vykonané čistenie; test immutability a právnej blokácie úspešný. Všetky brány ponechať **OFF** bez nového samostatného schválenia.
- **Etapa 3 – tento ZIP**: upravené GPS na výslovný klik, súradnice nie v URL, one-time browser session handoff, GDPR texty CZ/SK/EN/DE/PL, odstránenie Google Fonts requestov z dotknutých stránok a dokumentácia dodávateľov. Lokálne 657/657 testov + TEST build, ešte **nie je potvrdený PR, CI, ani nasadenie na rentulo.eu**.

**Zostáva pred PROD:** skutočné doklady DPA/rolí/regiónov/prenosov dodávateľov, záverečné potvrdenie českých právnych znení a dátumu účinnosti, kontrola DPIA/DPO, pozitívne reálne TEST scenáre s novými rezerváciami a mazaním pri výslovne povolenom bezpečnom scenári, plus samostatné schválenie PROD. Tieto blokátory sú v [docs/BOD02_ETAPA3_DODAVATELIA_DPA_DPIA_TEST.md](docs/BOD02_ETAPA3_DODAVATELIA_DPA_DPIA_TEST.md). Čisté CI samo nezapína retenciu.

**Podrobný postup:** [etapa 3 a GPS](docs/BOD02_ETAPA3_WEB_GPS_PRAVNE_TEXTY_TEST.md), [retencia](docs/BOD02_ETAPA2_RETENCIA_TEST.md), [pravidlá](docs/BOD02_GDPR_RETENCNA_POLITIKA_V1.md). **PROD `production` / Supabase PROD / Stripe live nemeniť.**

## 1. Aktuálny stav (snapshot k 13. 10. 2026)

Rentulo V1 je platforma na požičiavanie vecí **medzi súkromnými osobami v ČR**. Používateľské rozhranie má päť jazykov (CZ/SK/EN/DE/PL), predvolená je čeština. Prevádzkovateľ: **EBBI s. r. o.** Projekt zatiaľ funguje v TEST prostredí; verejné spustenie na `rentulo.com` nebolo odsúhlasené.

- GitHub: [`EBBI-SK/rentulo`](https://github.com/EBBI-SK/rentulo), `main` pred touto aktualizáciou **`19c3a2e5359c65b454184f419945859c2d79e762`** (13. 10. 2026; korekcia TEST monitorovacieho workflow P1-4). Projektový ZIP z 13. 10. bol overený proti tomuto commitu.
- GitHub Actions: posledné úspešné projektové overenie pred touto zmenou **Rentulo CI #402**, `npm test` **423/423, fail 0**, TEST build a Deno typecheck. Tento údaj sa vzťahuje na `19c3a2e`; po tejto dokumentačnej zmene treba overiť nový CI beh.
- TEST: Vercel `rentulo`, vetva `main`, doména `https://rentulo.eu`, Supabase projekt `vspposovhdgvbeukoivh`, Stripe **test/sandbox**.
- PROD: Vercel `rentulo-prod`, vetva `production` (posledný zdokumentovaný a v projektovom ZIP-e prítomný commit `a79d3bb`), Supabase projekt `tfvgxrdjrpicgtvovehl`, plánovaná doména `https://rentulo.com`. **PROD neaktivovať a nemeniť.**
- Pri audite 10. 10. bola na Vercel PROD potvrdená ochrana **Authentication → All Deployments**. Ide o dátumovo obmedzené overenie; ochranu pred štartom skontrolovať znova, nikdy ju predčasne nevypnúť.
- TEST a prelaunch hosty majú `noindex`; podľa aktuálneho `vercel.json` je `X-Robots-Tag: noindex` aj pre `.com`, pokiaľ nebude osobitne schválená aktivácia indexovania.
- **BOD 13 – TEST:** reálne doručené 4/4 typy SMS cez BulkGate; príslušné e-maily `sent`, bez chýb. Po teste bol `SMS_SEND_MODE` manuálne vrátený na `dry_run`. **PROD SMS nie sú aktivované.**
- **BOD 12 – P1-4 TEST:** oddelený monitor notifikácií bol aktivovaný cez **cron-job.org** a podľa rozhodnutia zostáva zapnutý. GitHub Actions sa ponechá len na manuálnu diagnostiku, bez plánovaného spúšťania; podrobnosti v kapitole 22. Posledné skutočné behy cron-job.org sa overujú v jeho dashboarde, nie podľa Gitu.

**Rozsah tohto overenia:** GitHub commit, zdrojové súbory a CI logy. Úspešné CI samo osebe neoveruje živé Supabase PROD, Stripe live, DNS, všetky dashboard secrets ani pripravenosť schránok. Plán spustenia a rollback je v **kapitole 12**.

## 2. Architektúra

```text
prehliadač
    |
    v
Vercel (statický HTML/CSS/vanilla JS build v dist/)
    |                         |
    |                         +--> serverless api/offer-page.mjs a api/sitemap.mjs (SEO)
    +--> Supabase Auth, PostgreSQL + RLS/RPC, Storage
    +--> Supabase Edge Functions
                  |           |
                  +--> Stripe Checkout / Connect / webhook / refundy / transfery
                  +--> PostgreSQL notification outbox + cron worker
                            +--> Resend (rezervačné e-maily)
                            +--> BulkGate (voliteľné SMS, len TEST live)

externý cron-job.org (TEST; pravidelné HTTPS POST)
    +--> Edge Function monitor-reservation-notifications
         +--> monitorovacie RPC + heartbeat workera
         +--> Resend (deduplikovaný alarm na support@rentulo.com)

mapa: OpenStreetMap; adresy: Geoapify EU (cez Supabase Edge Functions, serverový secret `GEOAPIFY_API_KEY`; TEST aktivovať až po nasadení)
```

Frontend nemá bundler ani JS framework, **má však riadený Node.js build** `scripts/build-site.mjs`. Build vytvára `dist/` a vkladá konfiguráciu prostredia a SEO metadata. Vercel má oddelené hostové CSP pravidlá a serverless SEO endpointy. Stripe operácie sa vykonávajú cez dôveryhodný backend/webhook, nie priamou zmenou stavu rezervácie z prehliadača.

## 3. Dôležité priečinky

```text
.github/workflows/ci.yml    GitHub Actions CI
.github/workflows/rentulo-test-notification-monitor.yml   iba manuálna TEST diagnostika
api/                        Vercel SEO API pre ponuky a sitemap
assets/                     logo a ostatné verejné statické súbory
css/                        spoločné a stránkové CSS
js/                         frontend, navigácia, Auth, rezervácie, PIN, i18n
scripts/                    build-site.mjs, SEO katalóg a runtime
supabase/auth-email-templates/  zdrojové šablóny Auth e-mailov
supabase/functions/         18 Edge Functions
supabase/migrations/        aktívna SQL migračná história
supabase/migrations-archive/ historický archív migrácií
supabase/snippets/          pomocné SQL/snippety
tests/                      Node.js automatizované testy
vercel.json                 build/rewrite/security/noindex konfigurácia
```

`dist/` je generovaný a ignorovaný Gitom. `supabase/migrations-archive/` je historický archív, **nemažte ho a nespúšťajte jeho migrácie znova**. Vkladaný zmenový ZIP má obsahovať iba odsúhlasené súbory, nikdy `.git/`, `dist/`, `node_modules/` ani secrets.

## 4. Supabase a build konfigurácia

Frontendový klient je v `js/supabase-config.js`. Zdroj pracuje s `SUPABASE_URL`, verejnou `SUPABASE_PUBLISHABLE_KEY` a `RENTULO_DEPLOY_TARGET`. Session sa podľa voľby prihlásenia uchováva v `sessionStorage` (bežne) alebo `localStorage` (zapamätané prihlásenie).

Build `npm run build` štandardne vytvára **TEST** variant. Pre PROD je potrebný `RENTULO_DEPLOY_TARGET=prod` spolu s vlastnými `RENTULO_SUPABASE_URL` a `RENTULO_SUPABASE_PUBLISHABLE_KEY` v bezpečne nastavenej konfigurácii Vercel. Build odmieta nesprávny Supabase projekt alebo TEST publishable key pri PROD. Klient zároveň odmieta nesúlad nasadzovacej domény `.eu`/`.com`.

Publishable key je určená na použitie v prehliadači; ochranu dát musia vynucovať **RLS, databázové oprávnenia a autorizované RPC/Edge Functions**. **`SUPABASE_SERVICE_ROLE_KEY` ani Stripe/Resend/BulkGate/PIN secrets nepatria do HTML, klientského JS, commitu ani odovzdávacieho ZIP-u.** Migrácie alebo serverové secrets sa buildom webu automaticky nenasadzujú.

## 5. Supabase Edge Functions

V `main` je **20 Edge Functions**. Zoznam je úplný pre referenčný commit; pred ďalším vývojom opäť preveriť priečinok `supabase/functions/`.

| Funkcia | Účel |
| --- | --- |
| `account-deactivation` | bezpečná deaktivácia účtu a kontrola finančných prekážok |
| `address-suggestions` | návrhy a filtrovanie adries podľa prostredia |
| `geocode-pickup` | geokódovanie vyzdvihnutia (Geoapify EU; bez verejného fallbacku po migrácii) |
| `create-checkout-session` | vytvorenie Stripe Checkout pre rezerváciu |
| `create-connect-account` | vytvorenie Stripe Connect účtu prenajímateľa |
| `create-connect-onboarding-link` | odkaz na Stripe Connect onboarding |
| `get-connect-status` | stav Stripe Connect napojenia |
| `stripe-webhook` | overené Stripe udalosti a finančné dokončenia |
| `create-owner-transfer` | spustenie Stripe transferu po prevzatí |
| `retry-owner-transfers` | automatický bezpečný retry transferov |
| `get-pickup-pin` | sprístupnenie PIN oprávnenému nájomcovi |
| `resolve-pickup-pin` | nájdenie rezervácie prenajímateľa podľa PIN |
| `confirm-pickup` | potvrdenie prevzatia a nadväznosť na transfer |
| `cancel-paid-reservation` | storno zaplatenej rezervácie a refund |
| `create-owner-debt-checkout` | úhrada dlhu prenajímateľa cez Stripe |
| `send-reservation-email` | jazykový transport rezervačných e-mailov cez Resend, interné claimy/idempotencia |
| `process-reservation-notifications` | chránený worker spoločnej fronty e-mailov a BulkGate SMS, retry a evidencia; úspešný heartbeat P1-4 |
| `monitor-reservation-notifications` | TEST-only monitor chýb notifikačnej fronty, deduplikované e-mailové alarmy na `support@rentulo.com`; externé spúšťanie cez cron-job.org |
| `expire-reservations` | bezpečná 24-hodinová expirácia nezaplatených rezervácií (s kontrolou Stripe Checkout) |
| `send-overdue-owner-debt-reminders` | upozornenia na dlhy po splatnosti |

Používané **názvy** serverových premenných (nie ich hodnoty): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PICKUP_PIN_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `SITE_URL`, `BULKGATE_APPLICATION_ID`, `BULKGATE_APPLICATION_TOKEN`, `SMS_SEND_MODE`, `SMS_ALLOWED_NUMBERS`. Každá funkcia používa len relevantnú podmnožinu; skutočné povinné premenné overiť pri konkrétnom nasadení v jej kóde. Cron pracovníci majú navyše samostatné tajomstvá v Supabase Vault. Externý TEST monitor vyžaduje vlastné tajomstvo `RENTULO_MONITOR_SECRET` v Supabase a nezverejnenú hodnotu `x-rentulo-monitor-secret` v cron-job.org; **hodnoty nikdy nedokumentovať ani neposielať do Gitu/ZIP-u**.

`send-reservation-email` a `send-overdue-owner-debt-reminders` odvodzujú bezpečný kanonický pôvod z identifikátora Supabase projektu (TEST `.eu`, PROD `.com`); pri nesúhlase explicitného `SITE_URL` odmietnu odoslanie. Stripe funkcie tiež vyžadujú správnu konfiguráciu návratových URL – **pred produkciou overiť konkrétne secrets a URLs samostatne**. Rezervačné e-maily majú transportnú evidenciu v `reservation_email_deliveries`; spoločný asynchrónny stav e-mailov a SMS je v `reservation_notification_deliveries` (kapitola 21).

## 6. Databáza, migrácie a stav rezervácie

Autoritatívnou históriou SQL je `supabase/migrations/`; pred pridaním alebo aplikovaním SQL vždy skontrolovať najnovšie migrácie a skutočný stav **správneho** Supabase projektu. Súbory v Gite samy osebe nedokazujú ich aplikovanie v TEST alebo PROD.

- Tabuľky a pravidlá zahŕňajú ponuky, profily, rezervácie, platby, notifikácie, hodnotenia, doručenie e-mailov, Stripe webhook audit, refundy a dlhy prenajímateľov. Prístup chráni RLS a účelové RPC. BOD 13 pridáva `profiles.sms_notifications` (predvolene `false`) a server-only frontu `reservation_notification_deliveries` s idempotentnými kľúčmi `(reservation_id, event_type, recipient_id, channel)`.
- Nemenné identifikačné čísla: ponuky `N-000001...`, rezervácie `R-000001...` (migrácia `20261009130000_add_offer_and_reservation_numbers.sql`). Ide o verejné referenčné čísla, nie náhradu interného UUID.
- Stavy: `pending` → `approved` → `paid` → `picked_up` → `returned`; existuje aj `rejected`, `cancelled` a `expired` (nezaplatená rezervácia po bezpečnej kontrole 24-hodinovej lehoty/Stripe). Prechod na `paid` je viazaný na dôveryhodné potvrdenie Stripe; na `picked_up` na bezpečné potvrdenie PIN. Bežný používateľ nemôže tieto stavy ľubovoľne prepísať.
- Presné kontakty/miesto vyzdvihnutia sa sprístupnia príslušným stranám po zaplatení. Rezervácia ukladá snapshot vyzdvihnutia, aby neskoršia zmena profilu neupravila už uzavreté údaje.
- **Bežné storno** (nezaplatené `pending`/`approved` podľa roly) má hranicu **6 hodín pred** dohodnutým `start_date + pickup_time` v `Europe/Prague`. **Zaplatené storno** prechádza samostatným autorizovaným Stripe/refund procesom; nájomca má túto časovú hranicu tiež. Doterajšie nasadené pravidlo (od 11. 10.) viaže PIN na *kalendárny deň* prevzatia; KROK 79 ho **pripravuje** na celé zaplatené obdobie od `start_date` do `end_date` vrátane, bez zmeny hranice storna.
- V1 používa minimum **100 CZK/deň** pre ponuku a platformový poplatok **max(10 % z ceny rezervácie, 50 CZK)**.

Najnovšie rozhodujúce migrácie:

- `2026100707*` – finančné dlhy prenajímateľov a ich úhrada; `202610071*` – blokovanie schvaľovania pri omeškanom dlhu, reminder cron a retry transferov.
- `20261008100000_guard_account_deactivation_financials.sql` – strážne pravidlá deaktivácie účtu.
- `20261009130000_add_offer_and_reservation_numbers.sql` – referenčné čísla.
- `20261011103000_guard_pickup_and_remove_test_payment.sql` – odstránenie starej fake-payment RPC a spevnenie prevzatia.
- **`20261011170000_limit_pickup_pin_to_pickup_day.sql` – aktuálne nasadené pravidlo PIN pred KROKOM 79:** `start_date` musí byť dnešný deň podľa `Europe/Prague`. Pripravovaná (EŠTE NENASADENÁ) migrácia `20261015161000_paid_no_show_settlement_TEST.sql` zmení autorizované prevzatie na presný časový interval `start_date + pickup_time` až `end_date + pickup_time` (koniec exkluzívny). Doterajšiu migračnú históriu nemažte.
- `20261012100000_unify_reservation_notification_outbox.sql` – transakčná rezervačná fronta pre e-mail/SMS, opt-in a bezpečné claim/ack/retry.
- `20261012101000_schedule_notification_worker.sql` – Vault tajomstvo a databázový cron spoločného notifikačného workera.
- `20261012150000_harden_reservation_notification_worker.sql` – bezpečné spracovanie fronty pri zlyhaniach a timeoute.
- `20261012170000_add_expired_reservation_status.sql` až `20261012172000_schedule_reservation_expiration.sql` – status `expired`, bezpečné 24-hodinové expiračné pravidlá a samostatný cron.
- `20261013090000_reset_sms_opt_in_on_phone_change.sql` – nové telefónne číslo automaticky nezachová SMS opt-in.
- `20261013100000_monitor_reservation_notifications_TEST.sql` – dve server-only monitorovacie tabuľky a tri RPC; **bez vlastného databázového cron jobu**.

**Štyri** databázové cron joby definované migráciami: `rentulo-retry-owner-transfers-every-5-minutes` (`*/5 * * * *`), `rentulo-send-overdue-owner-debt-reminders-hourly` (`0 * * * *`), `rentulo-process-reservation-notifications-every-minute` (`* * * * *`) a `rentulo-expire-unpaid-reservations-every-5-minutes` (`*/5 * * * *`). **Odlišný plánovač:** nezávislý TEST monitor P1-4 sa spúšťa z **cron-job.org**, nie z databázového cronu ani plánovaného GitHub Actions. Po nasadení do daného prostredia treba overiť skutočný stav jobov, Vault a výsledky behov. **Žiadnu migráciu teraz automaticky nespúšťať na PROD.**

## 7. TEST PAYMENT – aktuálny bezpečnostný stav

Augustové upozornenie, že browser stále môže volať `mark_my_reservation_paid_test`, **už nezodpovedá zdrojovému kódu**. Migrácia `20261011103000_guard_pickup_and_remove_test_payment.sql`:

1. odníma práva a **odstraňuje** `public.mark_my_reservation_paid_test(uuid)`;
2. odníma oprávnenia na historickú tabuľku `public.test_payment_users` rolám `public`, `anon`, `authenticated`;
3. **nemaže** testovacie rezervácie ani obsah historickej tabuľky.

Na TEST sa používajú **Stripe test/sandbox platby**, nie stará klientská fake-payment cesta. Pred ostrým spustením je nutné osobitne potvrdiť, že najnovšia migrácia bola skutočne použitá v **PROD**, že neexistuje obchádzka platby a že produkčné Stripe účty/kľúče/webhook nie sú testovacie. Historickú tabuľku nemažte len kvôli dokumentácii; akékoľvek čistenie dát je samostatne schvaľovaná úloha.

## 8. Platby, PIN, transfery a refundy

**Stripe už je integrovaný v zdrojovom kóde a testovaný v TEST režime.** Neznamená to pripravenosť na ostré platby. Architektúra: serverové vytvorenie Checkout → dôveryhodný Stripe webhook + audit v `stripe_webhook_events` → zaplatená rezervácia → PIN odovzdanie → pokus o Stripe Connect transfer. Webhook spracovanie a retry majú kontrolu opakovania/idempotencie.

**Bezpečnosť PIN:** šesťmiestny PIN sa odvodzuje na serveri a neukladá v plaintextovom stĺpci. Sprístupňuje sa oprávnenému nájomcovi pri zaplatenej rezervácii, aj vopred pred termínom; **v doterajšom nasadení ho prenajímateľ mohol použiť iba v deň `start_date`; pripravovaný KROK 79 (nie live) povoľuje použitie od `start_date` po `end_date` vrátane, podľa Prahy**. Po uplynutí celého obdobia sa nezobrazuje; po úspešnom odovzdaní okamžite zaniká a nedá sa použiť znova. Tri nesprávne pokusy uzamknú overovanie na 15 minút. Overenie PIN ešte samo neodovzdá vec: nasleduje explicitné **„Předat věc“**. Databáza odmieta prevzatie v nesprávny deň aj pri priamom RPC volaní. Po potvrdení sa rezervácia mení na `picked_up`.

**Peníze prenajímateľovi:** po úspešnom PIN potvrdení sa iniciuje Stripe transfer; pri dočasnom zlyhaní sa používa worker a cron každých päť minút. Prenos cez Stripe nie je totožný s časom pripísania peňazí na bankový účet.

**Storno zaplatenej rezervácie:**

- Ak zruší nájomca v povolenom čase, z refundu sa odpočíta vypočítaný preukázateľný externý náklad (napr. Stripe poplatok), zvyšok sa vráti nájomcovi; e-mail uvádza rozpis.
- Ak zruší prenajímateľ, nájomcovi sa vracia plná suma a príslušný externý náklad môže vzniknúť ako **dlh prenajímateľa** voči Rentulu so splatnosťou **7 dní**. Existuje Stripe Checkout na úhradu tohto dlhu, hodinový reminder a blokovanie schvaľovania nových rezervácií po splatnosti.
- Vykonanie/refund prechádza bezpečným backendom a Stripe potvrdením; neprisudzovať refund iba podľa vizuálnej zmeny v UI.

**No-show** (nedostavenie sa na prevzatie) je **rozpracovaný KROK 79, zatiaľ nie hotová/nasadená funkcia**. Pravidlo: pri nepotvrdení PIN do presného plánovaného času vrátenia (`end_date + pickup_time` podľa Europe/Prague) automaticky ukončiť na `no_show`, uvoľniť termín a bezpečne iniciovať Stripe transfer prenajímateľovi. Pri potvrdení počas obdobia sa PIN jednorazovo spotrebuje a payout sa spustí hneď. Presné produkčné účtovné, daňové, Stripe live a payout nastavenie treba pred štartom otestovať a právne/finančne preveriť.

## 9. Rezervačné e-maily, SMS a Supabase Auth šablóny

- **Resend** posiela rezerváciami vyvolané e-maily a oznámenia o refundoch; `send-reservation-email` používa preferovaný jazyk, transportný log v `reservation_email_deliveries` a ochranu proti duplicitám. **BOD 13** priniesol spoločný databázový outbox pre e-mail a voliteľné SMS a cron worker. **BOD 12 – P1-4** navyše pridal oddelený externý TEST monitoring cez cron-job.org s alarmami cez Resend; nejde o plánovač bežnej notifikačnej fronty. E-mailové odkazy musia rešpektovať oddelenie TEST `.eu` / PROD `.com`.
- V `supabase/auth-email-templates/` sú päťjazyčné Auth šablóny **Confirm sign up, Reset password, Change email address**. Šablóny **nie sú automaticky synchronizované** len commitom: aktivujú sa v príslušnom Supabase Auth dashboarde. Na TEST boli v októbri upravované a overované; PROD potrebuje samostatnú kontrolu a nasadenie.
- Pri bezpečnej zmene e-mailu môže Supabase poslať **dve potvrdenia** – na pôvodnú aj novú adresu. UI na TEST vysvetľuje, že je potrebné potvrdiť oba odkazy. Neoznačovať tento bezpečnostný proces za chybnú duplicitnú notifikáciu.
- **SMS už sú implementované a reálne otestované v TEST** pre `new_request`, `approved`, `paid`, `cancelled`; BulkGate doručenie potvrdili používateľské mobilné testy 12. 10. 2026 (4/4). SMS zostávajú voliteľné a nezávislé od e-mailov. `live` je v zdrojovom kóde povolené iba pre TEST projekt a čísla v `SMS_ALLOWED_NUMBERS`; aktuálny administrátorský režim po testoch má byť `dry_run`. Detaily sú v kapitole 21.

Pred spustením overiť Resend sender/doménu, SPF/DKIM/DMARC, presmerovania v Auth, šablóny, doručiteľnosť a skutočne funkčné kontaktné schránky. Žiadny úspešný lokálny alebo CI test tieto externé nastavenia nepotvrdzuje automaticky.

## 10. Poloha, mapa a súkromné údaje o vyzdvihnutí

Autoritatívnym miestom ponuky je profilová alebo vlastná adresa vyzdvihnutia. Súradnice sa získavajú geokódovaním, rezervácia si ukladá ich snapshot. Verejná mapa ukazuje iba **približnú polohu**, nie presnú adresu; presné údaje pre odovzdanie sa oprávneným stranám odomknú po zaplatení.

Východisková mapa bola v októbri upravená na **českú lokalitu** (nie Bratislavu). Opravy automatického dopĺňania a filtrovania adries na TEST boli nasadené a overené 10. 10. (commity `caa842c`, `5f8caee`). Historicky bol fallback Photon a primárny Nominatim. V BOD 02 z 20. 10. 2026 bola pripravená ich náhrada Geoapify EU; skutočné správanie TEST sa potvrdí až po konfigurácii serverového kľúča a nasadení oboch Edge Functions. Pravidlá povolených pôvodov požiadaviek/User-Agent zostávajú oddelené medzi `.eu` a `.com`.

**Etapa 3 (pripravená na TEST deploy):** polohu zariadenia žiadať až po výslovnom kliknutí používateľa na hľadanie v okolí; ani platné predošlé browser povolenie nespúšťa žiadosť pri načítaní stránky. Súradnice sa neukladajú do URL, `localStorage` ani profilu. Odovzdajú sa jednorazovo v rámci tej istej browser karty pomocou `sessionStorage` (platnosť maximálne 120 s), na stránke výsledkov sa z neho okamžite odstránia a zostanú len v pamäti zobrazenej stránky. Po refreshi sa musí vyžiadať nová explicitná akcia; bez povolenia funguje manuálne vyhľadávanie. Live TEST overenie ešte vykonať po zlúčení PR.

## 11. Prevádzkovateľ, kontakty a právne texty

V zdrojových právnych dokumentoch a na stránke Kontakt sú uvedené tieto údaje:

- **EBBI s. r. o.**, Rybničná 11, 831 07 Bratislava, Slovenská republika; IČO **46 306 374**.
- Všeobecný kontakt: **`rentulo@rentulo.com`**.
- Ochrana osobných údajov: **`policy@rentulo.com`**.
- V1: trh **Česká republika**, iba **nepodnikajúce súkromné osoby**; podnikateľské účty až v ďalšej verzii.

`obchodni-podminky.html` a `ochrana-osobnich-udaju.html` boli aktualizované pre Stripe, PIN a refundy; preklady sú v CZ/SK/EN/DE/PL. **Text v kóde nie je potvrdením, že schránky už boli fyzicky zriadené a otestované.** Ochrana osobných údajov sama uvádza, že účinnosť V1 a niektoré retenčné/dodávateľské posúdenia sa musia finalizovať pred verejným spustením. Finálnu právnu kontrolu, dane/DPH a skutočné kontakty overiť pred otvorením PROD, nie prepisovať podľa neaktuálnej augustovej úlohy „ešte doplniť firmu“.


## 12. BOD 8 – Doména TEST `rentulo.eu` a budúca PROD `rentulo.com`

**Stav k 10. 10. 2026.** Toto je schválený **plán prípravy**, nie povolenie spustiť produkciu. Produkčnú vetvu, DNS, Vercel PROD, Supabase PROD, produkčné platby ani indexovanie teraz nemeníme. Akýkoľvek vykonávací krok nižšie potrebuje samostatný výslovný súhlas pri ostrom spustení.

### 12.1 Pevné oddelenie prostredí

| Oblasť | TEST (aktuálne používané) | PROD (pripravené, neverejné) |
| --- | --- | --- |
| Doména | `https://rentulo.eu` | `https://rentulo.com` |
| Vercel projekt | `rentulo` | `rentulo-prod` |
| GitHub vetva | `main` | `production` |
| Supabase projekt | `vspposovhdgvbeukoivh` | `tfvgxrdjrpicgtvovehl` |
| Build konfigurácia | `RENTULO_DEPLOY_TARGET=test` | `RENTULO_DEPLOY_TARGET=prod` |
| Supabase Auth | samostatné TEST nastavenie | samostatné PROD nastavenie – preveriť pred štartom |
| Dostupnosť/indexovanie | TEST funguje; `noindex` | neaktivovať pre verejnosť; `noindex` do osobitného schválenia |

`js/supabase-config.js` blokuje zámenu TEST klienta na `.com` a PROD klienta na `.eu`. Build cez `scripts/build-site.mjs` vyžaduje pri PROD nastavenia jeho vlastného Supabase a odmieta nesprávny projekt alebo TEST publishable key. `vercel.json` používa CSP osobitne pre `.eu` a `.com` a zatiaľ nastavuje `X-Robots-Tag: noindex` pre obe domény aj preview.

**Dôležité:** `rentulo.eu` zostáva TEST aj po budúcom spustení `rentulo.com`, pokiaľ výslovne nerozhodneme o jeho presunutí/ukončení. **Nesmie sa teraz ani automaticky pri štarte presmerovať `.eu` → `.com`**, pretože by to miešalo TEST a PROD. Prípadné neskoršie presmerovanie je samostatný schválený projekt po vyriešení testovacej domény.

### 12.2 Čo už bolo vykonané a overené – nepreverovať stále dokola

- **Historický snapshot k 10. 10. 2026:** GitHub `main` `5f8caee`, testy **332/332**, CI úspešné; vetva `production` pri tomto audite zostala `a79d3bb`. Tento údaj nie je aktuálnym stavom vetvy `main`.
- TEST `rentulo.eu`: HTTP 200; bezpečnostné hlavičky vrátane CSP a HTTPS/HSTS; `X-Robots-Tag: noindex`; TEST sitemap vracia 404.
- Supabase TEST: `Authentication → URL Configuration`: Site URL `https://rentulo.eu`; jediný povolený recovery redirect `https://rentulo.eu/obnova-hesla.html`. Stará adresa `rentulo-seven.vercel.app/obnova-hesla.html` bola 10. 10. 2026 odstránená.
- Supabase TEST: po doménových zmenách boli aktualizované funkcie `address-suggestions`, `geocode-pickup`, `send-reservation-email` a `send-overdue-owner-debt-reminders`. Následná oprava `address-suggestions` sa nasadila a reálne otestovala 10. 10. 2026.
- Na TEST po aktualizácii prešiel reálny test doručenia rezervačného e-mailu a odkazu na `rentulo.eu`; autovyplnenie a filtrovanie adries bolo otestované v prehliadači.
- Vercel `rentulo-prod`: pri audite potvrdená väzba na `production` a **Vercel Authentication → All Deployments**. Ochranu pred verejným spustením nevypínať.
- TEST a PROD majú odlišné Supabase projektové identifikátory v kóde; domény, geokódovací User-Agent a e-mailové odkazy sú na tieto prostredia viazané.

**Historické overenie zdrojov (12. 10. 2026, pred BOD 13):** GitHub `main` `8ef44e2`, CI [#391](https://github.com/EBBI-SK/rentulo/actions/runs/38156414667) **success**, automatické testy **367/367**, úspešný TEST build a Deno typecheck. **Aktuálnejší snapshot BOD 13:** `main` `fc69cc0`, projektové CI **#393 úspešné, 375/375 testov** a štyri reálne doručené SMS v TEST. Tieto údaje aktualizujú iba informácie o **TEST/kóde/CI**, nie vyššie dátumovo označené kontroly PROD/Vercel/Supabase dashboardov.

Úspešný GitHub/Vercel status **nedokazuje**, že PROD URL, skryté Supabase secrets, produkčné DNS či Stripe/Resend nastavenia už boli end-to-end overené. Tieto body zostávajú pre okamih produkčnej prípravy.

### 12.3 Príprava pred ostrým spustením – zatiaľ iba kontrolný zoznam

1. Určiť dátum spustenia, osobu schvaľujúcu zmeny, čas údržby, komunikáciu používateľom a plán návratu; vykonať bezpečnostnú, právnu a platobnú kontrolu.
2. Porovnať `main` s `production`, určiť **presný odskúšaný commit** pre vydanie a pripraviť riadené povýšenie do `production`. Nemergovať/pushovať do `production` len na základe tejto dokumentácie.
3. Skontrolovať vo Vercel `rentulo-prod` priradenie vetvy `production`, environment variables `RENTULO_DEPLOY_TARGET=prod`, `RENTULO_SUPABASE_URL` a `RENTULO_SUPABASE_PUBLISHABLE_KEY`; všetky hodnoty musia zodpovedať **PROD Supabase**, nie TEST. Pri maskovaných tajných hodnotách preveriť správnosť bezpečným servisným postupom; hodnoty nikdy neposielať do chatu, commitov ani ZIP.
4. Skontrolovať **Supabase PROD**: databázu/migrácie, RLS, Auth Site URL `https://rentulo.com`, presne potrebné Redirect URLs (minimálne `https://rentulo.com/obnova-hesla.html`), poskytovateľov OAuth (ak sa používajú), e-mailové šablóny a príslušné Edge Functions vrátane ich JWT nastavení. Neprenášať TEST používateľov/rezervácie ani secret hodnoty bez schváleného migračného plánu.
5. Skontrolovať serverové `SITE_URL`/návratové URL pre produkčné Stripe Checkout, Stripe Connect (refresh/return), účtovné úhrady, rezervácie a notifikácie; zabezpečiť výhradne `https://rentulo.com`. Osobitne preveriť webhooky, Connect, refundy, testovacie platobné obchádzky a bezpečné produkčné platby.
6. V Resend preveriť vlastníctvo produkčnej e-mailovej domény, odosielateľa, DNS SPF/DKIM/DMARC, odpovede a kontaktné schránky. Na TEST sa používal `noreply@rentulo.eu`; adresu PROD odosielateľa **nepovažovať za pripravenú bez kontroly**. Produkčné SMS (BulkGate, ochrana telefónov a právne súhlasy) vyžadujú osobitnú STOP/GO kontrolu, nie len prekopírovanie TEST nastavení.
7. Preveriť vlastníctvo/DNS `rentulo.com`, `www.rentulo.com`, požadované Vercel DNS záznamy, certifikát TLS a prípadné presmerovanie `www` → primárna doména. **Pred schváleným štartom nemeniť živé DNS ani nenastaviť `.com` ako verejný TEST web.**

### 12.4 Postup v deň ostrého spustenia – iba po novom súhlase

1. **STOP/GO brána:** potvrdiť hotové kontroly vyššie, aktuálny `main`, úspešné CI, stabilné TEST a pripravený rollback. Ak niektorá kritická kontrola zlyhá, spustenie sa odkladá.
2. Pod ochranou **All Deployments** nasadiť schválený commit do `production` a potvrdiť, že PROD používa len Supabase PROD a produkčné serverové secrets. TEST `main`/`rentulo.eu` ponechať bez zásahu.
3. Nastaviť/overiť v samostatnom Supabase PROD Auth, Edge Functions, `SITE_URL` a produkčné integračné návraty. Overiť kľúčové procesy bez vystavenia neotestovaného webu verejnosti.
4. Priradiť `rentulo.com` (a podľa rozhodnutia `www`) výhradne k Vercel `rentulo-prod`; upraviť DNS podľa **aktuálnych** pokynov Vercelu; počkať na platný HTTPS certifikát. Nerobiť doménové presmerovanie `.eu` → `.com`.
5. Overiť na chránenej PROD URL pripravenosť: správny Supabase PROD, prihlasovanie, obnova hesla, ponuky/rezervácie, kontakty, e-mailové a platobné návraty, API/CSP a mobil. Až po výslovnom potvrdení otvoriť **produkčnú vlastnú doménu** pre verejnosť; preview a ostatné deploymenty musia zostať chránené.
6. Po otvorení preveriť HTTP/HTTPS, canonical, `www`/bez `www`, prihlásenie, obnovu hesla, rezervačné e-maily, mapu, platby/refundy a logy. `X-Robots-Tag: noindex` na TEST a na preview musí zostať. Indexovanie PROD a produkčná sitemap sa povolia iba samostatným SEO rozhodnutím a kontrolou – nie automaticky týmto krokom.
7. Zaznamenať čas spustenia, commit na `production`, zmenené nastavenia, výsledok smoke testov a schválenie. Monitorovať chyby, bezpečnosť, Stripe a odosielanie e-mailov.

### 12.5 Núdzový návrat (rollback)

- Pri kritickej chybe **najprv znovu zapnúť `All Deployments`** alebo inak bezpečne uzavrieť verejný PROD prístup; neodhaľovať TEST ako náhradu produkcie.
- Vrátiť iba PROD na posledný overený deployment/commit, prípadne obnoviť pôvodné PROD nastavenie podľa pripraveného záznamu. DNS vracať len cielene a po kontrole certifikátov a dopadov DNS cache/TTL.
- Zachovať TEST `rentulo.eu` a samostatný Supabase TEST bez zmien. Nikdy neprepnúť PROD na TEST databázu, neposlať používateľov na nesprávnu doménu a nepoužiť TEST kľúče.
- Po oprave znova absolvovať STOP/GO schvaľovací postup; nespúšťať automatické opätovné otvorenie.

### 12.6 Stav bodu 8

**Príprava TEST a plán domény: dokončené. Verejná aktivácia PROD: vedome odložená na ostré spustenie.** Nie je potrebné opakovať potvrdené TEST kontroly; zostávajúce PROD body sú úlohy pre budúci schválený release, nie okamžité pokyny na zmenu.

## 13. Bezpečnostný stav k 18. 8. 2026

### GitHub CodeQL

Po zapnutí CodeQL bolo identifikovaných 6 nálezov.

Po opravách:

```text
0 Open
6 Closed
```

Riešili sa najmä:

- ukladanie presnej GPS polohy do browser storage,
- klientské presmerovania,
- XSS/taint upozornenia súvisiace s presmerovaniami.

### Secret scanning

Pri kontrole nebol otvorený žiadny secret-scanning alert.

### Dependabot

Pri kontrole nebol otvorený žiadny Dependabot vulnerability alert.

### Dôležité

Toto je snapshot bezpečnostného stavu k uvedenému dátumu, nie trvalá garancia.

CodeQL, Secret scanning a Dependabot treba ponechať zapnuté a znovu skontrolovať pred produkčným spustením.

## 14. Vercel, bezpečnostné hlavičky a SEO

`vercel.json` obsahuje `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`, `Strict-Transport-Security` a `Cross-Origin-Opener-Policy`. CSP je **odlišná podľa hosta** (`.eu`, `.com`, preview) a obmedzuje príslušný Supabase projekt. Pred pridaním externej služby overiť CSP, nepridávať široké výnimky bez potreby.

Build `scripts/build-site.mjs` generuje metadáta `title`, `description`, canonical a Open Graph pre verejné stránky, súkromné stránky označuje `noindex` a vkladá runtime jazykové SEO. `api/offer-page.mjs` vytvára serverom čitateľný detail aktívnej ponuky na `/nabidka/:id`. `api/sitemap.mjs` generuje produkčnú sitemap aktívnych verejných ponúk cez `/sitemap.xml`; **na TEST vracia 404**.

Podľa aktuálneho `vercel.json` má TEST, PROD pred spustením aj preview `X-Robots-Tag: noindex`. Robots prístup môže zostať technicky otvorený, aby robot videl hlavičku `noindex`. **Indexovanie PROD neaktivovať pri obyčajnom pushe ani len preto, že existuje sitemap**; samostatné povolenie je súčasť schváleného release.

## 15. Vývoj, lokálne testovanie a nasadzovanie

Schválený postup pre **TEST vetvu `main`**:

1. Skontrolovať aktuálny GitHub `main`, posledné commity, našu projektovú históriu a existujúce súbory; neopakovať hotové zmeny.
2. Pripraviť návrh a získať súhlas. Vytvoriť **jeden ZIP iba s odsúhlasenými upravenými súbormi**, so zachovanými relatívnymi cestami.
3. Rozbaliť ZIP priamo do existujúceho koreňa projektu vo VS Code. Pred testom skontrolovať, že neboli zmenené iné súbory.
4. Spustiť `npm test` a podľa rozsahu tiež `npm run build` (predvolený **TEST** build); pri JS možno navyše `node --check <subor.js>`.
5. Skontrolovať diff; vykonať `git add` iba dohodnutých súborov, `git commit`, `git push origin main`.
6. Overiť nový GitHub Actions run a **TEST** Vercel deployment na `rentulo.eu`. Pri funkčnom zásahu tiež smoke test v prehliadači, konzole a podľa potreby mobile.

Pre aktualizáciu **BODU 12 – P1-4 (prechod dokumentácie na cron-job.org a odstránenie GitHub harmonogramu)** sú lokálne PowerShell príkazy (až po vložení schváleného päťsúborového ZIP-u, iba na vetve `main`):

```powershell
cd C:\Users\ebbi\Desktop\pujc-naradi
git status
git branch --show-current
git diff -- README.md HANDOVER.md docs/BOD12_P1-4_monitoring_TEST.md .github/workflows/rentulo-test-notification-monitor.yml tests/monitor-reservation-notifications.test.js
npm test
npm run build
git diff --check
git add README.md HANDOVER.md docs/BOD12_P1-4_monitoring_TEST.md .github/workflows/rentulo-test-notification-monitor.yml tests/monitor-reservation-notifications.test.js
git diff --cached --check
git diff --cached --stat
git commit -m "docs: switch TEST notification monitor schedule to cron-job.org"
git push origin main
```

> Príkazy na commit/push použiť **iba keď testy a diff prejdú** a iba na správnej vetve `main`. Pred ich použitím musí byť `git status` bez nesúvisiacich zmien. Commit ani push do `production` sem nepatrí.

GitHub workflow `.github/workflows/ci.yml` sleduje push a pull requesty na `main` aj `production`; používa **Node 22** a **Deno 2**. Kontroluje: `npm ci`, JS syntax (`node --check`), JSON, konfliktné značky, zakázané sledované tajné/záložné súbory, `npm audit --audit-level=high`, `npm test`, **TEST build** a `deno check` všetkých Edge Functions. Posledný doložený projektový beh **#402** k `19c3a2e` mal **423/423 testov**; nový dokumentačný commit potrebuje vlastné CI. CI úspech nenahrádza živý end-to-end audit Supabase, Stripe ani PROD.

PROD deploy má samostatnú vetvu `production` a vlastné prostredie; neriadiť ho automaticky vývojovým workflow. Postup aktivácie je **výlučne kapitola 12** a potrebuje nový súhlas.

## 16. Jazyková podpora

V `js/i18n.js` sú `SUPPORTED_LANGUAGES = ["cs", "sk", "en", "de", "pl"]`; základ je `cs`. Jazyk možno meniť v rozhraní/nastaveniach. **Všetky používateľsky viditeľné zmeny kontrolovať v CZ, SK, EN, DE a PL**, vrátane statických textov, validačných chýb, PIN procesu, rezervačných a refund e-mailov.

`supabase/auth-email-templates/` obsahuje päťjazyčné šablóny registrácie, obnovy hesla a zmeny e-mailu. Ich verzovanie v Gite **nezmení automaticky obsah Supabase Auth dashboardu**. Pri zmene e-mailu rešpektovať bezpečné dvojité potvrdenie, nie ho zjednodušovať bez samostatnej analýzy.

## 17. Legacy a prípravné súbory

`js/api.js` je starší prípravný súbor, nie hlavná API vrstva aktuálnej aplikácie. Pred jeho úpravou/odstránením overiť skutočné referencie; nemažte ho iba podľa názvu.

Historické migrácie v `supabase/migrations-archive/`, lokálne zálohy, staré testovacie artefakty a súbor `test_payment_users` sa **nemajú bez samostatného auditu a schválenia hromadne mazať**. Naopak, stará klientská fake-payment RPC už má v aktívnych migráciách explicitné odstránenie (kapitola 7).

## 18. Aktuálny plán pokračovania – október 2026

**Nahrádza historický augustový plán** „najprv doplniť CI, potom zaviesť testy, potom vybrať platobnú bránu“. Tieto položky boli medzičasom implementované.

Dokončené alebo pripravené na TEST podľa projektovej histórie a GitHub commitov:

- **BOD 1** – storno/refund zaplatených rezervácií; **BOD 2** – Stripe transfer retry.
- **BOD 3** – kontrola nastavení; **BOD 4** – výsledky vyhľadávania; **BOD 5** – „Jak to funguje“.
- **BOD 6** – obchodné podmienky a ochrana osobných údajov v piatich jazykoch (produkčná právna validácia stále otvorená).
- **BOD 7** – SEO vrátane dynamického detailu ponuky a sitemap (indexovanie PROD sa neaktivovalo).
- **BOD 8** – TEST/PROD konfigurácia a **plán budúceho spustenia**; samotné spustenie PROD vedome odložené.
- **BOD 9** – päť jazykov, jazykové/UI opravy a Supabase Auth e-mailové šablóny v TEST.
- **BOD 10** – bezpečnostné a platobné release spevnenie, vrátane odstránenia fake-payment RPC, kontroly dátumu prevzatia, PIN a posledných opráv. Referencia: `8ef44e2`, 367/367, CI #391 úspešné.
- **BOD 11** – aktualizácia `README.md` a `HANDOVER.md` dokončená na TEST v skoršom kroku; pôvodný snapshot `8ef44e2` je historický.
- **BOD 12** – priebežný záverečný audit; **P1-4 (monitoring notifikácií)** aktivovaný a overený v TEST 13. 10. 2026, plánovanie cez **cron-job.org**. Ďalšie časti auditu sa riešia osobitne; TEST neznamená povolenie spustiť PROD.
- **BOD 13** – spoločný systém rezervačných e-mailov a voliteľných SMS implementovaný, nasadený a **4/4 reálnych SMS udalostí overených v TEST** (`fc69cc0` bol pôvodný implementačný commit; po ďalších opravách aktuálny snapshot `19c3a2e`, CI #402, 423/423). Po testoch administratívne obnovené `dry_run`; nejde o povolenie PROD.

Nasledujúce práce sa navrhujú a schvaľujú **samostatne**; najbližšie je kontrola **24-hodinovej expirácie rezervácií** v BODE 12 bez opakovania hotových testov, potom predprodukčný checklist podľa kapitoly 19. **No-show** zostáva odložené. Nezavádzať ďalšiu funkciu len preto, že je spomenutá v dokumentácii.

## 19. Otvorené kontroly pred verejným spustením

Toto je **checklist budúceho release, nie pokyn na okamžité vykonanie**. Postup, domény a rollback podrobnejšie v kapitole 12.

1. **STOP/GO a revízia zdrojov:** presný schválený release commit, úspešné CI, porovnanie `main`/`production`, záloha a rollback plán; nezávislé potvrdenie otvorenia PROD.
2. **Supabase PROD:** čistá databáza, kontrola/aplikovanie potrebných migrácií, RLS/RPC, oddelené Auth a Storage, Edge Functions, cron joby/Vault, logy. **Žiadne kopírovanie TEST používateľov/rezervácií bez samostatného rozhodnutia.**
3. **Produkčné platby:** Stripe **live** účty a kľúče, podpis webhooku, Connect onboarding, rozdelenie poplatkov, potvrdenie PIN, transfer/payout, retry, refundy, dlhy prenajímateľa a idempotencia; overenie odstránenia fake-payment cesty v cieľovom PROD.
4. **E-maily a Auth:** produkčné `SITE_URL`, návratové URL, bezpečné recovery/change-email toky, päť jazykov v Auth šablónach, Resend odosielateľ, DNS SPF/DKIM/DMARC a reálne doručenie správ.
5. **SMS/BulkGate PROD:** osobitne schválený režim, integrácia s produkčným Supabase, nezávislé secrets a API limity, bezpečný opt-in a overenie vlastníctva čísla, ochrana osobných údajov, cena/rozpočet, manuálne riešenie nejasných provider odpovedí, monitoring a reálne end-to-end doručenie; momentálne má kód `live` blokované mimo TEST. **TEST-only cron-job.org monitoring sa nepresúva do PROD** bez novej architektúry a súhlasu.
6. **Právo a kontakty:** potvrdená platnosť/účinnosť V1 podmienok a GDPR, fungujúce `rentulo@rentulo.com` a `policy@rentulo.com`, právna a daňová kontrola vrátane používania Stripe v ČR cez EBBI s. r. o.
7. **Web/doména:** `rentulo.com`/`www`, TLS, Vercel PROD ochrana až do schválenia, správna CSP, SEO canonical a indexovanie PROD iba po osobitnom rozhodnutí. TEST `rentulo.eu` nepresmerovávať.
8. **Bezpečnosť a funkčné smoke testy:** aktuálne CodeQL/secret scanning/Dependabot, mobil a desktop, Console/Network, 4xx/5xx, Auth, ponuky, rezervácie, platby/refundy, PIN v správny aj nesprávny deň, mapa a e-maily.
9. **Uzatvorenie:** zaznamenať výsledky, kto spustenie schválil, dátum/čas, produkčný commit, zmenené nastavenia a monitoring. Pri chybe použiť pripravený rollback namiesto presunu používateľov do TEST.

## 20. Pravidlá ďalších zásahov do Rentula

1. **pred každým krokom** skontrolovať **históriu predchádzajúcich prác**, posledné rozhodnutia a **aktuálny GitHub `main`**, potom dodaný ZIP a existujúce súbory/migrácie; zistiť, čo už bolo vykonané, a **hotové kroky neopakovať**.
2. **Potom** konkrétny návrh s presným zoznamom dotknutých súborov; **nič neupravovať pred súhlasom**.
3. Po súhlase odovzdať **jeden ZIP len so schválenými zmenami**, zachovať relatívne cesty, nepremiestňovať projekt a nezasahovať do iných funkcií.
4. Pri stránkovej zmene preveriť príslušné HTML/JS/CSS/i18n spolu; nevytvárať polovičné UI opravy.
5. Po vložení ZIP-u vykonať testy, diff, `git status`; následne presné príkazy `git add`, `git commit`, `git push origin main` a overiť konkrétny GitHub CI run/TEST nasadenie.
6. Pri SQL pred zásahom preveriť **existujúce** migrácie aj živý stav **správneho** Supabase projektu; nekopírovať SQL do druhého prostredia automaticky.
7. **PROD `production`, Vercel `rentulo-prod`, Supabase PROD, Stripe live, DNS, doménové presmerovania a indexovanie sa nikdy nemenia bez osobitného výslovného súhlasu.**
8. Zaznamenávať overené skutočnosti a dátumové snapshoty oddelene od plánov a domnienok; nemenovať úspešné CI „produkčne otestované“.

## 21. BOD 13 – zjednotené rezervačné notifikácie (TEST)

**Snapshot: 12. 10. 2026.** Zdrojový commit `fc69cc0` implementoval spoločnú frontu rezervácií s e-mailovým transportom cez Resend a SMS cez BulkGate. **Implementácia a štyri reálne SMS udalosti boli otestované v Supabase TEST**, nie v PROD. Táto kapitola dokumentuje už vykonané testy, nie pokyny na zapnutie SMS pre verejnosť.

### 21.1 Architektúra a udalosti

- Migrácia `20261012100000_unify_reservation_notification_outbox.sql` vytvára tabuľku `reservation_notification_deliveries` (RLS a prístup iba pre server), predvolený profilový opt-in `sms_notifications=false`, databázové triggery, unikátny kľúč na zabránenie duplicitných udalostí a bezpečné RPC na claim/dokončenie úloh.
- `process-reservation-notifications` sa spúšťa cron jobom `rentulo-process-reservation-notifications-every-minute` (`* * * * *`) cez Vault tajomstvo; pri odosielaní oddelene vyhodnocuje e-mail/SMS. E-mailové správy naďalej doručuje interná `send-reservation-email` s podporou idempotencie v Resend; notifikačná fronta má vlastné stavy a maximálne 5 pokusov pri vhodných chybách.
- SMS sa posielajú na udalosť **`new_request` (prenajímateľ), `approved` (nájomca), `paid` (prenajímateľ), `cancelled` (druhá strana)**. Krátky text obsahuje číslo rezervácie, **nie PIN, adresy ani telefónne čísla**. Pri `paid_cancelled` vznikajú finančné e-maily obom stranám a voliteľná SMS protistrane až po úspešnom refunde a finančnom uzavretí; tento špeciálny scenár **nebol súčasťou štyroch reálnych SMS skúšok**.
- Používateľ musí mať zapnuté SMS upozornenia a platné mobilné číslo v profile; e-maily fungujú nezávisle. Nie je zavedené nezávislé SMS/OTP overenie vlastníctva profilového čísla – **pred povolením PROD treba osobitne vyriešiť**.
- V `SMS_SEND_MODE` sú režimy `disabled` (predvolené), `dry_run` (`simulated` bez odoslania), `live`. Aktuálny zdrojový kód **odmieta `live` mimo presnej URL Supabase TEST** `https://vspposovhdgvbeukoivh.supabase.co` a na TEST vyžaduje `SMS_ALLOWED_NUMBERS`; zmenou samotného PROD secretu `live` nemožno SMS povoliť.
- Pri nejednoznačnom timeoute alebo odpovedi BulkGate worker používa `dead`/manuálnu kontrolu namiesto nebezpečného automatického opakovania SMS, ktorú mohol provider už prijať. Známe dočasné limity majú samostatné retry pravidlá. Úspešný provider stav `sent` znamená akceptáciu poskytovateľom; fyzické prijatie v testoch bolo osobitne potvrdené na mobile.

### 21.2 Overenie skutočného doručenia v TEST

| Rezervácia | Udalosť | E-mail | SMS | Overenie |
| --- | --- | --- | --- | --- |
| `R-000019` | `new_request` | `sent` | `sent` | prijaté na mobile |
| `R-000019` | `approved` | `sent` | `sent` | prijaté na mobile |
| `R-000019` | `paid` | `sent` | `sent` | prijaté na mobile, Stripe Sandbox platba |
| `R-000020` | `cancelled` | `sent` | `sent` | prijaté na mobile, bez refundu |
| `R-000020` | `new_request` | `sent` | `simulated` | kontrolovaný test `dry_run` |

Všetky štyri **skutočne odoslané** SMS mali v SQL `attempt_count=1`, nenulové `provider_message_id` a `last_error=null`. Používateľ potvrdil prijatie všetkých štyroch SMS na telefóne. V BulkGate TEST aplikácii `Rentulo-TEST` (Simple API) bol po skúškach stav **4/5 denného limitu (80 %) a 6,85 zostávajúcich kreditov**. Ide o **historický stav v čase testu**, nie trvalé nastavenie kreditu. E-maily boli v spoločnom logu pri týchto udalostiach `sent`; nešlo o test prijatia všetkých e-mailov do všetkých externých schránok.

### 21.3 TEST konfigurácia, diagnostika a ďalšie kroky

- Secrets používané na TEST: `BULKGATE_APPLICATION_ID`, `BULKGATE_APPLICATION_TOKEN`, `SMS_ALLOWED_NUMBERS` a `SMS_SEND_MODE`. **Hodnoty ani testovacie telefónne čísla nesmú byť v Gite, ZIP-e, screenshots alebo dokumentácii.** Worker využíva aj Vault položky `rentulo_project_url` a `rentulo_notification_cron_secret`.
- Na štyri reálne skúšky sa `SMS_SEND_MODE` kontrolovane prepínal na `live`. Po poslednej SMS ho administrátor **podľa vykonaného postupu vrátil na `dry_run`** a Supabase potvrdil zápis. Maskovaná hodnota secretu nie je zo screenshotu priamo čitateľná; pred ďalšími skúškami stav znova overiť správnym servisným postupom.
- Bezpečná čítacia diagnostika v **SQL Editor Supabase TEST** (bez PIN-u, telefónov a tokenov):

```sql
SELECT r.reservation_number, d.channel, d.event_type, d.status,
       d.attempt_count, d.provider_message_id, d.last_error, d.sent_at
FROM public.reservation_notification_deliveries AS d
JOIN public.reservations AS r ON r.id = d.reservation_id
WHERE r.reservation_number IN ('R-000019', 'R-000020')
ORDER BY d.created_at;
```

**Ostáva pred PROD:** samostatne schválená architektúra produkčných SMS, zmena zámernej TEST-only zábrany po bezpečnostnom audite, oddelený BulkGate účet/kľúče a rozpočet/limity, overenie vlastníctva telefónov a súhlasov, GDPR a retenčné pravidlá, monitoring `queued/retry/dead`, doručiteľnosť, sender, podmienky nákladov a end-to-end skúšky. **Žiadny zásah do `production`, Supabase PROD, Stripe live, DNS ani `rentulo.com` nie je týmto dokumentom povolený.**


## 22. BOD 12 – P1-4: nezávislý monitoring notifikácií (TEST)

**Stav 13. 10. 2026:** monitoring bol podľa projektového prevádzkového testu aktivovaný cez **cron-job.org** a na základe rozhodnutia ostáva zapnutý aj počas prestávky. Ide o nezávislú periodickú kontrolu notifikačného systému **Supabase TEST** (`vspposovhdgvbeukoivh`), **nie** o alternatívny worker na posielanie rezervácií. GitHub plánovaný monitorovací workflow sa v tejto úprave mení na **manuálnu diagnostiku**. Žiadne nastavenie externého cron-job.org, Supabase ani PROD sa samotným ZIP-om nemení.

### 22.1 Tri oddelené procesy

1. **Rezervačný worker:** Supabase `pg_cron` každú minútu volá `process-reservation-notifications`. Spracuje e-maily/SMS a po úspešnom dokončení vrátane ACK zapisuje serverový heartbeat do `reservation_notification_worker_health`. Aj zdravý prázdny beh obnovuje `last_success_at`.
2. **Nezávislá kontrola:** externý **cron-job.org** odošle cez HTTPS `POST` do `https://vspposovhdgvbeukoivh.supabase.co/functions/v1/monitor-reservation-notifications` s JSON telom `{}`, `Content-Type: application/json` a tajnou hlavičkou `x-rentulo-monitor-secret`. Tajomstvo (minimálne 64 znakov) musí zodpovedať serverovému `RENTULO_MONITOR_SECRET`; **nikdy ho neuvádzať do dokumentov/ZIP-u/Gitu**. Periodicita a úspešnosť sa spravujú v cron-job.org (pôvodný návrh P1-4 počítal s kontrolou približne každých päť minút; skutočné nastavenie treba overiť tam).
3. **Alarmy:** monitor použije iba serverové RPC, tabuľku `reservation_notification_monitor_alerts` a Resend. Alerty sú smerované na **`support@rentulo.com`**. `generation`, `claim_token`, lease a stabilný Resend idempotency key bránia duplicitám; pri neúspechu sa používa retry. `sent_at` v databáze znamená akceptované odoslanie, nie potvrdenie doručenia do schránky.

Edge Function je výslovne **TEST-only**: nesprávna URL projektu je odmietnutá (`403`), chýbajúci/nesprávny token (`401`), nesprávna metóda (`405`). Neuchovávať token v URL, query stringu, public workflow ani logoch. GitHub workflow `.github/workflows/rentulo-test-notification-monitor.yml` **nemá `schedule`**, používa len `workflow_dispatch` na `main` s GitHub secretom `RENTULO_TEST_MONITOR_SECRET` pre ručnú diagnostiku. Premenná `RENTULO_TEST_MONITOR_ENABLED` sa po tejto aktualizácii na spúšťanie nepoužíva.

### 22.2 Čo monitor hlási

- notifikácie so stavom `dead` (neúspešné SMS s nejasnou odpoveďou providera **neposielať automaticky znova**);
- `queued`/`retry` po termíne `next_attempt_at` o viac ako 10 minút;
- `sending` po skončení lease o viac ako 3 minúty;
- **worker stale:** chýba úspešný heartbeat dlhšie ako 8 minút.

Alarm rieši jednu generáciu incidentu jedným mailom; po vyriešení a novom výskyte sa môže vytvoriť nové upozornenie. Úplná nedostupnosť Supabase/Edge Gateway môže súčasne zablokovať samotný Resend alarm z Edge Function – preto sledovať **HTTP históriu/poruchy cron-job.org**, nie iba doručenú poštu. Prípadné upozornenia poskytovateľa externého cron služby sú samostatné od interných alarmov Rentula.

### 22.3 Výsledok doterajšej TEST kontroly

- GitHub `main` pred touto aktualizáciou `19c3a2e`, **CI #402, 423/423 testov**; posledné GitHub monitorovacie behy #4 a #5 boli **manuálne úspešné**, nejde o dôkaz priebežného behu cron-job.org.
- Supabase TEST `reservation_notification_worker_health.last_success_at` sa pri prevádzkovom overení aktualizoval (naposledy v doloženom SQL výstupe **2026-10-13 13:48:58 UTC**).
- Kontrolovaný alarm `qa-p1-4-alarm-20261013-01` mal SQL `sent_at=2026-10-13 14:10:18.774813+00`, `attempt_count=1` a `last_error=null`. To potvrdzuje záznam o odoslaní, **nie nezávisle overené doručenie** do e-mailovej schránky. V čase schválenia dokumentácie nebol predložený novší dôkaz z dashboardu cron-job.org.

### 22.4 Kontroly, bezpečné vypnutie a hranice zásahov

- **Bežná kontrola:** v cron-job.org overiť, že TEST job je `enabled` a volania dostávajú úspešnú HTTP odpoveď; v Supabase TEST čítať `last_success_at`, `reservation_notification_monitor_alerts.active`, `sent_at`, `last_error` a `next_attempt_at`. Nevyžadovať nové vytváranie alarmov, ak existujú dôkazy.
- **Neplánované spúšťanie GitHub Actions:** len ručne na `main` pri diagnostike; automatický GitHub harmonogram sa odstránil, takže nemajú bežať **dva nezávislé plánovače** toho istého monitoru.
- **Zastavenie iba monitora v prípade výslovného rozhodnutia:** vypnúť konkrétny job v **cron-job.org**; nevypínať databázový `rentulo-process-reservation-notifications-every-minute` ani iné pracovné crony. Aktuálne rozhodnutie je **ponechať monitor zapnutý**.
- **PROD:** tento monitor je pevne viazaný na TEST, má samostatné serverové tajomstvo a príjemcu. Pre PROD je potrebný nový návrh, oddelené secrets/účty, bezpečnostná revízia a výslovné schválenie. Nič neprenášať automaticky.

Podrobný operátorský postup a čítacie SQL: [docs/BOD12_P1-4_monitoring_TEST.md](docs/BOD12_P1-4_monitoring_TEST.md).

**BOD 03A (pripravený na nasadenie, zatiaľ nie aktívny):** interná evidencia incidentov, moderácia, blokovanie používateľov s auditom cez Supabase Owner SQL Editor. Postup a hranice: `docs/BOD03A_INCIDENTY_ADMIN_TEST.md`. `support@rentulo.com` začne dostávať TEST alarmy až po samostatnom redeployi monitorovacej Edge Function; nastavenia cron-job.org sú mimo Gitu. BOD 03B / finančné spory sa nemenia.
