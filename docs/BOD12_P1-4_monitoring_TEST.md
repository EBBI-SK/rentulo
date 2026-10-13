# Rentulo BOD 12 – P1-4: externý monitoring notifikácií (TEST)

**Stav k 13. 10. 2026: aktivované a otestované v Supabase TEST, externé spúšťanie cez `cron-job.org`.** Monitoring podľa rozhodnutia **zostáva zapnutý** aj počas prestávky. Tento dokument opisuje už vykonanú aktiváciu a prevádzku; **nie je** pokynom na opätovné nasadenie SQL, vytvorenie druhého jobu alebo aktiváciu PROD. Stav externého jobu sa musí kontrolovať priamo v jeho dashboarde. Samotná zmena súborov v Gite nemení existujúci job v cron-job.org.

## Účel a detekčné hranice

- `dead`: terminálne neúspešné e-maily a SMS vrátane nejednoznačnej odpovede BulkGate; **takú SMS nikdy bez manuálnej kontroly neposielať znova**.
- `queued`/`retry`: `next_attempt_at` prešiel pred viac ako 10 minútami.
- `sending`: lease vypršal pred viac ako 3 minútami.
- `worker_stale`: bez úspešného `last_success_at` dlhšie než 8 minút. Zelený stav Postgres `cron.job_run_details` **nie je dôkazom úspešnej HTTP/worker odpovede**.
- Pri aktívnom probléme odoslať na **`ebbi@ebbi.sk`** jeden e-mail na jednu generáciu incidentu; pri vyriešení a novom výskyte vzniká nová generácia. Pri neúspechu e-mailu sa používajú retry a ten istý Resend `Idempotency-Key` pre ten istý výskyt.

## Architektúra a odlíšenie plánovačov

1. **Supabase `pg_cron` pre bežné notifikácie:** `rentulo-process-reservation-notifications-every-minute` každú minútu volá `process-reservation-notifications`. Po úspešnom spracovaní vrátane ACK worker zavolá `record_reservation_notification_worker_success`; aj prázdna zdravá fronta zaznamená heartbeat v `reservation_notification_worker_health`.
2. **Supabase SQL:** migrácia `20261013100000_monitor_reservation_notifications_TEST.sql` pridala `reservation_notification_worker_health` a `reservation_notification_monitor_alerts`, tri server-only RPC s obmedzenými právami/RLS. Sama **nevytvára ani nespúšťa externý monitorovací cron**.
3. **Externý plánovač `cron-job.org`:** nezávisle od databázového workera vykonáva autorizované periodické HTTPS `POST` na funkciu `monitor-reservation-notifications`. Periodicita je konfigurovaná v **cron-job.org** (pôvodný zámer P1-4: približne každých päť minút; aktuálnu hodnotu potvrdzuje dashboard, nie repo). Pri presune plánovania sa **nevytvára nový druhý job**.
4. **Supabase TEST Edge Function:** prijíma výhradne `POST`, kontroluje exact TEST projekt `vspposovhdgvbeukoivh`, minimálne 64-znakové tajomstvo a dostupnosť `RESEND_API_KEY`/`EMAIL_FROM`. Akceptuje najviac päť alarmov na volanie (súbežne najviac tri), cez `claim_token`/lease/`generation` zabraňuje duplicitám. Adresát je pevne `ebbi@ebbi.sk`; z alarmov sa neposielajú PIN-y, telefóny ani privátne kontakty.
5. **GitHub Actions iba ručne:** `.github/workflows/rentulo-test-notification-monitor.yml` zostáva ako diagnostická možnosť `workflow_dispatch` na vetve `main`. Po tejto aktualizácii **nemá `schedule`** a nepotrebuje `RENTULO_TEST_MONITOR_ENABLED`. GitHub secret `RENTULO_TEST_MONITOR_SECRET` môže zostať iba pre túto manuálnu diagnostiku; samotný opakovaný monitoring sa nevykonáva v GitHube.

**Historická poznámka:** úvodný komentár v `supabase/functions/monitor-reservation-notifications/index.ts` ešte spomína GitHub Actions ako plánovač. Je to zastaraný komentár z pôvodného návrhu, nie aktívne runtime nastavenie; zdroj Edge Function nebol súčasťou schválenej päťsúborovej úpravy.

## Nastavenie externého HTTP jobu – referenčná kontrola, nie pokyn na opätovnú aktiváciu

