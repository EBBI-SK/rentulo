# BOD 02 – právny a daňový audit Rentulo V1 (CZ) / TEST

**Dátum technického návrhu:** 18. 10. 2026
**Stav:** schválený produktový rozsah, pripravený návrh zmien; **BOD 02 NIE JE UZAVRETÝ**.
**Predloha:** používateľský ZIP z 18. 10. 2026; GitHub `main` `d8bbfd2295670602db0ecd71d9d0d573ca5674e7`, úspešný GitHub CI [#39104698086](https://github.com/EBBI-SK/rentulo/actions/runs/39104698086) pred BOD 02.
**Dátum spustenia:** nestanovený. Produkčná doména a live platby nie sú schválené.

## 1. Schválený produktový model

- Prevádzkovateľ: **EBBI s. r. o.** (Slovensko), český trh, CZK, zákaznícke rozhranie CZ/SK/EN/DE/PL.
- **V1 výlučne súkromné osoby**; podnikanie v rámci ponuky nie je povolené. Skutočný status sa nesmie posudzovať len podľa samotného vyhlásenia osoby.
- Zmluvný nájom veci vzniká medzi súkromným majiteľom a nájomcom. EBBI poskytuje platformu a platobnú integráciu, nezaručuje poistenie ani paušálne neodmieta zodpovednosť za vlastné služby.
- Provízia Rentula: **10 %**, minimálne **50 Kč** na rezerváciu; min. cena ponuky 100 Kč/deň. Existujúce podmienky storna, odovzdania PINom, vrátenia, no-show a Stripe transferu ostávajú bez funkčných zásahov BODU 02.
- **Schválené rozhodnutie 18. 10. 2026:** vo V1 sa **neponúkajú dopravné prostriedky**, napríklad autá, motocykle, mopedy, skútre, bicykle, elektrobicykle, kolobežky, lode, člny, kajaky, obytné autá či prívesy. Až pri záujme zákazníkov a po samostatnej právnej/daňovej analýze sa môže ich prenájom povoliť vo V2.
- Ďalšie zakázané veci: zbrane, výbušniny, nebezpečné chemikálie, drogy, lieky na predpis, kradnuté a falšované veci, predmety mimo legálneho a bezpečného použitia.

## 2. Audit oblastí a záväzné kroky pred verejným spustením

| Téma | Pracovný záver / pripravované opatrenie | Externé potvrdenie / doklad požadovaný |
| --- | --- | --- |
| Cezhraničný model SK → CZ | Samotní českí klienti automaticky neznamenajú nutnosť zakladať českú s.r.o.; preveriť oprávnenie, skutočné miesto výkonu a riziko stálej prevádzkarne | Písomné právne/daňové stanovisko |
| Slovenská registrácia § 7a | V staršom audite uvedený údaj z externého registra o registrácii EBBI; **nepovažovať za oficiálne overený** a nezamieňať s bežným platiteľstvom DPH | Oficiálny výpis Finančnej správy SR / registrácia, aktuálny stav a IČ DPH |
| Provízia a DPH | Právne klasifikovať službu (sprostredkovanie / elektronická služba / iné) a určiť miesto dodania pri B2C súkromných osobách, českú/slovenskú DPH, prípadné SME/OSS a formuláciu faktúr | Písomné stanovisko účtovníka/daňového poradcu k skutočnému peňažnému toku; nezaúčtovať domnienku ako hotový verdikt |
| Vstupné náklady Stripe / Vercel a iné | Posúdiť režim samozdanenia pri cezhraničných službách a možné nároky na odpočet podľa skutočného statusu EBBI | Účtovník + podklady dodávateľov |
| DAC7 | DAC7 uvádza predaj tovaru, osobné služby, nehnuteľnosti a prenájom dopravy; **bežný prenájom predmetov** nie je samostatná vykazovaná kategória. Dopravné prostriedky vo V1 zakázané | Právne posúdenie konkrétneho modelu, monitorovanie rozšírení a prípadného predaja, nie paušálna výnimka pre všetkých prenajímateľov |
| DSA | Hostované ponuky potrebujú dostupný mechanizmus oznámenia nezákonného obsahu, potvrdenie prijatia, rozhodnutie a informácie o opravnom prostriedku; pri mikro/malom podniku overiť konkrétne výnimky | Interná metodika, vyhodnotenie veľkosti EBBI a doklad o prevádzkovaní DSA kanála |
| GDPR | Správca EBBI, služby Supabase/Vercel/Stripe/Resend/BulkGate/OSM; príslušné účely a právne základy už opísané. Uvedené všeobecné retenčné kritériá, nie presné potvrdené obdobia | Finálne retention schedule, zmluvy/DPA, posúdenie prenosov, incident plán, evidencie prístupov a žiadostí |
| Stripe Connect | Používa sa **Separate Charges and Transfers**; platforma môže byť merchant of record pre platbu a znášať platobné poplatky/refundy/spory, čo ju samo osebe nerobí prenajímateľom | Písomné potvrdenie Stripe/odborníka pre EU platformu + českých súkromných majiteľov, odložené transfery a PSD2 režim |
| ČR spotrebiteľské informačné povinnosti | Viditeľne uviesť, že prenajímateľ je súkromná osoba na základe jeho vyhlásenia a rozdeliť zodpovednosť za platformu vs. vec; nevylúčiť zákonné práva | Český právnik; presne určiť ADR subjekt EBBI pre vlastnú službu (nie pre C2C spor) |

Zdroje k právnej klasifikácii a kontrolám (kontrola 18. 10. 2026):
- DAC7 (EÚ 2021/514, príloha V): https://eur-lex.europa.eu/eli/dir/2021/514/oj/eng
- DSA (EÚ 2022/2065), články 11, 12, 14, 16, 17, 19 a podľa posúdenia aj 20: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32022R2065
- ČR 634/1992 Sb. § 11b (on-line trhoviská): https://e-sbirka.gov.cz/sb/1992/634
- Stripe Connect a PSD2: https://stripe.com/guides/frequently-asked-questions-about-stripe-connect-and-psd2
- Stripe Separate Charges and Transfers: https://docs.stripe.com/connect/separate-charges-and-transfers
- DPH, oficiálna FS SR: https://www.financnasprava.sk/sk/podnikatelia/dane/dan-z-pridanej-hodnoty

Toto je technicko-právny kontrolný podklad, **nie** osvedčenie o súlade ani náhrada stanoviska českého právnika a slovenského daňového poradcu.

## 3. Čo mení tento ZIP

- `obchodni-podminky.html`, `ochrana-osobnich-udaju.html`, `js/i18n.js`: presnejší rozsah V1, rozlíšenie zodpovedností, Stripe merchant-of-record nuance, nahlasovanie podľa DSA, škody, ďalšie zakázané kategórie, verzia návrhu **1.1** vo všetkých piatich jazykoch. **Dátum právnej účinnosti nie je určený.**
- `nabidnout.html`, `edit-nabidka.html`, `js/offer-policy.js`, `js/offer-form-page.js`, `js/edit-offer.js`: upozornenie a povinné potvrdenie, kontrola zjavného dopravného prostriedku ešte pred zápisom alebo nahraním fotografie.
- `supabase/migrations/20261018110000_bod02_v1_transport_rule_TEST.sql`: samostatné serverové vynútenie zjavne zakázaných názvov a kategórií pri `INSERT` aj každom `UPDATE`, aj pri priamom API; **iba TEST**, chránené kontrolou projektu.
- `detail.html` ostáva štrukturálne rovnaký; `js/detail-page.js` pridáva pri ponuke označenie deklarovaného súkromného vlastníka a odkaz na e-mailové nahlasovanie ponuky.
- `kontakt.html`: dostupné podrobné pokyny pre DSA oznámenie a námietku.
- `registrace.html`, `js/registration-page.js`: viditeľné číslo verzie dokumentov a v Supabase `auth.users.raw_user_meta_data` nové **klientom zaslané** polia `terms_version`, `privacy_notice_version`, `terms_language`. Existujúci súhlas a čas záznamu sú zachované. **Metadáta si môže používateľ potenciálne neskôr meniť; nie sú nemenným audítorským záznamom.** Pred ostrou prevádzkou zvážiť serverom chránený audit akceptácie a režim obnoveného súhlasu po zmene podmienok.
- `tests/bod02-legal-transport.test.js`: nové regresné testy.
- `README.md` a `HANDOVER.md`: stav BOD 02 a zákaz produkčného nasadenia bez potvrdenia.

## 4. Obmedzenia technického filtra a moderovanie

1. Na frontende ani v SQL **nejde o úplnú sémantickú identifikáciu veci**. Fotografia, skrytá značka alebo opis bez rozpoznaných slov môžu obísť blokovanie. Automatické pravidlo môže nesprávne vyhodnotiť napr. názov automobilového príslušenstva obsahujúci samostatné slovo „auto“; v takom prípade podať podnet na podporu.
2. Kontroluje sa **názov a kategória**. Opis a fotografia vyžadujú moderovanie. Zákaz bez moderovania by preto nebol absolútne vynútiteľný.
3. Staršie aktívne ponuky sa migráciou **nepresúvajú** a ich rezervácie sa nemenia. Pred verejným spustením skontrolovať existujúce TEST ponuky a manuálne vyriešiť prípadné výnimky. Na PROD sa nič neaplikuje.
4. Podnety vyhodnocovať individuálne; neblokovať zákonné príslušenstvo len podľa kľúčového slova bez možnosti vysvetlenia.

**Bezpečný prehľad existujúcich starších kategórií v TEST (len čítanie):**

```sql
select offer_number, name, category, status, created_at
from public.offers
where lower(btrim(coalesce(category, ''))) in ('auto a doprava', 'vehicles', 'transport', 'dopravní prostředky')
   or lower(coalesce(name, '')) ~ '(auto|motocykl|motorka|bicykl|bicykel|jízdní kolo|koloběžka|elektrokolo|skútr|loď|člun|kajak|přívěs)'
order by created_at desc;
```

Dotaz je iba podklad na ručnú kontrolu (môže zachytiť príslušenstvo), **nie pokyn na automatickú zmenu statusu**.

## 5. Postup DSA – návrh prevádzkovej smernice

- Kontaktné miesto pre podnety a úradné správy: `rentulo@rentulo.com`; GDPR: `policy@rentulo.com`.
- E-mailové oznámenie: URL/číslo ponuky, opis obsahu, zákonný dôvod, kontakt oznamovateľa (s prípadnými zákonnými výnimkami) a potvrdenie dobrej viery.
- Zaistiť interný číslovaný záznam prijatia, dátumu, URL, prípadného dôkazu, osoby rozhodujúcej, odôvodnenia, upovedomenia používateľa a námietky. Súčasný ZIP **neimplementuje helpdesk/ticketing ani automatické odosielanie potvrdení**; potrebný je skutočne obsluhovaný manuálny proces.
- Včas a objektívne vyhodnotiť podnet, pri nezákonnom obsahu obmedziť prístup v potrebnom rozsahu. Dotknutých v rozsahu zákona informovať o dôvodoch a opravných prostriedkoch. Pre mikro/malý podnik overiť výnimku zo špeciálneho čl. 20, **nie** z čl. 16.
- Sťažnosti na fungovanie Rentula a finančné spracovanie oddeľovať od súkromnoprávneho sporu o poškodenú vec.

## 6. Ručný TEST plán (po GitHub CI/merge a schválenom nasadení SQL)

1. Pred nasadením SQL overiť hodnotu `vault.decrypted_secrets` `rentulo_project_url` pre TEST. **Nikdy nespúšťať migráciu na PROD**.
2. V TEST SQL editore vykonať `20261018110000_bod02_v1_transport_rule_TEST.sql`; potvrdiť existenciu triggera. Nepoužívať Supabase PROD.
3. Prihlásiť súkromný TEST účet. Nová ponuka „Jízdní kolo“ musí byť odmietnutá ešte pred nahraním fotky; tiež „Koloběžka“, „Motocykl“, „Loď“, kategória `Auto a doprava` pri priamom zápise cez API.
4. Nová ponuka „Vrtačka“, kategória `Hobby`, cena >= 100 Kč, s potvrdením pravidiel sa uloží. Bez potvrdenia sa neuloží.
5. Upraviť existujúcu povolenú ponuku na „Elektrokoloběžka“ – musí byť zamietnutá; povolená úprava musí fungovať. Overiť ochranu aj pri priamom API `UPDATE status` pre zjavne zakázaný starý obsah.
6. Skontrolovať hlavičku detailu, deklarovaný súkromný status, odkaz na nahlásenie a kontakt; pri `cs/sk/en/de/pl` overiť texty všetkých právnych sekcií a mobilné zobrazenie.
7. Zaregistrovať nový TEST účet a bezpečne skontrolovať hodnoty `terms_version`, `privacy_notice_version`, `terms_language`, `terms_accepted_at` v autorizovanom rozhraní. Nezobraziť iné osobné údaje.
8. Prejsť existujúce rezervácie a Stripe TEST platby – **žiadna zmena** v platbách, PIN, transferoch ani historických rezerváciách.
9. Po schválenom TEST overení dokumentovať dátum migrácie, testujúceho, zistenia, CI run, commit a rollback postup. Produkcia má osobitný proces.

**Lokálne overenie pripraveného ZIP-u (18. 10. 2026):** `npm test` **563/563**, `npm run build` úspešný s TEST Supabase. Kontrola jedinečnosti HTML identifikátorov pre vybrané stránky úspešná. Skutočná databázová migrácia ani koncové TEST scenáre zatiaľ **neboli vykonané**. Prehliadačové screenshot QA nie je ešte potvrdené.

## 7. Uvoľňovacie podmienky BODU 02

- [x] Schválený zákaz dopravných prostriedkov vo V1, potenciálne až V2.
- [x] Pripravený súbor zmien HTML/JS, serverovej TEST SQL migrácie, testov a dokumentácie.
- [ ] ZIP vložený vo VS Code, otestovaný a potvrdený používateľom.
- [ ] Commit/push, PR, GitHub CI, merge do `main`.
- [ ] TEST databázová migrácia a reálne funkčné testy.
- [ ] Overený prevádzkový DSA postup vrátane evidencie, odpovedania na podnety a nahlasovania.
- [ ] Overené zmluvy spracovateľov údajov, konkrétne GDPR lehoty a prenosy.
- [ ] Oficiálne overený stav registrácie EBBI pre DPH/§ 7a a písomné stanovisko k províziám.
- [ ] Písomné potvrdenie vhodnosti Stripe Connect SC&T a príslušného PSD2 postavenia.
- [ ] Český právnik schválil podmienky, obsah piatich jazykov a povinné informácie podľa CZ práva.
- [ ] Určený dátum účinnosti právnych dokumentov a postup pre existujúcich používateľov.
- [ ] Záver dokumentácie doplnený po kontrolách, BOD oficiálne uzavretý.

**Kým tieto podmienky nie sú splnené, dokumenty verzie 1.1 sú iba pripravený TEST návrh, nie právne odsúhlasená produkčná verzia.**
