# RENTULO V1 – Retenčná politika osobných údajov

**Verzia internej politiky:** 1.0 – pravidlá V1 odsúhlasené EBBI
**Dátum vypracovania a aktualizácie:** 20. 10. 2026
**Stav:** INTERNÉ RETENČNÉ PRAVIDLÁ SCHVÁLENÉ 20. 10. 2026; technické vykonávanie podlieha TEST kontrolám a samostatnej aktivácii brán; verejný dátum účinnosti ešte nie je určený
**Prevádzkovateľ:** EBBI s. r. o.
**GDPR kontakt:** policy@rentulo.com
**Rozsah:** Rentulo V1 – platforma pre prenájom vecí medzi súkromnými osobami v ČR
**Východisko:** GitHub `EBBI-SK/rentulo`, `main` `bd03fca` po PR #32; 90-dňová GDPR ochrana z PR #27 a #30, etapa 1 z PR #31 aj všetky štyri migrácie etapy 2 z PR #32 nainštalované iba v Supabase TEST. Testy preukázali ochranné brány OFF a nulové vykonané čistenia; pozitívny retenčný test reálne vhodného záznamu ešte nebol vykonaný.
**Prostredia:** TEST `rentulo.eu`; PROD `rentulo.com` – bez zásahov

## 1. Účel a zásady

Tento interný dokument zaznamenáva **rozhodnutia EBBI o účeloch a primeranej dobe uchovávania**. Schválenie samo osebe **nespúšťa žiadne mazanie**. Technické brány musia zostať vypnuté do integračných testov, preukázania právneho dôvodu a samostatnej autorizácie vykonania; verejné GDPR informácie v piatich jazykoch sa upravujú v rovnakom balíku.

Podľa čl. 5 ods. 1 písm. c) a e) GDPR musí byť rozsah a doba uchovávania primeraná účelu; podľa čl. 5 ods. 2 musí EBBI vedieť tento postup preukázať. Výmaz podľa čl. 17 GDPR má výnimky napríklad pre zákonné povinnosti a preukazovanie, uplatňovanie alebo obhajobu právnych nárokov. **Dĺžka premlčacej doby nie je automatickým povolením uchovávať všetky osobné údaje rovnako dlho.**

Rozlišujeme: **(a)** kontakty potrebné iba na realizáciu prenájmu, **(b)** nevyhnutné zmluvné a právne dôkazy, **(c)** zákonné účtovné/daňové doklady a **(d)** technické a bezpečnostné záznamy. Pre každú skupinu sa posudzuje samostatný účel, právny základ a lehota.

**Bezpečnostné pravidlo:** Bez dôveryhodného času ukončenia, vyhodnotenia otvorených financií a právnych nárokov sa nič automaticky nemaže. Známe TEST brány zostávajú vypnuté. Samostatné schválenie internej lehoty **nie je** oprávnením na produkčné mazanie.

## 2. Schválené rozhodnutia pre Rentulo V1 – 20. 10. 2026

