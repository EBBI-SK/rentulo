# Rentulo BOD 12 – P1-4: externý monitoring notifikácií (TEST)

**Stav:** zdrojový návrh pripravený na kontrolovanú aktiváciu v **Supabase TEST**. Samotné vloženie ZIP-u ani `git push` monitoring neaktivuje. **PROD nemeniť.**

## Cieľ

- Zachytiť e-maily a SMS v terminálnom stave `dead` (vrátane nejednoznačných SMS – **manuálne preveriť, neposielať znova automaticky**).
- Zachytiť nevybavené `queued`/`retry`, ktorým termín `next_attempt_at` uplynul pred >10 minútami.
- Zachytiť `sending`, ktorému `lease_until` uplynul pred >3 minútami.
- Zachytiť zastavený alebo nesprávne fungujúci Cron/worker: chýba **úspešný heartbeat** >8 minút. Postgres `cron.job_run_details.status=succeeded` sám o sebe neoveruje HTTP odpoveď Edge Function.
- Zaslať **jeden e-mail na jeden výskyt incidentu** na `ebbi@ebbi.sk`. Po vyriešení a opätovnom vzniku problému môže prísť nový alert.
- Pri zlyhaní odoslania alarmu opakovať s odstupom, s rovnakým Resend `Idempotency-Key` pre rovnaký výskyt.

## Architektúra

1. `process-reservation-notifications` po **úspešnom dokončení vrátane ack** volá serverové RPC `record_reservation_notification_worker_success`. Aj prázdna fronta zaznamená úspešný heartbeat; chyba heartbeatu spôsobí HTTP 500 (bez opakovania už acknutých notifikácií).
2. Migrácia `20261013100000_monitor_reservation_notifications_TEST.sql` vytvorí `reservation_notification_worker_health`, `reservation_notification_monitor_alerts` a 3 serverové RPC. RLS, `revoke` pre anon/authenticated, `service_role` prístup. Migrácia **nevytvára Cron a neposiela e-maily**.
3. Nová Edge Function `monitor-reservation-notifications` prijíma len `POST` s vlastným tajomstvom `x-rentulo-monitor-secret` dĺžky aspoň 64 znakov, vyžaduje presnú **TEST Supabase URL** a existujúce `RESEND_API_KEY`/`EMAIL_FROM`. V PROD odmietne pracovať. Alert ide výlučne na `ebbi@ebbi.sk`, bez telefónov a PIN kódov.
4. Databáza pri monitorovaní atomicky označí pretrvávajúce incidenty, vyriešené uzavrie, prípadné nové výskyty rozpozná pomocou `generation`, a vydá najviac päť súbežne claimnutých alarmov. `claim_token` + 2-minútový lease + idempotentné poslanie cez Resend znižujú riziko duplicitných e-mailov. Neúspešné alarmové e-maily sa opakujú s exp. backoff najviac do 1 hodiny.
5. GitHub Actions workflow `.github/workflows/rentulo-test-notification-monitor.yml` volá Edge Function mimo Supabase plánovača **každých 5 minút**. Harmonogram je po mergi **neaktívny**, kým nie je GitHub repository variable `RENTULO_TEST_MONITOR_ENABLED=true`. Dočasne sa môže spustiť manuálne `workflow_dispatch`. GitHub secret `RENTULO_TEST_MONITOR_SECRET` musí byť rovnaký ako Supabase Edge secret `RENTULO_MONITOR_SECRET`.

**Prevádzkové obmedzenia:** GitHub Actions `schedule` môže meškať a nie je SLA monitoring. Ak je **celý Supabase projekt alebo Edge Gateway nedostupný**, nezávislý GitHub workflow zlyhá, ale monitor nedokáže v tej chvíli odoslať e-mail cez Supabase – treba sledovať aj **GitHub Actions failure notifications**, prípadne časom pridať nezávislého poskytovateľa na full-outage alert. `sent` znamená akceptáciu poskytovateľom, nie potvrdenie doručenia e-mailu/SMS koncovému príjemcovi. Alert o `dead` neznamená povolenie SMS opakovať.

## Bezpečné poradie aktivácie – len po samostatnom schválení používateľom

1. Nahrať súbory do lokálneho `main`, skontrolovať presné zmeny, `npm test`, `git diff --check`, commit, push a zelené GitHub CI.
2. Spustiť migráciu **iba** v Supabase TEST projekte `vspposovhdgvbeukoivh`; overiť 2 tabuľky a 3 serverové RPC, nastavenie RLS a seed heartbeat. Nedotknúť sa PROD.
3. Nasadiť **najprv aktualizovaný** `process-reservation-notifications` do Supabase TEST. Po 1–2 minútach SQL dotazom potvrdiť, že `last_success_at` sa aktualizuje aj pri prázdnej fronte.
4. Vygenerovať jeden náhodný **minimálne 64-znakový** token mimo GitHub súborov. Jeho hodnotu nastaviť ako **Supabase TEST Edge Function secret** `RENTULO_MONITOR_SECRET` a **GitHub repository Actions secret** `RENTULO_TEST_MONITOR_SECRET`. Nikdy ho nepísať do Gitu, ZIP-u alebo screenshotu. Na TEST má byť funkčný odosielateľ `EMAIL_FROM` a `RESEND_API_KEY`.
5. Nasadiť `monitor-reservation-notifications` do Supabase TEST s `--no-verify-jwt` (vlastná kontrola tajomstva, nie verejná funkcia). Bez správneho tajomstva vráti 401; neznáma/PROD URL vráti 403. V tomto stave ešte **žiadne automatické spúšťanie**.
6. Manuálne spustiť GitHub Actions workflow `Rentulo TEST notification monitor` – pri zdravej fronte musí vrátiť `{ "ok": true, "claimed": 0, ... }` a nesmie posielať e-mail.
7. Až po potvrdení pripravenosti zapnúť repository **variable** `RENTULO_TEST_MONITOR_ENABLED=true`. Prechod `false` na `true` je produkčné zapnutie len na TEST. Potom overiť aspoň dve automatické spustenia a doručenie jedného kontrolovaného testovacieho alarmu podľa osobitného, schváleného testovacieho scenára (bez skutočnej SMS a bez úprav reálnych rezervácií).

### Čítacie SQL na overenie (Supabase TEST)

```sql
-- Posledný úspešný heartbeat (mal by pribúdať približne každú minútu):
select last_success_at, last_claimed, last_sent, last_retried, last_dead
from public.reservation_notification_worker_health;

-- Všetky incidenty/alarmy, bez osobných údajov:
select alert_key, issue_kind, reservation_number, active,
       generation, attempt_count, sent_at, next_attempt_at, last_error
from public.reservation_notification_monitor_alerts
order by last_seen_at desc limit 30;
```

### Vypnutie bez zmeny databázy

Nastaviť GitHub repository variable `RENTULO_TEST_MONITOR_ENABLED=false`. Plánované spustenia prestanú volať monitor; samotná rezervačná fronta/worker naďalej fungujú. Nespúšťať samostatný monitor bez vlastného HTTP tajomstva. Pre nasadenia PROD treba nový návrh bezpečnej integrácie, oddelené tajomstvá, príjemcu, limity, a osobitný súhlas.
