# RENTULO V1 – Retenčná politika osobných údajov

**Verzia návrhu:** 1.0  
**Dátum vypracovania:** 20. 10. 2026  
**Stav:** NÁVRH NA SCHVÁLENIE – zatiaľ nie je účinná ani právne schválená  
**Prevádzkovateľ:** EBBI s. r. o.  
**Kontakt pre GDPR:** policy@rentulo.com  
**Rozsah:** Rentulo V1 – prenájom vecí medzi súkromnými osobami v ČR  
**Technické východisko:** GitHub `EBBI-SK/rentulo`, `main` po PR #27, commit `9004d7c`  
**Prostredia:** TEST `rentulo.eu`; PROD `rentulo.com` – bez zmeny

## 1. Načo je tento dokument

Určuje, **ktoré údaje držíme, prečo, odkedy počítame lehotu a čo sa stane potom**. Po schválení bude interným podkladom pre čistenie databázy a zosúladenie dokumentu „Ochrana osobních údajů“ vo všetkých piatich jazykoch.

Princíp: osobné údaje držať len nevyhnutne dlho (čl. 5 ods. 1 písm. e GDPR). Zákonná povinnosť, otvorený spor či ochrana právneho nároku môže vyžadovať výnimku. Nie všetky údaje v jednej rezervácii musia mať rovnakú lehotu.

**Bezpečnostné pravidlo:** kým táto politika a konkrétne lehoty nie sú schválené, nespúšťame žiadne automatické ani manuálne hromadné mazanie historických záznamov. Existujúca TEST SQL ochrana po PR #27 zostáva vypnutá (`gdpr_reservation_contact_cleanup_gate.is_enabled = false`).

## 2. Retenčná tabuľka – konkrétny pracovný návrh

