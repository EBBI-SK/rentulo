# Rentulo V1 – BOD 02: rozhodnuté nastavenie Geoapify EU a Vercel Pro

**Rozhodnuté 20. 10. 2026:** EBBI schválila pre Rentulo V1 Geoapify cez európsky endpoint a Vercel Pro pre komerčnú prevádzku. Ide o potvrdené rozhodnutie, **nie o dôkaz, že sú oba platené/externé účty už aktivované**.

## 1. Geoapify EU – iba zamýšľaný dopad tejto opravy

- Nahradiť verejné Nominatim/Photon **v dvoch existujúcich Supabase Edge Functions**: `address-suggestions` a `geocode-pickup`. Klientske formuláre, vzhľad, PIN, Stripe a rezervácie bez zmeny.
- Obe funkcie smerujú výlučne na `https://api-eu.geoapify.com`: autocomplete pri zadávaní adresy, search na geokódovanie. Neexistuje návrat k verejnému endpointu, ani fallback na iného poskytovateľa pri chybe.
- Na TEST (`vspposovhdgvbeukoivh`) najprv vytvoriť firemný Geoapify účet a API kľúč. **Kľúč nikdy nevkladať do GitHub, ZIP, klientského JavaScriptu, chatu ani na screenshoty.** V Supabase TEST > Edge Functions > Secrets nastaviť `GEOAPIFY_API_KEY`; následne nasadiť **len obe** Edge Functions do TEST.
- Najprv overiť URL, krajinu CZ, dokončenie adresy s domovým číslom, správnosť výsledných súradníc a správanie pri chybe. Testy používajú fiktívny kľúč a simulovaný server; **nie sú dôkazom funkčnosti reálnej služby bez kľúča**.
- Zabezpečený firemný doklad priložiť: prijatá zmluva/účtovné údaje Geoapify na EBBI, DPA verzia, región, dátum a správca. Konkrétne zmluvné potvrdenie účtu bez prístupu k nemu zostáva nepotvrdené.
- Odkazy poskytovateľa:
  - DPA: https://www.geoapify.com/data-processing-agreement/
  - EU endpoint a GDPR: https://www.geoapify.com/maps-geocoding-routing-apis-gdpr-compliant-application/
  - API autocomplete: https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/
  - API geocoding: https://apidocs.geoapify.com/docs/geocoding/forward-geocoding/

## 2. Vercel Pro – schválené, nie zapnuté automaticky

- EBBI schválila **Vercel Pro pre komerčné spustenie Rentulo V1**. Plán je nastavením účtu/fakturácie na Vercel, **nedá sa aktivovať zmenou `vercel.json` ani ZIP-u**.
- TEST ponechať na `rentulo.eu`. PROD `rentulo.com`, produkčné databázy a platby bez zásahu. Pri aktivácii Pro overiť reálny tím, projekt, platený plán a doklad EBBI v správe účtu, až potom označiť DPA za zmluvne pokrývajúcu konkrétny účet.
- Oficiálna DPA Vercel pre Pro a Enterprise: https://vercel.com/legal/dpa

## 3. Bezpečnostná hranica a stav

- Žiadny API kľúč nie je súčasťou repozitára, do HTTP odpovede klientovi sa neposiela a poskytovateľské URL s adresou sa nezapisujú do aplikačných logov.
- Bez nastavenia `GEOAPIFY_API_KEY` po nasadení funkcie bezpečne odmietnu požiadavku namiesto návratu k verejným poskytovateľom. **Preto nastav secret pred deployom, aby existujúce formuláre neprerušili prevádzku.**
- Získanie potvrdenia DPA/účtu, nastavenie secretu a výber plateného Vercel Pro plánu sú externé úkony v účtoch EBBI; nemožno ich označiť ako hotové samotným commitom alebo úspešným testom.

## Zmena BOD 2 – 27. 10. 2026 (návrh na TEST)

Automatické návrhy adries na klientskych formulároch Rentulo V1 sa po neúspešnom živom teste RÚIAN vyraďujú. Adresy (ulica/číslo, mesto, PSČ) sa zadávajú ručne v registrácii, nastaveniach, pri vytvorení a úprave ponuky. Geoapify EU ostáva pre **geokódovanie miesta vyzdvihnutia** (`geocode-pickup`) a polohu ponuky na mape; nejde o návrat k Photon/Nominatim. Nevyužívaný endpoint `address-suggestions` sa odstráni zvlášť až po bezpečnom nasadení a živom overení formulárov v TEST. Vyššie uvedené pôvodné rozhodnutie zostáva historickým záznamom a nie je aktuálnym návrhom našepkávania vo V1.
