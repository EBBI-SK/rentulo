# RENTULO V1 – Retenčná politika osobných údajov

**Verzia návrhu:** 1.0  
**Dátum vypracovania a aktualizácie:** 20. 10. 2026  
**Stav:** NÁVRH NA INTERNÉ SCHVÁLENIE – zatiaľ nie je účinná  
**Prevádzkovateľ:** EBBI s. r. o.  
**GDPR kontakt:** policy@rentulo.com  
**Rozsah:** Rentulo V1 – platforma pre prenájom vecí medzi súkromnými osobami v ČR  
**Východisko:** GitHub `EBBI-SK/rentulo`, `main` po PR #28 (merge `2250ed0`); GDPR ochrana z PR #27 nainštalovaná iba v Supabase TEST  
**Prostredia:** TEST `rentulo.eu`; PROD `rentulo.com` – bez zásahov

## 1. Účel a zásady

Tento interný dokument určuje, **ktoré osobné údaje uchovávame, prečo, odkedy sa počíta lehota a čo sa po jej uplynutí odstráni**. Jeho schválenie samo osebe **nespustí žiadne mazanie**. Následne sa musia zosúladiť verejné GDPR informácie vo všetkých piatich jazykoch.

Podľa čl. 5 ods. 1 písm. c) a e) GDPR musí byť rozsah a doba uchovávania primeraná účelu; podľa čl. 5 ods. 2 musí EBBI vedieť tento postup preukázať. Výmaz podľa čl. 17 GDPR má výnimky napríklad pre zákonné povinnosti a preukazovanie, uplatňovanie alebo obhajobu právnych nárokov. **Dĺžka premlčacej doby nie je automatickým povolením uchovávať všetky osobné údaje rovnako dlho.**

Rozlišujeme: **(a)** kontakty potrebné iba na realizáciu prenájmu, **(b)** nevyhnutné zmluvné a právne dôkazy, **(c)** zákonné účtovné/daňové doklady a **(d)** technické a bezpečnostné záznamy. Pre každú skupinu sa posudzuje samostatný účel, právny základ a lehota.

**Bezpečnostné pravidlo:** Pokiaľ nie je schválená konkrétna lehota a technicky overené jej uplynutie, neaktivujeme hromadné ani automatické čistenie historických údajov. V Supabase TEST je brána `gdpr_reservation_contact_cleanup_gate.is_enabled = false`.

## 2. Retenčná tabuľka – pracovný návrh pre V1

