# Rentulo PROD -> Rentulo Office: BOD 3 (FUNKCNE OVERENE 15. 11. 2026)

**Aktualny stav: AKTIVNE / HOTOVE pre vybrane prevadzkove udalosti.** PR #174 bol zluceny do `production` (merge `7008191`), dokumentacny PR #175 (merge `fb75751`). Jednorazove PROD SQL je **APPLIED / DO NOT RERUN**. Produkcna Supabase Edge Function `monitor-reservation-notifications-prod` je nasadena (verzia 5), odosielanie do Office bolo 15. 11. 2026 aktivovane. Skutocne prijatie jednej *syntetickej* udalosti bolo overene priamo v databaze Rentulo Office. Neznamena to test vsetkych typov incidentov ani skutocneho prenajmu.

## Architektura a hranice

`Rentulo PROD DB` -> `rentulo_office_event_outbox` -> existujuci `rentulo-prod-notification-monitor-5min` -> Supabase Edge Function `monitor-reservation-notifications-prod` -> HTTPS s Vercel Protection Bypass + HMAC-SHA256 -> Office `POST /api/integrations/rentulo/events` -> oddelena Office DB `office_rentulo_events`.

- **Zdroj je iba Rentulo PROD** (`tfvgxrdjrpicgtvovehl`); v Office sa uklada `source_environment='prod'`. Rentulo TEST sa neaktivovalo. Office Production a Preview pouzivaju spolocnu izolovanu Office DB, ale z PROD sa prijima iba na Office Production.
- Zdrojove triggery zachytavaju **vybrane** udalosti: vznik/uzavretie `platform_incident`, nevratenu vec / vyriesenie (`return_not_received`), zlyhania notifikacii a ich vyriesenie, trvale zlyhanie vyplaty bez dalsieho retry, manualny zasah pri vysporiadani sporu. Nie kazda rezervacia alebo platba sa posiela.
- PROD outbox momentalne povoluje typy `platform_incident`, `return_not_received`, `owner_transfer_failure`, `refund_failure`, `notification_delivery_failure`, `notification_worker_failure`. Office prijimac podporuje sirsie typy, ale nie vsetky su napojene na PROD zdroje (napr. kartove spory).
- Prenasaju sa iba: `event_id`, `issue_key`, `event_type`, `state`, `severity`, `occurred_at`, volitelne `reservation_number` a `diagnostic_code`. **Neposielaju sa** mena, kontakty, adresy, PIN, text incidentu, sumy platieb ani Stripe identifikatory.
- `event_id` je jedinecne pre deduplikaciu, `issue_key` spaja vznik a vyriesenie. Outbox ma lease, retry s odstupom a odosielanie maximalne 4 zaznamov na jeden beh (2 subezne).
- Existujuci PROD monitor bezpecne dorucuje aj upozornenia na `support@rentulo.com`. Odosielanie do Office je oddelene: zlyhanie Office nesmie prerusit monitorovaci email. **Nevznikol novy cron**, zasahy do Stripe, stavov rezervacii ani uz hotovych procesov.
- Office **zatial iba eviduje udalosti na pozadi**. Netvori z nich automaticky Pripady, Ulohy, zvoncek ani polozky dashboardu. To su body 5, 6 a 7 planu Office; bod 4 je prijem emailov.

## Bezpecna konfiguracia (15. 11. 2026 – nastavene)

**Rentulo PROD Supabase Edge Function:**
- `RENTULO_OFFICE_EVENTS_ENABLED=true`
- `RENTULO_OFFICE_EVENTS_URL`: produkcny Office endpoint `https://rentulo-office.vercel.app/api/integrations/rentulo/events`
- `RENTULO_OFFICE_EVENTS_SECRET`: serverove HMAC tajomstvo
- `RENTULO_OFFICE_VERCEL_BYPASS_SECRET`: oddeleny token ochrany Vercelu

