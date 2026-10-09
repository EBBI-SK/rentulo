# Rentulo – HANDOVER

Tento dokument zachytáva technický stav projektu Rentulo k 18. 8. 2026 a slúži ako odovzdávací a servisný dokument.

## 1. Aktuálny stav

Rentulo je funkčná predprodukčná webová aplikácia. Funkčné a vizuálne smoke testy hlavných používateľských tokov boli vykonané, bezpečnostné GitHub kontroly boli zapnuté a aktuálne nálezy CodeQL boli vyriešené.

Zatiaľ nie sú dokončené najmä:

- ostrá platobná brána,
- produkčná doména,
- finálna stratégia notifikácií,
- finálne firemné a právne údaje,
- jednoduché GitHub CI,
- automatizované testy kritických tokov,
- čistá finálna záloha pred produkčnými integráciami.

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

Aktuálny User-Agent geokódovacích požiadaviek stále obsahuje testovaciu doménu `https://rentulo-seven.vercel.app` a pracovný kontakt `info@rentulo.cz`.

Pri produkčnej doméne to treba aktualizovať.

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

`SITE_URL` má momentálne fallback:

```text
https://rentulo-seven.vercel.app
```

Pri nasadení produkčnej domény treba `SITE_URL` nastaviť na ostrú adresu a skontrolovať všetky odkazy v e-mailoch.

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

Samostatná stránka `Kontakt` v aktuálnom repozitári nie je. Treba ju pred verejným spustením vytvoriť alebo finalizovať, keď budú známe oficiálne firemné údaje.

Pracovný kontakt `info@rentulo.cz`, ktorý sa dnes nachádza v niektorých miestach projektu, sa nesmie automaticky považovať za finálny firemný kontakt bez potvrdenia.

## 12. Produkčná doména

Aktuálna testovacia doména používaná v projekte je:

```text
https://rentulo-seven.vercel.app
```

Pri prechode na produkčnú doménu skontrolovať najmenej:

- Vercel domain konfiguráciu,
- Supabase Auth Site URL,
- Supabase povolené redirect URL,
- `SITE_URL` pre Edge Functions,
- odkazy v registračných a recovery e-mailoch,
- odkazy v rezervačných e-mailoch,
- geokódovací User-Agent,
- CSP a povolené externé zdroje,
- HTTPS/HSTS správanie,
- všetky návratové URL po prihlásení a obnove hesla.

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

Aktuálny produkčný tok vývoja:

```text
lokálna zmena
-> kontrola
-> git add
-> git commit
-> git push origin main
-> automatické nasadenie na Vercel
```

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
