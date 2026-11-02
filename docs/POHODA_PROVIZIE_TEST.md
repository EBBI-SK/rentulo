# Rentulo / POHODA – TEST export provízií a doplatkov (bod 7.3)

**Stav 2. 11. 2026:** offline export pre **kontrolný import do skúšobnej účtovnej jednotky**. Nie je to produkčné nasadenie, potvrdený import ani konečné účtovné/daňové schválenie. Tento bod nemení Stripe, verejný web ani schému Supabase.

## Už schválené účtovné parametre (18. 10. 2026)

- Za každú **kladnú, bezpečne finančne uzavretú províziu** samostatná **Ostatná pohľadávka** v POHODE (`inv:invoiceType=receivable`). Žiadne pohľadávky s nulovou províziou.
- Skratka predkontácie v POHODE **presne `Provizie Rentulo`** (MD **315100** / D **602100**). Účtovníčka musí overiť, že skratka existuje a ukazuje na tieto účty.
- Právny subjekt EBBI s. r. o. (IČO 46306374). Aktuálne nie je platiteľ bežnej DPH; XML používa `rateVAT=none`. **Ak sa režim DPH zmení, zastaviť export a preveriť formát i klasifikáciu.** Registrácia podľa §7a nemusí znamenať všeobecné platiteľstvo DPH.
- Vznik transakcií v **CZK**, domáce účtovníctvo v **EUR**. Kurz určí **účtovníčka**. Parametrom `--rate` / `--rates` sa zadáva **1 EUR = n CZK**; XML zapisuje prevrátenú hodnotu **EUR za 1 CZK**. Nevymýšľať kurz zo Stripe.
- XML **nevytvára úhrady**. Párovanie so Stripe Connect, súhrnnými prevodmi a bankou rieši účtovníčka.
- Príjmový okamih dokladu používa podľa pôvodnej dohody **dátum úspešného Stripe Connect transferu**, v časovej zóne `Europe/Prague`. Pri predĺžení s nulovým podielom prenajímateľa (žiadny transfer sa nevytvára) je to neskorší z okamihov **zaplatenia doplatku** a **úspešného pôvodného transferu**. **Účtovníčka musí pred ostrým používaním potvrdiť toto pravidlo účtovného dátumu.**

## Rozsah dát

SQL `docs/sql/pohoda_provizie_export_TEST.sql` je **iba SELECT** v TEST Supabase `vspposovhdgvbeukoivh`. Vracia **jeden riadok na pôvodnú úspešne prevedenú platbu a jeden na každé zaplatené predĺženie**, ktorého transfer je úspešný. Predĺženie s `owner_payout = 0` sa eviduje po uzavretí pôvodného transferu aj bez vlastného Stripe transferu.

SQL číta len uzavreté `returned` / `no_show`. **Nie je auditom všetkých finančných záväzkov**: nevyplatené, neuzavreté, zlyhané či nezrovnalé záznamy je nutné osobitne preveriť. Prípady s kartovým sporom alebo vnútorným vysporiadaním v tomto mesačnom výbere exportér **zastaví**, aj keď bol spor neskôr uzavretý. Nie je bezpečné odstraňovať problematické riadky z CSV na dosiahnutie importu.

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
2. Od účtovníčky si vyžiadaj schválený kurz (1 EUR = n CZK) alebo súbor kurzov `kurzy.csv` s hlavičkou `date,czk_per_eur` a riadkom pre každý dátum dokladu. Žiadny odhad podľa Stripe. Pri kladnej provízii z predĺženia **over Charge a refund stav v Stripe** a eviduj referenciu kontroly.
3. Spusti lokálne v koreňovom priečinku projektu iba na pripravenom CSV. Príklad s dennými kurzami:

    ```powershell
    node scripts/export-pohoda-commissions.mjs --month 2026-10 --input "C:\bezpecny-priecinok\provizie.csv" --rates "C:\bezpecny-priecinok\kurzy.csv"
    ```

    Ak účtovníčka schválila jednotný kurz a predĺženia s kladnou províziou boli **manuálne overené**:

    ```powershell
    node scripts/export-pohoda-commissions.mjs --month 2026-10 --input "C:\bezpecny-priecinok\provizie.csv" --rate <KURZ_OD_UCTOVNICKY> --extension-review "UCT-STRIPE-KONTROLA-2026-10"
    ```

4. V `.gitignore` ignorovanom priečinku `pohoda-export/` vzniká `rentulo-provizie-2026-10.xml` (**iba pri aspoň jednej kladnej provízii**) a `rentulo-provizie-2026-10-parovanie.csv` (**každý finančný riadok, aj nulový**). Pri nulových províziách za celý mesiac vzniká **iba CSV**, pri prázdnom SQL výstupe žiadny súbor. Existujúce súbory sa **nikdy neprepíšu**.
5. Pred akýmkoľvek importom účtovníčka porovná všetky zdrojové platby, sumy, fee, Charge/Transfer a refundy. Pri chýbajúcom údaji sa export **nesmie automaticky považovať za úplné párovanie**. Pri spore či nevyriešenom refunde sa vysporiadanie rieši individuálne, bez obchádzania kontrol.
6. Import XML **výlučne do testovacej kópie** POHODY; skontrolovať typ `receivable`, partnera, CZK/EUR kurz, sumy, predkontáciu, dátumy, číselný rad a že doklady nie sú uhradené. Zopakovať import rovnakého XML s `checkDuplicity=true` a overiť, že nevznikne duplicitný doklad. Uschovať `responsePack` a schválenie účtovníčky. Nástroj sám úspešný import POHODA **netestuje**.

## Technické a bezpečnostné zábrany

- Zdrojové osobné údaje a CSV nikdy neposielať na verejný web, do Edge Function, PR, GitHubu či do chatu. XML i CSV nech sú v šifrovanom/súkromnom adresári prístupnom účtovníčke. Nástroj je **offline** bez Supabase service-role kľúčov.
- Generátor zastaví celý súbor pri neplatnom stave rezervácie alebo platby, nesúlade sumy a provízie, neplatnom Stripe identifikátore/prevode, chýbajúcom schválenom kurze pre **kladné** provízie, duplicite zdroja či dokladu, spore alebo inom internom vysporiadaní.
- Pri nulovej výplate z predĺženia sa nemá v databáze vymýšľať Stripe transfer. Ak je vyplatená suma nenulová, musí byť potvrdený skutočný Stripe transfer. Pri CZK predĺžení sa kontroluje rovnosť `owner_payout * 100` so skutočným transferom v menších jednotkách.
- Kontrolné CSV rozlišuje surové Stripe *minor units*, menu, stavy chýbajúcich fee a status refundovej evidencie. Tieto údaje sa **nesmú zameníť za províziu platformy**. Zmena skutočného účtovného režimu, právneho/daňového posúdenia alebo schémy vyžaduje nový audit pred používaním.
- SQL výber na konkrétny mesiac má limit: záznam bez úspešného owner transferu s kladným podielom vlastníka ešte **nie je zahrnutý**. To nie je potvrdením, že neexistujú otvorené záväzky. Mesačnú úplnosť je nutné porovnať so Stripe výkazmi a internou evidenciou.

## Oficiálne referencie

- POHODA XML: https://www.stormware.sk/pohoda/xml/xmlzpracovani/
- Duplicity a XML `numberRequested`: https://www.stormware.sk/pohoda/xml/obecny-obchod/pro-vyvojare/
- Oficiálne schémy: https://www.stormware.sk/pohoda/xml/seznamschemat/
- Test importu do agendy: https://www.stormware.sk/prirucka-pohoda-online/Datova_komunikacia/XML_import-export/
