# Rentulo – HANDOVER

Tento dokument vznikol ako odovzdávací a servisný dokument k 18. 8. 2026. **K 10. 10. 2026 bola aktualizovaná kapitola 1 a časť o doménach (kapitola 12), vrátane súvisiacich poznámok k Edge Functions a nasadzovaniu.** Ostatné historické časti môžu popisovať starší stav; pred akýmkoľvek zásahom ich treba porovnať s aktuálnym `main` a históriou prác.

## 1. Aktuálny stav (overené k 10. 10. 2026)

Rentulo zatiaľ funguje **iba v testovacom prostredí**. Príprava produkcie je oddelená a verejné spustenie na `rentulo.com` nebolo odsúhlasené ani vykonané.

- Repozitár: `EBBI-SK/rentulo`; GitHub `main`: **`5f8caee`**; GitHub CI úspešné, lokálne testy **332/332, fail 0**.
- TEST: Vercel projekt `rentulo`, vetva `main`, doména `https://rentulo.eu`, Supabase projekt `vspposovhdgvbeukoivh`.
- PROD: Vercel projekt `rentulo-prod`, vetva `production` (pri audite `a79d3bb`), Supabase projekt `tfvgxrdjrpicgtvovehl`, budúca doména `https://rentulo.com`.
- PROD je zatiaľ chránený cez Vercel Authentication **All Deployments**; úspešný stav kontroly Vercel neznamená verejné spustenie.
- TEST má zakázané indexovanie. Produkčný web, DNS a presmerovania sa teraz **nemenia**.
- Doménový audit a presný plán ostrej aktivácie: **kapitola 12**. Spustenie je samostatný krok vyžadujúci nový výslovný súhlas.

Pozor: staršie pasáže tohto dokumentu o CI, integrácii platieb, testovacích platbách či kontaktných údajoch sú historické a **nie sú potvrdeným aktuálnym produkčným auditom**. Pred spustením preveriť ich dnešný stav samostatne.

## 2. Architektúra

Zjednodušený tok:

```text
prehliadač
    |
    v
statický HTML/CSS/JS frontend
    |
    +--> Supabase Auth
    +--> Supabase PostgreSQL + RLS + RPC
    +--> Supabase Storage
    +--> Supabase Edge Functions
    |
    +--> Vercel hosting
```

Ďalšie externé služby:

- Resend – aktuálne e-mailové notifikácie,
- OpenStreetMap – mapové podklady,
- Nominatim – primárne geokódovanie,
- Photon – náhradné geokódovanie pri zlyhaní Nominatim.

Frontend nemá bundler ani frameworkový build. Ide o statické stránky s vanilla JavaScriptom.

## 3. Dôležité priečinky

```text
assets/                     brand a statické súbory
css/                        spoločné a stránkové CSS
js/                         frontendová logika
supabase/functions/         Edge Functions
supabase/migrations/        aktívna migračná história
supabase/migrations-archive/ historický archív
supabase/snippets/          pomocné SQL/snippety
```

`supabase/migrations-archive/` nie je dočasný priečinok. Bez dôvodu ho nemažte ani jeho migrácie znovu nespúšťajte.

## 4. Supabase frontend konfigurácia

Frontendový Supabase klient je v:

```text
js/supabase-config.js
```

Používa:

- `SUPABASE_URL`,
- verejnú `SUPABASE_PUBLISHABLE_KEY`.

Publishable key je verejný klientsky údaj. Ochrana databázy sa nesmie spoliehať na utajenie tohto kľúča; musí byť vynútená RLS, právami a bezpečnými databázovými/RPC funkciami.

Nikdy nevkladať `SUPABASE_SERVICE_ROLE_KEY` do HTML alebo frontendového JavaScriptu.

### Ukladanie session

Aplikácia podľa voľby používateľa používa:

- `sessionStorage` – bežné prihlásenie,
- `localStorage` – zapamätané prihlásenie.

## 5. Supabase Edge Functions

### 5.1 `account-deactivation`

Účel:

- preverenie, či sa účet môže deaktivovať,
- bezpečné dokončenie deaktivácie,
- serverová operácia s oprávneniami, ktoré nesmú byť dostupné klientovi.

Funkcia očakáva:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Service-role kľúč musí zostať iba v serverovom prostredí Supabase.

