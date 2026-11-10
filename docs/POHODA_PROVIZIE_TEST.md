# Rentulo / POHODA – TEST export provízií a doplatkov (bod 7.3)

**Stav 4. 11. 2026:** lokálny export podkladov pre účtovníčku. Dátum dokladu je odvodený od dôveryhodného potvrdenia vrátenia a kurz sa automaticky načíta z oficiálneho ECB historického kurzového lístka. **Import do POHODY sa teraz netestuje; odkladá sa, nie je podmienkou spustenia Rentula.** Pred ostrým zaúčtovaním má účtovníčka overiť účtovné zaradenie a porovnať údaje so Stripe. Tento bod nemení Stripe, web ani databázovú schému Supabase.

## Už schválené účtovné parametre (18. 10. 2026)

- Za každú **kladnú, bezpečne finančne uzavretú províziu** samostatná **Ostatná pohľadávka** v POHODE (`inv:invoiceType=receivable`). Žiadne pohľadávky s nulovou províziou.
- Skratka predkontácie v POHODE **presne `Provizie Rentulo`** (MD **315100** / D **602100**). Účtovníčka musí overiť, že skratka existuje a ukazuje na tieto účty.
- Právny subjekt EBBI s. r. o. (IČO 46306374). Aktuálne nie je platiteľ bežnej DPH; XML používa `rateVAT=none`. **Ak sa režim DPH zmení, zastaviť export a preveriť formát i klasifikáciu.** Registrácia podľa §7a nemusí znamenať všeobecné platiteľstvo DPH.
- Vznik transakcií v **CZK**, domáce účtovníctvo v **EUR**. Pre dátum dodania sa vyberie **posledný kurz ECB vyhlásený pred týmto dátumom** (vrátane víkendov a dní, keď ECB kurz nevydáva). Oficiálna história ECB sa pri behu nástroja načíta automaticky a bez odoslania osobných či finančných údajov. Pri práci bez internetu možno použiť `--rates kurzy.csv` so skutočnými **dátumami publikácie ECB**, nie dátumami dokladov. Jednotný mesačný kurz `--rate` je zakázaný. XML zapisuje prevrátenú hodnotu **EUR za 1 CZK**; kontrolné CSV uvádza dátum kurzu, kurz a informatívny prepočet provízie na EUR. Žiadny kurz Stripe.
- XML **nevytvára úhrady**. Párovanie so Stripe Connect, súhrnnými prevodmi a bankou rieši účtovníčka.
- Dátum dodania províznej služby pri `returned` je **dátum potvrdeného vrátenia veci** z `reservations.gdpr_finalized_at` v časovej zóne `Europe/Prague`, podľa dodaného účtovného stanoviska. **Nie je to dátum platby ani Stripe transferu.** Pôvodná provízia aj prípadná kladná provízia predĺženia majú dátum toho istého dokončeného prenájmu. Čas odráža potvrdenie vrátenia v Rentule; ak vlastník potvrdí vrátenie v iný deň ako skutočné fyzické vrátenie, účtovníčka musí výnimku preveriť.
- Pri `no_show` fyzické vrátenie neprebehlo a pri historickom `returned` s `gdpr_finalized_at IS NULL` chýba dôveryhodný dátum. SQL tieto riadky označí `*_manual_review` a nástroj **zablokuje celý export**, aby nevznikol nesprávny doklad. Na takéto výnimky treba samostatné účtovné posúdenie; systém ich automaticky nedatuje.

## Rozsah dát

SQL `docs/sql/pohoda_provizie_export_TEST.sql` je **iba SELECT** v TEST Supabase `vspposovhdgvbeukoivh`. Vracia **jeden riadok na pôvodnú úspešne prevedenú platbu a jeden na každé zaplatené predĺženie**, ktorého transfer je úspešný. Predĺženie s `owner_payout = 0` sa eviduje po uzavretí pôvodného transferu aj bez vlastného Stripe transferu. Riadky sa vyberajú do mesiaca podľa potvrdeného vrátenia; `no_show` a historické neznáme vrátenie sa zobrazia **len na upozornenie** v mesiaci ich finalizácie, resp. transferu. Dátum takéhoto výnimočného riadku nie je automaticky dátumom dodania.

SQL číta len uzavreté `returned` / `no_show`. **Nie je auditom všetkých finančných záväzkov**: nevyplatené, neuzavreté, zlyhané či nezrovnalé záznamy je nutné osobitne preveriť. Prípady s kartovým sporom alebo vnútorným vysporiadaním v tomto mesačnom výbere exportér **zastaví**, aj keď bol spor neskôr uzavretý. Rovnako zastaví celý export, ak nenájde dôveryhodné potvrdenie vrátenia. Nie je bezpečné odstraňovať problematické riadky z CSV na dosiahnutie dokladu.

