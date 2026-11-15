# Rentulo PROD -> Rentulo Office: BOD 3 (PRIPRAVENE, VYPNUTE)

**Stav 15. 11. 2026: len navrh kodu / SQL. Nic z tohto balika nebolo aplikovane do Rentulo PROD, ziadne secrets nie su nastavene, ziadny worker nebol nasadeny.**

## Co uz existuje

Rentulo Office: `api/integrations/rentulo/events.js`, serverove HMAC overenie, SQL tabulka `office_rentulo_events` APPLIED, SQL sa **nesmie zopakovat**. Office prijem PROD je predvolene vypnuty. Office Preview a Production zdielaju databazu; z PROD sa smie odosielat len do Office Production.

Rentulo PROD: rezervacie a Stripe su oddelene, notifikacny worker spracuje zakaznicke emaily/SMS, `monitor-reservation-notifications-prod` nezavisle posiela emaily o zlyhani na support@rentulo.com. Tento kod sa ich pravidiel nedotyka.

## Navrhovane zmeny pre Rentulo PROD (neaktivne)

- Nova tabulka `rentulo_office_event_outbox` (len PROD) drzi kazdu udalost az do potvrdeneho prijatia. `event_id` zabraňuje duplikatom, `issue_key` spaja vznik a vyriesenie. Retry s lease a postupnym spatnym odstupom.
- Zdrojove triggery zachytia vznik/zavretie platformovych incidentov, nenavratene veci a ich potvrdene vratenie, vznik/vyriesenie zlyhanych notifikacii, nenapravitelne neuspesny owner transfer (bez autom. retry), a financne vysporiadanie vyzadujuce manualny zasah.
- Do Office sa posielaju **len** `event_id`, `issue_key`, `event_type`, `state`, `severity`, `occurred_at`, volitelne `reservation_number` a `diagnostic_code`. Ziadne mena, adresy, emaily, PIN, logy, vysky platieb ani Stripe ID.
- Podpis HMAC-SHA256 pre `x-rentulo-environment: prod`, casovu hlavicku a presny surovy JSON. HTTP 200/201 s `accepted: true` potvrdi dorucenie. HTTP 409 sa zaznamena na manualnu kontrolu. Ostatne chyby su retry, nevymazavaju sa.
- Spracovanie najviac 4 udalosti na jedno volanie, 2 subezne, s kratkym HTTP timeoutom. Bez noveho cron jobu: pouzije sa uz existujuce volanie PROD monitora. Prepojenie je striktne volitelne. Chyba Office **nesmie** znizit uspesnost monitorovych emailov.

## Konfiguracia - az pri samostatne schvalenom aktivacnom kroku

V existujucej **Rentulo PROD Supabase Edge Function** `monitor-reservation-notifications-prod`:

- `RENTULO_OFFICE_EVENTS_ENABLED` presne `true` (inak sa ani nevola DB ani Office),
- `RENTULO_OFFICE_EVENTS_URL` presna produkcna HTTPS adresa konciaca `/api/integrations/rentulo/events`,
- `RENTULO_OFFICE_EVENTS_SECRET` nahodny tajny kluc aspon 64 UTF-8 bajtov,
- `RENTULO_OFFICE_VERCEL_BYPASS_SECRET` automatizacny bypass kluc z Vercel Office, bez vypnutia Deployment Protection.

V **Office Vercel Production**:

- `OFFICE_RENTULO_PROD_EVENTS_ENABLED=true`,
- `OFFICE_RENTULO_PROD_EVENTS_SECRET` musi byt rovnaky kluc ako odosielaci `RENTULO_OFFICE_EVENTS_SECRET` (nikdy nezdielat servisne kluce Supabase).

**Ziadne kluce nevkladat do repozitara, chatu, ZIP alebo SQL.** Vercel ochrana ostava zapnuta, Office pouziva svoj vlastny serverovy Supabase projekt a tajomstva ostavaju oddelene.

## Nasadenie - dalsie osobitne kontrolovane kroky

1. Pripravena SQL migracia `supabase/prod-release-20261115-office-events/migrations/20261115090000_office_event_outbox_PROD_PENDING.sql` je **PENDING / NOT APPLIED**. Pred aplikaciou v Supabase PROD overit projekt `tfvgxrdjrpicgtvovehl`, existujuce tabulky, schvalenie a udrzat jednorazovy release guard. Nic neaplikovat do Office ani TEST. Po schvalenom spusteni, overeni a zaznameni premigrovat status na `APPLIED / DO NOT RERUN`.
2. Novy komunikacny modul je iba importovany v PROD monitore, aktivacny flag ho predvolene vypina. **Git merge sam o sebe nenasadi Supabase SQL ani Edge Function**; to sa vykona len samostatne po schvaleni.
3. Pred zapnutim overit, ze existujuci PROD monitor je skutocne pravidelne spustany. GitHub kód samotny nie je dokazom beziaceho schedule.
4. Jedna neskodna synteticka udalost (bez fiktivnej produkcnej rezervacie) otestuje HTTP 201, opakovanie HTTP 200 duplicate a vyriesenie. PROD objednavky, Stripe a existujuce crony pri teste neovplyvnovat.
5. V BODE 5 sa udalosti premenia na Pripady (a sparuju s emailmi). Teraz sa len ukladaju do Office inboxu.

## Limity

- Este neriesime card-dispute feed, pretoze samotne prave aplikovane PROD DB schema nebolo priamo verifikovane; pred jeho doplnenim treba read-only overenie.
- Bez noveho monitoru nezachytime jeho vlastny uplny vypadok v realnom case; tento limit treba neskor vyhodnotit v bode 13 Technicky monitoring.
- Vybrane udalosti starsie nez aplikacia tejto PRODUKCNEJ migracie sa automaticky nedoplnia; nezamienat s historickym auditom.
- Toto je len priprava. Funkcne end-to-end dorucenie sa da potvrdit az po schvalenej PROD aktivacii.

Lokálne cielené testy: `node --test tests/rentulo-office-prod-dispatch.test.mjs`. Existujúce kompletne testy: `npm test`. Pripadne chyby dokumentovat presne a nereparovat nesuvisiace funkcie.
