# Rentulo V1 – BOD 2: riadené nasadenie SQL do Supabase PROD

**Vypracované:** 25. 10. 2026  
**Stav 25. 10. 2026:** **76 migrácií v PROD; 1 z 38 nových nasadená, druhá zlyhala na REVOKE neexistujúcej funkcie. Opravené SQL pripravené; zostáva 37 migrácií. Ďalší PROD push len po novom dry-run a kontrole.**  
**GitHub `main` pred opravou:** `55e34da87d8c084f6d727ba1264db338b123515c` (PR #60); pôvodný SQL release zdroj bol zmrazený na `e4be9fbfd0e18fb15473984bf0a883d72c35bfa2`.  
**GitHub `production`:** `a79d3bb93bbf37a7d36c35484fadcdeb461419ea` (bez zmeny)  
**Supabase TEST:** `vspposovhdgvbeukoivh` – nepripájať ani neupravovať.  
**Supabase PROD:** `tfvgxrdjrpicgtvovehl` – zatiaľ neverejné.

## 1. Presný rozsah

Pôvodný prípravný balík (PR #60) pridal tieto **štyri súbory** do projektu:

1. `supabase/prod-release-20261024/deploy-manifest.json` – zmrazený inventár 75 + 38 SQL a SHA-256 každej PROD SQL.
2. `scripts/prepare-prod-sql-release.mjs` – iba lokálna príprava oddeleného pracovného priestoru. **Nepripája sa** k Supabase.
3. `tests/prod-sql-deploy-preparation.test.mjs` – jeden cielený offline test.
4. `docs/BOD2_SUPABASE_PROD_SQL_NASADENIE_20261025.md` – tento postup.

**Oprava po čiastočnom nasadení:** mení sa iba druhé PROD SQL `20261011103000_guard_pickup_and_remove_test_payment.sql` (odstránenie neplatného `REVOKE`), jeho SHA-256 v manifeste, tento postup a jediný cielený test. Prvú už vykonanú migráciu `20261009130000` nemeníme. TEST migrácie `supabase/migrations/` zostávajú nezmenené. Nevytvárame ďalšie Edge Functions, cron joby ani API kľúče.

## Opravná poznámka po chybe druhej migrácie (25. 10. 2026)

- Skutočný PROD výsledok SQL Editoru: `pocet_migracii=76`, `posledna_migracia=20261009130000`, `prva_zapisana=true`, `druha_zapisana=false`, `testovacia_funkcia_existuje=false`.
- `prod_final_guard` už predtým odstránil `public.mark_my_reservation_paid_test(uuid)`; preto následné `REVOKE ALL ON FUNCTION` zlyhalo. Oprava tento jeden `REVOKE` odstránila, ale ponechala `DROP FUNCTION IF EXISTS`, ktorý toleruje oba stavy a odstráni prípadnú funkciu aj s jej oprávneniami.
- Druhá migrácia obsahuje `BEGIN` a zlyhala na druhom SQL príkaze; nebola zaznamenaná ako vykonaná. **Nepoužívať `migration repair`, neopakovať prvú migráciu, nemazať zoznam migrácií ani nevykonávať restore.**
- Pokračovanie je povolené iba po **novom** prípravnom priečinku z aktualizovaného manifestu, read-only kontrole 76 verzií a novom `db push --dry-run` s presne 37 pending. Ostatné SQL súbory zostávajú nezmenené.

## 2. Overený stav PROD pred prípravou

- Supabase Pro: aktívne, databáza PROD: `Healthy`.
- Zálohy: 24. a 25. 10. 2026 v Dashboarde viditeľné *Physical* backupy. Pred skutočným SQL zásahom **znovu overiť aktuálny obnoviteľný bod** a možnosť obnovy; fyzická záloha neznamená otestovaný restore a nezahŕňa obsah Storage objektov.
- Pred prvým nasadením: **75 verzií**, posledná `20261008120000`, odtlačok `a30b4b2c515cf6a02d8831be001c297f`. **Potvrdený stav po zastavení: 76 verzií**, posledná `20261009130000`, odtlačok verzií očakávaný `4d28b674443cbf0fcbec10b6d681fa19` (overiť read-only dotazom pred ďalším push). Druhá verzia `20261011103000` nie je zapísaná.
- Zo 75 verzií: **73** korešponduje s pôvodným GitHub `production`; dve PROD-only: `20260721100000_prod_fresh_project_guard`, `20261008120000_prod_final_guard`.
- `rentulo_prod_release_target = tfvgxrdjrpicgtvovehl` v PROD Vault: vytvorený a overený používateľom.
- `rentulo_project_url`: `UNCONFIGURED` (overené); žiadne aktívne ani neaktívne `rentulo-%` crony vo výpise (overené).
- Nové migrácie v balíku: **38**; prvá `20261009130000` už bola úspešne nasadená, **37 zostáva pending**, posledná `20261024150000`.

## 3. Bezpečná lokálna príprava (teraz povolené)

V **koreni projektu Rentulo** vo VS Code / PowerShell spustiť iba:

```powershell
node --test tests/prod-sql-deploy-preparation.test.mjs
node scripts/prepare-prod-sql-release.mjs
```

Test a príprava **nepristupujú na internet, do TEST ani PROD databázy**. Druhý príkaz vytvorí v systémovom dočasnom adresári nový izolovaný priečinok a vypíše jeho presnú cestu.

Nový manifest má nový SHA-256, a preto prípravný skript vytvorí **nový izolovaný priečinok**; starý staging z neúspešného pokusu sa nesmie používať. Lokálny skript môže stále vypísať 38 SQL súborov; **počet skutočne čakajúcich migrácií určuje `migration list` a `--dry-run`: musí byť presne 37**.

V izolovanom priečinku je:

- `supabase/config.toml` – minimálna lokálna konfigurácia bez project-ref, hesiel a secrets.
- `supabase/migrations/` – **113 SQL súborov**: 75 *ochranných zástupných súborov* (fail-closed) a 38 skutočných PROD SQL.

**Prečo ochranné zástupné súbory?** Supabase CLI identifikuje migrácie podľa 14-ciferného čísla. Pôvodných 75 v PROD už **bolo vykonaných**. Prípravný postup ich teda v izolovanom priestore zámerne reprezentuje SQL, ktoré obsahuje `RAISE EXCEPTION`. Ak by niektorá zo 75 verzií v cieľovej databáze chýbala, namiesto omylom zopakovaného historického SQL musí dôjsť k zastaveniu. Zástupné súbory nie sú reálnou náhradou pôvodných 75 SQL, **nikdy sa nesmú spustiť**, nie sú určené na vytvorenie novej databázy a nepatria do štandardného `supabase/migrations/`.

Izolovaný priestor je mimo Git repozitára. Ak už existuje, program ho len overí; pri nezhode odmietne pokračovať. Nepoužíva sa `supabase link` ani existujúce prepojenie lokálneho TEST.

## 4. Preflight bez zápisu do databázy (až pred samostatne schváleným nasadením)

**A.** Overiť na GitHube posledný zdrojový commit. Ak sa zdroj alebo 38 SQL zmenilo, nové nasadenie neschvaľovať bez aktualizovaného release balíka.

**B.** V Supabase Dashboard vybrať výhradne **PROD `tfvgxrdjrpicgtvovehl`** a spustiť tento **read-only** dotaz:

```sql
select count(*) as pocet_migracii,
       max(version) as posledna_migracia,
       md5(string_agg(version, ',' order by version)) as kontrolny_odtlacok
from supabase_migrations.schema_migrations;
```

Pred pokračovaním vyžadovať **76**, `20261009130000`, `4d28b674443cbf0fcbec10b6d681fa19`. Záznam `20261011103000` musí chýbať. Odchýlka = **STOP**, bez `migration repair`. Prvá už vykonaná migrácia sa nesmie opakovať.

**C.** Samostatne, bez vypísania akýchkoľvek tajných hodnôt:

```sql
select
  case when exists (
    select 1 from vault.decrypted_secrets
    where name = 'rentulo_prod_release_target'
      and decrypted_secret = 'tfvgxrdjrpicgtvovehl'
  ) then 'OK' else 'STOP' end as prod_guard,
  case when exists (
    select 1 from vault.decrypted_secrets
    where name = 'rentulo_project_url' and decrypted_secret = 'UNCONFIGURED'
  ) then 'OK' else 'STOP' end as prod_url,
  (select count(*) from cron.job where jobname like 'rentulo-%') as pocet_cronov;
```

Vyžadovať `OK`, `OK`, `0`. Overiť **použiteľnú aktualizovanú zálohu** a nulové neautorizované zmeny. Potom získať samostatný súhlas na PROD SQL.

**D.** Supabase CLI sa musí spustiť **len z izolovaného pracovného priestoru** (alebo s presným globálnym `--workdir` naň). Na pripojenie slúži iba **PROD** Postgres *session pooler*, ideálne port 5432; zvolenú adresu treba ručne skontrolovať podľa PROD Dashboardu. URL neukladať do Gitu, súborov ani neodosielať do chatu. Pripravená Node funkcia `validateProdDbUrl()` rozpoznáva PROD hostiteľa/pooler a odmieta TEST, no **sama databázu neotvára**.

**E.** Supabase CLI má zdokumentované read-only/predbežné príkazy `migration list --db-url` a `db push --db-url --dry-run`. Príkazy budú zadané **samostatne až po ďalšom schválení a kontrole cieľovej URL**. Výpis musí ukázať presne **76 už vykonaných** (75 pôvodných + prvá nová) a **37 pending** migračných verzií, bez akýchkoľvek ďalších. Nesúlad = **STOP**, nikdy nevykonávať `migration repair`, `db reset`, `db push --include-all` naslepo ani `supabase link` na hlavnom TEST workspaci.

Oficiálna dokumentácia Supabase: https://supabase.com/docs/reference/cli/supabase-db-push a https://supabase.com/docs/guides/deployment/database-migrations .

## 5. Pokračovanie zostávajúcich 37 migrácií – iba po opätovnom preflighte

**Pôvodný `db push` bol autorizovaný, ale zastavil sa na druhej migrácii; žiadny ďalší push sa nemá spúšťať, kým oprava nie je zlúčená do `main` a opätovný preflight nevypíše 37 pending.** Po potvrdení rozsahu a bezchybnom preflighte bude operátor používať oficiálny **Supabase CLI `db push` s explicitným `--db-url` výhradne pre PROD a s izolovaným `--workdir`**, nikdy root projektu. Supabase CLI štandardne po úspešnom vykonaní jednotlivých migrácií zapisuje ich verzie do `supabase_migrations.schema_migrations`; starých 75 sa nesmie vykonať znova.

Počas SQL migračnej fázy nesmie byť aktivované LIVE Stripe, email/SMS worker ani produkčné crony. `rentulo_project_url` musí zostať `UNCONFIGURED`. Ak nastane chyba, príkaz okamžite zastaviť; **automatické opakovanie alebo oprava migračnej histórie sú zakázané**. Pokračovať iba podľa skutočne poslednej vykonanej migrácie a nového schváleného postupu. Jedna migrácia môže obsahovať SQL, ktoré nemožno univerzálne vrátiť jednoduchým revertnutím Git commitu (napríklad `ALTER TYPE ... ADD VALUE`).

### Očakávaná kontrola po úplnom úspechu

```sql
select count(*) as pocet_migracii,
       max(version) as posledna_migracia,
       md5(string_agg(version, ',' order by version)) as kontrolny_odtlacok
from supabase_migrations.schema_migrations;
```

Očakávané: **113**, `20261024150000`, `949655b5e6ecb1e50920894efd269930`. Overiť RLS, zákaz `mark_my_reservation_paid_test`, bez aktívnych cronov a konzistentné `storage.buckets` bez kopírovania súborov TEST.

## 6. Stop / rollback plán

**Pri prvej chybe:** STOP, nepridávať ani neodstraňovať migračné záznamy ručne, nepokračovať ďalšími súbormi. Zaznamenať verzus posledný úspešný stav, názov neúspešného SQL a presnú chybu (bez secrets). Podľa výsledku sa rozhodne o schválenej *forward fix* migrácii alebo o obnove z preukázateľne použiteľnej zálohy; neexistuje univerzálny bezpečný `down` pre tento balík. Neaktivovať crony, Stripe LIVE, SMTP alebo SMS. Po ostrých finančných transakciách nemožno slepo obnovovať starý snapshot bez rekonciliácie so Stripe.

**NO-GO**, ak: chýba záloha / obnova nie je možná, nie je presne 75 pôvodných migrácií, je zamenený DB hostiteľ/URL, chýba PROD Vault guard, cron nie je vypnutý, SQL sa odlišuje od manifestu, SQL dry-run nehlási presne 38 zmien, alebo nie je nový samostatný súhlas.

## 7. Neskoršie samostatné práce – nepatria do tohto ZIP-u

- BOD 2: RLS/Storage/Auth, produkčné Edge Functions, secrets a konfigurácia.
- BOD 3: Stripe LIVE/Connect.
- BOD 4: produkčné emaily a SMS.
- BOD 5: Vercel, ochrana `rentulo.com`.
- BOD 6+: monitoring, finančný cyklus, právna predštartová podmienka issue #7 a GO/NO-GO.

**Verejné otvorenie `rentulo.com` ostáva až na BOD 10.** TEST `rentulo.eu` zostáva nezmenený. Pôvodné zamýšľané pravidlo nasadenia je naďalej **ZIP → jeden test → pracovná vetva → PR → CI → merge do `main` → zvlášť odsúhlasený zásah do PROD**.
