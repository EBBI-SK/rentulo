# BOD – POHODA: samostatne ostatné pohľadávky za provízie Rentula

**Stav:** pripravený offline export pre kontrolný import v skúšobnej účtovnej jednotke POHODA. **Nie je to nasadenie do PROD, ani potvrdenie úspešného importu POHODA.**

## Schválené s účtovníčkou (18. 10. 2026)

- Každá skutočne finančne uzavretá provízia → samostatná **Ostatná pohľadávka** (`inv:invoiceType=receivable`).
- Skratka predkontácie v POHODE **presne `Provizie Rentulo`** (nie názov „Provízie Rentulo“). MD **315100** / D **602100**. Skratka musí v cieľovej účtovnej jednotke skutočne existovať s danými účtami.
- Cena a provízia vzniká v **CZK**; slovenská POHODA vedie domáce účtovníctvo v **EUR**. XML preto musí obsahovať **cudziu menu CZK a kurz**. Účtovníčka dodá kurz 1 EUR = X CZK; export ho do XML pre domácu menu EUR zapíše ako jeho prevrátenú hodnotu (EUR za 1 CZK). Bez schváleného kurzu sa export zastaví.
- Import nevytvára úhrady. Párovanie s agregovanými výplatami Stripe a bankou rieši účtovníčka.
- EBBI s. r. o. IČO 46306374 (podľa právnych údajov v repozitári).
- Teraz EBBI nie je platiteľ bežnej DPH (§ 4); v XML sa účelovo používa `rateVAT=none`. **Pred vznikom platiteľstva DPH treba zastaviť tento export a doplniť klasifikáciu aj správny režim DPH** – nedávať túto verziu do účtovného obehu pri zmenenom režime.

## Prečo je tento nástroj interný

V aktuálnom webovom Rentule neexistuje bezpečná administrácia účtovníka s oprávneniami. Preto tieto citlivé údaje **neexportujeme verejnou webovou funkciou ani Edge Function s otvoreným oprávnením**. SQL sa spúšťa ručne výlučne v Supabase TEST a generovanie XML beží **lokálne**, bez sieťovej komunikácie. Neskôr môže vzniknúť súkromná administrácia po samostatnom bezpečnostnom audite.

## Prvý TEST krok, bez importu do ostrej účtovnej jednotky

1. Otvoriť Supabase **rentulo** (TEST, project ref `vspposovhdgvbeukoivh`) → SQL Editor. Spustiť **len** `docs/sql/pohoda_provizie_export_TEST.sql` (je to jediný SELECT). V prvom riadku SQL nastaviť požadovaný mesiac (napr. `DATE '2026-10-01'`). Výsledok stiahnuť ako **CSV** do vlastného chráneného priečinka mimo repozitára. V CSV budú súkromné osobné údaje prenajímateľov – súbor nezverejňovať, neprikladať do PR/GitHubu.
2. Zohnať od účtovníčky schválené **kurzy 1 EUR = n CZK** pre dátumy vytvorenia dokladov. Pri používaní *jedného pevného kurzu* pre všetky doklady v mesiaci použiť `--rate <SCHVÁLENÝ_KURZ>` (hodnotu musí dodať účtovníčka). Pri denných kurzoch vytvoriť vedľajší CSV súbor `kurzy.csv` s hlavičkou `date,czk_per_eur`, a jedným riadkom za každý dátum, napr. `2026-10-18,24.50` (opäť iba ilustračný príklad). Žiadne kurzy sa nehádajú zo Stripe!
3. Vo VS Code termináli v priečinku projektu spustiť napríklad:

    ```powershell
    node scripts/export-pohoda-commissions.mjs --month 2026-10 --input "C:\cesta\k\stiahnutemu-vypisu.csv" --rates "C:\cesta\ku\kurzy.csv"
    ```

    alebo (iba keď účtovníčka výslovne používa pevný kurz):

    ```powershell
    node scripts/export-pohoda-commissions.mjs --month 2026-10 --input "C:\cesta\k\stiahnutemu-vypisu.csv" --rate <SCHVALENY_KURZ_OD_UCTOVNICKY>
    ```

4. V chránenom adresári `pohoda-export/` vzniknú **dva** súbory `rentulo-provizie-2026-10.xml` a `rentulo-provizie-2026-10-parovanie.csv`. Výstupný priečinok je ignorovaný cez `.gitignore` a nie je súčasťou verejného webového buildu. Pri rovnakom názve sa súbory zámerne **neprepíšu**; starý import nikdy neupravovať naslepo.
5. **Účtovníčka** najprv skúsi XML v **testovacej kópii** POHODY cez XML import. Skontroluje typ dokladu, meno partnera, dátumy, správny účet 315100/602100, prepočet CZK/EUR a kurz, sumu a že pohľadávka nie je zaplatená. Zároveň urobí druhý import toho istého súboru so zapnutou **kontrolou duplicity** a potvrdí, že nevznikne druhý doklad. Uloží výsledný POHODA `responsePack`. Až po tomto reálnom teste schválime formát na produkčné účtovníctvo.

## Bezpečnostné a účtovné zábrany

- Výber je založený na dátume **skutočného Stripe Connect transferu** v pražskom čase, nie na dátume prijatia platby. Iba stavy rezervácií `returned` a `no_show` so `succeeded` transferom, zaplatenou Stripe platbou a bez refundu.
- Ak je medzi podkladmi sporný alebo neuzavretý záznam, nulová/nesúhlasiaca provízia, neznámy partner, duplicita alebo chýba kurz, **celý export skončí chybou**; nie tichým vynechaním položky. V prípade neskorších refundov alebo chargebackov predtým zaúčtovaných provízií treba osobitný opravný doklad – tento nástroj ich automaticky nevytvára.
- Identifikátor dokladu vychádza stabilne z `R-000123` → `RP-000123`. XML obsahuje `checkDuplicity=true` a stabilný balík/ID; **účtovníčka musí v POHODE potvrdiť, že číselný rad a duplicity naozaj fungujú**. Vstupný SQL dotaz sa neopiera o testovanie klientov, môže čítať iba SQL administrátor.
- CSV na párovanie uvádza surové Stripe fee a skutočné sumy Stripe charge/transfer **v menších jednotkách** a ISO menu settlementu; tie sa nemusia zhodovať s CZK províziou. Nesmie sa z toho automaticky vypočítavať vlastný poplatok platformy.
- Požiadavka jedného dokladu na províziu sa vzťahuje aj na to, že súčet sumy prenájmu musí byť presne `provizia + suma prenajímateľovi`.
- XML import bude treba skontrolovať najmä kvôli číselnému radu a zahraničnej mene v konkrétnej slovenskej edícii POHODA. V tomto ZIPe nie je žiadna skutočná osobná/produkčná účtovná evidencia.

## Referencie k formátu

- POHODA XML dataPack/duplicitné importy: https://www.stormware.sk/pohoda/xml/xmlzpracovani/
- Import agendy Ostatné pohľadávky (`invoiceType=receivable`): https://api.stormware.cz/pohoda/xml-import-podporovana-data/faktury/faktury/
- Oficiálne XSD schémy POHODA v2: https://www.stormware.sk/pohoda/xml/seznamschemat/
- Import do testovacej firmy: https://www.stormware.sk/prirucka-pohoda-online/Datova_komunikacia/XML_import-export/