### 5.2 `geocode-pickup`

Účel:

- geokódovanie adresy miesta vyzdvihnutia,
- primárne cez Nominatim,
- fallback cez Photon.

Funkcia očakáva:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
```

Geokódovací `User-Agent` je už naviazaný na Supabase prostredie: TEST používa `https://rentulo.eu`, budúci PROD `https://rentulo.com`; kontaktná adresa v kóde je `rentulo@rentulo.com`. Rovnaké oddelenie pôvodu požiadaviek používa funkcia `address-suggestions`. Pri ostrom spustení overiť ich nasadenie osobitne na Supabase PROD; TEST sa neprepína.

### 5.3 `send-reservation-email`

Účel:

- posielať e-mailové udalosti súvisiace s rezerváciami,
- rešpektovať preferovaný jazyk používateľa,
- evidovať odoslanie v `reservation_email_deliveries`,
- brániť duplicitnému odoslaniu tej istej udalosti.

Funkcia očakáva:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY
EMAIL_FROM
SITE_URL
```

Aktuálny `send-reservation-email` určuje bezpečnú doménu z **konkrétneho Supabase projektu**: TEST → `https://rentulo.eu`, PROD → `https://rentulo.com`. Ak `SITE_URL` chýba, použije tento kanonický pôvod; ak je nastavené na inú doménu, funkcia skončí chybou (fail closed). Rovnako postupuje `send-overdue-owner-debt-reminders`.

Na TEST sa po nasadení 9. 10. 2026 overilo doručenie nového rezervačného e-mailu aj odkaz na `https://rentulo.eu/moje-nabidky.html`. **Samotnú hodnotu skrytého secretu `SITE_URL` tým nepotvrdzujeme.** Pred ostrým spustením samostatne skontrolovať serverové `SITE_URL`, e-mailové šablóny a Stripe návratové adresy v PROD.

Hodnoty tajomstiev nikdy neukladať do GitHub repozitára ani do dokumentácie.

## 6. Databáza a migrácie

Aktívne migrácie sú v:

```text
supabase/migrations/
```

Obsahujú okrem základnej schémy aj postupné bezpečnostné a funkčné úpravy, napríklad:

- ochranu kontaktných údajov rezervácií,
- obmedzenie verejných view/prístupov,
- bezpečné čítanie rezervácií a dostupnosti,
- riadené zmeny stavov rezervácií,
- ochranu nemenných polí rezervácie,
- platobnú prípravu a testovaciu platobnú cestu,
- profilové nastavenia a jazyky,
- e-mailové delivery logy,
- verejnú približnú mapu,
- deaktiváciu účtu,
- snapshot miesta vyzdvihnutia a súradníc rezervácie.

Pred akoukoľvek novou SQL zmenou najprv skontrolovať už existujúce migrácie, aby nevznikali duplicity alebo konfliktné pravidlá.

## 7. Kritické produkčné upozornenie – TEST PAYMENT

Projekt ešte obsahuje testovaciu platobnú cestu.

Pred ostrou platobnou bránou treba:

1. skontrolovať a vyčistiť `public.test_payment_users`,
2. overiť, že nezostal žiadny náhodný testovací účet,
3. vypnúť alebo odstrániť verejne používateľnú testovaciu cestu `mark_my_reservation_paid_test`,
4. následne otestovať produkčný platobný tok bez možnosti obísť platobnú bránu.

Tento bod nesmie zostať otvorený pri verejnom spustení.

## 8. Platby

Externá ostrá platobná brána ešte nie je zapojená.

Aktuálny projekt obsahuje databázovú prípravu pre platby a testovací pracovný postup, ale nepredstavuje skutočné spracovanie platby poskytovateľom platobných služieb.

Pred produkciou bude potrebné podľa zvoleného poskytovateľa doplniť najmä:

- bezpečné vytvorenie platby na serverovej strane,
- webhook alebo iné dôveryhodné potvrdenie výsledku platby,
- idempotenciu,
- stavy neúspešnej/vrátenej platby,
- payout logiku pre majiteľa,
- storno a refund pravidlá,
- právne a účtovné nastavenie.

## 9. Notifikácie

E-mailové notifikácie sú aktuálne implementované a otestované cez Resend.

