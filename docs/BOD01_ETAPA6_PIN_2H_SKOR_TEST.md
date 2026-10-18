# RENTULO – BOD 01 / ETAPA 6: Voliteľné odovzdanie o 2 hodiny skôr (TEST)

Východisko: `EBBI-SK/rentulo`, `main` = `5480c56658d5899da75e561706d75395f8450da1`, BOD 01 etapa 5 nasadená na TEST. Zmena sa po merge nasadzuje **iba** na Supabase TEST `vspposovhdgvbeukoivh`, Vercel TEST `rentulo.eu` a Stripe Sandbox. NIKDY nie priamo na produkčný Supabase `tfvgxrdjrpicgtvovehl`, `rentulo.com` či Stripe LIVE.

## Dohodnuté správanie

- Nájomcovi sa PIN zobrazí po potvrdenej Stripe platbe. Prenajímateľ ho môže overiť a skutočne potvrdiť odovzdanie **najskôr 2 hodiny (uplynutého času) pred dohodnutým termínom prevzatia**, ak je vec pripravená a účastníci sa dohodnú. PIN na to nikoho nenúti.
- PIN je jednorazový a po potvrdení `paid -> picked_up` sa zneplatní. Bez potvrdenia platí len do presného pôvodného dátumu/času **vrátenia** (`end_date + pickup_time`, `Europe/Prague`) **bez ďalších 2 hodín**. Po konci prenájmu zostáva automatické `no_show` podľa pôvodného okamihu; nie pri skoršom prevzatí.
- Plánované dátumy/časy a cena rezervácie sa nemenia. Dvojhodinový odstup medzi **plánovanými** rezerváciami sa nemení; skoršie fyzické odovzdanie je výlučne rozhodnutie prenajímateľa.
- Pri vrátení **nie je PIN**. Už existujúca ETAPA 3 rieši +30-minútové pripomenutie prenajímateľovi a po +2 hodinách druhé pripomenutie s **dobrovoľnou** možnosťou nahlásiť skutočne nevrátenú vec. **Žiadny automatický incident či poplatok**, vrátenie vie prenajímateľ potvrdiť aj po termíne. Do tejto časti nič nezasahujeme.
- Stripe transfer sa naďalej vytvára **až po potvrdenom vrátení** (`returned`) alebo po dokončenom `no_show`, nikdy po PIN-e; refund, storno, poplatky a ďalšie statusy bezo zmeny.
- V textoch aktualizované CZ/SK/EN/DE/PL, obchodné podmienky a platobné upozornenie, nie právne pravidlá o odškodnení.

## Bezpečné nasadenie po CI + merge do GitHub main

1. V lokálnom TEST repo vykonať testy a build, push témy, kontrola GitHub CI, merge. **Pred dokončeným nasadením nepoužívať PIN**, ak treba otestovať posunuté okno.
2. V **Supabase TEST** SQL Editore aplikovať obsah novej migrácie `supabase/migrations/20261018090000_pickup_pin_two_hours_early_TEST.sql`. Migrácia začína transakciou a má fail-closed kontrolu `vault.decrypted_secrets.rentulo_project_url` na TEST projekt. Re-vytvára iba posledný bezpečnostný trigger a mení iba jeho najskorší povolený okamih; `no_show` a ostatné prechody sú doslova nezmenené.
3. **Až po úspešnom SQL** nasadiť funkcie do rovnakého TEST projektu (z aktuálneho main):

   ```powershell
   npx supabase functions deploy resolve-pickup-pin --project-ref vspposovhdgvbeukoivh
   npx supabase functions deploy confirm-pickup --project-ref vspposovhdgvbeukoivh
   ```

   `resolve-pickup-pin` zabalí aktualizovanú pomocnú knižnicu `_shared/prague-rental-window.mjs`. Zachovať pôvodné overovanie JWT. `get-pickup-pin`, Stripe a Cron worker teraz netreba nasadzovať znova.
4. Po SQL + Edge deploy overiť výsledok read-only SQL a prvé skutočné prevzatie používateľom cez UI. Nemeniť stav rezervácie cez SQL.

## Diagnostika (iba SELECT, TEST)

```sql
SELECT
  r.reservation_number,
  r.status,
  r.start_date,
  r.end_date,
  r.pickup_time,
  ((r.start_date + r.pickup_time) AT TIME ZONE 'Europe/Prague')
    - interval '2 hours' AS pin_valid_from,
  ((r.end_date + r.pickup_time) AT TIME ZONE 'Europe/Prague')
    AS pin_expires_at,
  s.confirmed_at,
  p.transfer_status,
  p.stripe_transfer_id
FROM public.reservations r
LEFT JOIN public.reservation_pickup_security s ON s.reservation_id = r.id
LEFT JOIN public.payments p ON p.reservation_id = r.id
WHERE r.reservation_number = 'R-000039';

SELECT
  pg_get_functiondef('public.protect_reservation_status_transition()'::regprocedure)
    LIKE '%- interval ''2 hours''%' AS early_pin_guard_active;
```

## Testovacie hranice

R-000039: plánované prevzatie 18. 10. 2026 **10:00**, vratka 19. 10. **10:00** (Praha). Po kompletnej aktivácii PIN pre odovzdanie najskôr 18. 10. **08:00**. Pred 08:00 odmietnuť bez zaznamenania chybného PIN-u. O 08:00 a neskôr môže prenajímateľ potvrdiť odovzdanie, **len ak je vec skutočne fyzicky odovzdaná**. Po správnom PIN-e `picked_up`, `confirmed_at` nastavené, `transfer_status=not_created`; po následnom Cron workeri stále bez transferu. Presne 19. 10. o 10:00 nepoužitý PIN zanikne a pôvodný `no_show` scenár ostáva. Test po skutočnom vrátení a jeho potvrdení riešime ako pokračovanie ETAPY 5.

Zvlášť pretestované: 2-hodinová spodná hranica, prekročenie polnoci pri čase `00:00`, DST v `Europe/Prague`, nulový či chybný čas (fail closed), presný čas vrátenia, zachovanie všetkých stavových a finančných kontrol.
