# Rentulo – BOD 01, etapa 3: nepotvrdené vrátenie a skutočné nevrátenie (TEST)

**Východisko:** `EBBI-SK/rentulo` `main` `0f3fede3587f5b0de917010860ea136fa7f9811c`.
**Výhradne TEST** `vspposovhdgvbeukoivh` / `rentulo.eu`.
PROD `tfvgxrdjrpicgtvovehl`, `rentulo.com`, vetva `production` ani LIVE Stripe sa nemenia.

## Presný rozsah

- Prenajímateľ po plánovanom termíne vrátenia (+30 minút) dostane **jeden e-mail** s výzvou potvrdiť už uskutočnené vrátenie.
- Ak stav zostane `picked_up`, po +2 hodinách príde **druhý e-mail**. Od tohto okamihu vie prenajímateľ po vyslovenom potvrdení uviesť dôvod (15–500 znakov) a nahlásiť **skutočné** nevrátenie.
- Nahlásenie vytvorí v databáze jeden záznam a jeden **e-mail nájomcovi**. Nájomca má situáciu riešiť s prenajímateľom.
- Keď prenajímateľ potvrdí `picked_up -> returned`, otvorené hlásenie sa automaticky uzavrie a ďalšie upozornenia už nevznikajú.
- **Nie je to `no_show`.** `no_show` označuje neprevzatie veci. Nevytvárame nový stav rezervácie, nemeníme PIN, refundy, Stripe transfer/payout ani kalendárové blokovanie.
- Žiadne automatické pokuty, finančné zrážky, refundy, reporty či obvinenia. Nahlásenie vyžaduje vedomú akciu prenajímateľa.
- Iba rezervácie vytvorené **po okamihu nasadenia SQL** (`reservation_return_followup_activation.activated_at`). Predchádzajúce rezervácie sa spätne neupozorňujú.
- Časy sa vyhodnocujú v `Europe/Prague`; opakované cron behy a súbežné požiadavky sú bezpečne deduplikované cez existujúci outbox.
- Upozornenia sú **len e-mailové**, v jazyku adresáta (CZ/SK/EN/DE/PL), aj pri vypnutých voliteľných e-mailoch. **Žiadna SMS.**

## Poradie nasadenia (vždy po úspešných testoch, PR a CI)

1. Vizuálne skontrolovať TEST frontend nasadený z nového `main`. TEST nastavenia a prostredia, žiadne PROD zásahy.
2. Do **Supabase TEST** nasadiť **iba** dve aktualizované Edge Functions zo schváleného `main`: `send-reservation-email` a `process-reservation-notifications` (obe majú naďalej svoje pôvodné konfigurácie autentifikácie; workerov JWT režim nemeníme).
3. Až potom v **Supabase TEST SQL Editore** vykonať jedinú **novú** migráciu `supabase/migrations/20261017233000_return_followup_incident_TEST.sql`. Pred spustením overiť project ref `vspposovhdgvbeukoivh`; SQL navyše overuje TEST Vault URL. Existujúce migrácie NESPUŠŤAŤ znova.
4. Overiť Cron `rentulo-return-followups-every-minute` a existujúci `rentulo-process-reservation-notifications-every-minute`; oba majú zostať aktívne. Skontrolovať TEST logy Edge Functions, chyby outboxu, neposielať LIVE SMS.
5. Na úplný funkčný test vytvoriť **až po SQL aktivácii** novú TEST rezerváciu, schváliť ju, zaplatiť výhradne v Stripe TEST a potvrdiť reálne odovzdanie testovacím PIN-om. Po dohodnutom čase vrátenia overiť po +30 min jednu pripomienku, po +2 hodinách druhú, potom vedomé nahlásenie prenajímateľom a e-mail nájomcovi. Následne potvrdiť vrátenie a uzavretie hlásenia. Bez umelého posúvania dátumov už zaplatených rezervácií.
6. Overiť odoslanie všetkých troch e-mailov len raz, správny jazyk, čas a číslo rezervácie. Po návrate do `returned` nesmie vzniknúť ďalšia pripomienka. Nájomca nesmie vedieť nahlásiť za majiteľa; hlásenie pred +2h musí byť odmietnuté. Žiadna automatická pokuta/refund/Stripe operácia.
7. Ak TEST nemá novú ukončenú rezerváciu, **nepredstierať** end-to-end úspech; testy a SQL môžu overiť iba mechaniku, nie reálne doručenie alebo fyzické vrátenie.

## Diagnostika – čisto čítacie SQL (iba TEST)

```sql
select activated_at
from public.reservation_return_followup_activation
where singleton = true;

select jobname, schedule, active
from cron.job
where jobname in (
  'rentulo-return-followups-every-minute',
  'rentulo-process-reservation-notifications-every-minute'
)
order by jobname;

select r.reservation_number, r.status, r.end_date, r.pickup_time,
       i.reported_at, i.resolved_at, i.resolution
from public.reservations r
left join public.reservation_return_incidents i on i.reservation_id = r.id
where r.reservation_number = 'R-XXXXXX'; -- Nahraď číslom novej TEST rezervácie.

select r.reservation_number, n.event_type, n.channel, n.status,
       n.attempt_count, n.sent_at, n.last_error
from public.reservation_notification_deliveries n
join public.reservations r on r.id = n.reservation_id
where r.reservation_number = 'R-XXXXXX'
  and n.event_type in (
    'return_reminder_30m', 'return_reminder_2h', 'return_not_received'
  )
order by n.created_at;
```

## Bezpečnostné hranice

- RPC `get_my_return_followup_overview` zobrazuje stav iba majiteľovi konkrétnej rezervácie a používa databázový čas na výpočet dostupnosti tlačidla.
- RPC `report_my_reservation_not_returned` overuje majiteľa, `picked_up`, aktiváciu, +2h, opis a existenciu skoršieho hlásenia. Mení iba záznam hlásenia a e-mailový outbox.
- Tabuľka hlásení nie je dostupná priamo bežným klientským rolám. Prenajímateľ nemôže meniť finančné údaje cez túto akciu.
- Cron berie len aktuálne `picked_up` rezervácie, selektuje ich cez `FOR UPDATE SKIP LOCKED` a existujúci `queue_reservation_notification` s unikátnosťou udalosti/príjemcu/kanála.
- E-mailový worker pred doručením znova preverí stav: pri `returned`, existujúcom hlásení alebo už uzavretom hlásení sa oneskorená neaktuálna správa bezpečne preskočí.
- Po presiahnutí +2h sa prvá (+30m) pripomienka už neodosiela spätne, aby používateľ nedostal dve oneskorené správy naraz.
