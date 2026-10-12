# BOD 13 – Jednotné rezervačné e-mailové a SMS notifikácie (TEST)

**Stav:** pripravený zdrojový balík na lokálnu kontrolu a riadené nasadenie do **TEST**. Tento balík **nie je nasadenie** a nie je pokynom meniť PROD, Stripe live, DNS alebo `production` vetvu.

**Východisko:** GitHub `EBBI-SK/rentulo` `main` `1bb4abe8bf173a89f88a62ed2a4a31a6b46a0404`, používateľský ZIP 12. 10. 2026 (07:01:59). Pôvodné Node testy: 367/367. Zmena nepredpokladá žiadne zásahy do produkčného Supabase `tfvgxrdjrpicgtvovehl`.

## Rozsah

- Jediná tabuľka `reservation_notification_deliveries`: jeden záznam na udalosť, príjemcu a kanál. RLS + `revoke` bežných rolí; len servisný proces môže claim/ack.
- Vytváranie udalostí **transakčnými databázovými trigger-mi** pri vzniku rezervácie a zmene statusu, nezávisle od otvoreného prehliadača. Zmena statusu nikdy nečaká na Resend ani SMS API.
- Špeciálna zaplatená rezervácia: `paid_cancelled` ide obom účastníkom ako e-mail a protistrane ako voliteľná SMS až po `refund_status = succeeded` a `financials_finalized_at is not null`.
- Jeden worker `process-reservation-notifications`, zabezpečený vlastným náhodným Cron tajomstvom vo Vault; atomické claimy `FOR UPDATE SKIP LOCKED`, lease/claim token, stavová evidencia a oneskorené retry (max. 5 pokusov).
- Existujúca `send-reservation-email` ostáva interným emailovým transportom (Resend), vrátane kompletných 5-jazykových HTML šablón a detailného finančného rozpisu. Je viazaná na konkrétnu pracovníkom claimnutú položku; Resend používa stabilný `Idempotency-Key`.
- SMS: `new_request`, `approved`, `paid`, `cancelled` (zahŕňa bezpečne uzatvorený `paid_cancelled`). Príjemca je vždy účastník relevantný pre udalosť; pri zaplatenom storne SMS dostane iba protistrana. SMS obsahuje iba číslo rezervácie, bez PIN/telefónov/kontaktov.
- Odosielanie cez overený BulkGate Simple Transactional API má 3 režimy: `disabled` (predvolené), `dry_run`, `live`. **`live` je zablokovaný mimo TEST** a aj v TEST vyžaduje explicitný zoznam povolených čísiel.
- Nastavenia: opt-in `profiles.sms_notifications` predvolene `false` a checkbox v `nastaveni.html` vo všetkých 5 jazykoch. Zmena telefónu je samostatné existujúce nastavenie profilu.
- Naďalej oddelené: Supabase Auth bezpečnostné e-maily a samostatné e-maily o splatných dlhoch majiteľov. Tie neboli prepisované, aby sa nerozšíril rozsah a neporušila ich finančná logika.

## Kritické pravidlá a obmedzenia

1. **Žiadne PROD zmeny.** Nepoužiť žiadne produkčné `supabase link`, db push, Edge deploy, Vercel env alebo Stripe live.
2. SMS sa **predvolene neodosielajú**. Pracovný rozsah štyroch SMS udalostí treba ešte finálne porovnať so schválením z predchádzajúceho rozhovoru; kým nie je overený, `SMS_SEND_MODE=disabled`, prípadne `dry_run` pre TEST.
3. Čísla v profile zatiaľ nie sú nezávisle SMS/OTP-verifikované. Pred ostrým SMS spustením treba pridať overenie vlastníctva čísla a schváliť finalizované znenie GDPR a pravidiel doručovania.
4. SMS provider pri sieťovom timeoute mohol správu akceptovať aj bez odpovede. Worker preto pre nejednoznačné odpovede použije konečný stav `dead` (manuálna kontrola), nie automatické opakovanie s rizikom duplicitnej platenej SMS. Pri známom rate-limite retry beží.
5. TEST/PROD izolácia: SMS `live` je v kóde natvrdo povolené iba pre TEST URL `https://vspposovhdgvbeukoivh.supabase.co` a len pre `SMS_ALLOWED_NUMBERS`.
6. Migrácie v jednom balíku majú **poradie**: najprv outbox, potom Cron. Po samotnom `git push` aplikácia ešte nemá novú databázovú funkcionalitu; nasadzovať len podľa kontrolovaného plánu.
7. E-mailové notifikácie sa odošlú, keď pracovník spracuje frontu, spravidla pri najbližšom Cron ticku (každú minútu). Nezaručuje sa doručenie na externú schránku, iba akceptácia poskytovateľom.