| Údaje / technické tabuľky | Navrhovaná lehota a začiatok počítania | Po uplynutí lehoty | Stav |
|---|---|---|---|
| Profil, autentifikácia (`profiles`, `auth.users`) | Počas aktívneho účtu; pri oprávnenom zrušení vykonať existujúci proces deaktivácie | Vyčistiť priame kontaktné údaje, vypnúť prihlásenie; potrebné identifikátory a finančné väzby riešiť oddelene | Mechanizmus TEST otestovaný |
| Aktívna ponuka a fotografie (`offers`, Storage `offer-photos`) | Počas zverejnenia; po stiahnutí len počas otvorených rezervácií, námietok či sporov | Skryť/anonymizovať ponuku; odstrániť fotografie pri zrušení účtu podľa existujúceho procesu | Pri zrušení účtu TEST otestované |
| Meno, e-mail, telefón nájomcu uložené v uzavretej nezaplatenej rezervácii (`reservations.renter_*`) | **Návrh 90 dní** od spoľahlivo doloženého uzavretia rezervácie bez sporu; až po kontrole všetkých súvisiacich záväzkov | Vyprázdniť len tri kontaktné polia; ponechať číslo rezervácie, stav, termíny a nevyhnutnú históriu | LEHOTA NA SCHVÁLENIE; TEST nástroj pripravený, vypnutý |
| Kontaktné údaje majiteľa a miesto prevzatia v historickej rezervácii (`reservations.owner_*`, `pickup_*`) | **Návrh 90 dní** od riadneho ukončenia a vysporiadania, ak nie je otvorený nárok | Anonymizovať nepotrebné kontakty a presnú adresu; zachovať nutné dôkazy | LEHOTA A TECHNICKÁ ÚPRAVA NA SCHVÁLENIE |
| Rezervácie bez kontaktných údajov, hodnoty, dátumy a väzby (`reservations`) | **Pracovný návrh 3 roky** od konečného vysporiadania, ak neplatí zákonná povinnosť či spor | Zmazať/anonymizovať až po kontrole súvisiacich platieb, dôkazov a väzieb | PRÁVNE OVERIŤ |
| Platby, refundy, prevody, záväzky a náklady (`payments`, `reservation_cancellations`, `reservation_cancellation_cost_items`, `owner_cancellation_debts`) | **Podľa účtovných a daňových predpisov a ochrany nárokov; presnú lehotu zatiaľ neurčujeme** | Ponechať potrebné doklady, potom kontrolované odstránenie | ČAKÁ NA ÚČTOVNÍČKU / PRÁVNIKA |
| Hodnotenia a komentáre (`reviews`) | Počas odôvodneného zverejnenia a vybavenia námietok | Odstrániť či anonymizovať autora a osobné údaje v texte podľa prípadu | PRAVIDLO NA SCHVÁLENIE |
| Oznámenia v účte (`notifications`) | **Návrh 90 dní** od doručenia, ak nie sú dôkazom incidentu | Zmazať nepotrebné oznámenia | LEHOTA NA SCHVÁLENIE |
| Staršie e-mailové doručenky vrátane adresy (`reservation_email_deliveries`) | **Návrh:** e-mail príjemcu preveriť na odstránenie po 90 dňoch; potrebný dôkaz o doručení posudzovať samostatne (pracovne do 12 mesiacov alebo dlhšie pri spore) | Minimalizovať adresu a chyby, nechať len odôvodnený dôkaz; nikdy nestratiť potrebný dôkaz o oznámení | PRÁVNE OVERIŤ; zatiaľ nemazať |
| Novšie e-mailové/SMS udalosti (`reservation_notification_deliveries`) | **Návrh 12 mesiacov** od doručenia/uzavretia, iba v rozsahu potrebnom na reklamáciu, bezpečnosť a preukázanie odoslania | Odstrániť identifikátory poskytovateľov, texty chýb a nadbytočné prevádzkové záznamy | LEHOTA NA SCHVÁLENIE |
| PIN – pokusy a blokácie (`reservation_pickup_security`) | **Návrh 30 dní** po ukončení rezervácie pre technické pokusy; dôkaz o prevzatí môže vyžadovať dlhšiu lehotu | Odstrániť bezpečnostný detail, keď už nie je potrebný; dôkaz o prevzatí oddeliť | PRÁVNE A TECHNICKY OVERIŤ |
| Stripe technické udalosti (`stripe_webhook_events`) | **Návrh 180 dní** od úspešného spracovania; nikdy nemazať pri nevyriešenej platbe/refunde | Odstrániť technické chyby a duplicity; potrebné finančné záznamy uchovať zvlášť | LEHOTA NA SCHVÁLENIE |
| Incidenty pri nevrátení a riešenie škôd (`reservation_return_incidents`) | **Pracovný návrh 3 roky** po právoplatnom/úplnom uzavretí veci, podľa typu nároku | Vymazať opis a osobné údaje, keď už neexistuje právny dôvod | PRÁVNE OVERIŤ; proces sporov patrí do BODU 03 |
| Technické chyby, stav workerov a monitoring (`reservation_notification_monitor_alerts`, prevádzkové logy) | **Návrh 90 dní** po vyriešení; údaje bez osobného obsahu možno držať podľa potreby | Zmazať staré incidentné logy a citlivý text chýb | LEHOTA NA SCHVÁLENIE; overiť logy dodávateľov |
| Záznam akceptácie právnych podmienok (`auth.users` metadáta a prípadná auditná evidencia) | **Pracovný návrh 3 roky** po skončení relevantného zmluvného vzťahu, pokiaľ nie je nárok alebo iná povinnosť | Odstrániť po uplynutí právne odôvodnenej lehoty | PRÁVNE OVERIŤ; súčasné klientské metadáta nie sú nemenný dôkaz |
| Údaje potrebné pre DAC7 | Len ak sa podľa stanoviska FS povinnosť na Rentulo vzťahuje; lehotu určiť podľa zákona | Uchovať len povinne požadovaný rozsah | ČAKÁ SA NA ODPOVEĎ FS |
| Testovacie údaje a testovacie účty | **Návrh do 30 dní po skončení konkrétneho testu** | Zmazať nepotrebné skutočné osobné údaje; prednostne používať fiktívne údaje | INTERNÉ PRAVIDLO NA SCHVÁLENIE |

**Pozor:** čísla 30/90/180 dní, 12 mesiacov a 3 roky sú pracovné návrhy EBBI pre právne preverenie, **nie univerzálne lehoty stanovené GDPR**. Ani táto tabuľka sama o sebe nezapína technické čistenie.

## 3. Čo už bolo preverené na Supabase TEST

- Deaktivované profily: **2**.
- Historické rezervácie s menom, e-mailom a telefónom zrušených nájomcov: **4**.
- Z nich: **2 `cancelled` bez platobného záznamu; 2 `expired`, z nich 1 obsahuje Stripe platbu `pending`** (refund `not_requested`, transfer `not_created`). `pending` nie je dôkaz zaplatenia, ale taký záznam automatickú anonymizáciu blokuje.
- Staršie záznamy doručenia e-mailov s adresou: **6**.
- Trigger `trg_protect_reservation_immutable_fields` chráni nemenné polia rezervácií.
- PR #27 vytvoril v TEST-only SQL **uzamknutú, štandardne vypnutú** možnosť vyčistiť tri polia kontaktu nájomcu iba v úzkom bezpečnom režime. Funkcia nie je súčasťou automatického zrušenia účtu a e-mailové doručenky nemení.