Finálna stratégia notifikácií ešte nie je uzavretá.

Pred produkčným spustením sa rozhodne, či Rentulo:

- ponechá e-mail ako hlavný kanál,
- pridá SMS pre časovo citlivé udalosti,
- alebo použije kombináciu SMS + e-mail.

Preferovaný návrh na ďalšie posúdenie:

- SMS iba pre udalosti, pri ktorých je žiaduca rýchla reakcia používateľa,
- e-mail pre podrobnejšie potvrdenia a informácie,
- neposielať automaticky oba kanály pri každej malej zmene stavu.

Pri rozhodovaní treba zohľadniť cenu SMS, spoľahlivosť, súhlasy/preferencie používateľa a prevádzkové náklady.

## 10. Poloha a miesto vyzdvihnutia

Autoritatívnym miestom ponuky je miesto vyzdvihnutia:

- štandardne profilová adresa,
- alebo vlastná adresa zadaná pri vytváraní ponuky.

Súradnice sa odvodzujú z tejto adresy geokódovaním.

Pri vytvorení rezervácie sa používa snapshot miesta vyzdvihnutia a súradníc, aby neskoršia zmena profilu alebo ponuky nemenila už existujúcu rezerváciu.

Verejná mapa nesmie zobrazovať presnú adresu miesta vyzdvihnutia.

Poloha zariadenia návštevníka slúži na vyhľadávanie/raďenie ponúk v okolí. Po bezpečnostnej oprave sa presné GPS súradnice návštevníka nemajú dlhodobo ukladať do `localStorage`.

## 11. Kontaktné údaje a súkromie

Telefón, presná adresa a údaje potrebné na odovzdanie veci sú chránené podľa stavu rezervácie.

Pred verejným spustením treba dokončiť a právne zosúladiť:

- oficiálny názov prevádzkovateľa,
- sídlo,
- identifikačné údaje firmy podľa potreby,
- zákaznícky/kontaktný e-mail,
- Obchodné podmienky,
- Ochranu osobných údajov.

Stránka `kontakt.html` už v aktuálnom repozitári existuje. Pred verejným spustením treba skontrolovať jej obsah a funkčnosť oficiálnych kontaktov, vrátane všeobecnej adresy `rentulo@rentulo.com` a plánovaného GDPR kontaktu `policy@rentulo.com`. Nezamieňať plánovanú e-mailovú adresu za už overenú a zriadenú schránku.

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

- GitHub `main` `5f8caee`, testy **332/332**, CI úspešné; vetva `production` pri audite zostala `a79d3bb`.
- TEST `rentulo.eu`: HTTP 200; bezpečnostné hlavičky vrátane CSP a HTTPS/HSTS; `X-Robots-Tag: noindex`; TEST sitemap vracia 404.
- Supabase TEST: `Authentication → URL Configuration`: Site URL `https://rentulo.eu`; jediný povolený recovery redirect `https://rentulo.eu/obnova-hesla.html`. Stará adresa `rentulo-seven.vercel.app/obnova-hesla.html` bola 10. 10. 2026 odstránená.
- Supabase TEST: po doménových zmenách boli aktualizované funkcie `address-suggestions`, `geocode-pickup`, `send-reservation-email` a `send-overdue-owner-debt-reminders`. Následná oprava `address-suggestions` sa nasadila a reálne otestovala 10. 10. 2026.
- Na TEST po aktualizácii prešiel reálny test doručenia rezervačného e-mailu a odkazu na `rentulo.eu`; autovyplnenie a filtrovanie adries bolo otestované v prehliadači.
- Vercel `rentulo-prod`: pri audite potvrdená väzba na `production` a **Vercel Authentication → All Deployments**. Ochranu pred verejným spustením nevypínať.
- TEST a PROD majú odlišné Supabase projektové identifikátory v kóde; domény, geokódovací User-Agent a e-mailové odkazy sú na tieto prostredia viazané.

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

## 14. Vercel security headers

`vercel.json` obsahuje spoločné hlavičky pre stránky projektu:

- `Content-Security-Policy`,
- `X-Content-Type-Options: nosniff`,
- `Referrer-Policy`,
- `X-Frame-Options: DENY`,
- `Permissions-Policy`,
- `Strict-Transport-Security`,
- `Cross-Origin-Opener-Policy`.