| Kategória | Interná lehota / rozhodnutie EBBI | Zásadná výnimka a vykonanie |
|---|---|---|
| Priamy profil a Auth | Počas oprávneného účtu; po zrušení vyčistiť priame identifikátory, zamedziť prihláseniu | Nevymazať účtovné dôkazy, väzby a otvorené záväzky; existujúci TEST proces bol otestovaný |
| Kontakty nájomcu pri uzavretej **nezaplatenej** rezervácii | **90 dní od preukázateľného uzavretia** | Bez akéhokoľvek platobného riadku, incidentu či legal hold; historický neznámy čas = nevykonávať automaticky |
| Prevádzkové kontakty majiteľa a miesto prevzatia | **90 dní od uzavretia a finančného vysporiadania** | Uchovať meno a nevyhnutné dôkazy; zaplatené rezervácie iba po kontrole úplného vysporiadania, refundov, dlhov a sporov |
| Rezervačná a zmluvná história | Základné pravidlo **3 roky od posledného relevantného vysporiadania** | Samostatne posúdiť druh nároku, rozhodné SK/CZ právo, finance a otvorené spory; nie bezpodmienečne zmazať riadok |
| Ponuky a fotografie | Ponuku skryť hneď po zmazaní; nepotrebnú fotografiu odstrániť do **30 dní po preukázateľnom vysporiadaní** | Neodstraňovať fotografie potrebné pre nárok; bez spoľahlivého dátumu či pri platobnom dôkaze iba individuálna kontrola |
| Hodnotenia | Pri aktívnom účte a legitímnom zverejnení; po zrušení účtu minimalizovať identifikovateľnosť | Ak stále možno autora identifikovať, nejde o anonymizované hodnotenie; uplatniť pravidlá podnetov |
| Bežné oznámenia v účte | **90 dní od vytvorenia** | Významné právne/finančné dôkazy zachovať a oddeliť od bežných oznámení |
| E-mail/SMS technické doručenky | **12 mesiacov** od definitívne vybavenej udalosti; nepotrebné kontakty a vyriešené chyby **90 dní** | Pri právne významnej výzve zachovať len nevyhnutný čas/identifikáciu/dôkaz dlhšie |
| PIN | Zneplatniť pri potvrdení alebo definitívnom uzavretí; neúspešné pokusy **30 dní po uzavretí** | Záznam o prevzatí je dôkaz rezervácie (spravidla 3 roky), nie samotný PIN |
| Stripe webhooky a diagnostika | Nepotrebné technické chyby **180 dní** od definitívneho spracovania | `stripe_event_id` a idempotenciu, nároky, refundy a finančné doklady nezmazať bez samostatného dôvodu |
| Škody, nevrátené veci, spory a dlhy | Potrebné údaje počas konkrétneho nároku; dôvody zadržania posudzovať **každých 6 mesiacov** | Pozastavenie je na konkrétne záznamy, nie bezdôvodne celý účet a všetku históriu |
| Logy a monitoring | Bežné prevádzkové logy **90 dní** od vytvorenia; vyriešené chyby/monitoring **90 dní od vyriešenia** | Bezpečnostné dôkazy/úradná kontrola podľa skutočného dôvodu; poskytovatelia majú vlastné lehoty |
| Skutočné osobné údaje v TEST | Odstrániť do **30 dní po ukončení konkrétneho testu** | Uprednostniť fiktívne testovacie osoby; finančné/legal hold výnimky posúdiť jednotlivo |
| Evidencia prijatia podmienok | Počas účtu a spravidla **3 roky po poslednom relevantnom zmluvnom vzťahu** | Uchovať nemenný serverový čas, verziu, jazyk; právne dôkazy pri otvorenom spore osobitne |
| Účtovné a daňové podklady | Podľa zákona a funkcie záznamu, pri určených dokladoch spravidla **10 rokov** | EBBI nie je bežný platiteľ DPH; § 7a registrácia potvrdená používateľom; účtovný export/POHODA sa posudzuje zvlášť |
| DAC7 | Podľa rozhodnutého rozsahu V1 a príslušnej zákonnej povinnosti | DAC7 posúdenie používateľ označil za vyriešené; nevymýšľať novú povinnosť ani novú výnimku |
| GDPR práva | `policy@rentulo.com`, štandardne odpoveď do **1 mesiaca** | Predĺženie až o ďalšie 2 mesiace len podľa čl. 12 GDPR; overiť identitu primerane |
| Bezpečnostné incidenty | Evidencia všetkých incidentov súvisiacich s osobnými údajmi | Oznámiť úradu, pokiaľ možno do **72 hodín**, ak je pravdepodobné riziko, používateľom pri vysokom riziku |

**Ide o schválené interné rozhodnutia EBBI, nie univerzálne zákonné lehoty.** Pred fyzickým výmazom overiť nezastupiteľné dôkazy, finančné väzby, skutočné dátumy a právne dôvody. Retenčné hodiny nezačínajú plánovaným `end_date` ani z nedôveryhodného `updated_at`.

