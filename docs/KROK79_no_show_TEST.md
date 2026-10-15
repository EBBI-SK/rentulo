# Rentulo – KROK 79: zaplatená rezervácia bez prevzatia (TEST)

Status: **zdrojový návrh, nie overenie live**. Nasadiť výhradne do projektu
`vspposovhdgvbeukoivh` (`rentulo.eu`). PRODUKCIU `tfvgxrdjrpicgtvovehl` NEMENIŤ.

## Pravidlo

- Základom je **celé zaplatené obdobie** od `start_date` po `end_date` (vrátane)
  podľa časovej zóny `Europe/Prague`, nie iba prvý deň.
- Najprv sa musí zverejniť nové znenie podmienok a výrazné upozornenie
  pred platbou. AŽ POTOM sa spúšťa databázová migrácia.
- Pri inštalácii sa nastaví dátum aktivácie na nasledujúci deň a čas
  aktivácie pre vznik rezervácie. Staré rezervácie vytvorené pred aktiváciou
  (aj keď majú budúci termín prevzatia) nikdy nespustia no-show payout.
- Nové pravidlo je pracovné a musí ho preveriť právnik pred PROD; najmä
  viacdňové rezervácie, spor o pripravenosť veci a nevrátené platby.
- Po zaplatení sa PIN nájomcovi môže zobraziť aj vopred, no **na potvrdenie
  prevzatia ho možno použiť len od `start_date` do `end_date` vrátane**.
  Neskoršie prevzatie nepredlžuje dátum vrátenia.
- PIN je **jednorazový**: samotné overenie ho nespotrebuje, ale po úspešnom
  potvrdení tlačidlom „Předat věc“ sa stav zmení na `picked_up`, PIN sa
  okamžite zneplatní a druhé použitie je odmietnuté. Payout sa vtedy spustí hneď.
- Iba ak do **23:59 posledného zaplateného dňa** nedošlo k potvrdeniu, pri
  najbližšom minútovom behu po polnoci Cron prepne overenú rezerváciu z `paid`
  na `no_show`. PIN tým definitívne zaniká; nejde o skutočné prevzatie.
- `no_show` už neblokuje termíny, zobrazí sa v Histórii obom účastníkom.
- Refund nájomcovi **nevzniká**; fronta e-mailov doručí dôvod obom účastníkom
  v ich jazyku. SMS no-show nie sú zapnuté.
- Po prechode sa spustí EXISTUJÚCI Stripe transfer worker. Používa idempotentný
  claim, kontrolu skutočnej platby/refundu a retry každých päť minút.
  **Spustenie transferu nie je pripísanie peňazí na účet.**
- Ak je platba poškodená/neznáma, fail-closed: rezervácia zostane `paid`,
  záznam v `reservation_no_show_issues` a operatívne preverenie.
- Dodatočné blokovanie deaktivácie účtu majiteľa, kým nie je výplata `succeeded`.

## Bezpečné nasadenie – poradie

1. CI (`npm test`, TEST build) + PR do GitHub `main`.
2. Skontrolovať, že aktualizované obchodné podmienky a upozornenie pred platbou
   sú dostupné v TEST. Až potom aplikovať dve NOVÉ migrácie iba v TEST Supabase
   **postupne**: najprv status-enum a potom politiku/crony. Staré migrácie
   NIKDY nespúšťať opakovane.
3. Nasadiť TEST Edge Functions `get-pickup-pin`, `resolve-pickup-pin`,
   `confirm-pickup`, `create-owner-transfer`, `send-reservation-email` a
   `process-reservation-notifications` zo schváleného `main`, nikdy nie PROD.
4. Overiť zapnutý Cron `rentulo-paid-no-show-every-minute`, po zmene nadväzný
   `rentulo-retry-owner-transfers-every-5-minutes` a bežný notifikačný worker.
5. Testovať nový Stripe Sandbox scenár **viacdňovej rezervácie**: PIN funguje
   aj po prvom dni, úspešné potvrdenie ho okamžite zneplatní, po `end_date`
   PIN nefunguje a bez potvrdenia nastane `no_show` až po skončení celého obdobia.
   Pre rýchlu skúšku použiť kontrolovaný SQL TEST scenár, nie meniť systémový čas.
6. Skontrolovať jednu zmenu statusu, jednu dvojicu e-mailov, uvoľnenie termínu,
   jeden Stripe transfer, opakované Cron pokusy bez duplicít a Históriu.
7. Overiť zobrazenie upozornenia pred Stripe Checkout, jednorazový PIN a pravidlá v sekcii
   `obchodni-podminky.html#nevyzvednuti` vo všetkých piatich jazykoch.
8. V PROD je pred spustením potrebná finálna právna kontrola a odsúhlasenie
   znenia podmienok; automatický Stripe payout nenahrádza riešenie sporov.

## Obmedzenie presnosti

Supabase pg_cron beží každú minútu. Spracovanie sa spustí po lokálnej polnoci,
nie garantovane presne v sekunde 00:00; Stripe/banka môžu pripísať neskôr.

KROK 80 (odstránenie odkazu *Detail nabídky* z riadku Moje rezervace) zostáva
oddelený, tento balík ho nemení.
