# Rentulo – HANDOVER

**Servisná a odovzdávacia dokumentácia.** Pôvodný dokument vznikol 18. 8. 2026; priebežné aktualizácie zachytávajú doménový audit z 10. 10. 2026 a **aktuálny stav zdrojov k 12. 10. 2026** (referenčný `main` `8ef44e2`). Historické bezpečnostné výsledky a kontroly dashboardov sú výslovne označené dátumom. **Implementácia v Gite, úspešný TEST/CI a pripravenosť živého PROD sú tri odlišné veci.**

Tento dokument **nie je pokynom na spustenie produkcie**. Bez nového schválenia sa nemení vetva `production`, Vercel/Supabase PROD, Stripe live, domény, DNS ani indexovanie. [README.md](README.md) obsahuje stručný úvod; tu je technický stav, prevádzkové pravidlá a kontrolný zoznam pred spustením.

## 1. Aktuálny stav (snapshot k 12. 10. 2026)

Rentulo V1 je platforma na požičiavanie vecí **medzi súkromnými osobami v ČR**. Používateľské rozhranie má päť jazykov (CZ/SK/EN/DE/PL), predvolená je čeština. Prevádzkovateľ: **EBBI s. r. o.** Projekt zatiaľ funguje v TEST prostredí; verejné spustenie na `rentulo.com` nebolo odsúhlasené.

