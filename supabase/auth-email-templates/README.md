# Rentulo – BOD 9 – Supabase Auth e-maily (CZ/SK/EN/DE/PL)

**Zdroj:** GitHub `EBBI-SK/rentulo`, východiskový `main` `96467bb`.
**Prostredie:** výhradne Supabase TEST `vspposovhdgvbeukoivh`, nikdy nie PROD.

Tento priečinok ukladá tri schválené šablóny v repozitári. Ich umiestnenie
v Gite nie je automatická synchronizácia do Supabase Authentication.
Na použitie ich treba vložiť do príslušných nastavení v Supabase TEST.

## Spoločný postup ako pri ostatných opravách

1. Rozbaľ ZIP **priamo do** `C:\Users\ebbi\Desktop\pujc-naradi` so zachovaním podpriečinkov.
2. V existujúcom VS Code termináli spusti `npm test`.
3. Po úspešných testoch vykonaj:

   ```powershell
   git add supabase/auth-email-templates
   git commit -m "Add five-language Supabase Auth email templates"
   git push origin main
   ```

4. Over na GitHub, že commit prešiel a TEST deploy neskončil chybou.
5. V Supabase **TEST** → Authentication → Emails → Templates vlož obsah
   `Subject.txt` do **Subject** (celý na jeden riadok) a `Body.html` do
   **Body / Source** pre tieto tri typy:
   - Confirm sign up → `confirm-sign-up/`
   - Reset password → `reset-password/`
   - Change email address → `change-email-address/`
6. Každú upravenú šablónu ulož tlačidlom Save changes a skontroluj
   skutočne doručené e-maily testovacích používateľov pre všetkých 5 jazykov.

**Záloha:** Pred prepisovaním si odlož aktuálny Subject aj Body z každej
šablóny, hlavne celý pôvodný Subject pri Confirm sign up. Jeho úplné znenie
nebolo dostupné z pôvodnej snímky. Pôvodné obsahy zo snímok sú v staršom
pracovnom ZIP, ale celý Subject Confirm sign up tam nie je.

**Bezpečnosť:** Nevkladaj potvrdzovacie odkazy ani tokeny zo skutočných
e-mailov do chatu. Šablóny používajú `{{ .ConfirmationURL }}` a pri zmene
e-mailu `{{ .NewEmail }}`. V TEST over URL Configuration (rentulo.eu).

**Dôležité:** `npm test` a `git push` len kontrolujú/verzujú súbory
v repozitári. Neaktivujú Auth šablóny v Supabase; tie sa nastavujú
samostatne v dashboarde TEST.