`source_type` a `source_id` identifikujú konkrétny finančný záznam. Pôvodná provízia používa stabilné pôvodné číslo `RP-000123` ako predtým. Dodatočná provízia používa `RE-` + 16 znakov odvodených kryptografickým hashom **nemenného UUID predĺženia**, aby viaceré predĺženia mali odlišné čísla. Originálne UUID zostáva v kontrolnom CSV a poznámke XML. Kolízie čísel v jednom exporte zastavia spracovanie; kontrolu proti skorším mesiacom a číselnému radu musí overiť POHODA (reimport s kontrolou duplicity).

### Príklad R-000045 (ilustrácia z existujúceho TEST)

| Zdroj | Cena CZK | Provízia CZK | Prenajímateľ CZK | XML doklad | Kontrolné CSV |
| --- | ---: | ---: | ---: | --- | --- |
| Pôvodná platba | 450 | 70 | 380 | `RP-000045` | áno |
| Predĺženie | 150 | **0** | 150 | **žiadny** | **áno** |
| Spolu | **600** | **70** | **530** | **1 doklad** | **2 riadky** |

Ak zaplatené predĺženie vytvorí dodatočnú províziu napríklad 15 CZK, vznikne **ďalší samostatný doklad** na 15 CZK, ale nie duplicitný doklad za pôvodnú províziu. Historické provízie sa prepočtom podľa dnešného minima nemenia; používa sa **skutočne uložená suma**.

**Pozor:** R-000045 má v TEST evidovanú simuláciu kartového sporu; pri skutočnom mesačnom SQL exporte môže preto celý export **správne zablokovať**. Údaje v príklade sú ilustráciou výpočtu, nie potvrdením účtovnej oprávnenosti tejto konkrétnej rezervácie. Pre automatické testy sa používajú výhradne **syntetické údaje**.

## Dôležité limity pri predĺženiach

Tabuľka `reservation_extensions` obsahuje zaplatenú sumu, uloženú províziu, výplatu, Stripe `PaymentIntent`, `Charge`, `Transfer`, ale **neuchováva samostatný stav refundu predĺženia ani Stripe processing fee či charge balance transaction**. Nástroj nesmie túto neznámu hodnotu nahradiť nulou alebo ju označiť za overenú.

- V kontrolnom CSV je pri predĺženiach `stripe_poplatok_stav = NOT_STORED_CHECK_STRIPE` a `refund_overenie = NOT_TRACKED_IN_EXTENSION_DB`. Skutočné fee i prípadný refund treba overiť priamo v Stripe a doplniť do účtovnej evidencie **mimo** automatického reportu. Údaj o Stripe poplatku **nie je** provízia Rentulo.
- Pre každú **kladnú dodatočnú províziu** sa export bez výslovného parametra `--extension-review "REFERENCIA_KONTROLY"` zastaví. Tento parameter je záznam **vykonanej manuálnej kontroly doplatkových Charge a refundov** (napr. číslo interného kontrolného záznamu), nie automatické overenie Stripe.
- Záznamy s **nulovou** dodatočnou províziou idú do kontrolného CSV aj bez parametra; **nevytvára sa XML** len pre nulové riadky.
- Pri akejkoľvek evidovanej kartovej námietke `stripe_card_disputes` alebo internom vysporiadaní `reservation_dispute_settlements` sa celý export zastaví. Prípadné opravné doklady a neskoršie refundy už zaúčtovaných provízií rieši účtovníčka **manuálne**, tento nástroj negeneruje automatický storno doklad.

## Bezpečný TEST postup (žiadne ostré účtovanie)

1. Supabase **TEST** `rentulo` (`vspposovhdgvbeukoivh`) → SQL Editor. V prvom CTE `requested_month` nastav začiatok mesiaca, napr. `DATE '2026-10-01'`. Spusti **iba** `docs/sql/pohoda_provizie_export_TEST.sql`, ulož výsledok ako CSV do súkromného adresára **mimo** GitHub/VS Code repozitára. SQL neobsahuje žiadne modifikácie dát.
2. Spusti lokálne v koreňovom priečinku projektu iba na pripravenom CSV. Pri bežnej práci nástroj **automaticky stiahne oficiálnu historickú sériu ECB**; iba verejné kurzy, žiadne údaje o rezerváciách, sa získavajú cez internet:

    ```powershell
    node scripts/export-pohoda-commissions.mjs --month 2026-10 --input "C:\bezpecny-priecinok\provizie.csv"
    ```

    Ak nie je dostupné ECB pripojenie, použi `--rates "C:\bezpecny-priecinok\kurzy.csv"` s overenou úplnou sériou **publikačných dátumov ECB** (`date,czk_per_eur`, napr. `2026-10-16,24.323`). Nedávaj kurz k dátumu dokladu, keď nebol vtedy zverejnený, a nepouži jediný kurz na celý mesiac. Ak je v exporte kladná provízia predĺženia, **po overení Charge a refundácie priamo v Stripe** pridaj napr. `--extension-review "UCT-STRIPE-KONTROLA-2026-10"`.