| Pole | Hodnota/požiadavka |
| --- | --- |
| Poskytovateľ | `cron-job.org` (existujúci TEST job; ponechať zapnutý) |
| URL | `https://vspposovhdgvbeukoivh.supabase.co/functions/v1/monitor-reservation-notifications` |
| Metóda a telo | `POST`, JSON `{}` |
| HTTP hlavička | `Content-Type: application/json` |
| Autentifikácia | `x-rentulo-monitor-secret` – skutočný token iba v chránenom nastavení jobu; rovnaká hodnota ako Supabase TEST `RENTULO_MONITOR_SECRET` |
| Interval | overiť priamo v cron-job.org (pôvodný návrh 5 minút; v Gite sa neoveruje) |
| Úspešný beh | HTTP 2xx z Edge Function; neprítomnosť alertu ešte nevylučuje nefunkčný externý plánovač |

**Bezpečnosť:** nikdy neuvádzať hodnotu tokenu do chatu, screenshotov, logov, URL, súborov alebo ZIP-u. Funkcia bez správneho tajomstva vráti `401`, na neznámom/PROD Supabase projekte `403`, iná metóda `405`. V PROD sa tento TEST monitor **nesmie aktivovať**. Upozornenie cez e-mail môže zlyhať práve pri úplnom výpadku Supabase, preto nezávisle sledovať aj výsledky HTTP kontrol vo vlastnom dashboarde cron-job.org.

## Zaznamenané overenie 13. 10. 2026

- GitHub zdrojový snapshot **`main` `19c3a2e`**, **CI #402 úspešné, 423/423 testov**. Pôvodný GitHub monitorovací workflow má zdokumentované úspešné **manuálne** behy #4 a #5; nemýliť si ich s cron-job.org behmi.
- Supabase SQL doložilo funkčný heartbeat `reservation_notification_worker_health.last_success_at = 2026-10-13 13:48:58.084919+00`.
- Kontrolovaný testovací alert `qa-p1-4-alarm-20261013-01` mal `active=true`, `attempt_count=1`, `sent_at=2026-10-13 14:10:18.774813+00`, `last_error=null`. To dokazuje zápis o úspešnom odoslaní alarmu cez Resend; **nezaručuje fyzické doručenie** do schránky.
- Podľa projektovej histórie bol nastavený externý job cron-job.org a ponechaný zapnutý počas prestávky. **Aktuálny interval, počet behov a posledný výsledok nemožno z tejto Git histórie samostatne potvrdiť.**

## Čítacie SQL – iba Supabase TEST

```sql
-- Úspešný heartbeat frontového workera (bežne sa obnovuje každý ~1 min):
select last_success_at, last_claimed, last_sent, last_retried, last_dead
from public.reservation_notification_worker_health;

-- Aktuálne / historické incidenty, bez osobných údajov:
select alert_key, issue_kind, reservation_number, active,
       generation, attempt_count, sent_at, next_attempt_at, last_error
from public.reservation_notification_monitor_alerts
order by last_seen_at desc limit 30;
```

## Prevádzková kontrola, bezpečné vypnutie a obnovenie

1. **Bežná kontrola:** v cron-job.org overiť existujúci TEST job, jeho `enabled` stav, periodu a posledné HTTP odpovede. V Supabase TEST overiť heartbeat a alarmy uvedeným **čítacím** SQL. Nevytvárať kvôli kontrole ďalší incident ani neodosielať skúšobnú SMS, ak to nie je osobitne schválené.
2. **Ak príde alarm:** zistiť stav konkrétnej udalosti vo fronte; `dead` pri nejednoznačnom BulkGate výsledku vždy riešiť manuálne. Pri výpadku celého Supabase sledovať v prvom rade zlyhania HTTP volaní v cron-job.org – Edge Function nemusí vedieť alarm sama poslať.
3. **Núdzové vypnutie len po výslovnom rozhodnutí:** zastaviť príslušný job v **cron-job.org** (nie v GitHub repository variable). **Nevypínať** `rentulo-process-reservation-notifications-every-minute` ani ostatné dátové crony; samotné rezervácie a ich spracovanie by tým neboli bezpečne monitorované.
4. **Obnovenie:** po odstránení príčiny opäť povoliť ten istý externý job a overiť jeho úspešný HTTP beh + zdravý heartbeat. Nezakladať druhý job. Po schválenom nasadení päťsúborového ZIP-u GitHub slúži iba na manuálny test, nie ako ďalší plánovač.

**Žiadne zmeny PROD:** `production`, Vercel `rentulo-prod`, Supabase PROD, Stripe live, DNS a `rentulo.com` týmto BODOM nie sú dotknuté. Budúci monitoring PROD vyžaduje nové oddelené riešenie a súhlas.