- GitHub: [`EBBI-SK/rentulo`](https://github.com/EBBI-SK/rentulo), `main` **`8ef44e2dd06548bae3df73e76811c588de529930`** (11. 10. 2026). Obsah poskytnutého projektového ZIP-u má rovnaký `main` a pôvodné dokumenty ako GitHub.
- GitHub Actions: [**Rentulo CI #391**](https://github.com/EBBI-SK/rentulo/actions/runs/38156414667) – **success**, `npm test` **367/367, fail 0**; prešiel aj TEST build a Deno typecheck všetkých Edge Functions.
- TEST: Vercel `rentulo`, vetva `main`, doména `https://rentulo.eu`, Supabase projekt `vspposovhdgvbeukoivh`, Stripe **test/sandbox**.
- PROD: Vercel `rentulo-prod`, vetva `production` (posledný zdokumentovaný a v projektovom ZIP-e prítomný commit `a79d3bb`), Supabase projekt `tfvgxrdjrpicgtvovehl`, plánovaná doména `https://rentulo.com`. **PROD neaktivovať a nemeniť.**
- Pri audite 10. 10. bola na Vercel PROD potvrdená ochrana **Authentication → All Deployments**. Ide o dátumovo obmedzené overenie; ochranu pred štartom skontrolovať znova, nikdy ju predčasne nevypnúť.
- TEST a prelaunch hosty majú `noindex`; podľa aktuálneho `vercel.json` je `X-Robots-Tag: noindex` aj pre `.com`, pokiaľ nebude osobitne schválená aktivácia indexovania.

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
                  +--> Resend (rezervačné e-maily)

mapa: OpenStreetMap; adresy: Nominatim + Photon
```

Frontend nemá bundler ani JS framework, **má však riadený Node.js build** `scripts/build-site.mjs`. Build vytvára `dist/` a vkladá konfiguráciu prostredia a SEO metadata. Vercel má oddelené hostové CSP pravidlá a serverless SEO endpointy. Stripe operácie sa vykonávajú cez dôveryhodný backend/webhook, nie priamou zmenou stavu rezervácie z prehliadača.

## 3. Dôležité priečinky

```text
.github/workflows/ci.yml    GitHub Actions
api/                        Vercel SEO API pre ponuky a sitemap
assets/                     logo a ostatné verejné statické súbory
css/                        spoločné a stránkové CSS
js/                         frontend, navigácia, Auth, rezervácie, PIN, i18n
scripts/                    build-site.mjs, SEO katalóg a runtime
supabase/auth-email-templates/  zdrojové šablóny Auth e-mailov
supabase/functions/         17 Edge Functions
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

Publishable key je určená na použitie v prehliadači; ochranu dát musia vynucovať **RLS, databázové oprávnenia a autorizované RPC/Edge Functions**. **`SUPABASE_SERVICE_ROLE_KEY` ani Stripe/Resend/PIN secrets nepatria do HTML, klientského JS, commitu ani odovzdávacieho ZIP-u.** Migrácie alebo serverové secrets sa buildom webu automaticky nenasadzujú.

## 5. Supabase Edge Functions

V `main` je **17 Edge Functions**. Zoznam je úplný pre referenčný commit; pred ďalším vývojom opäť preveriť priečinok `supabase/functions/`.

| Funkcia | Účel |
| --- | --- |
| `account-deactivation` | bezpečná deaktivácia účtu a kontrola finančných prekážok |
| `address-suggestions` | návrhy a filtrovanie adries podľa prostredia |
| `geocode-pickup` | geokódovanie vyzdvihnutia (Nominatim, Photon fallback) |
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
| `send-reservation-email` | jazykové e-maily, delivery log, ochrana proti duplicitám |
| `send-overdue-owner-debt-reminders` | upozornenia na dlhy po splatnosti |

Používané **názvy** serverových premenných (nie ich hodnoty): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PICKUP_PIN_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `SITE_URL`. Každá funkcia používa len relevantnú podmnožinu; skutočné povinné premenné overiť pri konkrétnom nasadení v jej kóde. Cron pracovníci majú navyše samostatné tajomstvá v Supabase Vault.

`send-reservation-email` a `send-overdue-owner-debt-reminders` odvodzujú bezpečný kanonický pôvod z identifikátora Supabase projektu (TEST `.eu`, PROD `.com`); pri nesúhlase explicitného `SITE_URL` odmietnu odoslanie. Stripe funkcie tiež vyžadujú správnu konfiguráciu návratových URL – **pred produkciou overiť konkrétne secrets a URLs samostatne**. Rezervačné e-maily sa zaznamenávajú do `reservation_email_deliveries`.

## 6. Databáza, migrácie a stav rezervácie

Autoritatívnou históriou SQL je `supabase/migrations/`; pred pridaním alebo aplikovaním SQL vždy skontrolovať najnovšie migrácie a skutočný stav **správneho** Supabase projektu. Súbory v Gite samy osebe nedokazujú ich aplikovanie v TEST alebo PROD.

- Tabuľky a pravidlá zahŕňajú ponuky, profily, rezervácie, platby, notifikácie, hodnotenia, doručenie e-mailov, Stripe webhook audit, refundy a dlhy prenajímateľov. Prístup chráni RLS a účelové RPC.
- Nemenné identifikačné čísla: ponuky `N-000001...`, rezervácie `R-000001...` (migrácia `20261009130000_add_offer_and_reservation_numbers.sql`). Ide o verejné referenčné čísla, nie náhradu interného UUID.
- Stavy: `pending` → `approved` → `paid` → `picked_up` → `returned`; existuje aj `rejected` a `cancelled`. Prechod na `paid` je viazaný na dôveryhodné potvrdenie Stripe; na `picked_up` na bezpečné potvrdenie PIN. Bežný používateľ nemôže tieto stavy ľubovoľne prepísať.
- Presné kontakty/miesto vyzdvihnutia sa sprístupnia príslušným stranám po zaplatení. Rezervácia ukladá snapshot vyzdvihnutia, aby neskoršia zmena profilu neupravila už uzavreté údaje.
- **Bežné storno** (nezaplatené `pending`/`approved` podľa roly) má hranicu **6 hodín pred** dohodnutým `start_date + pickup_time` v `Europe/Prague`. **Zaplatené storno** prechádza samostatným autorizovaným Stripe/refund procesom; nájomca má túto časovú hranicu tiež. Potvrdenie odovzdania PIN je od 11. 10. viazané na *kalendárny deň* prevzatia, nie na hodinu `pickup_time`.
- V1 používa minimum **100 CZK/deň** pre ponuku a platformový poplatok **max(10 % z ceny rezervácie, 50 CZK)**.

Najnovšie rozhodujúce migrácie:

- `2026100707*` – finančné dlhy prenajímateľov a ich úhrada; `202610071*` – blokovanie schvaľovania pri omeškanom dlhu, reminder cron a retry transferov.
- `20261008100000_guard_account_deactivation_financials.sql` – strážne pravidlá deaktivácie účtu.
- `20261009130000_add_offer_and_reservation_numbers.sql` – referenčné čísla.
- `20261011103000_guard_pickup_and_remove_test_payment.sql` – odstránenie starej fake-payment RPC a spevnenie prevzatia.
- **`20261011170000_limit_pickup_pin_to_pickup_day.sql` – posledné platné pravidlo PIN:** `start_date` musí byť **dnešný deň podľa `Europe/Prague`**. Nahrádza predchádzajúcu kontrolu presnej hodiny; ostatné storno pravidlá nemení.

Dva databázové cron joby definované migráciami: `rentulo-retry-owner-transfers-every-5-minutes` (`*/5 * * * *`) a `rentulo-send-overdue-owner-debt-reminders-hourly` (`0 * * * *`). Po nasadení do daného prostredia treba overiť ich skutočný stav, Vault a výsledky behov. **Žiadnu migráciu teraz automaticky nespúšťať na PROD.**

## 7. TEST PAYMENT – aktuálny bezpečnostný stav

Augustové upozornenie, že browser stále môže volať `mark_my_reservation_paid_test`, **už nezodpovedá zdrojovému kódu**. Migrácia `20261011103000_guard_pickup_and_remove_test_payment.sql`:

1. odníma práva a **odstraňuje** `public.mark_my_reservation_paid_test(uuid)`;
2. odníma oprávnenia na historickú tabuľku `public.test_payment_users` rolám `public`, `anon`, `authenticated`;
3. **nemaže** testovacie rezervácie ani obsah historickej tabuľky.

Na TEST sa používajú **Stripe test/sandbox platby**, nie stará klientská fake-payment cesta. Pred ostrým spustením je nutné osobitne potvrdiť, že najnovšia migrácia bola skutočne použitá v **PROD**, že neexistuje obchádzka platby a že produkčné Stripe účty/kľúče/webhook nie sú testovacie. Historickú tabuľku nemažte len kvôli dokumentácii; akékoľvek čistenie dát je samostatne schvaľovaná úloha.

## 8. Platby, PIN, transfery a refundy

**Stripe už je integrovaný v zdrojovom kóde a testovaný v TEST režime.** Neznamená to pripravenosť na ostré platby. Architektúra: serverové vytvorenie Checkout → dôveryhodný Stripe webhook + audit v `stripe_webhook_events` → zaplatená rezervácia → PIN odovzdanie → pokus o Stripe Connect transfer. Webhook spracovanie a retry majú kontrolu opakovania/idempotencie.

**Bezpečnosť PIN:** šesťmiestny PIN sa odvodzuje na serveri a neukladá v plaintextovom stĺpci. Sprístupňuje sa oprávnenému nájomcovi pri zaplatenej rezervácii, aj vopred pred termínom; **prenajímateľ ho môže použiť na potvrdenie prevzatia len v deň `start_date` podľa Prahy**. Po uplynutí dňa sa už nezobrazuje; po úspešnom odovzdaní zaniká. Tri nesprávne pokusy uzamknú overovanie na 15 minút. Overenie PIN ešte samo neodovzdá vec: nasleduje explicitné **„Předat věc“**. Databáza odmieta prevzatie v nesprávny deň aj pri priamom RPC volaní. Po potvrdení sa rezervácia mení na `picked_up`.

**Peníze prenajímateľovi:** po úspešnom PIN potvrdení sa iniciuje Stripe transfer; pri dočasnom zlyhaní sa používa worker a cron každých päť minút. Prenos cez Stripe nie je totožný s časom pripísania peňazí na bankový účet.

**Storno zaplatenej rezervácie:**

- Ak zruší nájomca v povolenom čase, z refundu sa odpočíta vypočítaný preukázateľný externý náklad (napr. Stripe poplatok), zvyšok sa vráti nájomcovi; e-mail uvádza rozpis.
- Ak zruší prenajímateľ, nájomcovi sa vracia plná suma a príslušný externý náklad môže vzniknúť ako **dlh prenajímateľa** voči Rentulu so splatnosťou **7 dní**. Existuje Stripe Checkout na úhradu tohto dlhu, hodinový reminder a blokovanie schvaľovania nových rezervácií po splatnosti.
- Vykonanie/refund prechádza bezpečným backendom a Stripe potvrdením; neprisudzovať refund iba podľa vizuálnej zmeny v UI.

**No-show** (nedostavenie sa na prevzatie) zostáva **odloženou témou**, nejde o hotovú funkciu. Presné produkčné účtovné, daňové, Stripe live a payout nastavenie treba pred štartom otestovať a právne/finančne preveriť.

## 9. E-mailové notifikácie a Supabase Auth šablóny

- **Resend** posiela rezerváciami vyvolané e-maily a oznámenia o refundoch; `send-reservation-email` používa preferovaný jazyk, log v `reservation_email_deliveries` a ochranu proti duplicitám. E-mailové odkazy musia rešpektovať oddelenie TEST `.eu` / PROD `.com`.
- V `supabase/auth-email-templates/` sú päťjazyčné Auth šablóny **Confirm sign up, Reset password, Change email address**. Šablóny **nie sú automaticky synchronizované** len commitom: aktivujú sa v príslušnom Supabase Auth dashboarde. Na TEST boli v októbri upravované a overované; PROD potrebuje samostatnú kontrolu a nasadenie.
- Pri bezpečnej zmene e-mailu môže Supabase poslať **dve potvrdenia** – na pôvodnú aj novú adresu. UI na TEST vysvetľuje, že je potrebné potvrdiť oba odkazy. Neoznačovať tento bezpečnostný proces za chybnú duplicitnú notifikáciu.
- SMS nie sú aktuálne súčasťou implementovaného hlavného procesu. Prípadné doplnenie SMS sa rozhodne osobitne podľa ceny, ochrany súkromia a reálnej potreby.

Pred spustením overiť Resend sender/doménu, SPF/DKIM/DMARC, presmerovania v Auth, šablóny, doručiteľnosť a skutočne funkčné kontaktné schránky. Žiadny úspešný lokálny alebo CI test tieto externé nastavenia nepotvrdzuje automaticky.

## 10. Poloha, mapa a súkromné údaje o vyzdvihnutí

Autoritatívnym miestom ponuky je profilová alebo vlastná adresa vyzdvihnutia. Súradnice sa získavajú geokódovaním, rezervácia si ukladá ich snapshot. Verejná mapa ukazuje iba **približnú polohu**, nie presnú adresu; presné údaje pre odovzdanie sa oprávneným stranám odomknú po zaplatení.

Východisková mapa bola v októbri upravená na **českú lokalitu** (nie Bratislavu). Opravy automatického dopĺňania a filtrovania adries na TEST boli nasadené a overené 10. 10. (commity `caa842c`, `5f8caee`). Fallback geokódovania je Photon, primárny Nominatim. Pravidlá povolených pôvodov požiadaviek/User-Agent sú oddelené medzi `.eu` a `.com`.

GPS poloha zariadenia slúži na radenie/vyhľadávanie v okolí a presné GPS súradnice návštevníka sa po bezpečnostnej oprave nemajú trvalo ukladať do `localStorage`. Povolenie polohy je dobrovoľné; pri odmietnutí má zostať funkčné manuálne vyhľadávanie.

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

**Novšie overenie zdrojov (12. 10. 2026):** GitHub `main` `8ef44e2`, CI [#391](https://github.com/EBBI-SK/rentulo/actions/runs/38156414667) **success**, automatické testy **367/367**, úspešný TEST build a Deno typecheck. Tento údaj aktualizuje iba informácie o **kóde a CI**, nie vyššie dátumovo označené kontroly PROD/Vercel/Supabase dashboardov.

Úspešný GitHub/Vercel status **nedokazuje**, že PROD URL, skryté Supabase secrets, produkčné DNS či Stripe/Resend nastavenia už boli end-to-end overené. Tieto body zostávajú pre okamih produkčnej prípravy.

### 12.3 Príprava pred ostrým spustením – zatiaľ iba kontrolný zoznam

1. Určiť dátum spustenia, osobu schvaľujúcu zmeny, čas údržby, komunikáciu používateľom a plán návratu; vykonať bezpečnostnú, právnu a platobnú kontrolu.
2. Porovnať `main` s `production`, určiť **presný odskúšaný commit** pre vydanie a pripraviť riadené povýšenie do `production`. Nemergovať/pushovať do `production` len na základe tejto dokumentácie.
3. Skontrolovať vo Vercel `rentulo-prod` priradenie vetvy `production`, environment variables `RENTULO_DEPLOY_TARGET=prod`, `RENTULO_SUPABASE_URL` a `RENTULO_SUPABASE_PUBLISHABLE_KEY`; všetky hodnoty musia zodpovedať **PROD Supabase**, nie TEST. Pri maskovaných tajných hodnotách preveriť správnosť bezpečným servisným postupom; hodnoty nikdy neposielať do chatu, commitov ani ZIP.
4. Skontrolovať **Supabase PROD**: databázu/migrácie, RLS, Auth Site URL `https://rentulo.com`, presne potrebné Redirect URLs (minimálne `https://rentulo.com/obnova-hesla.html`), poskytovateľov OAuth (ak sa používajú), e-mailové šablóny a príslušné Edge Functions vrátane ich JWT nastavení. Neprenášať TEST používateľov/rezervácie ani secret hodnoty bez schváleného migračného plánu.
5. Skontrolovať serverové `SITE_URL`/návratové URL pre produkčné Stripe Checkout, Stripe Connect (refresh/return), účtovné úhrady, rezervácie a notifikácie; zabezpečiť výhradne `https://rentulo.com`. Osobitne preveriť webhooky, Connect, refundy, testovacie platobné obchádzky a bezpečné produkčné platby.
6. V Resend preveriť vlastníctvo produkčnej e-mailovej domény, odosielateľa, DNS SPF/DKIM/DMARC, odpovede a kontaktné schránky. Na TEST sa používal `noreply@rentulo.eu`; adresu PROD odosielateľa **nepovažovať za pripravenú bez kontroly**.
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

Pre tento dokumentačný **BOD 11** sú lokálne PowerShell príkazy (až po vložení dodaného ZIP-u):

```powershell
cd C:\Users\ebbi\Desktop\pujc-naradi
git status
git diff -- README.md HANDOVER.md
npm test
npm run build
git diff --check
git add README.md HANDOVER.md
git diff --cached --check
git diff --cached --stat
git commit -m "Update Rentulo README and handover for October 2026"
git push origin main
```

> Príkazy na commit/push použiť **iba keď testy a diff prejdú** a iba na správnej vetve `main`. Pred ich použitím musí byť `git status` bez nesúvisiacich zmien. Commit ani push do `production` sem nepatrí.

GitHub workflow `.github/workflows/ci.yml` sleduje push a pull requesty na `main` aj `production`; používa **Node 22** a **Deno 2**. Kontroluje: `npm ci`, JS syntax (`node --check`), JSON, konfliktné značky, zakázané sledované tajné/záložné súbory, `npm audit --audit-level=high`, `npm test`, **TEST build** a `deno check` všetkých Edge Functions. Referenčný úspešný beh **#391** k `8ef44e2` mal **367/367 testov**. CI úspech nenahrádza živý end-to-end audit Supabase, Stripe ani PROD.

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
- **BOD 11 (tento dokumentačný krok)** – aktualizácia `README.md` a `HANDOVER.md`. **Za uzavretý označiť až po úspešných testoch, commite, pushi a novej GitHub CI kontrole.**

Nasledujúce práce sa navrhujú a schvaľujú **samostatne**; najmä kontrola release pripravenosti/čistenia pre **BOD 12**, ďalšie end-to-end overenia a predprodukčný checklist podľa kapitoly 19. **No-show** zostáva odložené. Nezavádzať ďalšiu funkciu len preto, že je spomenutá v dokumentácii.

## 19. Otvorené kontroly pred verejným spustením

Toto je **checklist budúceho release, nie pokyn na okamžité vykonanie**. Postup, domény a rollback podrobnejšie v kapitole 12.

1. **STOP/GO a revízia zdrojov:** presný schválený release commit, úspešné CI, porovnanie `main`/`production`, záloha a rollback plán; nezávislé potvrdenie otvorenia PROD.
2. **Supabase PROD:** čistá databáza, kontrola/aplikovanie potrebných migrácií, RLS/RPC, oddelené Auth a Storage, Edge Functions, cron joby/Vault, logy. **Žiadne kopírovanie TEST používateľov/rezervácií bez samostatného rozhodnutia.**
3. **Produkčné platby:** Stripe **live** účty a kľúče, podpis webhooku, Connect onboarding, rozdelenie poplatkov, potvrdenie PIN, transfer/payout, retry, refundy, dlhy prenajímateľa a idempotencia; overenie odstránenia fake-payment cesty v cieľovom PROD.
4. **E-maily a Auth:** produkčné `SITE_URL`, návratové URL, bezpečné recovery/change-email toky, päť jazykov v Auth šablónach, Resend odosielateľ, DNS SPF/DKIM/DMARC a reálne doručenie správ.
5. **Právo a kontakty:** potvrdená platnosť/účinnosť V1 podmienok a GDPR, fungujúce `rentulo@rentulo.com` a `policy@rentulo.com`, právna a daňová kontrola vrátane používania Stripe v ČR cez EBBI s. r. o.
6. **Web/doména:** `rentulo.com`/`www`, TLS, Vercel PROD ochrana až do schválenia, správna CSP, SEO canonical a indexovanie PROD iba po osobitnom rozhodnutí. TEST `rentulo.eu` nepresmerovávať.
7. **Bezpečnosť a funkčné smoke testy:** aktuálne CodeQL/secret scanning/Dependabot, mobil a desktop, Console/Network, 4xx/5xx, Auth, ponuky, rezervácie, platby/refundy, PIN v správny aj nesprávny deň, mapa a e-maily.
8. **Uzatvorenie:** zaznamenať výsledky, kto spustenie schválil, dátum/čas, produkčný commit, zmenené nastavenia a monitoring. Pri chybe použiť pripravený rollback namiesto presunu používateľov do TEST.

## 20. Pravidlá ďalších zásahov do Rentula

1. **pred každým krokom** skontrolovať **históriu predchádzajúcich prác**, posledné rozhodnutia a **aktuálny GitHub `main`**, potom dodaný ZIP a existujúce súbory/migrácie; zistiť, čo už bolo vykonané, a **hotové kroky neopakovať**.
2. **Potom** konkrétny návrh s presným zoznamom dotknutých súborov; **nič neupravovať pred súhlasom**.
3. Po súhlase odovzdať **jeden ZIP len so schválenými zmenami**, zachovať relatívne cesty, nepremiestňovať projekt a nezasahovať do iných funkcií.
4. Pri stránkovej zmene preveriť príslušné HTML/JS/CSS/i18n spolu; nevytvárať polovičné UI opravy.
5. Po vložení ZIP-u vykonať testy, diff, `git status`; následne presné príkazy `git add`, `git commit`, `git push origin main` a overiť konkrétny GitHub CI run/TEST nasadenie.
6. Pri SQL pred zásahom preveriť **existujúce** migrácie aj živý stav **správneho** Supabase projektu; nekopírovať SQL do druhého prostredia automaticky.
7. **PROD `production`, Vercel `rentulo-prod`, Supabase PROD, Stripe live, DNS, doménové presmerovania a indexovanie sa nikdy nemenia bez osobitného výslovného súhlasu.**
8. Zaznamenávať overené skutočnosti a dátumové snapshoty oddelene od plánov a domnienok; nemenovať úspešné CI „produkčne otestované“.
