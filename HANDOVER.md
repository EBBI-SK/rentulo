# Rentulo – HANDOVER

**Aktuálna technická a prevádzková odovzdávacia dokumentácia | stav k 12. 11. 2026.** Tento dokument nahrádza zastaraný októbrový snapshot. Dátum sa vzťahuje na nižšie uvedené doložené stavy; nie je tvrdením, že všetky externé služby boli práve teraz opätovne testované.

**Pravidlo interpretácie:** **NASADENÉ** = zmena bola skutočne aplikovaná na uvedenom prostredí; **OVERENÉ** = existuje zaznamenaný test konkrétneho správania; **ČAKÁ** = ešte neprebehlo potrebné reálne overenie alebo schválenie. Automatické testy, zelené CI, úspešný Vercel deploy, SQL `Success` a skutočný platený prenájom sú rozdielne dôkazy. Starý HANDOVER (august – október) je v Git histórii a špecializovaných `docs/` runbookoch; jeho niekdajšie pokyny nie sú aktuálne.

## 1. Stručné odovzdanie – čo platí teraz

| Oblasť | Stav k 12. 11. 2026 | Dôkaz / hranica |
| --- | --- | --- |
| Základ Rentulo V1 | **Implementovaný a nasadzovaný oddelene na TEST a PROD** | C2C prenájom vecí iba na území ČR; 5 jazykov, predvolená čeština. Oficiálne otvorenie plánované na **1. 12. 2026**. |
| TEST web | **V prevádzke na `rentulo.eu`** | Vetva `main`, samostatný Supabase/Stripe TEST, `noindex`. |
| PROD web | **Technicky dostupný na `rentulo.com`**, pred spustením | Vetva `production`, Vercel `rentulo-prod`, samostatný Supabase PROD, `noindex` až do launch rozhodnutia. |
| Rezervácie, PIN, storno, refundy, `no_show`, predĺženia | **Implementované; vykonané čiastkové testy** | Kompletný živý český PROD end-to-end test **ČAKÁ**. Nezamieňať testy jednotlivých častí za celý proces. |
| Stripe Connect, výplaty | **Technická integrácia a účty kontrolované** | Skutočné čerpanie/výplata na CZ teste **ČAKÁ**. Prenajímateľ dostáva transfer až po potvrdenom vrátení (okrem `no_show`). |
| Transakčné e-maily, monitorovanie | **Nasadené a samostatne testované** | PROD notifikačné Edge Functions aktualizované 12. 11.; reálny review invite **ČAKÁ** na kvalifikovaný prenájom. |
| Produkčné SMS BulkGate | **Odložená aktivácia** | Rozhodnutie používateľa: neplatiť/neaktivovať teraz; podľa plánu **deň pred spustením** (pri 1. 12. → **30. 11. 2026**), potom skúška českého čísla. |
| GDPR a obchodné podmienky V1.0 | **Pripravené, právne finálne skontrolované a nasadené** | 5 jazykov, účinnosť **od 1. 12. 2026**, evidencia súhlasu v DB. |
| Technické SEO 19A–19C | **Nasadené do PROD 10. 11.** | PR #157, PROD SQL 19B2/19B3 vykonané, SSR/sitemap; zapnutie indexovania **19D ČAKÁ** na štart. |
| POHODA | **Technický export XML/CSV pripravený** | Testovacia metodika a produkčný podklad; reálny import, potvrdenie účtovníčkou a skutočné transakcie **ČAKAJÚ**. |
| Hodnotenia platformy Rentulo | **TEST aj PROD nasadené 12. 11.** | PR #168–170 (TEST), #171 (PROD), SQL + dve Edge Functions PROD, stránka PROD zobrazená bez recenzií. Reálna pozvánka a následná moderácia po českému prenájmu **ČAKAJÚ**. |
| Automatické testy pred PROD hodnoteniami | **931/931 úspešných; 0 chýb** | Zdokumentovaný lokálny beh 12. 11. na vetve pripravujúcej PR #171, 3/3 GitHub/Vercel checks. Nie runtime dôkaz budúceho prenájmu. |