## Navrhované poradie riadeného nasadenia do TEST (po ďalšom schválení)

*Každú fázu samostatne overiť. Nenasadzovať naraz bez kontroly konfigurácie.*

1. Overiť aktuálny GitHub `main`, TEST Supabase project ref a zálohu/test migration planu. Overiť miestne testy a build.
2. V **Supabase TEST** uplatniť migráciu `20261012100000_unify_reservation_notification_outbox.sql`. Zatiaľ nič neodosiela; vytvorí server-only frontu + triggery a používateľský SMS opt-in.
3. Nasadiť novú internú e-mailovú funkciu `send-reservation-email` s podporou claimu z fronty a nový worker `process-reservation-notifications` s `--no-verify-jwt` (overuje vlastný Vault Cron secret). Nový worker na štarte nevytáča SMS poskytovateľa.
4. V **Supabase TEST** skontrolovať Vault `rentulo_project_url` = `https://vspposovhdgvbeukoivh.supabase.co`. Nasadiť Cron migráciu `20261012101000_schedule_notification_worker.sql`. Tajomstvo `rentulo_notification_cron_secret` zostane iba vo Vault; posiela sa v `x-rentulo-cron-secret`, nie v Gite.
5. Nasadiť aktualizovaný TEST Stripe webhook a `cancel-paid-reservation` až po overení triggerov, vrátane existujúcich Stripe webhook secrets. Nesmie sa zmeniť Stripe live konfigurácia.
6. Po lokálnej kontrole nasadiť TEST frontend a otestovať: `pending → approved → paid → picked_up → returned`, rejected, ordinary cancelled, renter/owner paid cancellation a asynchrónny refund. Skontrolovať e-maily, databázové položky a `stripe_webhook_events`.
7. Pre SMS skúšať najprv `SMS_SEND_MODE=dry_run`; zapnúť `sms_notifications=true` len testovaciemu používateľovi, vytvoriť novú testovaciu rezerváciu, overiť `simulated` v outboxe. Staré udalosti sa spätne neposielajú.
8. Reálne SMS **len po samostatnom schválení** BulkGate účtu a nákladov, s TEST `SMS_SEND_MODE=live`, `SMS_ALLOWED_NUMBERS` (zoznam vlastných testovacích telefónov), `BULKGATE_APPLICATION_ID` a `BULKGATE_APPLICATION_TOKEN`. Sender `gSystem`; text začína `Rentulo:`. Reálne produkčné SMS nie sú súčasťou tohto balíka.

## Základná diagnostika – iba TEST SQL Editor

```sql
-- Po aplikovaní TEST migrácie:
select channel, event_type, status, count(*)
from public.reservation_notification_deliveries
group by channel, event_type, status
order by channel, event_type, status;

-- Posledných 20 záznamov bez kontaktných údajov:
select created_at, channel, event_type, status, attempt_count, last_error
from public.reservation_notification_deliveries
order by created_at desc
limit 20;
```

**Dôležité:** Testy v tomto balíku sú lokálne statické, jednotkové a typové. Nie sú náhradou reálnej SQL migrácie v TEST Supabase, doručenia cez Resend, skúšky Cron ani vyhodnotenia BulkGate fakturácie. Produkcia musí ostať nedotknutá.
