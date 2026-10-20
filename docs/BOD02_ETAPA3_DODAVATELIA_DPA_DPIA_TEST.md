# Rentulo V1 – BOD 02 / ETAPA 3: Dodávatelia, DPA, prenosy a GDPR kontrola

**Dátum:** 20. 10. 2026. **Prevádzkovateľ:** EBBI s. r. o.; `policy@rentulo.com`. **Rozsah:** právne a bezpečnostné podklady pre CZ V1. **Stav jednotlivých dokumentov:** bez dokladu z reálneho účtu **NEOVERENÉ** (nesmie sa nahradiť odhadom). Verejné informácie môžu vyžadovať zmeny, ak sa zistí iný reálny stav.

## 1. Matica dodávateľov – kontrola pred PROD

| Poskytovateľ / účel | Údaje a prístup | Overiť v skutočnom účte / zmluve | Stav dokladu |
|---|---|---|---|
| Supabase (Auth, DB, Storage, Edge) | účty, kontakty, ponuky, rezervácie, logy | región DB, DPA, subprocesori, exporty/zálohy, retention, oprávnenia, prevody mimo EHP | **NEOVERENÉ** |
| Vercel (hosting) | IP, požiadavky, deployment/technické logy | **Pro schválené pre komerčné používanie V1**; pred PROD fakticky aktivovať Pro v účte EBBI a overiť plán, DPA, lokality logov, subprocesorov a retention | **Verejná Pro DPA overená; aktivácia Pro v EBBI účte nepotvrdená** |
| Stripe/Stripe Connect | platby, identity, finančné údaje, refundy | priamo rola Stripe samostatného správcu vs. spracovateľa podľa účelu, dokumentácia, medzinárodné prenosy, doklady | **NEOVERENÉ** |
| Resend (e-mail) | e-mail, obsah transakčných e-mailov, delivery metadata | DPA/rola, región, retenčné nastavenia, subprocesori, ochrana API kľúčov | **NEOVERENÉ** |
| BulkGate (SMS) | mobilné číslo a SMS udalosti | DPA/rola, skutočný SMS routing, operátori/poddodávatelia, retention, možnosť exportu/výmazu | **NEOVERENÉ** |
| cron-job.org (monitoring a plánované volania) | URL funkcií, technické výsledky, prípadne IP | DPA/rola, čo sa loguje do požiadaviek/odpovedí, retention, regióny, tajné tokeny v hlavičkách | **NEOVERENÉ** |
| OpenStreetMap tiles | IP adresa a technické údaje klienta pri mapových požiadavkách | služba a právna rola, pravidlá používania/retencie/transferov, geografická granularita mapy | **NEOVERENÉ** |
| Geoapify EU (adresy a geokódovanie) | ulica, domové číslo, mesto, PSČ; serverové volania z Edge Functions | V1 schválila použitie Geoapify EU endpointu `api-eu.geoapify.com`, DPA verejne existuje; API kľúč musí zostať iba v Supabase Secrets. Pred zapnutím zachovať dôkaz o zmluve/účte EBBI | **Verejná DPA a EU endpoint overené; zmluvný dôkaz EBBI sa doplní pri registrácii** |
| jsDelivr CDN (knižnice) | IP a technické údaje pri načítaní zdrojov | dôvody externého CDN, subprocesori/rola, možnosť self-hostingu, pravidlá bezpečnosti/SRI | **NEOVERENÉ** |
| Google Maps (užívateľský odkaz na trasu) | iba údaje odovzdané po kliknutí na externý odkaz | rozlíšiť samostatného prevádzkovateľa služby; nenahrádzať jeho podmienky naším DPA | **NEOVERENÉ** |

**Postup overenia:** pri každom poskytovateľovi založiť interný doklad: aktuálny dokument/prijaté podmienky DPA, dátum/URL/verzia, zodpovedná osoba, krajiny spracúvania, právna rola, prípadné SCC alebo rozhodnutie o primeranosti, subprocesori a lehoty. Zápis uložiť v zabezpečenom firemnom úložisku, **nie** s kľúčmi alebo osobnými dátami v GitHube. Nevyplnené doklady znamenajú blokátor tvrdenia, že prevádzka PROD už má kompletne právne overených dodávateľov.

## 2. DPIA a DPO – prvotné posúdenie, nie univerzálna výnimka