Pri pridaní novej externej služby treba skontrolovať CSP. Nepridávať široké výnimky bez konkrétnej potreby.

## 15. Nasadzovanie

Aktuálny **TEST** tok vývoja:

```text
lokálna zmena vo vyhradenom priečinku
-> npm test + kontrola dohodnutých súborov
-> git add
-> git commit
-> git push origin main
-> GitHub CI + automatické nasadenie do Vercel `rentulo` (TEST)
```

Vercel `rentulo-prod` sleduje samostatnú vetvu `production`; produkciu neaktivovať ani neupravovať bez výslovného súhlasu a postupu z kapitoly 12.

Pred pushom je vhodné minimálne:

```powershell
git status
```

Pri JS súboroch možno použiť:

```powershell
node --check cesta/k/suboru.js
```

Po nasadení vykonať smoke test dotknutej stránky na desktope aj mobile a skontrolovať konzolu prehliadača.

## 16. Jazyková podpora

Aplikácia používa:

- CZ,
- EN,
- DE,
- PL.

Pri každej používateľsky viditeľnej novej funkcii treba skontrolovať všetky štyri jazyky.

E-mailové rezervačné šablóny aktuálne takisto obsahujú tieto štyri jazyky.

## 17. Legacy / prípravné súbory

`js/api.js` je starší prípravný súbor a nie je hlavnou API vrstvou aktuálnej aplikácie.

Pred jeho budúcim použitím alebo odstránením treba najprv overiť referencie v projekte. Neodstraňovať ho iba podľa názvu.

## 18. Aktuálny plán pokračovania

Dokončené pred týmto dokumentom:

- bod 8 – GitHub bezpečnostné kontroly a vyriešenie aktuálnych nálezov,
- bod 9 – čistý Git stav, kontrola pomocných súborov a rozšírený `.gitignore`,
- bod 10 – táto technická dokumentácia.

Nasleduje:

### Bod 11 – jednoduché GitHub CI

Cieľ:

- automaticky spustiť základné technické kontroly pri pushi,
- zachytiť jednoduché chyby ešte pred nasadením.

Presný rozsah treba najprv navrhnúť a odsúhlasiť.

### Bod 12 – automatizované testy kritických tokov

Vybrať iba najdôležitejšie toky, napríklad:

- bezpečné prihlasovacie presmerovania,
- vytvorenie/čítanie rezervácie,
- povolené zmeny stavu,
- ochranu kontaktov,
- základnú logiku dostupnosti.

Presný testovací stack sa má určiť až v tomto kroku.

### Bod 13 – čistá finálna záloha

Po CI a testoch:

- overiť čistý Git stav,
- vytvoriť finálny ZIP bez `node_modules`, temp súborov a lokálnych cache,
- uchovať verziu pred napojením ostrej platobnej brány a domény.

## 19. Následné kroky pred verejným spustením

Po bode 13:

1. odstrániť testovacie platobné oprávnenia a testovaciu platobnú cestu,
2. vybrať a integrovať ostrú platobnú bránu,
3. rozhodnúť finálny model SMS/e-mail notifikácií,
4. nastaviť produkčnú doménu,
5. doplniť oficiálne firemné a kontaktné údaje,
6. finalizovať stránku Kontakt,
7. právne skontrolovať Obchodné podmienky a Ochranu osobných údajov,
8. spustiť finálny GitHub/Supabase/security audit,
9. vykonať kompletný desktop + mobile smoke test.

## 20. Pravidlá pre ďalšie zásahy do projektu

Pri ďalšej práci:

1. **pred každým krokom** skontrolovať históriu predchádzajúcich prác, posledné rozhodnutia a aktuálny GitHub `main`; zistiť, čo už bolo vykonané a overené, a hotové kroky neopakovať,
2. navrhnúť presný rozsah zmeny,
3. meniť až po odsúhlasení,
4. meniť iba dohodnutú vec,
5. pri jednej stránke dokončiť aj jej súvisiace JS/CSS/i18n zmeny,
6. po zmene vykonať kontrolu/test,
7. commitnúť a pushnúť zmenu na `main`,
8. overiť nasadenie na Verceli.

Pri SQL vždy najprv overiť existujúce migrácie a aktuálny stav databázy.