| Údaje / tabuľky | Návrh lehoty a začiatok počítania | Následný postup a obmedzenia | Rozhodnutie |
|---|---|---|---|
| Účet a priamy profil (`profiles`, `auth.users`) | Počas účtu; pri oprávnenom zrušení použiť už otestovanú deaktiváciu | Vymazať priame identifikátory, zamedziť prihláseniu; finančné/rezervačné väzby posúdiť osobitne | Mechanizmus TEST otestovaný; rozsah zvyšných väzieb sledovať |
| Ponuky a fotografie (`offers`, Storage `offer-photos`) | Počas zverejnenia, prípadne potrebného riešenia nadväzujúcich rezervácií/nárokov | Skryť a odstrániť nadbytočný obsah; otestované čistenie pri zrušení účtu ponechať | Existujúci proces ponechať |
| Meno, e-mail, telefón nájomcu (`reservations.renter_*`) pri **definitívne uzavretej nezaplatenej** rezervácii | **Pracovný návrh: 90 dní od preukázateľného uzavretia** (`cancelled`, `expired`, `rejected`), iba bez platobného záznamu, sporu a ďalšieho dôvodu uchovania | Po lehote vyprázdniť tieto 3 polia, nie rezerváciu; `pending` Stripe platobný záznam **blokuje** zásah. Pred aktiváciou doplniť technické overenie dátumu uzavretia a 90 dní | Návrh EBBI na zdôvodnenie a schválenie; zatiaľ NEMAZAŤ |
| Kontakty majiteľa a presné údaje prevzatia (`reservations.owner_*`, `pickup_*`) | **Návrh 90 dní** po skutočnom ukončení a vysporiadaní iba tam, kde nejde o dôkaz prenájmu/nároku | Pri uskutočnenej platenej rezervácii najprv oddeliť nevyhnutný dôkaz od čisto prevádzkových kontaktov; nič plošne nemazať | Individuálne posúdiť a technicky pripraviť |
| Rezervačná a zmluvná história (`reservations`) bez nadbytočných kontaktov | **3 roky iba orientačný návrh** pre bežné prípady od relevantnej splatnosti alebo vzniku možnosti uplatniť nárok; príslušné právo môže stanoviť odlišnú lehotu | Zachovať len nutné údaje pre spor/zmluvný nárok; nemažať kompletné riadky bez kontroly platieb a väzieb | Overiť podľa druhu nároku a rozhodného SK/CZ práva |
| Platby, refundy, prevody, náklady, dlhy (`payments`, `reservation_cancellations`, `reservation_cancellation_cost_items`, `owner_cancellation_debts`) | Podľa funkcie záznamu, zákonných povinností a nárokov; **konkrétny režim odložený na účtovníčku** | Podľa § 35 zákona č. 431/2002 Z. z. sa určené účtovné doklady spravidla uchovávajú 10 rokov nasledujúcich po roku, ktorého sa týkajú. Nie každý SQL riadok je účtovným dokladom | Do potvrdenia nemažať ani neskracovať |
| Hodnotenia (`reviews`) | Počas odôvodneného zverejnenia a vybavenia námietok; po skončení účelu preskúmať | Odstrániť alebo odosobniť autora a osobné údaje v texte, ak už nie sú potrebné | Interné pravidlo na schválenie |
| Oznámenia v účte (`notifications`) | **Návrh 90 dní od vytvorenia/doručenia**, pokiaľ nie sú právnym dôkazom | Odstrániť bežné oznámenia; rozhodnutia, spory a významné výzvy posúdiť osobitne | Interný návrh na schválenie |
| Staršie e-mailové doručenky (`reservation_email_deliveries`) | **Návrh 90 dní na nadbytočnú e-mailovú adresu** iba ak nie je potrebná na preukázanie príjemcu. Dôkaz o významnej výzve/oznámení môže vyžadovať dlhšie uchovanie podľa nároku | Rozlíšiť technický detail od preukázania doručenia; zachovať nevyhnutné údaje o adresátovi, udalosti a čase v odôvodnenom rozsahu | Zatiaľ nemazať; 6 záznamov čaká na samostatné posúdenie |
| Novšie e-mailové a SMS udalosti (`reservation_notification_deliveries`) | **Návrh 12 mesiacov** pre bežné doručovacie metadáta od uzavretia udalosti; právne významný dôkaz podľa príslušného nároku | Minimalizovať `last_error`, `provider_message_id` a ďalšie identifikátory podľa účelu; nie automaticky odstrániť všetky dôkazy po 12 mesiacoch | Interný návrh s výnimkami |
| PIN pokusy a blokácie (`reservation_pickup_security`) | **Návrh 30 dní** od ukončenia rezervácie pre neúspešné pokusy; samotný dôkaz prevzatia podľa potreby dlhšie | Technické pokusy mazať oddelene od dôkazu úspešného prevzatia | Overiť technickú oddeliteľnosť |
| Stripe technické udalosti (`stripe_webhook_events`) | **Návrh 180 dní** od úspešného a definitívneho spracovania, bez nevyriešeného transferu, refundu, reklamácie alebo retry | Odstrániť iba nadbytočné technické informácie, nie povinné finančné podklady | Overiť prevádzkovú potrebu a Stripe procesy |
| Nevrátenie, incidenty a škody (`reservation_return_incidents`) | **Nie jednotne 3 roky:** lehota podľa druhu nároku, rozhodného práva, vyriešenia a prípadného konania | Po zániku dôvodu odstrániť osobné opisy a dôkazy; počas konania uplatniť zdokumentované pozastavenie čistenia | Právne posúdiť; riešenie sporov patrí do BODU 03 |
| Monitoring a chyby (`reservation_notification_monitor_alerts`, prevádzkové logy) | **Návrh 90 dní od vyriešenia incidentu**, iba ak neprebieha vyšetrovanie | Odstrániť staré logy vrátane osobných detailov v chybových hláseniach; preveriť aj lehoty dodávateľov | Interný návrh na schválenie |
| Evidencia prijatia podmienok (`auth.users` metadáta; budúca serverová evidencia) | Počas relevantného vzťahu a odôvodnenej lehoty na nároky; **3 roky je orientačná, nie univerzálna hranica** | Zachovať preukázateľnú verziu, jazyk a čas prijatia len nevyhnutne dlho; súčasné klientské metadáta nie sú nemenný audit | Právne a technicky spresniť pred spustením |
| DAC7 | Len ak príslušná povinnosť platí; čas a rozsah určiť podľa stanoviska FS a príslušného zákona | Nevymazávať povinné záznamy | ČAKÁ SA NA ODPOVEĎ FS |
| Testovacie osobné údaje | **Návrh do 30 dní od ukončenia konkrétneho testu**, ak sa neuplatní iný dôvod | Vymazať skutočné osobné údaje; pri vývoji uprednostniť fiktívne | Interný návrh na schválenie |