- **DPIA (čl. 35 GDPR)**: na základe známeho rozsahu V1 (C2C prenájom vecí, bežné kontaktné a lokalizačné údaje, bez rozpoznávania tvárí a zámerného rozsiahleho profilovania) zatiaľ nebol potvrdený automatický dôvod povinnej DPIA. Pred PROD overiť reálnu mieru a kategórie údajov, súvislé monitorovanie, rizikové kombinácie, mapovú presnosť a aktuálne usmernenia dozorného orgánu. Ak je spracúvanie pravdepodobne vysokorizikové, DPIA vykonať *pred* jeho spustením.
- **DPO (čl. 37 GDPR)**: EBBI nie je verejný orgán; podľa známeho modelu nie je podstatou služby rozsiahle spracúvanie zvláštnych kategórií údajov alebo rozsiahle pravidelné systematické monitorovanie osôb. Povinnosť menovať DPO zatiaľ nie je preukázaná. Rozsah spracúvania a príslušné ustanovenia pred PROD opätovne potvrdiť; kontaktná zodpovednosť GDPR zostáva u EBBI.
- **Register spracovateľských činností (čl. 30)**: základný prehľad v `docs/BOD02_ETAPA1_GDPR_DSA_BEZPECNOST_TEST.md`; upravovať vždy pri novej službe/príjemcovi alebo zmene lehôt. Záznam o spracovaní nie je náhradou DPA ani skutočnej bezpečnosti.

## 3. Prevádzkový postup – DSAR, DSA a incidenty

- **Žiadosti osôb** na `policy@rentulo.com`: po prijatí zaznačiť `received_at` a druh do `gdpr_subject_requests`, overiť identitu primerane, odpovedať spravidla do **jedného kalendárneho mesiaca**. O predĺžení najviac o ďalšie dva mesiace a dôvode informovať v prvom mesiaci. Pri výmaze rozlíšiť právne dôkazy, platby, legal hold a informácie v nezávislých službách. Nemazať automaticky bez posúdenia.
- **DSA podnety** na `rentulo@rentulo.com` (odkaz na kontakt z detailu ponuky): zaznačiť URL/dôvod/tvrdenie v dobrej viere do `dsa_content_notices`. Potvrdiť prijatie bez zbytočného odkladu, vyhodnotiť podnet, dokumentovať odôvodnenie rozhodnutia, oznámenie a prípadnú námietku. Konkrétny režim vnútorných sťažností podľa čl. 20 DSA posúdiť podľa uplatniteľnosti výnimky pre malé podniky.
- **Incident / únik**: bezodkladne obmedziť škody, zachovať primerané dôkazy, zaznačiť do `gdpr_security_incidents` kedy sa organizácia o porušení dozvedela, riziko, rozhodnutie, opatrenia. Pri pravdepodobnom riziku pre práva a slobody oznámiť dozornému orgánu pokiaľ možno do **72 hodín od zistenia** (čl. 33). Pri vysokom riziku informovať dotknuté osoby bez zbytočného odkladu, ak sa neuplatní výnimka (čl. 34).
- **Právne pozastavenie čistenia**: iba úzko odôvodnená `gdpr_legal_holds` na konkrétnu rezerváciu/ponuku/účet, prehodnotenie najneskôr za 6 mesiacov; nemá sa používať plošne a neurčito.

## 4. Záverečný kontrolný zoznam pred PROD

- [ ] Reálne doklady zmlúv a účtov podľa tabuľky vyššie (role, DPA, prenosy, regióny, backup/log retention).
- [ ] Finálne dátumy účinnosti právnych textov a kontrola znenia s právnikom relevantným pre CZ/SK trh; jednotné texty CZ/SK/EN/DE/PL.
- [ ] V browseri potvrdené správanie GPS, mapy, filtre, mobil a URL bez presných súradníc.
- [ ] DSAR/DSA/incident evidencie dostupné len dôveryhodným operátorom; proces a lehoty určené zodpovedným osobám.
- [ ] Rizikové posúdenie DPIA/DPO zdokumentované s dátumom a skutočným rozsahom V1.
- [ ] Finálne pravidlá retencie, individuálne právne výnimky a skutočné možnosť čistenia potvrdené integračne pred **oddeleným** schválením zapnutia brán.
- [ ] Pred prechodom na PROD samostatné rozhodnutie EBBI o testoch, auditných dokladoch, dátumoch a aktivácii.

**Stav:** technickú etapu 3 možno integrovať do TEST bez týchto dokladov; **nesmie sa však prezentovať ako úplná právna certifikácia alebo schválenie PROD**.
