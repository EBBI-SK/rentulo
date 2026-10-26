# Rentulo V1 – BOD 02 / ETAPA 1: GDPR, DSA a bezpečnostné evidencie

**Dátum prípravy:** 20. 10. 2026
**Rozsah:** iba Supabase TEST `vspposovhdgvbeukoivh` / `rentulo.eu`. PROD (`rentulo.com`) **bez zásahov**.
**Stav k 20. 10. 2026:** PR #31 úspešne zlúčený do `main`; migrácia bola **manuálne nainštalovaná do Supabase TEST** a následne kontrolami potvrdených 5 RLS registrov, 3 aktívne triggery, vypnutá GDPR mazacia brána. **ZIP sám nič nenasadil; PROD zostáva nedotknutý.** Registračný live end-to-end TEST bude súčasťou spoločného finálneho preverenia.
**Prevádzkovateľ:** EBBI s. r. o.; GDPR `policy@rentulo.com`; DSA a všeobecné podnety `rentulo@rentulo.com`.

## 1. Rozsah a čo presne sa nainštaluje

Jedna TEST-only SQL migrácia `supabase/migrations/20261020170000_bod02_v1_compliance_registry_TEST.sql` zavádza päť **interných** tabuliek:

| Tabuľka | Účel | Používa sa v etape 1 |
| --- | --- | --- |
| `gdpr_terms_acceptances` | Nemenný serverový záznam o tvrdení pri novej registrácii: verzia obchodných podmienok, verzia zobrazeného GDPR oznámenia, jazyk, čas | Automaticky iba pre **nových** používateľov, ktorých registrácia obsahuje tri výslovné potvrdenia |
| `gdpr_subject_requests` | GDPR žiadosti prijaté e-mailom a ich vybavenie | Ručne, cez interný SQL Editor |
| `dsa_content_notices` | DSA oznámenia o údajne nezákonnom obsahu, rozhodnutia a prípadné opravné podanie | Ručne, cez interný SQL Editor |
| `gdpr_security_incidents` | Incidenty, posúdenie rizika, opatrenia, prípadné oznámenia úradu/osobám | Ručne, cez interný SQL Editor |
| `gdpr_legal_holds` | Odôvodnené pozastavenie čistenia konkrétneho profilu, ponuky alebo rezervácie | Ručne; dátum ďalšej kontroly najneskôr do 6 mesiacov |

- Všetkých päť tabuliek má **RLS zapnuté** a prístupy pre `anon`/`authenticated`/`PUBLIC` odobraté. Na ručné zápisy prevádzkových registrov je určený iba dôveryhodný serverový účet alebo SQL Editor s administrátorským prístupom.
- Záznamy prijatia podmienok zapisuje **len trigger na `auth.users`**; `service_role` má iba `SELECT`, nie priame právo zápisu. Pokus o neskorší UPDATE/DELETE je zablokovaný triggerom aj pre privilegovaného operátora. Kontrolovaná retencia tejto evidencie je samostatná téma etapy 2.
- Záznam obsahuje čas servera a serverom určenú testovaciu verziu `1.0-test-2026-10-20`, nie čas alebo verziu, ktorú by mohol ľubovoľne určiť klient. Registrácia so zastaranými verzovacími údajmi sa odmietne; používateľ musí načítať aktuálnu registračnú stránku.
- Historické účty **nebudú spätne označené za súhlasiace**. Priamo cez Auth API môže byť používateľ vytvorený bez tvrdenia o potvrdení; potom sa nevytvorí audit prijatia. **To nie je automaticky dôkaz neplatnosti účtu ani kryptografický dôkaz kliknutia.** Pred PROD bude treba osobitne overiť/uzavrieť všetky alternatívne registračné cesty a verzie dokumentov (etapa 3).
- Skratka `terms_privacy_accepted` vo vstupných metadátach znamená **potvrdenie oboznámenia sa s informačným dokumentom**, nie univerzálny GDPR súhlas na spracúvanie údajov.
- Nevytvára sa cron, verejný GDPR formulár, automatické odpovede, export osobných údajov ani pravidlo mazania. **Existujúca brána GDPR čistenia zostáva OFF.**
- Migrácia nezasahuje do Stripe, PIN, rezervácií, platieb ani existujúcich záznamov. Sledovanie retenčných lehôt z 16 schválených pravidiel patrí do etapy 2; jazykové znenia, GPS a webové závislosti do etapy 3.