## 3. Právne porovnanie – Slovensko a Česko

- **GDPR (EÚ 2016/679):** čl. 5 (minimalizácia, obmedzenie uchovávania, zodpovednosť), čl. 6 (právny základ), čl. 13 ods. 2 písm. a) (lehota alebo kritériá), čl. 17 (výmaz a výnimky), čl. 30 a 32 (evidencia a bezpečnosť, ak sa uplatnia).
- **Slovenský zákon č. 18/2018 Z. z. o ochrane osobných údajov:** dopĺňa vnútroštátny rámec; pri spracúvaní Rentula podliehajúcom GDPR je základným priamo použiteľným predpisom GDPR.
- **Slovenský Občiansky zákonník č. 40/1964 Zb.:** § 101 – všeobecná premlčacia doba 3 roky; § 106 – pri škode osobitné pravidlá vrátane 2-ročnej subjektívnej a spravidla 3-ročnej objektívnej lehoty (pri úmyselnej škode 10 rokov; zákon má výnimky). To **nie sú všeobecné retenčné lehoty GDPR**.
- **Slovenský Obchodný zákonník č. 513/1991 Zb.:** § 397 – pri vzťahoch, na ktoré dopadá tento režim, všeobecne 4 roky, ak zákon neurčí inak. **Nepoužívať automaticky na C2C prenájom súkromných osôb.**
- **Slovenský zákon o účtovníctve č. 431/2002 Z. z.:** § 35 ods. 3 – spravidla 10 rokov pre určené účtovné doklady a knihy, počítaných od nasledujúceho roka. Iné druhy záznamov môžu mať inú lehotu alebo ďalšie povinnosti.
- **Český občiansky zákonník č. 89/2012 Sb.:** § 629 stanovuje všeobecnú trojročnú subjektívnu premlčaciu lehotu a spravidla desaťročnú najneskoršiu hranicu majetkového práva; existujú výnimky. Pri českých nárokoch preto nemožno mechanicky použiť len slovenské lehoty.
- **Rím I (ES 593/2008), najmä čl. 6:** pri zmluve Rentulo ↔ český spotrebiteľ môže byť potrebné rešpektovať povinnú ochranu českého spotrebiteľa. Vzťah súkromná osoba ↔ súkromná osoba treba posúdiť osobitne.

**Záver:** Pre každý konkrétny typ nároku najprv určiť rozhodné právo a dátum, odkedy možno nárok uplatniť. Nepredlžovať držanie všetkých kontaktov len preto, že niektoré právne nároky môžu trvať dlhšie.

## 4. Skutočný stav v Supabase TEST – overenia 20. 10. 2026

- **2 deaktivované účty, 4 historické rezervácie so zvyškami kontaktov nájomcu a 6 starších e-mailových doručeniek**. Dve rezervácie sú `cancelled` bez platby, dve `expired`; jedna z nich má platobný riadok `pending`, ktorý automatické mazanie blokuje.
- Existujúce migrácie z PR #27 a #30 boli v TEST nainštalované. Po PR #30 bolo v TEST overené `je_test=true`, `casovy_stlpec_existuje=true`, `casovy_trigger_aktivny=true`, `ochrana_90_dni_aktivna=true`, `mazanie_povolene=false`, `historicke_bez_datumu=2`.
- Rezervácie `R-000021` a `R-000022` nemajú spoľahlivý čas konečného zrušenia; e-mail/oznámenie nie je dôkaz na automatické doplnenie. U týchto riadkov musí automatické čistenie zlyhať zatvoreným spôsobom.
- **Žiadne historické kontakty sa doterajšími migračnými kontrolami nemazali.** PROD zostáva nedotknutý.
- Nové migrácie `20261020170500`, `20261020171000`, `20261020172000` a `20261020173000` boli v Supabase TEST úspešne nainštalované a overené základným SQL auditom a bezpečnými integračnými pokusmi o nepovolený zápis. Časové kotvy a vypnuté vykonávacie brány fungujú; pri 0 vhodných údajoch ešte nebolo overené skutočné pozitívne čistenie. Nikdy automaticky nezapínať brány v PROD.

