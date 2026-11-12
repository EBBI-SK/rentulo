# Rentulo V1.0 – Hodnotenia platformy: produkčné nasadenie

**Pripravené 12. 11. 2026.** Oddelené od TEST. Základ: GitHub vetva `production`, commit `964f750`.
Zdroj funkcionality: TEST PR #168, #169 a #170; tieto tri zmeny boli prenesené *selektívne*, nie zlúčením celej vetvy `main`.

## Obsah balíka

- Kompaktný pás hodnotení na úvodnej stránke. **Zostáva skrytý**, kým neexistuje skutočné schválené hodnotenie s textom.
- Samostatná stránka `zkusenosti.html`, 5 jazykov, hodnotenie 1–5 hviezdičiek, bezpečné vkladanie textov, moderovanie, oprava súhrnných hviezdičiek vrátane čiastočného vyplnenia.
- Odkaz z prihlasovania naspäť na formulár, po overení oprávnenia podľa dokončeného prenájmu.
- Databáza: samostatná PROD migrácia, nové tabuľky, RPC, RLS, jedna pozvánka e-mailom na účet 24 h po prvom potvrdenom vrátení od aktivácie. **Nie SMS.** Bez zmeny používateľských hodnotení v `Historie`.
- Doplnenie už existujúcich e-mailových workerov a testov; zachované aktuálne PROD správanie notifikácií a blokovania živých PROD SMS.
- SEO: nové verejné URL je v `scripts/seo-pages.json`. Sitemap sa generuje dynamicky z tohto katalógu. PROD build generuje canonical `https://rentulo.com/zkusenosti.html`.

**TEST recenzie, používateľské profily, rezervácie a iné testovacie údaje sa do PROD neprenášajú.**

## Pred nasadením: nevynechať

1. Overiť, že lokálny `production` zodpovedá GitHub `origin/production` a že pracovný adresár je čistý. Vytvoriť **novú pracovnú vetvu z `production`**, nie z `main`.
2. Preniesť len zmenené súbory zo ZIP-u. Rozbaliť do priečinka, ktorý obsahuje projekt `pujc-naradi`, nie priamo do `pujc-naradi`.
3. Overiť `git status --short -uall` a spustiť `node --test tests/platform-reviews-v1.test.mjs` a `npm run build`. Pred merge musia prejsť povinné GitHub CI + Vercel kontroly. Lokálny `npm run build` je predvolene TEST, nie dôkaz úspechu PROD build-u.
4. PR otvoriť s **base `production`** a compare s novou pracovnou vetvou. Nikdy nemergovať celý `main` do `production` kvôli recenziám.
5. PRODUKČNÉ ZMENY (merge, SQL a Edge Functions) vykonávať len po výslovnom potvrdení a po jednej akcii. Nespušťať TEST SQL na PROD.

## Read-only preflight – Supabase PROD, SQL Editor

Vybrať projekt **`tfvgxrdjrpicgtvovehl`** (PROD). Tento dotaz nič nezapisuje a nevypisuje obsah secret-u.

```sql
SELECT
  EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'rentulo_project_url'
      AND btrim(decrypted_secret, '/') = 'https://tfvgxrdjrpicgtvovehl.supabase.co'
  ) AS expected_prod_project,
  to_regclass('public.reservation_notification_deliveries') IS NOT NULL AS notification_outbox_exists,
  to_regclass('public.reservation_email_deliveries') IS NOT NULL AS email_delivery_log_exists,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reservations'
      AND column_name = 'gdpr_finalized_at'
  ) AS confirmed_return_column_exists,
  to_regclass('public.platform_reviews') IS NULL AS reviews_not_yet_installed;
```

Prvé štyri hodnoty musia byť `true`; posledná sa pred prvým nasadením očakáva `true`. Ak niečo nesedí, **zastaviť sa**. Skontrolovať aj existujúce pravidlá eventov:

```sql
SELECT conrelid::regclass::text AS table_name, conname AS constraint_name,
       pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conname IN (
  'reservation_notification_deliveries_event_type_check',
  'reservation_email_deliveries_event_type_check'
)
ORDER BY table_name;
```

Ak sa objaví nový event mimo existujúceho produkčného zoznamu, pred migráciou zosúladiť CHECK allowlist, aby sa iné notifikácie neobmedzili.

## Poradie nasadenia na PROD

1. Schváliť PR do `production` po GitHub CI; tým sa aktualizuje web na `rentulo.com` cez Vercel (skontrolovať **Production / Ready / Current**). Kým v PROD nie je migrácia, pás hodnotení zostáva skrytý a stránka nezobrazuje fiktívne hodnotenia.
2. Deploy do PROD Supabase týchto **dvoch existujúcich Edge Functions** zo schválenej produkčnej vetvy:

```powershell
npx --no-install supabase functions deploy send-reservation-email --project-ref tfvgxrdjrpicgtvovehl --use-api
npx --no-install supabase functions deploy process-reservation-notifications --project-ref tfvgxrdjrpicgtvovehl --use-api
```

Tieto príkazy **nespúšťať bez osobitného schválenia nasadenia**. SMS zostávajú podľa existujúcich bezpečnostných pravidiel PROD.
3. Po kontrole cieľového projektu a funkcií spustiť v PROD Supabase SQL Editor **iba**:
   `supabase/prod-release-20261112-platform-reviews/migrations/20261112160000_platform_reviews_v1_PROD.sql`.
   Migrácia je transakčná a overuje Supabase PROD URL cez Vault; pri nesúlade zlyhá bez aplikovania zmien.
4. Overiť nové tabuľky/RPC a verejnú stránku `https://rentulo.com/zkusenosti.html`. Na PROD má byť stav bez hodnotení (kým ich nepridajú reálni používatelia), pás na úvodnej stránke skrytý.
5. Po prvom **skutočnom** potvrdenom vrátení prenájmu od aktivácie overiť jednu e-mailovú pozvánku na oprávnený účet s termínom +24 h, rešpektovanie opt-out, `no_show` bez pozvánky a absenciu duplicít. Tento živý end-to-end scenár bol v čase prípravy **ešte neotestovaný**.

## Moderovanie a kontrola po nasadení

Nové hodnotenie je vždy `pending` až do vecnej kontroly proti spamu, urážkam a osobným údajom. Pozitívne aj negatívne hodnotenia spĺňajúce pravidlá sa zverejňujú; nie podľa počtu hviezdičiek. Stav konkrétneho používateľa možno zmeniť v Supabase SQL Editore po samostatnom overení. Žiadne testovacie hodnotenia sa nemajú vytvárať ani kopírovať na PROD.

Čítacia kontrola:

```sql
SELECT count(*) AS all_reviews FROM public.platform_reviews;
SELECT count(*) AS pending_reviews FROM public.platform_reviews WHERE status='pending';
SELECT * FROM public.get_platform_review_summary();
```

**Upozornenie:** právne dokumenty V1.0 už hovoria o hodnoteniach vo všeobecnosti, ale pred verejným spustením odporúčame výslovne právne preveriť zverejnenie textu, skráteného mena a moderovanie *hodnotení samotnej platformy*. Právne dokumenty tento technický ZIP zámerne nemení.