## 2. Manuálna prevádzka – GDPR žiadosti

1. Prijímať e-mail na `policy@rentulo.com`, zaznačiť skutočný `received_at`, typ žiadosti a minimum kontaktov do `gdpr_subject_requests`. Nepresúvať celú e-mailovú komunikáciu vrátane nadbytočných príloh do databázy.
2. Identitu overovať primerane a iba v rozsahu potrebnom na ochranu údajov; nevyžadovať automaticky občiansky preukaz. Do evidencie zapísať `identity_verified_at`, nie kópie dokladov.
3. **Odpovedať bez zbytočného odkladu, spravidla do jedného kalendárneho mesiaca od prijatia.** V odôvodnených prípadoch možno predĺžiť najviac o ďalšie dva mesiace; o predĺžení a dôvode treba informovať v pôvodnej mesačnej lehote (čl. 12 ods. 3 GDPR). Súhrnný limit je tri mesiace.
4. Každú žiadosť vecne posúdiť podľa príslušného práva (prístup, oprava, výmaz, prenosnosť, obmedzenie, námietka). Žiadne automatické vymazanie finančných/právnych dokladov. Zaznačiť `responded_at`, stručný `decision_reason` a konečný `status`.
5. Osobné údaje ani UUID skutočných osôb nekopírovať do GitHub issue/PR, testov ani screenshotov.

**Bezpečná prevádzková kontrola lehoty (iba dôveryhodný SQL Editor):**

```sql
SELECT id, request_kind, status, received_at,
       coalesce(extended_until, received_at + interval '1 month') AS deadline,
       (coalesce(extended_until, received_at + interval '1 month') < now()) AS overdue
FROM public.gdpr_subject_requests
WHERE status NOT IN ('closed','refused')
ORDER BY received_at;
```

Výpis obsahuje interné identifikátory žiadostí, nie osobné kontakty; bežným používateľom sa nesprístupňuje.

## 3. Manuálna prevádzka – DSA podnety

1. Na `rentulo@rentulo.com` prijať označenie ponuky (URL/číslo), vysvetlenie údajnej nezákonnosti a kontakt oznamovateľa, pokiaľ ho uviedol. Zaznačiť `received_at`.
2. Keď má oznamovateľ elektronický kontakt, **bez zbytočného odkladu potvrdiť prijatie** a zaznačiť `acknowledged_at` (čl. 16 DSA). Priebežne preveriť obsah a prípadné dôkazy.
3. Pri zásahu alebo zamietnutí rozhodnúť bez svojvôle, s uvedením dôvodu. Zaznačiť `decided_at`, `decision_reason`, `status` a `notified_at` po doručení oznámenia dotknutým osobám v potrebnom rozsahu. Vždy osobitne posúdiť povinné odôvodnenie a opravné prostriedky (čl. 17 DSA).
4. Námietku alebo ďalšie opravné podanie zaznamenať bez straty pôvodného rozhodnutia. Rozsah formálneho interného systému sťažností podľa čl. 20 závisí od uplatniteľnosti výnimky pre mikro-/malé podniky; tým **nie je vylúčené** nahlasovanie podľa čl. 16.
5. Prístup k nahlasovaniu už existuje cez `kontakt.html` a odkaz v detaile ponuky. Etapa 1 zavádza evidenciu, nie samostatný helpdesk.

## 4. Bezpečnostný incident / únik údajov

