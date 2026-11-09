# Rentulo SEO 19B/2 – automatické podkategórie (TEST)

**Východisko:** TEST `main` po PR #143, commit `a9d465d`; PROD nie je súčasťou tohto balíka.

## Čo sa mení

- 26 stabilných podkategórií pod šiestimi existujúcimi hlavnými kategóriami.
- Používateľ stále vyberá iba hlavnú kategóriu. **Nepridáva sa žiadne formulárové pole.**
- Supabase automaticky vypočíta uložené `offers.subcategory_slug` z hlavnej kategórie, názvu a opisu. Rozpoznáva konzervatívne synonymá v CZ/SK/EN/DE/PL, celé slová a frázy.
- Pri nejednoznačnom názve ponechá `NULL`. Opis môže vyriešiť konflikt alebo pridať výsledok iba s najmenej dvoma silnými frázami.
- `Ostatní → Jiné` je zámerne iba na ručné administrátorské zaradenie.
- `public_offers` bezpečne pridáva `subcategory_slug` ako **posledný** stĺpec; neodhaľuje administratívny dôvod, audit ani súkromné kontakty.
- Nové stránky: `/kategorie/{kategoria}/{podkategoria}` (serverové HTML s vlastným title, description a canonical).
- Hlavná kategória linkuje iba na podkategórie skutočne zastúpené na danom liste aktívnych ponúk. Sitemap odkazuje iba na podkategórie so skutočne aktívnymi ponukami.
- Prázdne podkategórie zostávajú `noindex`; TEST, Preview a predspúšťací PROD zostávajú `X-Robots-Tag: noindex`.

## Bezpečné poradie TEST nasadenia

1. Overiť pracovnú vetvu z `origin/main`, na commite `a9d465d`, a čistý pracovný adresár.
2. Rozbaliť iba zmenené súbory ZIP; skontrolovať `git status` a rozsah.
3. Pred merge / TEST Vercel nasadením **najprv** v **Supabase TEST** SQL Editore jednorazovo vykonať migráciu `supabase/migrations/20261109170000_seo19b2_automatic_subcategories_TEST.sql`. Skript obsahuje preflight proti produkčnému projektu a preflight štruktúry verejného pohľadu; všetko vykonáva v jednej transakcii.
4. Prípadné chyby pri migrácii **neriešiť opakovaným spúšťaním**; zastaviť, odložiť chybovú správu a najprv ju vyhodnotiť. SQL skript v tejto verzii nie je zámerne idempotentný.
5. V TEST SQL Editore po úspešnej migrácii spustiť iba účelovú kontrolu:

   ```sql
   select category, name, subcategory_slug from public.offers limit 10;
   select category, name, subcategory_slug from public.public_offers limit 10;
   ```

6. Dokončiť lokálne testy/build, commit, push, PR do `main`, CI a TEST merge podľa bežného pracovného postupu. **Do `production` nič neposielať.**

## Ručné administrátorské opravy

Iba existujúci **Supabase Owner / SQL Editor**, nikdy klientská aplikácia:

```sql
-- Príklad po reálnom overení zaradenia, iba TEST:
select public.seo19b2_admin_override(
  '00000000-0000-4000-8000-000000000000'::uuid,
  'vrtacky',
  'Ručná oprava po overení názvu a opisu ponuky'
);

-- NULL odstráni ručnú opravu a znovu použije automatickú klasifikáciu:
select public.seo19b2_admin_override(
  '00000000-0000-4000-8000-000000000000'::uuid,
  null,
  'Zrušenie ručného zaradenia po kontrole ponuky'
);
```

Príklady ID nie sú skutočné ponuky. Slug musí patriť k existujúcej hlavnej kategórii. Každá oprava je zapísaná do neveľejného append-only auditu `seo19b2_override_events`. Ručné opravy sú viazané na hlavnú kategóriu a pri jej zmene sa na verejnom pohľade automaticky ignorujú.

## Overenie

- Cielené testy: `node --test tests/seo-category-pages.test.js tests/seo-subcategory-pages.test.js tests/seo-subcategory-migration.test.js tests/seo-sitemap.test.js tests/seo-offers-directory.test.js`
- Regresné testy: `npm test`
- TEST build: `npm run build`
- Simulovaný PROD build slúži iba na kontrolu bundlingu s nefunkčným testovacím publishable kľúčom; nikdy nepristupuje do PROD databázy.

**Obmedzenie:** V tomto balíku sa nemigrovala živá Supabase databáza a nebol vykonaný SQL runtime test na PostgreSQL. SQL logika je staticky kontrolovaná testami a musí byť potvrdená jednorazovým vykonaním v Supabase TEST skôr, než sa podkategórie považujú za nasadené.
