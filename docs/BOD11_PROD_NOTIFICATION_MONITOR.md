# Rentulo PROD – monitoring rezervačných notifikácií (bod 11)

## Účel a izolácia

- **TEST nemeníme**: existujúca `monitor-reservation-notifications` je zámerne TEST-only, beží cez cron-job.org.
- **PROD** používa novú `monitor-reservation-notifications-prod` a nezávislý GitHub Actions plánovač.
- Databázové objekty `reservation_notification_worker_health`, `reservation_notification_monitor_alerts`, `claim_reservation_notification_monitor_alerts(integer)` a `finish_reservation_notification_monitor_alert(text,uuid,integer,boolean,text)` už boli v PROD overené 3. 11. 2026. **Nenasadzovať ich SQL znova.**
- Monitor hlási `dead`, `overdue`, `stuck` a `worker_stale`; nezasahuje do rezervácií, platieb, SMS ani samotného spracovania notifikácií.
- Technické alarmy idú iba na `support@rentulo.com` z `Rentulo Monitoring <support@rentulo.com>`.

## Najskôr PR, potom osobitné schválenie nasadenia

1. Pridať iba nové súbory z tohto balíka do **samostatnej vetvy**, spustiť `npm test`, vytvoriť PR a nechať prejsť CI. TEST súbory neupravovať.
2. Po merge workflow zatiaľ **nič neposiela**: job je blokovaný, kým repository variable `RENTULO_PROD_MONITOR_ENABLED` nebude presne `true` (predvolene má byť nenastavená / false).
3. Až po výslovnom schválení pripraviť **nový, náhodný minimálne 64-znakový tajný kľúč**. Nastaviť rovnakú hodnotu ako Supabase PROD Edge Function secret `RENTULO_PROD_MONITOR_SECRET` a GitHub repository Actions secret `RENTULO_PROD_MONITOR_SECRET`. NIKDY nie v kóde, ZIP, PR, terminálovom logu alebo chate. Nepoužiť TEST ani existujúci produkčný notifikačný cron secret.
4. Overiť existenciu `RESEND_API_KEY` v Supabase PROD (2026-11-03 potvrdený), `SUPABASE_URL` a `SUPABASE_SERVICE_ROLE_KEY` runtime; neposielať ich do chatu.
5. **Samostatne schváliť nasadenie** Edge Function `monitor-reservation-notifications-prod` iba do projektu `tfvgxrdjrpicgtvovehl`. Táto funkcia sa musí nasadiť s **Verify JWT = OFF iba pre tento endpoint** (vlastná autentifikácia cez tajnú hlavičku je povinná). Nedotknúť sa rovnomennej TEST funkcie.
6. Skontrolovať nezávislý beh pri neexistencii alertov a bezpečnostné odmietnutie nesprávneho secretu bez jeho prezradenia. `claimed: 0` a HTTP 200 potvrdzujú iba zdravý idle beh, nie skutočné doručenie alarmu.
7. Až po schválenom testovaní nastaviť GitHub Actions repository variable `RENTULO_PROD_MONITOR_ENABLED=true` a skontrolovať pravidelné behy `Rentulo PROD notification monitor` a prijatie technického alertu pri kontrolovanom incidente. Nenastavovať variable ani nespúšťať testy automaticky pri merge.

## Prevádzka

- GitHub Actions plánuje najčastejšie **každých 5 minút**; skutočný štart môže byť oneskorený. Detekčný limit chýbajúceho worker heartbeatu v databáze je 8 minút, takže upozornenie nemusí prísť presne po ôsmich minútach.
- Neprítomnosť alarmu nie je garanciou funkčnosti. Kontrolovať aj behy GitHub Actions a prevádzkový stav Resend.
- Pri nejednoznačnej odpovedi Resend monitor používa `Idempotency-Key` a databázovú lease, ale manuálna kontrola doručenia je potrebná pri incidente.
- Jediný vypínač pravidelných behov: `RENTULO_PROD_MONITOR_ENABLED=false` (alebo odstrániť variable). Nezruší ani nemení produkčné SQL či zákaznícke notifikácie.