1. Bezodkladne zastaviť ďalšiu škodu: obmedzenie účtu/tokenu, rotácia kľúča, izolácia, zachovanie potrebných dôkazov. Pri práci s TEST/PROD rozlišovať projekty.
2. Zapísať `detected_at`, opis, osoby/záznamy dotknuté incidentom v minimálnom rozsahu, dôsledky a opatrenia; riziko klasifikovať ako `unlikely`, `risk`, `high_risk` alebo dočasne `under_review`.
3. Ak porušenie ochrany osobných údajov pravdepodobne predstavuje **riziko** pre práva a slobody osôb, oznámiť príslušnému dozornému orgánu pokiaľ možno do **72 hodín od toho, ako sa prevádzkovateľ o porušení dozvedel**, a pri omeškaní uviesť dôvod (čl. 33 GDPR). Pri **vysokom riziku** informovať dotknuté osoby bez zbytočného odkladu, ak sa neuplatní zákonná výnimka (čl. 34).
4. Aj neoznamovaný incident zdokumentovať spolu s odôvodnením. Zapísať `contained_at`, `authority_notified_at`, `subjects_notified_at`, `decision_reason`, nápravné opatrenia a `closed_at`.
5. Ak právny dôvod uchovania dôkazov trvá, pridať úzky záznam `gdpr_legal_holds` so stručným dôvodom, konkrétnou rezerváciou/ponukou/profilom a šesťmesačnou kontrolou. Záznam právneho pozastavenia **nie je povolením neobmedzeného uchovávania**.

**Kontrola otvorených incidentov (administrátorský SQL Editor):**

```sql
SELECT id, risk, detected_at,
       detected_at + interval '72 hours' AS orientacna_72h_hranica,
       authority_notified_at, closed_at
FROM public.gdpr_security_incidents
WHERE closed_at IS NULL ORDER BY detected_at;
```

Pozor: hranica je kontrolná pomôcka; zákonný okamih začiatku lehoty sa viaže na **zistenie porušenia**, nie automaticky na každý technický alarm.

## 5. Prvotná kontrola potreby DPIA a DPO (V1)

- **DPIA / čl. 35 GDPR:** V aktuálnom V1 ide o sprostredkovanie C2C prenájmu, spracúvanie bežných kontaktných, lokačných a platobných metadát, bez plánovaného rozsiahleho automatizovaného rozhodovania, rozpoznávania tvárí či systematického sledovania verejných priestorov. Na základe tohto opisu sa **zatiaľ nepreukázal spúšťač povinnej DPIA**, nejde však o právnu záruku. Pred nasadením PROD skontrolovať skutočný rozsah, dostupnú verejnú mapu a príslušné zoznamy vysoko rizikových spracovaní dozorného orgánu. Ak sa spúšťač objaví, DPIA vykonať **pred** spustením takejto funkcie.
- **DPO / čl. 37 GDPR:** EBBI nie je verejný orgán; podľa známej podoby V1 nie je hlavnou činnosťou rozsiahle spracúvanie zvláštnych kategórií údajov ani rozsiahle pravidelné a systematické monitorovanie jednotlivcov. Zatiaľ sa preto **nepreukázala zákonná povinnosť menovať DPO**; zodpovednosť za GDPR zostáva EBBI. Zmeniť záver, ak sa zmení povaha alebo rozsah spracúvania.
- **Čl. 30 GDPR:** základný register spracovateľských činností je uvedený priamo v nasledujúcej časti. Konkrétne zmluvné postavenie externých poskytovateľov a medzinárodné prenosy sa ešte overia pri záverečnej kontrole dodávateľov v etape 3.

| Riziko V1 | Opatrenie dostupné/požadované | Zvyšná kontrola |
| --- | --- | --- |
| Neoprávnené čítanie rezervácií a kontaktov | RLS, oddelené TEST/PROD, kontakty až po platbe | Preveriť RLS a role na nových aj existujúcich tabuľkách |
| Strata alebo únik prihlasovacieho tokenu | Supabase Auth, MFA pre administrátorov | Nevkladať kľúče do repozitára alebo logov |
| Duplicitná Stripe udalosť/platba | Webhook idempotencia a stavové kontroly | Pri retencii neodstraňovať ochranné identifikátory |
| Neoprávnené zobrazenie presnej adresy/GPS | Presné miesto až po zaplatení; verejná mapa približná | Oprava automatického GPS a URL vo fáze 3 |
| Nesprávne vymazanie údajov a dôkazov | Existujúca GDPR brána OFF; právne pozastavenia | Samostatná fáza 2, TEST dry-run a kontrola dátumov |
| Chyby poskytovateľov a zálohy | Evidencia výpadkov a incidentov, retry worker | Zmluvy a skutočné retenčné lehoty dodávateľov: fáza 3 |
| Neoprávnený prístup k interným registrám | RLS bez public politík a odobraté granty | Overiť SQL kontrolami a manuálnym TEST pokusom |