**Pozor:** 30/90/180 dní, 12 mesiacov a 3 roky sú **interné pracovné návrhy**, nie automatické lehoty určené GDPR. Každá kategória musí mať odôvodnenie, začiatok lehoty, pravidlo výnimky a bezpečný spôsob odstránenia.

## 3. Právne porovnanie – Slovensko a Česko

- **GDPR (EÚ 2016/679):** čl. 5 (minimalizácia, obmedzenie uchovávania, zodpovednosť), čl. 6 (právny základ), čl. 13 ods. 2 písm. a) (lehota alebo kritériá), čl. 17 (výmaz a výnimky), čl. 30 a 32 (evidencia a bezpečnosť, ak sa uplatnia).
- **Slovenský zákon č. 18/2018 Z. z. o ochrane osobných údajov:** dopĺňa vnútroštátny rámec; pri spracúvaní Rentula podliehajúcom GDPR je základným priamo použiteľným predpisom GDPR.
- **Slovenský Občiansky zákonník č. 40/1964 Zb.:** § 101 – všeobecná premlčacia doba 3 roky; § 106 – pri škode osobitné pravidlá vrátane 2-ročnej subjektívnej a spravidla 3-ročnej objektívnej lehoty (pri úmyselnej škode 10 rokov; zákon má výnimky). To **nie sú všeobecné retenčné lehoty GDPR**.
- **Slovenský Obchodný zákonník č. 513/1991 Zb.:** § 397 – pri vzťahoch, na ktoré dopadá tento režim, všeobecne 4 roky, ak zákon neurčí inak. **Nepoužívať automaticky na C2C prenájom súkromných osôb.**
- **Slovenský zákon o účtovníctve č. 431/2002 Z. z.:** § 35 ods. 3 – spravidla 10 rokov pre určené účtovné doklady a knihy, počítaných od nasledujúceho roka. Iné druhy záznamov môžu mať inú lehotu alebo ďalšie povinnosti.
- **Český občiansky zákonník č. 89/2012 Sb.:** § 629 stanovuje všeobecnú trojročnú subjektívnu premlčaciu lehotu a spravidla desaťročnú najneskoršiu hranicu majetkového práva; existujú výnimky. Pri českých nárokoch preto nemožno mechanicky použiť len slovenské lehoty.
- **Rím I (ES 593/2008), najmä čl. 6:** pri zmluve Rentulo ↔ český spotrebiteľ môže byť potrebné rešpektovať povinnú ochranu českého spotrebiteľa. Vzťah súkromná osoba ↔ súkromná osoba treba posúdiť osobitne.

**Záver:** Pre každý konkrétny typ nároku najprv určiť rozhodné právo a dátum, odkedy možno nárok uplatniť. Nepredlžovať držanie všetkých kontaktov len preto, že niektoré právne nároky môžu trvať dlhšie.

## 4. Skutočný stav v Supabase TEST k 20. 10. 2026

