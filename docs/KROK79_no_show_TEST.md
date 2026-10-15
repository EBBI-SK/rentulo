# Rentulo – KROK 79: zaplatená rezervácia bez prevzatia (TEST)

Status: **zdrojový návrh, nie overenie live**. Nasadiť výhradne do projektu
`vspposovhdgvbeukoivh` (`rentulo.eu`). PRODUKCIU `tfvgxrdjrpicgtvovehl` NEMENIŤ.

## Pravidlo

- Základom je **presný časový interval** od `start_date + pickup_time` do
  `end_date + pickup_time` v časovej zóne `Europe/Prague`. Čas vrátenia
  je v posledný deň rovnaký ako čas prevzatia (napr. 12. 11. 10:00 – 13. 11. 10:00).
- Najprv sa musí zverejniť nové znenie podmienok a výrazné upozornenie
  pred platbou. AŽ POTOM sa spúšťa databázová migrácia.
- Pri inštalácii sa nastaví dátum aktivácie na nasledujúci deň a čas
  aktivácie pre vznik rezervácie. Staré rezervácie vytvorené pred aktiváciou
  (aj keď majú budúci termín prevzatia) nikdy nespustia no-show payout.
- Nové pravidlo je pracovné a musí ho preveriť právnik pred PROD; najmä
  viacdňové rezervácie, spor o pripravenosť veci a nevrátené platby.
- Po zaplatení sa PIN nájomcovi môže zobraziť aj vopred, no **na potvrdenie
  prevzatia ho možno použiť len od presného plánovaného času prevzatia do
  presného plánovaného času vrátenia**; na hranici času vrátenia už neplatí.
  Neskoršie prevzatie nepredlžuje dohodnutý čas vrátenia.
- PIN je **jednorazový**: samotné overenie ho nespotrebuje, ale po úspešnom
  potvrdení tlačidlom „Předat věc“ sa stav zmení na `picked_up`, PIN sa
  okamžite zneplatní a druhé použitie je odmietnuté. Payout sa vtedy spustí hneď.
- Iba ak do **presného plánovaného času vrátenia** nedošlo k potvrdeniu, PIN
  v tomto čase definitívne zaniká a Cron pri najbližšom minútovom behu prepne
  overenú rezerváciu z `paid` na `no_show`. Nejde o skutočné prevzatie.
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
   PIN nefunguje a bez potvrdenia nastane `no_show` až po presnom čase vrátenia.
   Pre rýchlu skúšku použiť kontrolovaný SQL TEST scenár, nie meniť systémový čas.
6. Skontrolovať jednu zmenu statusu, jednu dvojicu e-mailov, uvoľnenie termínu,
   jeden Stripe transfer, opakované Cron pokusy bez duplicít a Históriu.
7. Overiť zobrazenie upozornenia pred Stripe Checkout, jednorazový PIN a pravidlá v sekcii
   `obchodni-podminky.html#nevyzvednuti` vo všetkých piatich jazykoch.
8. V PROD je pred spustením potrebná finálna právna kontrola a odsúhlasenie
   znenia podmienok; automatický Stripe payout nenahrádza riešenie sporov.

## Obmedzenie presnosti

Supabase pg_cron beží každú minútu. PIN zaniká v plánovanom čase vrátenia;
automatický prechod `paid` → `no_show` môže nasledovať až pri ďalšom minútovom
behu, nie presne v sekunde (napr. okolo 13. 11. 10:00–10:01). Stripe/banka
môžu platbu pripísať neskôr. Pri neznámom čase prevzatia sa výplata zablokuje
a prípad sa zaznamená na manuálnu kontrolu. Pri testovaní overiť aj zmeny DST.

KROK 80 (odstránenie odkazu *Detail nabídky* z riadku Moje rezervace) zostáva
oddelený, tento balík ho nemení.