**Záväzná pracovná metóda:** jedna vec naraz; nevymýšľať ďalšie audity už potvrdených oblastí. Návrh → súhlas → ZIP iba zmenených súborov → vlastná vetva → potrebné testy → commit/push → PR → CI → merge → cielené overenie. Do PROD (vrátane SQL, Edge Functions, Stripe, SMS, SEO a DNS) sa zasahuje **iba po výslovnom rozhodnutí**. Neprenášať celú `main` do `production` kvôli jednej funkcii.

## 2. Prostredia a identifikátory

| Parameter | TEST | PROD |
| --- | --- | --- |
| Doména | `https://rentulo.eu` | `https://rentulo.com` |
| GitHub vetva | `main` | `production` |
| Vercel projekt | `rentulo` | `rentulo-prod` |
| Supabase projekt | `vspposovhdgvbeukoivh` | `tfvgxrdjrpicgtvovehl` |
| Build target | `RENTULO_DEPLOY_TARGET=test` | `RENTULO_DEPLOY_TARGET=prod` |
| Stripe | TEST | oddelené LIVE nastavenia, finálny reálny český test čaká |
| Indexácia | `noindex` trvalo ako test | `noindex` až do výslovného launch/SEO 19D |

Vercel PROD **12. 11.**: projekt `rentulo-prod` sleduje vetvu **`production`**, doména `rentulo.com`; v prostredí Production existujú `RENTULO_DEPLOY_TARGET`, `RENTULO_SUPABASE_URL` a `RENTULO_SUPABASE_PUBLISHABLE_KEY`. Na screenshote sa overila **existencia**, nie zobrazenie tajných hodnôt. Build konfigurovaný cez repozitárový `vercel.json`, bez dodatočného override. Nemeniť toto nastavenie len kvôli dokumentácii.

**Bezpečnosť oddelenia:** `.eu` sa nesmie automaticky presmerovať na `.com`; TEST používateľov, ponuky, recenzie, Stripe platby, databázové záznamy ani secrets nekopírovať do PROD. PROD-specific SQL v `supabase/prod-release-*` sa nedáva automaticky do `supabase/migrations/`. Produkčné procesy používajú vlastné prostredie a kľúče. Nezverejňovať skryté hodnoty secrets alebo osobné údaje.

## 3. Obchodný model a pravidlá V1

- **Cieľová krajina:** prenájmy/pickup vo V1 iba **Česká republika**. Registrácia je možná pre iné štátne príslušnosti; krajinu ponuky/prevzatia kontroluje aplikácia. Predaj podnikateľom/PRO a používateľské dopyty patria do budúcej verzie.
- **Účastníci:** ne-podnikajúce súkromné osoby, prenajímateľ a nájomca. Prenájom sprostredkúva EBBI s. r. o. Zatiaľ nie sú povolené dopravné prostriedky (autá, motorky, bicykle, kolobežky, lode/kajaky, prívesy a podobné), nebezpečné a nezákonné ponuky.
- **Cena:** najmenej **100 CZK/deň** za ponuku, ceny a Stripe toky v **CZK**. Platformová provízia **10 % z rezervácie, minimálne 70 CZK za rezerváciu**. Minimum 70 CZK sa vzťahuje na nové rezervácie, historicky uložené provízie sa nemenia. Pri doplatku za predĺženie sa minimum neuplatňuje znova na tú istú rezerváciu.
- **Referenčné čísla:** verejná ponuka `N-000001…`, rezervácia `R-000001…`; v databáze a autorizáciách zostávajú UUID.
- **Obrazovky:** homepage s mapou a šiestimi hlavnými kategóriami (*Domácnost, Zahrada, Stavba, Hobby, Párty, Ostatní*), výsledky, detail, ponuka, moje ponuky/rezervácie, história, nastavenia, legálne stránky, nová stránka skúseností. Aktívna ponuka vyžaduje aspoň 1 fotografiu. UI aj e-maily podporujú CZ/SK/EN/DE/PL.