3. V `.gitignore` ignorovanom priečinku `pohoda-export/` vzniká `rentulo-provizie-2026-10.xml` (**iba pri aspoň jednej kladnej provízii**) a `rentulo-provizie-2026-10-parovanie.csv` (**každý finančný riadok, aj nulový**). Pri nulových províziách za celý mesiac vzniká **iba CSV**, pri prázdnom SQL výstupe žiadny súbor. Existujúce súbory sa **nikdy neprepíšu**.
4. Účtovníčka dostane v kontrolnom CSV dátum potvrdenia vrátenia, účtovný dátum, dátum publikácie ECB, kurz, províziu v CZK aj orientačný prepočet v EUR a referencie Stripe. Stripe export poskytuje osobitne transakčné údaje a poplatky. Účtovníčka vykoná **bežnú vecnú kontrolu**, ale nemusí ručne vyhľadávať ECB kurzy ani dátumy vrátenia bežných dokončených rezervácií.
5. Export pri `no_show`, staršom `returned` bez potvrdeného času, spore či chýbajúcom finančnom dôkaze zastaví celý súbor. **Nikdy neodstraňuj takéto riadky len kvôli úspechu exportu**; rieši ich účtovníčka osobitne. Výpis nevyplatených alebo neúplných platieb sa preveruje samostatne.
6. **Import do POHODY je odložený.** Keď bude možné ho vykonať, najprv iba do testovacej kópie, s kontrolou typu `receivable`, partnera, CZK/EUR, súm, predkontácie, dátumov a duplicitného importu (`checkDuplicity=true`). Nástroj sám kompatibilitu s POHODOU nemôže potvrdiť.

## Technické a bezpečnostné zábrany

- Zdrojové osobné údaje a CSV nikdy neposielať na verejný web, do Edge Function, PR, GitHubu či do chatu. XML i CSV nech sú v šifrovanom/súkromnom adresári prístupnom účtovníčke. Nástroj beží **lokálne** bez Supabase service-role kľúčov; cez sieť odosiela len požiadavku na verejný kurzový XML súbor ECB, bez zákazníckych údajov.
- Generátor zastaví celý súbor pri neplatnom stave rezervácie alebo platby, chýbajúcom dôveryhodnom čase vrátenia, `no_show`, nesúlade sumy a provízie, neplatnom Stripe identifikátore/prevode, chýbajúcom **predchádzajúcom publikovanom kurze ECB** pre kladné provízie, duplicite zdroja či dokladu, spore alebo inom internom vysporiadaní. Nepripustí kurz starší ako 7 kalendárnych dní ani budúci/súčasný deň voči účtovnému dátumu.
- Pri nulovej výplate z predĺženia sa nemá v databáze vymýšľať Stripe transfer. Ak je vyplatená suma nenulová, musí byť potvrdený skutočný Stripe transfer. Pri CZK predĺžení sa kontroluje rovnosť `owner_payout * 100` so skutočným transferom v menších jednotkách.
- Kontrolné CSV rozlišuje surové Stripe *minor units*, menu, stavy chýbajúcich fee a status refundovej evidencie. Tieto údaje sa **nesmú zameníť za províziu platformy**. Zmena skutočného účtovného režimu, právneho/daňového posúdenia alebo schémy vyžaduje nový audit pred používaním.
- SQL výber na konkrétny mesiac má limit: záznam bez úspešného owner transferu s kladným podielom vlastníka ešte **nie je zahrnutý**. To nie je potvrdením, že neexistujú otvorené záväzky. Mesačnú úplnosť je nutné porovnať so Stripe výkazmi a internou evidenciou. Historické vrátenia bez dôveryhodného dátumu sú priradené ku kontrolnému mesiacu podľa transferu len pre upozornenie, nie na vystavenie dokladu.

## Oficiálne referencie

- ECB historická séria XML: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml
- ECB zverejňovanie kurzov a prázdniny TARGET: https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html
- NBS – automatizované spracovanie kurzových lístkov ECB: https://nbs.sk/statisticke-udaje/kurzovy-listok/denny-kurzovy-listok-ecb/
- POHODA XML: https://www.stormware.sk/pohoda/xml/xmlzpracovani/
- Duplicity a XML `numberRequested`: https://www.stormware.sk/pohoda/xml/obecny-obchod/pro-vyvojare/
- Oficiálne schémy: https://www.stormware.sk/pohoda/xml/seznamschemat/
- Test importu do agendy: https://www.stormware.sk/prirucka-pohoda-online/Datova_komunikacia/XML_import-export/