- **2 deaktivované profily.**
- **4 historické rezervácie** s ponechaným menom, e-mailom a telefónom zrušeného nájomcu: 2 `cancelled` bez platobného záznamu; 2 `expired`, z ktorých 1 má Stripe platobný záznam `pending` (refund `not_requested`, transfer `not_created`). `pending` nie je potvrdená úspešná platba, ale **existujúci platobný záznam blokuje čistenie**.
- **6 e-mailových doručeniek** s adresou príjemcu zostáva na samostatné posúdenie.
- PR #27 je zlúčený; SQL migrácia `20261020120000_bod02_gdpr_reservation_contacts_gate_TEST.sql` je **nainštalovaná v Supabase TEST**. Overené: `funkcia_existuje = true`, `anonymizacia_povolena = false`, `rezervacie_s_kontaktmi = 4`, `emailove_zaznamy = 6`.
- **Žiadne historické kontaktné údaje sa touto inštaláciou nevymazali.** PROD nebolo zmenené.

**Technická medzera, ktorú treba vyriešiť pred aktiváciou:** aktuálna funkcia `gdpr_review_deactivated_renter_contacts` overuje stav účtu, rezervácie a súvisiacich blokácií, ale **sama zatiaľ neoveruje uplynutie 90 dní od dôveryhodne zaznamenaného uzavretia**. `end_date` ani obyčajné `updated_at` nemusia byť správnym okamihom. Bez doplnenia a otestovania tohto časového pravidla **neschvaľovať zapnutie brány ani `p_apply = true`**.

**Terminológia:** odstránenie `renter_name`, `renter_email` a `renter_phone` pri zachovaní rezervácie a identifikátorov je *vyčistenie kontaktov / potenciálna pseudonymizácia*. Nie je to automaticky úplná anonymizácia podľa GDPR, ak možno človeka ďalej identifikovať z iných údajov.

## 5. Pravidlá vykonávania a výnimiek

1. **Konkrétny účel a zákonný základ:** ku každej kategórii zaznamenať účel, príslušný právny základ (napr. plnenie zmluvy, právna povinnosť alebo primerane odôvodnený oprávnený záujem) a pravidlo zániku potreby.
2. **Preukázateľný začiatok lehoty:** zachytiť dôveryhodný čas zmeny na konečný stav alebo dokončenia vysporiadania. Pre staré rezervácie bez spoľahlivého času nevypočítavať automaticky 90 dní iba z plánovaného termínu prenájmu.
3. **Pozastavenie čistenia („legal hold“):** len pre otvorený spor, súdne konanie, refund, nárok, kontrolu či inú konkrétnu povinnosť. Zaznamenať dôvod, dotknuté záznamy, zodpovednú osobu a dátum najbližšieho prehodnotenia; nepredlžovať neurčito bez kontroly.
4. **Minimalizácia:** uchovávať dôkaz v najmenšom potrebnom rozsahu. Rezervačné číslo, suma, stav a čas môžu postačovať tam, kde už meno/telefón/adresa nie sú potrebné.
5. **Technická kontrola:** pred každým schváleným zásahom náhľad počtov, kontrola platobných a právnych blokácií, vykonanie najprv v TEST, regresné testy a kontrola výsledku. PROD iba po novom výslovnom súhlase.
6. **Auditný záznam:** evidovať schválené pravidlo, dátum, rozsah, súhrnné počty, operátora a výsledok; nepísať do logu osobné údaje, ktoré práve odstraňujeme.
7. **Individuálne GDPR žiadosti:** riešiť osobitne a vysvetliť zákonné dôvody ponechania niektorých údajov; mechanické uplynutie interného intervalu nie je jediným spôsobom výmazu.
8. **Zálohy a dodávatelia:** overiť, kedy sa zmazané údaje odstránia z dostupných záloh a logov a či sa môžu obnoviť; zdokumentovať prístup a zodpovednosť dodávateľov.

## 6. Čo ešte potrebuje rozhodnutie alebo potvrdenie