**Pozor na starú dokumentáciu:** už neplatí minimálna provízia 50 CZK, 6-hodinový cutoff bežného storna ani tvrdenie, že výplata majiteľovi nastane po PIN-e. Aktuálne pravidlá nižšie zodpovedajú novým podmienkam V1.0 a vykonaným novembrovým zmenám.

### 3.1 Rezervácia, schvaľovanie a platba

1. Nájomca vytvorí žiadosť (**`pending`**) na presný termín, čas a miesto; systém nedovolí kolízie dostupnosti.
2. Prenajímateľ schváli alebo odmietne do **24 h od žiadosti** a vždy pred dohodnutým časom prevzatia. Neschválená žiadosť po lehote expiruje.
3. Pri schválení viac ako 24 h pred prevzatím musí byť platba dokončená najneskôr 24 h pred prevzatím. Pri neskoršom schválení je lehota na úhradu najviac **30 minút**, nikdy nie po prevzatí. Pri veľmi blízkom termíne sa postupuje podľa checkout pravidiel konkrétnej rezervácie.
4. Stav **`paid`** vzniká až po dôveryhodnom Stripe potvrdení. Po platbe sa odomknú potrebné kontakty a neveřejné informácie; nie pred platbou.
5. PIN + výslovné potvrdenie majiteľa **„Předat věc“** prepnú na **`picked_up`**. Majiteľ potom po reálnom vrátení potvrdí **`returned`**.
6. Existujú aj správne zdôvodnené stavy expirácie/storna a zaplateného **`no_show`**, ktoré nie sú to isté ako riadne vrátenie.

### 3.2 PIN, prevzatie a vrátenie

- PIN je **6-miestny**, jednorazový a serverovo chránený; po troch nesprávnych pokusoch platí **15-minútový zámok**.
- Možno ho použiť **od 2 hodín pred časom dohodnutého prevzatia až do dohodnutého času vrátenia** (časové pásmo `Europe/Prague`). Neskoršie prevzatie počas zaplateného intervalu je možné po dohode strán; dohodnutý koniec sa neposúva.
- PIN sa zadáva v používateľskom toku cez **„Zadat PIN“** na úvodnej stránke so správnym nasmerovaním do *Moje nabídky*. Samotný údaj PIN bez finálneho potvrdenia fyzického odovzdania nesmie predstavovať odovzdanie.
- **Výplatu nespúšťa PIN ani `picked_up`:** po skutočnom vrátení majiteľ potvrdí `returned`, čím vzniká oprávnenie na spracovanie owner transferu.
- **`no_show`:** ak zaplatená vec do dohodnutého konca nebola prevzatá, backend po konci obdobia rezerváciu bezpečne uzavrie a pripraví finančné vysporiadanie. Automatický transfer neznamená, že majiteľ preukázateľne splnil všetky povinnosti; oprávnený spor sa musí vyriešiť osobitne.

### 3.3 Storno, refund, predĺženia a spory

- **Bežné storno:** pri rezerváciách uzatvorených podľa podmienok V1.0 **viac než 24 h pred dohodnutým prevzatím**; dostupné podľa roly **aj po platbe**. Staršie rezervácie sa posudzujú podľa podmienok platných pri ich vytvorení.
- **Nájomca ruší zaplatenú rezerváciu v lehote:** refund zaplatenej sumy mínus iba **preukázané nevratné externé poplatky Stripe**; rozpis pred potvrdením.
- **Majiteľ ruší zaplatenú rezerváciu:** nájomca dostane **plný refund**; externé náklady má niesť majiteľ (evidencia dlhu a splatnosť **7 dní**, pri omeškaní blokácia schvaľovania nových rezervácií). Ak vec nemôže odovzdať ani po cutoffe, existuje osobitná zdokumentovaná výnimka pred časom vrátenia; nie všeobecné neskoré storno.
- **Predĺženia:** zvlášť schválené doplatky a Stripe Checkout; bezpečné retry, evidencia oddelených zdrojových finančných záznamov. Pôvodná minimálna provízia sa nesmie pri predĺžení uplatniť druhý raz.
- **Spor:** evidenčné, auditované vetvy pri platobnom spore a výnimočnom finančnom vysporiadaní. Výnimka nie je falošné prepnutie fyzického `picked_up` na `returned`; pri kladnom výsledku kartového sporu musí byť opäť zosúladená finančná evidencia.
- Všetky refundy a transfery sa viažu na **skutočné Stripe ID/stav a dôveryhodné serverové dôkazy**, nie iba na zmenu UI alebo odpoveď klienta.