**Záver etapy 1:** nepovažovať informačný register sám osebe za celé GDPR/DSA compliance. Ide o konkrétnu technickú a procesnú časť BODU 02; na jej uzavretie je nutný úspešný CI, inštalácia TEST SQL a test nového TEST signupu. Schválené retenčné pravidlá sa implementujú v etape 2, zvyšná kontrola dodávateľov a publikovaných textov v etape 3. **PROD nikdy nepreberá túto TEST-only migráciu automaticky.**


## 6. Register spracovateľských činností podľa čl. 30 GDPR – Rentulo V1

**Prevádzkovateľ:** EBBI s. r. o., Rybničná 11, 831 07 Bratislava, SR, IČO 46 306 374. **Kontakt:** `policy@rentulo.com`.
**Kategórie dotknutých osôb:** návštevníci, registrovaní súkromní prenajímatelia a nájomcovia, oznamovatelia, osoby dotknuté incidentmi.
**Všeobecné technické a organizačné opatrenia:** Supabase Auth a RLS, oddelené databázy TEST/PROD, MFA na administrátorské účty, obmedzenie prístupu k osobným kontaktom do zaplatenia rezervácie, bezpečné spracovanie PIN, autentifikované Edge Functions, auditné a kontrolné záznamy; ich reálne nasadenie pravidelne kontrolovať.

| Činnosť / účel | Údaje a osoby | Predpokladaný právny základ | Príjemcovia / lehota |
| --- | --- | --- | --- |
| Registrácia a správa účtu | Používatelia: meno, e-mail, telefón, adresa, identifikátory Auth, jazyk, prijatie podmienok | Zmluva a bezpečnostný oprávnený záujem | Supabase, Vercel; počas účtu, po zrušení iba nevyhnutné právne dôkazy (pravidlá 1, 10, 14) |
| Zverejnenie ponúk a fotografií | Prenajímatelia: názov, opis, fotografie, cena, približná lokalita | Zmluva | Supabase Storage, Vercel, návštevníci; počas ponuky, nepotrebné fotografie do 30 dní po vysporiadaní (pravidlo 8) |
| Rezervácia, PIN, prevzatie a vrátenie | Nájomca a prenajímateľ: účastníci, termíny, kontakty, miesto prevzatia, stavy, PIN dôkaz | Zmluva, ochrana nárokov | Účastníci rezervácie, Supabase; nepotrebné kontakty po 90 dňoch, história spravidla 3 roky, s výnimkami (pravidlá 1–3, 6, 9) |
| Platby, provízie, refundy a výplaty | Používatelia: číslo rezervácie, sumy, Stripe identifikátory, finančné doklady | Zmluva, právna povinnosť, oprávnený záujem | Stripe, príslušné úrady a účtovník; podľa konkrétneho účelu, účtovných/daňových povinností a nárokov (pravidlo 7) |
| Prevádzkové e-maily, SMS a notifikácie | Používatelia: kontakt, stav doručenia, obsah prevádzkovej udalosti | Zmluva, oprávnený záujem, prípadne právna povinnosť | Resend, BulkGate, Supabase; prevádzkové oznámenia 90 dní, bežné doručovacie metadáta 12 mesiacov, nevyhnutné dôkazy dlhšie (pravidlá 4–5) |
| Lokalizácia a geokódovanie | Návštevníci: prechodná poloha zariadenia; prenajímatelia: adresa ponuky a mapové súradnice | Vyžiadaná funkcia služby, podľa konkrétnej činnosti príslušný právny základ | Mapové/geokódovacie služby, Supabase; poloha návštevníka bez trvalého profilu, ochranu URL treba dokončiť (pravidlo 13) |
| Hodnotenia a ochrana pred podvodmi | Účastníci rezervácií: hodnotenia, bezpečnostné stavy, základné identifikátory | Zmluva, oprávnený záujem | Používatelia a Supabase; po účte iba neidentifikujúce hodnotenia, nutné dôkazy podľa nároku (pravidlá 6, 8–9) |
| GDPR žiadosti a moderácia podľa DSA | Žiadatelia, oznamovatelia, dotknutí používatelia: kontakt, dôvod a výsledok konania | Právna povinnosť a ochrana nárokov | Poverené osoby EBBI, prípadne príslušný úrad; do ukončenia účelu a primeranej preukaznej lehoty (pravidlá 14, 16) |
| Bezpečnostné incidenty, logy, monitoring a TEST | Používatelia a technické identifikátory: chyby, PIN pokusy, servisné udalosti | Oprávnený záujem, bezpečnostná/právna povinnosť | Supabase, Vercel, cron-job.org a príslušní dodávatelia; bežné logy 90 dní, PIN pokusy 30 dní, skutočné TEST údaje do 30 dní po teste, incidenty podľa účelu (pravidlá 6, 11, 15) |

