# Rentulo – BOD 01, etapa 5: Stripe transfer až po potvrdenom vrátení (TEST)

**Východisko:** `EBBI-SK/rentulo` `main` `803123e06c44d1c3c303071b9eb577cc23d6ff9d`.
**TEST len:** Supabase `vspposovhdgvbeukoivh`, Vercel `rentulo.eu`, Stripe Sandbox.
Žiadny zásah do PROD `tfvgxrdjrpicgtvovehl`, vetvy `production` alebo LIVE Stripe.

## Dohodnuté správanie

- Po skutočnom odovzdaní a jednorazovom PIN-e (`paid -> picked_up`): okamžite zneplatniť PIN. **ŽIADEN Stripe transfer**; platba ostáva vysporiadaná cez Stripe, jej transfer majiteľovi má stav `not_created`.
- Po skutočnom vrátení, ktoré potvrdí prenajímateľ (`picked_up -> returned`): existujúci zabezpečený `retry-owner-transfers` worker (každých päť minút) vyberie rezerváciu a spustí **jeden** Stripe Connect transfer. Následné bankové pripísanie môže trvať dlhšie.
- Existujúci `paid -> no_show`, keď vec nájomca vôbec neprevezme do konca dohodnutého obdobia, **zostáva** automaticky vyúčtovaný podľa už prijatých pravidiel; transfer tu nepodmieňujeme vracaním, pretože vec nebola odovzdaná.
- Pri `picked_up` nesmie zafungovať žiadna z ciest: Edge Function, service-role claim RPC, automatický retry candidate RPC, Stripe finalizer. Starý nevyužívaný recorder sa zneprístupní.
- Platby, Stripe sumy, pomery platby/provízie, refundy, multi-currency settlement, idempotency, no-show cron, PIN ani storno sa nemenia.
- Existujúce Stripe transfery sú nedotknuté; spätne sa nevytvárajú duplicity ani reversal.
- Texty majiteľa a obchodné podmienky sú zosúladené v piatich jazykoch. Finančná/legal korektúra je nutná pred PROD.

## BEZPEČNÉ PORADIE NASADENIA

1. Na `main` overiť GitHub CI, lokálne testy a build. V TEST overiť, že predplatená R-000039 je `paid` a `transfer_status = not_created`, žiadny transfer ID.
2. **Ako prvú do TEST aplikovať jedinú novú SQL migráciu** `supabase/migrations/20261018001000_transfer_only_after_return_TEST.sql`. SQL obsahuje fail-closed TEST Vault overenie. Až tento krok zamedzí vytvoreniu nového transferu pri `picked_up`, aj keby stará Edge Function ešte volala Stripe.
3. Nasadiť do toho ISTÉHO TEST projektu `create-owner-transfer`, až potom `confirm-pickup`. Druhý krok odstraňuje automatické volanie pri PIN-e. Pri oboch ponechať pôvodné Edge Function JWT nastavenia; nevypínať JWT svojvoľne.
4. Existujúci `retry-owner-transfers` Edge worker **nemeníme** a Cron `rentulo-retry-owner-transfers-every-5-minutes` necháme zapnutý.
5. Diagnostika pre R-000039: po PIN-e musí byť `picked_up`, PIN spotrebovaný, `transfer_status=not_created`, Stripe transfer ID null; minimálne jeden beh retry workera NESMIE transfer vytvoriť.
6. Po skutočnom vrátení a kliknutí **„Potvrdit vrácení“** musí byť `returned`. Najbližší beh retry workera transfer vytvorí alebo bezpečne retry-ne; iba jeden Stripe `tr_...`, kontrola sumy/mien a idempotencie.
7. Negatívne kontroly: `paid` a `picked_up` nesmú byť kandidáti na transfer. `no_show` naďalej kandidát je. Historické už `succeeded` prevody sa nikdy neodošlú znova. Skontrolovať Cron výsledky a chyby.

## Čisto čítacie SQL (TEST)

```sql
SELECT r.reservation_number, r.status, p.status AS payment_status,
       p.stripe_payment_intent_status, p.transfer_status,
       p.transfer_attempt_count, p.transfer_next_retry_at,
       p.stripe_transfer_id, p.stripe_transfer_amount_minor,
       p.stripe_transfer_currency
FROM public.reservations r
JOIN public.payments p ON p.reservation_id = r.id
WHERE r.reservation_number = 'R-000039';

SELECT jobname, active, schedule
FROM cron.job
WHERE jobname IN ('rentulo-retry-owner-transfers-every-5-minutes',
                  'rentulo-paid-no-show-every-minute');
```

## Obmedzenia a prevádzkové upozornenia

- Stripe Connect Separate Charges and Transfers oddeľuje platbu od transferu. **Nie je to právne escrow ani neobmedzené zadržiavanie peňazí**. Stripe podmienky povoľujú zadržanie peňazí len na potrebnú dobu pre poskytnutie služby/refund/dispute. Pred produkciou preveriť maximálne praktické dĺžky prenájmu, postup pri nikdy nepotvrdenom vrátení a pravidlá Stripe balance automatických payouts (inak môže neskorší transfer zlyhať nedostatkom disponibilného zostatku). Všetko bez pridania finančných funkcií v tejto etape.
- Transfer z platformy na connected účet NIE JE bankové pripísanie majiteľovi. Východisková doba: najbližší worker každých päť minút plus potrebný čas Stripe/banky.
- Testovacia karta na bežné scenáre: `4242 4242 4242 4242`; žiadne ďalšie skutočné platby a žiadne kroky v LIVE Stripe.
- Ak bezpečnostná kontrola zlyhá, NEspúšťať PIN na R-000039; okamžite prestať s nasadzovaním a preveriť chybu.