**Terminológia:** vymazanie kontaktných snapshotov pri zachovaní UUID/histórie je minimalizácia alebo pseudonymizácia, **nie automatická úplná anonymizácia**.

## 5. Pravidlá vykonávania a výnimiek

1. **Konkrétny účel a zákonný základ:** ku každej kategórii zaznamenať účel, príslušný právny základ (napr. plnenie zmluvy, právna povinnosť alebo primerane odôvodnený oprávnený záujem) a pravidlo zániku potreby.
2. **Preukázateľný začiatok lehoty:** zachytiť dôveryhodný čas zmeny na konečný stav alebo dokončenia vysporiadania. Pre staré rezervácie bez spoľahlivého času nevypočítavať automaticky 90 dní iba z plánovaného termínu prenájmu.
3. **Pozastavenie čistenia („legal hold“):** len pre otvorený spor, súdne konanie, refund, nárok, kontrolu či inú konkrétnu povinnosť. Zaznamenať dôvod, dotknuté záznamy, zodpovednú osobu a dátum najbližšieho prehodnotenia; nepredlžovať neurčito bez kontroly.
4. **Minimalizácia:** uchovávať dôkaz v najmenšom potrebnom rozsahu. Rezervačné číslo, suma, stav a čas môžu postačovať tam, kde už meno/telefón/adresa nie sú potrebné.
5. **Technická kontrola:** pred každým schváleným zásahom náhľad počtov, kontrola platobných a právnych blokácií, vykonanie najprv v TEST, regresné testy a kontrola výsledku. PROD iba po novom výslovnom súhlase.
6. **Auditný záznam:** evidovať schválené pravidlo, dátum, rozsah, súhrnné počty, operátora a výsledok; nepísať do logu osobné údaje, ktoré práve odstraňujeme.
7. **Individuálne GDPR žiadosti:** riešiť osobitne a vysvetliť zákonné dôvody ponechania niektorých údajov; mechanické uplynutie interného intervalu nie je jediným spôsobom výmazu.
8. **Zálohy a dodávatelia:** overiť, kedy sa zmazané údaje odstránia z dostupných záloh a logov a či sa môžu obnoviť; zdokumentovať prístup a zodpovednosť dodávateľov.

## 6. Prevádzkový model a schválenie EBBI

- Schválené pravidlá 1–16 boli užívateľom v projekte Rentulo potvrdené postupne počas 20. 10. 2026. Zahŕňajú retenčné intervaly, privacy-by-design pre GPS a mapy, serverový audit podmienok, manuálne GDPR žiadosti, DSA evidenciu a bezpečnostné incidenty.
- Schválenie je **interné rozhodnutie o pravidlách**, nie osobitné technické povolenie spustiť fyzické čistenie dát. Bezpečné brány sa môžu aktivovať až po funkčnom TEST, náhľade, kontrole platobných a právnych výnimiek a zdokumentovanom vykonávacom rozhodnutí.
- TEST `rentulo.eu` používa Vercel Hobby počas vývoja; **Pro až pri produkčnom komerčnom spustení**. Nie je potrebné znovu rozhodovať.
- EBBI **nie je štandardným platiteľom DPH**; § 7a registrácia je potvrdená; **DAC7 bol podľa používateľa vyriešený**. Neprezentovať ich ako nové otvorené schvaľovacie otázky.
- Účtovníctvo: technický lokálny export POHODA existuje, skutočný skúšobný XML import a kurz/účtovanie preveruje účtovníčka. Technický súbor bez reálneho `responsePack` nie je dôkaz úspešného importu.
- Dodávatelia: uchovať primeraný prehľad ich DPA, rolí, regiónov, ďalších spracovateľov a záloh. Presné nastavenia konkrétnych účtov a záloh nemožno vyčítať len zo zdrojového kódu.
- DSA nahlasovanie `rentulo@rentulo.com`, GDPR žiadosti `policy@rentulo.com`; operačné manuálne postupy a registre sú v `docs/BOD02_ETAPA1_GDPR_DSA_BEZPECNOST_TEST.md`.
- Evidencia bezpečnosti, DPO/DPIA skríning a aktualizácia právnych textov vo všetkých 5 jazykoch patria do jedného balíka BODU 02. Bez preverenia zákonných predpokladov neoznačujeme DPO/DPIA ako automaticky povinné.