## 4. Platby Stripe a bezpečné finančné toky

- Integrácia: Stripe Checkout / PaymentIntent, Connect **separate charges & transfers**, CZK → CZK; webhook `payment_intent.succeeded` potvrdzuje platený stav a audit.
- Pri štandardnom prenájme sa **owner transfer vykoná až po potvrdení vrátenia** (majiteľ, `returned`), pri zaplatenom `no_show` po uzavretí celého obdobia. Pri zlyhaní existuje bezpečný retry transferov (napr. plánovanie každých 5 minút). Transfer na Stripe účet ≠ bankové pripísanie.
- Výnimočné storno majiteľa môže vyvolať jeho externý dlh, refund nájomcovi a samostatný upomienkový proces. Kartové námietky majú vlastný audit; neignorovať prípadné pozastavenie payoutu zo strany Stripe.
- **Skutočný end-to-end platobný test v ČR zostáva otvorený.** Neopakovovať už overené nastavenia Stripe Connect, identity či bankového spojenia bez konkrétneho nového incidentu; pri CZ teste overiť fyzickú udalosť, webhook, refund (ak je relevantný), transfer a následný bankový payout.

## 5. Komunikácia, notifikácie a crony

- **Resend:** rezervačné e-maily, prevádzkový odosielateľ **`rentulo@rentulo.com`**, konkrétne CTA podľa akcie, jazyky CZ/SK/EN/DE/PL. Supabase Auth šablóny fungujú nezávisle od rezervačného workeru; potvrdenie e-mailu môže byť dvojstupňové (starý aj nový e-mail).
- **Outbox:** `public.reservation_notification_deliveries`, e-mailová evidencia `public.reservation_email_deliveries`. `process-reservation-notifications` spracúva frontu, `send-reservation-email` e-mailové udalosti; serverová autorizácia, retry a zabezpečené deduplikácie. Nie každá udalosť má oboch príjemcov; príjemca sa určuje podľa obchodnej akcie.
- **SMS BulkGate:** používateľský opt-in a bezpečná normalizácia čísla. Produkčné reálne SMS **zostávajú odložené**, plán aktivovať deň pred oficiálnym spustením, s jediným potrebným českým live testom. Neskúšať opakovane alebo neplatiť teraz bez rozhodnutia.
- **Plánovanie:** databázové Supabase crony riešia frontu notifikácií, retry výplat, platené `no_show`, follow-up vrátení, expiráciu a upomienky; **cron-job.org** je externý monitor, nie druhý odosielací worker. TEST a PROD majú samostatné ciele a secrets. História úspešných kontrol je z októbra/novembra; nevyvodzovať nepretržitý budúci beh zo starého screenshotu.
- Pri probléme: najprv čítať stav existujúceho konkrétneho jobu/outbox riadku a poslednú chybu, **nevytvárať ďalšie crony** ani nenavrhovať znovu celé testovanie, keď stačí nájsť príslušný incident.

## 6. Hodnotenia samotnej platformy – TEST aj PROD

**Dôležité rozlíšenie:** používateľské **hodnotenia nájomcu/majiteľa v Historii** zostávajú bez zmeny. Nové `platform_reviews` hodnotia **službu Rentulo**.

### 6.1 Správanie a bezpečnosť