**Rentulo Office Vercel, iba Production:**
- `OFFICE_RENTULO_PROD_EVENTS_ENABLED=true`
- `OFFICE_RENTULO_PROD_EVENTS_SECRET`: rovnaky HMAC kluc ako u odosielatela

**Vercel Authentication - All Deployments zostala zapnuta.** Bypass sluzi len serverovemu prenosu; prijimac zaroven vyzaduje platny HMAC podpis a casovu hlavicku (tolerancia 300 s). Hodnoty tajomstiev sa **nesmu kopirovat do Gitu, dokumentacie, ZIP, logov ani chatu**. Prepnutie flagu `false` vypne odosielanie, nie zber zdrojovych udalosti.

## Preukazany end-to-end test – 15. 11. 2026

1. Rentulo PROD SQL Editor: bol vlozeny jeden neostry riadok do existujuceho outboxu, **bez vytvarania realnej rezervacie alebo incidentu**.
2. `event_id = smoke:office-prod:20261115:01`, `event_type = platform_incident`, `state = resolved`, `severity = normal`, `diagnostic_code = OFFICE_SMOKE_TEST`.
3. PROD cron `rentulo-prod-notification-monitor-5min`: `active=true`, rozvrh `*/5 * * * *`, v sledovanom 15-minutovom okne 3 behy, posledny `succeeded`.
4. Zdrojovy outbox po prenose: `delivery_status=sent`, `attempt_count=1`, `claim_token IS NULL`; zdroj potvrdil dorucenie.
5. **Nezavisle precitana Office DB** `tqihbgamqmjmuihtjhlv`: presny `event_id`, `source_environment=prod`, `event_type=platform_incident`, `state=resolved` a `diagnostic_code=OFFICE_SMOKE_TEST` existuju v `public.office_rentulo_events`. `received_at=2026-11-15 10:55:04.078785+00`.

**Zaver:** zabezpecene dorucenie jednej udalosti z produkcnej fronty do oddelenej Office DB bolo skutocne overene. **Netvrdit** z tohto jedneho behu realny test duplicity/409, vsetkych incidentov alebo koncoveho spracovania v Office UI.

## Databazova historia – neopakovat

- Rentulo PROD: `supabase/prod-release-20261115-office-events/migrations/20261115090000_office_event_outbox_PROD_APPLIED.sql` spustene manualne raz 15. 11. 2026 v `tfvgxrdjrpicgtvovehl` (`Success. No rows returned`). **APPLIED / DO NOT RERUN**. Rucne SQL nepredpoklada zaznam v `schema_migrations`.
- Office: `docs/sql/20261115_office_rentulo_events_APPLIED.sql` aplikovane raz v oddelenej Office Supabase DB. **APPLIED / DO NOT RERUN**.
- Zdrojove udalosti pred aplikaciou triggerov sa spatne nenaplnili.

## Dalsi postup a obmedzenia

- V bode **5** pri generovani Pripadov **vylucit synteticke udalosti** (napr. `event_id` zacinajuce `smoke:` alebo `diagnostic_code=OFFICE_SMOKE_TEST`); testovaci riadok v Office zostava ako audit, nie ako skutocny incident.
- Bod **4**: prijem emailov. Bod **5**: tvorba Pripadov a deduplikacia. Bod **6**: upozornenia zamestnancom. Bod **7**: skutocny dashboard.
- Samotny uplny vypadok monitoru sa bez nezavislej observability nezisti okamzite; zvazit v bode 13 (technicky monitoring).
- Card-dispute feed zostava mimo potvrdeneho zdrojoveho rozsahu. Nemeni sa bez kontroly realnej PROD schemy a samostatneho suhlasu.
- Ziadne dalsie migracie, nove crony ani opakovany smoke test nie su potrebne na uzavretie bodu 3.

Technicke subory: `supabase/functions/_shared/rentulo-office-dispatch.mjs`, `supabase/functions/monitor-reservation-notifications-prod/index.ts`; cielene offline testy `tests/rentulo-office-prod-dispatch.test.mjs`. Spravny dalsi pracovny ciel je **Office bod 4**.