## 7. Kontrola a uzatvorenie technického vykonávania

1. Vývojový balík vložiť do aktuálneho TEST `main` a prejsť plné lokálne testy, build a GitHub CI. Technické zmeny sa nesmú nezávisle aplikovať na PROD.
2. V presnom poradí po jednom spustiť TEST-only SQL `170500` → `171000` → `172000` → `173000`, vždy overiť správny projekt; vykonať smoke-test registrácie, rezervácie, kontaktov a Stripe.
3. Overiť všetky GDPR gate hodnoty `false`, typy tabuliek/RLS, časové pečiatky nových uzavretí a úspešný dry-run bez mazania. Overiť, že historické NULL dátumy ostali nedotknuté.
4. Samostatne nasadiť a preveriť TEST Edge photo worker a jeho ochranný interný token. Vypnutý gate nesmie umožniť mazanie. Odkaz na worker nikdy nesmie niesť autentizačné tajomstvo v URL.
5. Až po zdokumentovanom TEST audite oprávnenej kategórie možno samostatne aktivovať úzko zvolený gate a vykonanie. Nezapínať všetky brány len preto, že je politika interným rozhodnutím schválená.
6. Vyžiadané externé podklady (napr. potvrdenie z dashboardu dodávateľa, účtovný XML `responsePack`) overiť priamo v kroku, keď sú potrebné; neoznačovať ich za existujúce bez dôkazu.
7. **PROD zostáva bez akýchkoľvek zmien**, až kým nebude nový samostatný súhlas na jeho migráciu a komerčné spustenie.

## 8. Záznam schválenia

- **Rozhodnutie:** EBBI prostredníctvom oprávneného používateľa v projekte potvrdilo pravidlá 1–16 dňa **20. 10. 2026**.
- **Predmet:** interné účely a zásady minimalizácie, uvedené lehoty a výnimky; nevzťahuje sa na neoverené daňové klasifikácie ani automatické produkčné vykonanie.
- **Podklad:** výslovné potvrdenia v projektovej konverzácii z 20. 10. 2026. Tento dokument nezastupuje vlastnoručný podpis alebo právne stanovisko.
- **Aktivačný status TEST:** pôvodný `gdpr_reservation_contact_cleanup_gate.is_enabled=false`; nové brány podľa pripravených SQL migračných súborov tiež vzniknú v stave `false`.
- **Aktivačný status PROD:** nič nevykonané; samostatné povolenie potrebné.

## 9. Oficiálne právne zdroje (kontrola 20. 10. 2026)

- [GDPR – nariadenie (EÚ) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- [SK zákon č. 18/2018 Z. z. o ochrane osobných údajov](https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/2018/18/)
- [SK Občiansky zákonník č. 40/1964 Zb., najmä § 101 a 106](https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/1964/40/)
- [SK Obchodný zákonník č. 513/1991 Zb., najmä § 397](https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/1991/513/20260817)
- [SK zákon o účtovníctve č. 431/2002 Z. z., najmä § 35](https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/2002/431/20260601)
- [CZ občiansky zákonník č. 89/2012 Sb., najmä § 629](https://e-sbirka.gov.cz/sb/2012/89)
- [Rím I – nariadenie (ES) č. 593/2008, najmä čl. 6](https://eur-lex.europa.eu/eli/reg/2008/593/oj)

Tento dokument je **interné schválenie pravidiel a postup ich technického vykonávania**; sám osebe nie je potvrdením úplného právneho súladu ani dokončenia všetkých integračných kontrol.