- Stránka `zkusenosti.html` v piatich jazykoch; verejný zoznam len pre **publikované** recenzie. Súhrn ukazuje počet, správny priemer 1–5 vrátane čiastočných hviezdičiek. Pri nulovom počte žiadne fiktívne recenzie.
- Formulár dostupný prihlásenému účtu, ktorý bol **prenajímateľom alebo nájomcom v skutočne dokončenom prenájme** (`returned` a dôveryhodné `gdpr_finalized_at`). Používateľ môže mať **jedno hodnotenie platformy**, ktoré môže upraviť; nová verzia sa znova moderuje.
- Hodnotenie 1–5 hviezdičiek, komentár nepovinný (limit 500 znakov). Pri vložení stav **`pending`**. Zverejní sa po neutrálnej kontrole spamu, urážok a osobných údajov; **kladné aj záporné legitímne skúsenosti** sa publikujú. Pred uložením nezverejňovať celé meno; verejne iba krstné meno a iniciála.
- Homepage pás skúseností je **kompaktný, nepremáha hlavný obsah**; zobrazí sa iba po dostupnosti skutočnej schválenej recenzie s textom. SQL/RLS/RPC nezverejňujú účtové ID, e-maily ani čakajúce komentáre.
- **Pozvánka iba e-mailom, nie SMS:** približne **24 h po prvom kvalifikovanom potvrdenom vrátení po aktivácii** (najviac raz na účet), rešpektuje opt-out a nikdy sa netvorí pri `no_show`. Autorizovaný odkaz smeruje cez prihlásenie späť na `zkusenosti.html?hodnotit=1`.
- Nové databázové tabuľky: `platform_reviews`, `platform_review_activation`; bezpečné RPC na oprávnenie, vlastné hodnotenie, vloženie, verejný súhrn a zoznam. Event `platform_review_invite` bol pridaný do allowlistu existujúcich notifikačných tabuliek **bez odstránenia pôvodných udalostí**.

### 6.2 Doložené nasadenia 12. 11. 2026