**Medzinárodné prenosy a príjemcovia:** nie je možné bez preverenia zmlúv a konkrétnych regiónov účtov tvrdiť, že všetci dodávatelia ukladajú/spracúvajú údaje iba v EHP. Pri každom sa preverí miesto spracúvania, poddodávatelia, DPA, prípadné rozhodnutie o primeranosti alebo SCC, až potom sa register doplní o konkrétne záruky. To nie je schválenie neznámeho prenosu.

**Review registra:** minimálne raz ročne, pri podstatnej zmene V1, pri novej kategórii údajov či novom dodávateľovi. Registračné a retenčné lehoty sa čítajú spolu s `docs/BOD02_GDPR_RETENCNA_POLITIKA_V1.md`; jej schválené rozhodnutia budú konsolidované v etape 2. Ide o interný dokument EBBI a nie verejnú databázu osobných údajov.

## 7. Uvoľnenie do Supabase TEST – iba po samostatnom súhlase

1. V lokálnej vetve z `main` rozbaliť štyri súbory tohto ZIP-u; `npm test` a `npm run build`.
2. Skontrolovať diff, vytvoriť PR do `main`, počkať na GitHub CI a potvrdiť merge. **Merge nevykoná SQL migráciu**.
3. Otvoriť **Supabase TEST** so správnym projektovým referenčným ID. Vložiť a vykonať **celý** SQL súbor migrácie. Skript sa pri nesprávnom projekte alebo zapnutej GDPR bráne preruší pred zmenami.
4. Spustiť **iba čítací** súbor `docs/BOD02_ETAPA1_OVERENIE_TEST.sql`. Očakáva sa `je_test=true`; **5 tabuliek** s `rls_on=true`, `anon_can_read=false`, `user_can_read=false`, `backend_can_read=true`; `backend_can_insert=false` iba pri `gdpr_terms_acceptances`, pri štyroch procesných registroch `true`; **3 triggery** s `active=true`; `gdpr_mazanie_povolene=false`. Agregovaný počet testovacích prijatí môže byť pred prvou novou registráciou 0. Neposielať osobné údaje.
5. Zaregistrovať nový fiktívny TEST účet so všetkými tromi potvrdeniami; v administrátorskom SQL Editore overiť agregovaný počet nových auditných záznamov a verziu. Negatívny test so starou verziou podmienok a pokusy o prístup klientských rolí robiť iba v bezpečnom oddelenom TEST scenári, nie priamym zásahom do reálnych údajov.
6. Zaznamenať dôkaz o TEST validácii. Žiadna z evidencií sama neposiela e-mail, nerozhoduje spor ani nemaže údaje. Na PROD sa nesmie nič spustiť bez nového výslovného rozhodnutia.

## Zdroje

- GDPR čl. 12, 30, 33–35, 37: https://eur-lex.europa.eu/eli/reg/2016/679/oj
- DSA čl. 16, 17, 19–20: https://eur-lex.europa.eu/eli/reg/2022/2065/oj