| Oblasť | Zodpovednosť a požadovaný výsledok |
|---|---|
| Bežné prevádzkové lehoty (90 dní kontakty, 90 dní notifikácie, 30 dní PIN pokusy atď.) | EBBI schváli **konkrétne účely, lehoty a výnimky** a uloží odôvodnenie; neisté nároky posúdi osobitne |
| Premlčanie, dôkazy pri sporoch, e-mailové doručenky, prijatie podmienok, cezhraničné nároky | Zdokumentovaný právny záver podľa SK/CZ režimu; pri nejasnom prípade odborné potvrdenie |
| Účtovné a daňové doklady | Účtovníčka – **odložené podľa dohody**; príslušné záznamy zatiaľ nemazať |
| DAC7 | Čaká sa na oficiálnu odpoveď Finančnej správy; dovtedy nerozhodovať o DAC7 lehotách |
| Supabase, Vercel, Stripe, Resend, BulkGate | Overiť zmluvy/DPA, postavenie dodávateľa, zálohy, poddodávateľov a jeho vlastnú dobu uchovávania |
| Mapy, CDN, fonty a prenosy mimo EHP | Overiť skutočné prenosy údajov a potrebné záruky |
| DSA evidencia moderovania | Posúdiť uplatniteľné povinnosti a výnimky; samotný proces incidentov riešiť v BODE 03 |
| Prevádzkový postup GDPR | EBBI určí osobu na schválenie čistenia, evidenciu žiadostí, incidentov a pravidelnú revíziu lehôt |

## 7. Nasledujúce kroky – iba to, čo ešte chýba

1. **Tento krok:** opraviť existujúci dokument v `docs/` cez samostatné PR. To ešte **nie je právne schválenie** a nevykoná žiadnu databázovú zmenu.
2. **Interné rozhodnutie EBBI:** schváliť alebo upraviť jednotlivé navrhované lehoty, odôvodnenia a pravidlá pozastavenia; finančné/daňové a DAC7 otázky ostávajú odložené.
3. **Pred akýmkoľvek GDPR čistením:** bezpečne doplniť a otestovať kontrolu skutočného uplynutia 90 dní a existencie platobných, sporových a ďalších blokácií. Pri neistých starých časových údajoch nič automaticky neodstraňovať.
4. **Až potom:** vykonať odsúhlasený TEST náhľad a prípadný úzko vymedzený test čistenia; záznam s `pending` platbou a šesť historických e-mailov riešiť samostatne.
5. **Pred spustením V1:** upraviť používateľské GDPR texty CZ/SK/EN/DE/PL podľa schválenej politiky, dokončiť kontrolu dodávateľov a prenosov; PROD iba na osobitný súhlas.

## 8. Záznam interného schválenia EBBI

- **Stav:** NÁVRH – NESCHVÁLENÝ
- **Kategórie, lehoty a výnimky schválené EBBI:** ______________________________
- **Odôvodnenie právneho základu a prípadné stanoviská:** ______________________________
- **Otvorené výnimky (účtovníctvo, DAC7, spory):** ______________________________
- **Oprávnená osoba EBBI s. r. o.:** ______________________________
- **Dátum schválenia a účinnosti:** ______________________________
- **Podpis / interný elektronický záznam:** ______________________________

**Zlúčenie dokumentu na GitHube nie je schválením retenčných lehôt a nie je povolením GDPR mazania.**

## 9. Oficiálne právne zdroje (kontrola 20. 10. 2026)

- [GDPR – nariadenie (EÚ) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- [SK zákon č. 18/2018 Z. z. o ochrane osobných údajov](https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/2018/18/)
- [SK Občiansky zákonník č. 40/1964 Zb., najmä § 101 a 106](https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/1964/40/)
- [SK Obchodný zákonník č. 513/1991 Zb., najmä § 397](https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/1991/513/20260817)
- [SK zákon o účtovníctve č. 431/2002 Z. z., najmä § 35](https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/2002/431/20260601)
- [CZ občiansky zákonník č. 89/2012 Sb., najmä § 629](https://e-sbirka.gov.cz/sb/2012/89)
- [Rím I – nariadenie (ES) č. 593/2008, najmä čl. 6](https://eur-lex.europa.eu/eli/reg/2008/593/oj)

Tento dokument je **interný odôvodnený návrh**, nie potvrdenie úplného právneho súladu celej platformy Rentulo.