| Etapa | Dôkaz |
| --- | --- |
| TEST vývoj | PR **#168** (základ), **#169** (kompaktný pás a vysvetlenie moderovania), **#170** (priemer/hviezdičky); vykonaná TEST SQL migrácia, nasadené notifikačné Edge Functions. |
| TEST užívateľský scenár | Vložené 4-hviezdičkové testovacie hodnotenie, stav `pending`; po schválenej moderácii `published`; na webe 4,0 a štyri vyplnené + jedna prázdna hviezda. |
| PROD web | PR **[#171](https://github.com/EBBI-SK/rentulo/pull/171)** zlúčený do `production`, merge **`44f7dbe`**, 3/3 kontrol prešlo. |
| PROD SQL | `supabase/prod-release-20261112-platform-reviews/migrations/20261112160000_platform_reviews_v1_PROD.sql` vykonaný 12. 11. v správnom PROD Supabase, `Success. No rows returned`. |
| PROD Edge Functions | `send-reservation-email` a `process-reservation-notifications` nasadené 12. 11. cez Supabase CLI na **`tfvgxrdjrpicgtvovehl`**, obidve úspešné. |
| PROD vizuálny výsledok | `https://rentulo.com/zkusenosti.html` otvorená a správne zobrazená; **žiadne testovacie recenzie** z TEST sa nepreniesli. |
| Automatické testy pred PR | 23/23 cielených a **931/931 kompletných**, 0 chýb; TEST build úspešný; GitHub/Vercel 3/3 kontroly. |

**Skutočné poradie produkčných krokov 12. 11.:** zlúčenie PR #171 → aktualizácia lokálnej `production` → PROD SQL → Edge Function `send-reservation-email` → Edge Function `process-reservation-notifications` → zobrazenie produkčnej stránky. Pôvodný runbook [PLATFORM_REVIEWS_V1_PROD.md](docs/PLATFORM_REVIEWS_V1_PROD.md) je prednasadzovací plán, nie pokyn opakovať už vykonané kroky.

**Ešte neoverené (neprezentovať ako hotové):** reálny PROD prenájom v ČR, po ňom vznik jednej plánovanej pozvánky +24 h, jej reálne doručenie, odoslanie používateľskej recenzie a následné neutrálne zverejnenie na PROD. Bez vytvárania falošných recenzií na produkcii.

## 7. SEO a vizuál (body 19A–19D)

- Produkčný balík **19A–19C** bol 10. 11. 2026 nasadený do PROD cez **PR #157**; zahŕňa technické SEO, aktualizáciu homepage, kategórie/podkategórie/mestá, dynamickú sitemap, `canonical`, Open Graph, JSON-LD, interné odkazy, optimalizáciu fotografií, rozdelenie jazykových dát a **SSR prvých štyroch verejných výsledkov** pri nefiltrovanom dopyte. Testované aj SEO stĺpce `public_offers.subcategory_slug` / `seo_city_slug` v samostatných PROD migráciách.
- Doložená hodnota Lighthouse **Performance 99 / LCP 2,3 s** patrí TEST meraniu, **nie PROD garancii**.
- **19D ČAKÁ na schválené spustenie:** vyriešiť prístup verejnosti, až v deň oficiálneho štartu odstrániť `noindex` iba z PROD, preveriť `robots.txt`, kanonické URL, sitemap, Google Search Console a začať sledovať indexáciu/CWV. TEST a preview musia zostať `noindex`.
- Pre rozpracovanie nového SEO návrhu je zdrojom [docs/SEO_19_PROD_RELEASE_20261110.md](docs/SEO_19_PROD_RELEASE_20261110.md); jeho text v prítomnom čase „pred nasadením“ je **historický plán**. Dokumentáciu pri aktualizácii čítať v kontexte dátumu.

## 8. Právne V1.0, GDPR a administrácia

- **Prevádzkovateľ:** EBBI s. r. o., Rybničná 11, 831 07 Bratislava, SR, IČO **46 306 374**. Prevádzkový kontakt `rentulo@rentulo.com`; ochrana súkromia `policy@rentulo.com`.
- **Právne dokumenty V1.0** (*Obchodné podmienky* a *Ochrana osobných údajov*) v CZ/SK/EN/DE/PL, **účinnosť od 1. 12. 2026**. Nasadené na TEST aj PROD, prijatie terms/privacy sa verziuje v databáze. Finálna právna kontrola pre základný balík bola vykonaná v novembri. Osobitný právny aspekt publikovania recenzií platformy (skrátené meno a moderovanie) je uvedený ako upozornenie v review runbooku; nepredstierať automatickú novú právnu revíziu.
- **GDPR/DSA:** RLS, evidencie súhlasov, bezpečné procesy na deaktiváciu účtu, moderovanie podnetov/incidentov, retencia, právne pozastavenie. Časť citlivých retenčných/mazacích brán má samostatné schvaľovacie pravidlá; bez osobitného rozhodnutia ich neaktivovať.
- **Dodávatelia:** Supabase, Vercel, Stripe, Resend, BulkGate, Geoapify EU, OpenStreetMap a statické pomocné služby podľa účinných GDPR informácií. Externá dokumentácia DPA/dátových regiónov a posúdenia sa riadi samostatnými dôkazmi; nevytvárať nové otvorené body len na základe zastaraného októbrového textu.
- **Daňové postavenie:** slovenská spoločnosť, aktuálne neplatiteľ všeobecnej DPH, registrácia §7a; priebežné daňové/OSS/DAC7 otázky podľa účtovníčky a právnych podkladov. Samotný tento dokument nie je daňové stanovisko.

## 9. POHODA – účtovný export provízií

- Technická príprava XML/CSV pre **Ostatnú pohľadávku**, predkontácia **`Provizie Rentulo` (MD 315100 / DAL 602100)**, cena a provízia v CZK, kontrolný prepočet EUR; exportér: `scripts/export-pohoda-commissions.mjs`, pomocné skripty `scripts/pohoda-commissions.mjs`, zdrojové SQL v `docs/sql/`.
- **Dátum dodania pri riadnom `returned`:** dátum dôveryhodného potvrdenia vrátenia `reservations.gdpr_finalized_at` podľa `Europe/Prague`, nie dátum Stripe transferu. Pre CZK/EUR kurz zvoliť **posledný referenčný kurz ECB zverejnený striktne pred dňom dodania**; víkendy/sviatky = posledný dostupný predchádzajúci kurz.
- Pôvodná kladná provízia a kladná provízia za predĺženie sa evidujú samostatne; nulová dodatočná provízia nevytvára doklad. Neisté refundy, poplatky Stripe za extension, `no_show`, nesúlad dátumu alebo spory sú **manual-review blokátory exportu**, nie dôvod dopĺňať vymyslené údaje.
- **Stav:** technické riešenie a TEST/PROD podklady pripravené; **reálny import do POHODY a potvrdenie účtovníčkou na živých transakciách zatiaľ ČAKÁ**. Žiadne automatické účtovné exporty s produkčnými údajmi do verejného repozitára.
- Detailný metodický dokument: [docs/POHODA_PROVIZIE_TEST.md](docs/POHODA_PROVIZIE_TEST.md). Pravidlá pre daňové dátumy nesmie nahradiť starý HANDOVER s platbou/transferom ako dátumom dodania.

## 10. Technická štruktúra a bezpečné prevádzkové zásahy

| Časť | Hlavné zdroje / poznámky |
| --- | --- |
| Statické UI a i18n | `index.html`, `zkusenosti.html`, `css/`, `js/`, `scripts/` |
| Build a SEO | `scripts/build-site.mjs`, `scripts/seo-pages.json`, `api/sitemap.mjs`, `api/results-page.mjs`, `api/offer-page.mjs`, `vercel.json` |
| Supabase | `supabase/functions/` (Auth, checkout, transfer, pin, notifikácie), `supabase/migrations/`, `supabase/prod-release-*/` |
| Hodnotenia | `js/platform-reviews.js`, `css/platform-reviews.css`, `zkusenosti.html`, `tests/platform-reviews-v1.test.mjs` |
| E-maily | `supabase/functions/send-reservation-email/index.ts`, `supabase/functions/process-reservation-notifications/index.ts`, `_shared/notification-email-policy.mjs` |
| POHODA | `scripts/export-pohoda-commissions.mjs`, `scripts/pohoda-commissions.mjs`, `docs/POHODA_PROVIZIE_TEST.md` |
| Testy | `npm test` = Node test suite; `npm run build` = statický predvolený TEST build |

**Nedávať do ZIP/repa:** `.env`, service role/API secrets, exporty používateľov, bankové výpisy, Stripe finančné reporty s osobnými údajmi, súkromné XML/CSV, tokeny či DB backupy. Verejný Supabase publishable key nie je service role; prístup riadia RLS a backend. Fotografie a presné pickup kontakty majú vlastné súkromné pravidlá a po `paid` prístupové brány.

**Build a deploy sú oddelené:** `npm run build` predvolene vytvorí TEST `dist`; na PROD treba skutočné Vercel Production environment variables. Git merge nespúšťa Supabase SQL ani Edge Function deploy. Pri PROD migrácii najprv správny projekt/ref, konkrétny súbor, potrebný preflight podľa release runbooku a **výslovný súhlas**. Nikdy nespúšťať všetky historické migrácie paušálne.

**Pri incidente:** najprv identifikovať konkrétnu rezerváciu a dôkaz (`status`, dôvod, Stripe PaymentIntent/charge/transfer/refund, outbox/log, posledný worker error); zmeny vykonať iba cielene, append-only audit ponechať. Neobchádzať zámky, neprepisovať fyzické vrátenie alebo finančné stavy ručne len na „opravu obrazovky“. Pri vážnej produkčnej chybe je možné pozastaviť prístup a obnoviť posledný overený Vercel deployment; samostatné DB a Stripe účinky vyžadujú vlastný postup obnovy, Git rollback ich automaticky nevráti.

## 11. Zostávajúce kroky pred oficiálnym štartom (bez opakovania hotového)

1. **Reálny český end-to-end test:** na schválenom PROD scenári v ČR overiť vytvorenie ponuky/rezervácie, úhradu českou kartou, PIN a skutočné prevzatie, potvrdené vrátenie, Stripe owner transfer a následné vyplatenie. Pozorne zapísať prípadné rozdiely; nedotknúť sa existujúcich úspešných interných testov bez dôvodu.
2. **Hodnotenie po skutočnom prenájme:** až po legitímnej novej dokončenej rezervácii overiť vytvorenie jednej pozvánky +24 h, doručenie, autorizované vloženie, stav `pending`, moderovanie a zverejnenie. Netvoriť ani nevystavovať falošné produkčné recenzie.
3. **BulkGate:** až deň pred reálnym spustením (pri pláne 1. 12. je to 30. 11.) schválenie platenej aktivácie a otestovanie českého čísla. Dovtedy služby/zákaznícke súhlasy neprestavovať.
4. **Prevádzkový štart 1. 12. 2026:** odstrániť/nezobrazovať testovacie údaje podľa schváleného plánu, potvrdiť finálne produktové/platobné a komunikačné podmienky, sprístupnenie verejnosti, právnu účinnosť a kontakty. Nie je to opakovanie technického auditu; len posledná cielená launch kontrola.
5. **SEO 19D v deň štartu:** PROD prístup, odstránenie `noindex` len z `.com`, sitemap a Search Console; `.eu` a preview ponechať neindexované.
6. **POHODA po reálnych transakciách:** export skutočných finančných údajov, kontrola účtovníčkou a skúšobný import (najprv na kópii účtovníctva); nenechať to blokovať technicky hotové časti Rentula bez novej zákonnej požiadavky.

**Neriešiť znova bez novej chyby:** úspešne ukončené GitHub PR, základné Vercel projektové prepojenie, staré cron nastavenia, staré TEST rezervácie, povolenia na posielanie notifikácií, interné Stripe nastavenia alebo dnes už dokončené právne verzie. Nové overenia iba tam, kde ešte neexistuje dôkaz *skutočnej produkčnej udalosti*.

## 12. Doložené míľniky a historické referencie

| Dátum | Udalosť | Stav historického dôkazu |
| --- | --- | --- |
| 8.–20. 10. 2026 | GDPR/DSA, retencia, SMS testy, časové PIN a rezervačné pravidlá | Pôvodné snapshoty v Git histórii / `docs/BOD02_*`, `docs/BOD13_*`; staré predimplementačné upozornenia sa nemajú čítať ako dnešný stav. |
| 23. 10. | Zvýšenie minima provízie na **70 CZK**, finálna geokódovacia a produktová príprava | Platné pre nové rezervácie. |
| 3.–5. 11. | Emailové notifikácie, no-show/return-followup crony, účtovné podklady, právne V1.0 | Priebežné TEST/PROD overenia, samotný CZ reálny test zatiaľ odložený. |
| 5. 11. | Právne V1.0 CZ/SK/EN/DE/PL, účinnosť od 1. 12. | TEST/PROD nasadené; verzia prijatia v DB. |
| 10. 11. | Aktualizácia storna v TEST/PROD; platené storno **viac ako 24 h** pred prevzatím | PR #160 (TEST), #161 (PROD), overené texty a refund pravidlá. |
| 10. 11. | SEO 19A–19C nasadené do PROD | PR #157; 19D odložené na ostrý štart. |
| 10. 11. | POHODA – pripravený technický export, Stripe payout copy upravená | Reálny import a live CZ payout ešte čakajú. |
| 12. 11. | TEST hodnotenia a tri UI úpravy | PR #168, #169, #170; dôkaz pending → published pre 4★ TEST. |
| **12. 11.** | **PROD hodnotenia** | **PR #171 → `production` merge `44f7dbe` → SQL → obidve Edge Functions → stránka PROD zobrazená bez testovacích recenzií**. |

**Dokumentačný princíp:** tieto dve hlavné `.md` súbory sa majú aktualizovať pri významnom rozhodnutí alebo nasadení. Konkrétny dátum, vetva, PR/commit, či išlo o TEST alebo PROD, vykonaná SQL/funkcia a to, čo ešte čaká na reálny test, musia byť napísané jednoznačne. Detailné staré testovacie logy nie je potrebné pravidelne prepisovať alebo opätovne vykonávať; sú zachované v Git histórii a špecializovaných runbookoch.
