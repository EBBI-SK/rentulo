# Rentulo V1 – BOD 02 / ETAPA 3: Web, GPS, 5 jazykov, dokončenie dokumentácie

**Pripravené:** 20. 10. 2026. **Prostredie:** iba TEST `rentulo.eu`, Supabase `vspposovhdgvbeukoivh`. **PROD `rentulo.com`: žiadny zásah ani automatická aktivácia.**

## 1. Čo obsahuje táto etapa

- Na úvodnej stránke sa poloha **už nevyžaduje pri otvorení stránky ani na zmenu predtým udeleného browser povolenia**. Explicitné tlačidlo „Najít nabídky v okolí“ po kliknutí zavolá `navigator.geolocation.getCurrentPosition`.
- Pri prechode na výsledky súradnice nejdú do `window.location.search`, GET parametrov `lat`/`lng`, adresného riadku, histórie URL ani profilu. Odovzdajú sa **jednorazovo** cez `sessionStorage` v tej istej karte (maximálna platnosť 120 sekúnd); stránka výsledkov ich bezodkladne z dočasného úložiska odstráni a použije len v pamäti aktuálnej stránky. Obnovením výsledkov sa poloha stratí a vyhľadávanie nezotriedi podľa vzdialenosti. Ak úložisko nie je dostupné, systém zlyhá bezpečne a odporučí hľadanie podľa mesta.
- Pre staré odkazy s `lat`/`lng` sa tieto hodnoty vymažú z URL a **nepoužijú** na GPS vyhľadávanie; vymazanie po otvorení odkazu nemôže späťne odvolať už vykonanú požiadavku na server ani staré logy. Naše nové odkazy tieto parametre nevytvárajú.
- Text na úvodnej stránke vysvetľuje postup; chybové správy sú v CZ/SK/EN/DE/PL.
- Verejné GDPR informácie boli zosúladené vo všetkých piatich jazykoch: poloha zariadenia, externé mapové služby/CDN, krátkodobá cache a kategórie retencie. Na stránkach, ktoré ho načítavali, bol odstránený samostatný externý Google Fonts request (použité systémové fonty).
- Súčasťou je dokument pre kontrolu dodávateľských zmlúv, regionálnych nastavení, DPIA/DPO a medzinárodných prenosov. **Nie je to dôkaz, že zmluvy v účtoch dodávateľov už boli právne skontrolované a schválené.**
- Žiadna zmena Stripe, platenia, PIN, samotných rezervácií, DB tabuliek či retencie. Mazacie brány z etapy 2 zostávajú vypnuté.

## 2. Naviazané už dokončené etapy

- Etapa 1: 5 interných GDPR/DSA/incident evidencií, ochranné triggery, vypnuté mazanie. Úspešný GitHub PR #31; migrácia inštalovaná a kontrolovaná v Supabase TEST.
- Etapa 2: GitHub PR #32, 4 TEST migrácie, sedem kategórií retenčných pravidiel, náhľady, právne pozastavenia, ochrana vlastníkových kontaktov a obmedzený Edge worker `gdpr-cleanup-offer-photo`. Súhrnné TEST kontroly, výstup `false,0,0`, worker `ok:true,claimed:0,removed:0` a neprihlásený HTTP 401 úspešné. **Neaktivovať nič na PROD.**
- Interne schválené pravidlá v `docs/BOD02_GDPR_RETENCNA_POLITIKA_V1.md` majú ďalšie nevyhnutné výnimky pre právne nároky a účtovníctvo. Technicky prebiehajú iba explicitne povolené druhy čistenia, v TEST predvolene vypnuté.

## 3. Inštalačný a overovací postup iba pre TEST

1. Rozbaliť etapu 3 v novej lokálnej vetve `feat/bod02-etapa3-web-gdpr-test` z aktuálneho `main`, dodržať cesty. Skontrolovať `git status --short`.
2. Spustiť `npm test`, `npm run build`, `git add -A`, `git diff --cached --check`. CI po Pull Request, merge až po úspechu. **Etapa 3 neobsahuje SQL migráciu ani Edge Function.**
3. Overiť, že `rentulo.eu` (TEST Vercel) má novú verziu, a že produkčný `rentulo.com` nebol nasadený.
4. V anonymnom okne Chrome DevTools → Network → Preserve log, stránka `rentulo.eu`:
   - Otvorenie úvodnej stránky **nevyvolá** geolokačné oprávnenie. Mapa ČR aj bežné vyhľadávanie fungujú bez polohy.
   - Klik na „Najít nabídky v okolí“ vyžiada oprávnenie; pri odmietnutí sa zobrazí príslušný preklad a dá sa vyhľadávať podľa mesta.
   - Pri povolení výsledný link obsahuje `okoli=1`, **neobsahuje** `lat` ani `lng`, v URL sa žiadna presná súradnica neobjaví. Výsledky sa zoradia podľa vzdialenosti, ak majú ponuky mapové GPS.
   - V `Application → Session Storage` po načítaní výsledkov už nie je kľúč `rentuloNearbyOnceV1`; lokálne zobrazenie vzdialeností funguje aj bez uloženia súradníc do profilu.
   - Po obnovení výsledkov je poloha nedostupná a banner oznámi nezoradené výsledky (zámerné).
   - Otvorenie starého linku `vysledky.html?okoli=1&lat=49.2&lng=16.6` odstráni `lat`, `lng` a **nepoužije** ich na zoradenie.
   - Vyhľadávanie podľa mesta, kategórie, ceny, detail a mapa fungujú rovnako ako predtým.
5. V každom jazyku CZ/SK/EN/DE/PL skontrolovať text tlačidla, chybu odmietnutia polohy a odseky `ochrana-osobnich-udaju.html` § 5, 6, 8, 10, 11.
6. Skontrolovať, že bez kliknutia nevznikajú HTTP požiadavky na `fonts.googleapis.com` z upravených stránok. CDN a mapové požiadavky sa zobrazujú podľa použitých externých nástrojov; ich odosielanie IP je uvedené v právnych informáciách.
7. V Supabase TEST iba čítacou kontrolou potvrdiť, že všetky štyri GDPR mazacie brány sú `false`, počet schválených kategórií je 0; neaktivovať čistenie.
8. DPA/DPIA/DPO a dodávateľskú maticu skontrolovať proti reálnym účtom/zmluvám podľa samostatného checklistu. **Chýbajúce doklady nesmie interný audit automaticky označiť ako „hotové“.**

## 4. Rozsah úspechu a otvorené dôkazy

**Technicky v etape 3:** klientské GPS správanie, odstránenie GPS z URL, jednorazový prenos, preklady/HTML, statické a VM testy a TEST build. **Na overenie v prehliadači:** reálne povolenie/odmietnutie GPS, mobilný Chrome/Safari, mapa a všetky filtre v TEST po Vercel deployi.

**Nevyhlasovať bez externých dokladov:** podpis a účinnosť DPA, správnosť regiónov Supabase/Stripe/Resend/BulkGate/Vercel, SCC a subprocesorov, a to, či sa uplatňuje povinnosť DPIA/DPO pre skutočný produkčný rozsah. Dokumentácia týchto kontrol je v `docs/BOD02_ETAPA3_DODAVATELIA_DPA_DPIA_TEST.md`.

**Bezpečnostný princíp:** etapy 1 a 2 patria k GDPR bezpečnostným zábranám, ale úspešný automatický test neznamená schválenie skutočného mazania údajov ani plnú právnu certifikáciu. PROD výlučne po samostatnom rozhodnutí.