**Aktuálne rozhodnutie:** žiadny zo 4 rezervačných kontaktov ani zo 6 historických e-mailov nemažme, kým nie je schválená príslušná lehota a posúdený konkrétny dôkazný/finančný účel.

## 4. Pravidlá pred každým vymazaním

1. **Overiť účel a právny dôvod.** Najmä platby, refundy, dlhy, sťažnosti, právne nároky a zákonnú archiváciu.
2. **Overiť začiatok lehoty.** Pre rezervácie použiť dôveryhodný okamih zmeny stavu alebo doloženého vysporiadania. Samotný `end_date` pri zrušenej budúcej rezervácii ani všeobecné `updated_at` nemusia byť správnym začiatkom lehoty.
3. **Právny hold.** Ak existuje otvorený spor, kontrola, nárok alebo povinnosť podľa zákona, vymazanie sa pozastaví iba v nevyhnutnom rozsahu. Dôvod a termín prehodnotenia sa zaznamenajú.
4. **Minimalizácia.** Keď stačí zachovať číslo, stav, sumu a dátum, neuchovávať zbytočne meno, telefón, e-mail či presnú adresu.
5. **Bezpečná realizácia.** Najprv náhľad počtov, následne schválený TEST zásah, regresné testy, kontrola výsledku a až samostatným rozhodnutím PROD rollout.
6. **Auditná stopa.** Evidovať dátum, rozsah, právny základ/odkaz na schválenie, výsledné počty a zodpovednú osobu; do logu nekopírovať osobné údaje.
7. **Žiadosti podľa GDPR.** Každú žiadosť o vymazanie vyhodnotiť individuálne; pri oprávnenej výnimke informovať žiadateľa o dôvode a rozsahu ponechaných údajov.

## 5. Čo musí EBBI ešte potvrdiť

| Potvrdenie | Kto / výsledok |
|---|---|
| Lehoty pri rezerváciách, sporoch, recenziách, doručenkách a nemenných zmluvných dôkazoch | Český/slovenský právnik podľa príslušnej otázky; písomné potvrdenie alebo odôvodnený interný právny záver |
| Účtovné, daňové a platobné doklady | Účtovníčka – **odložené podľa dohody**; dovtedy nevymazávať |
| DAC7 a prípadné evidenčné lehoty | Čaká sa na odpoveď Finančnej správy |
| Zmluvy/DPA, roly, poddodávatelia, zálohy a retenčné lehoty služieb Supabase, Vercel, Stripe, Resend, BulkGate | Overiť konkrétne zmluvy a nastavenia účtov EBBI |
| Mapové služby, CDN, Google Fonts a prípadné prenosy mimo EHP | Overiť reálne dátové toky a záruky |
| Interný spôsob evidencie žiadostí GDPR, bezpečnostných incidentov a dočasného právneho holdu | EBBI – schváliť prevádzkový postup |

## 6. Realizačné poradie (bez práce navyše)

1. **Teraz:** uložiť tento dokument do `docs/` cez samostatné PR; len dokumentácia, žiadne spustenie migrácie.
2. **Po kontrole právnych lehôt:** EBBI schváli označené návrhy a určí dátum účinnosti; verzia zostáva 1.0, pokiaľ ide o prvú schválenú verziu.
3. **Až po schválení:** bezpečne nainštalovať TEST-only migráciu z PR #27 s vypnutou bránou; preveriť náhľady a ochrany.
4. **Následne osobitne:** povoliť a otestovať iba presne schválenú anonymizáciu kontaktov. Záznam `pending` platby a e-mailové doručenky naďalej riešiť oddelene.
5. **Napokon:** upraviť a otestovať automatický režim budúcich lehôt a zosúladiť GDPR texty CZ/SK/EN/DE/PL. PROD len po novom výslovnom súhlase.

## 7. Schvaľovací záznam EBBI

- **Stav dokumentu:** NÁVRH – NESCHVÁLENÝ
- **Schválené kategórie/lehoty:** ______________________________
- **Právne stanovisko / interné zdôvodnenie:** ______________________________
- **Daňové/účtovné lehoty – stanovisko:** ______________________________
- **Oprávnená osoba za EBBI s. r. o.:** ______________________________
- **Dátum schválenia a účinnosti:** ______________________________
- **Podpis alebo interná elektronická evidencia schválenia:** ______________________________

Po schválení sa tento záznam uloží interne a vykoná sa samostatná schválená technická implementácia. **Schválenie návrhu ako GitHub PR nie je schválením lehôt ani pokynom na vymazanie údajov.**

---

**Právny základ na overenie:** [GDPR – nariadenie (EÚ) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj), najmä články 5, 6, 17, 24, 28, 30 a 32.
