# RENTULO V1 – BOD 03B / spory a výnimočné finančné vysporiadanie (iba TEST)

**Rozsah schválený 21. 10. 2026.** TEST: `rentulo.eu`, Supabase `vspposovhdgvbeukoivh`, Stripe **TEST**, GitHub `main`. Bez PROD, bez administrátorského webu (V2), bez automatických pokút alebo oceňovania škody. Doterajšie pripomienky vrátenia, PIN, bežný `returned`/`no_show` transfer a BOD 03A zostávajú zachované.

## Čo tento balík rieši

1. Pri poškodení/strate/nevrátení má používateľ podať hlásenie cez `rentulo@rentulo.com`. Rentulo získa vyjadrenia strán a odkazy na súkromné dôkazy. Nevrátenie sa naďalej eviduje cez `reservation_return_incidents`, poškodenie/strata/podvod cez `platform_incidents` (BOD 03A). Dôkazy neukladať do verejného Storage ani do SQL.
2. Ak sa vec skutočne vráti, prenajímateľ použije pôvodné tlačidlo na potvrdenie. Automatický payout sa spustí až po `returned`, ako predtým.
3. Ak sa vec nevráti a existuje **písomná dohoda oboch strán alebo záväzný právny podklad**, jediný Owner môže **po dohodnutom čase vrátenia +2 h** schváliť jednu z dvoch **vzájomne vylúčených** trás:
   - `owner_full_payout` – iba bežný podiel majiteľovi zo zaplatenej rezervácie (`owner_payout`, nie celá platba). Používa existujúci idempotentný Stripe Connect worker.
   - `renter_full_refund` – vráti **celú pôvodnú platbu** na pôvodný platobný prostriedok cez nový vyhradený Stripe TEST worker.
4. Každá schválená výnimka má nemenné rozhodnutie, číslo rezervácie, vnútorný odkaz na dôkazy, povinný dôvod a append-only históriu. Typ vysporiadania už nemožno vymeniť. **Stav rezervácie zostáva `picked_up`** – uzatvára sa *incident*, nie predstierané fyzické vrátenie. Súčasné vyplatenie oboch strán je blokované v databázovom claime, finalizeri, kandidátoch i Edge Function.
5. Automatické spory bez zdokumentovaného podkladu, čiastočné rozdelenia peňazí, transfer reversals, automatické náhrady škody a externé vymáhanie **nie sú súčasťou V1**. Pri čiastočnej dohode sa rieši individualizovane mimo tejto automatizácie, len s právnym/platobným posúdením a evidenciou; nie ručným prepísaním databázy.

**Dôležité:** Stripe Connect `separate charges and transfers` nie je právna úschova (escrow), refund nespôsobuje automaticky reverzáciu už vykonaného transferu. Preto SQL nepovolí výnimku po začatom transfere, po refunde ani pri nejednoznačných finančných stavoch. Pred PROD treba právne/Stripe schváliť pravidlá zadržania, lehoty, vyúčtovanie platformy, priame nároky účastníkov, DAC7/účtovníctvo len podľa už prijatého samostatného rozsahu.

## Prevádzkový postup – jeden konkrétny prípad

1. Administrátor v Supabase TEST cez SQL Editor skontroluje rezerváciu, doručené oznámenie, relevantný incident (alebo 03A číslo), kompletnú dohodu oboch strán / záväzné rozhodnutie a prípadnú potrebu `gdpr_legal_holds`. Informácie o dôkazoch patria do zabezpečenej schránky, SQL obsahuje iba interný identifikátor podkladu (12–500 znakov).
2. Až po rozhodnutí na úrovni konkrétneho prípadu použije **iba** schválenú SQL funkciu; nebude robiť `UPDATE payments/reservations` ani upravovať stav `picked_up`:

```sql
-- ŠABLÓNA, NIE PRÍKAZ NA SPUSTENIE. Číslo a podklad vždy skutočného prípadu.
SELECT public.bod03b_admin_authorize_settlement(
  p_reservation_number => 'R-XXXXXX',
  p_settlement_route => 'renter_full_refund', -- alebo 'owner_full_payout'
  p_basis_type => 'joint_agreement', -- alebo 'binding_order'
  p_basis_reference => 'mailbox:interny-identifikator-dohody',
  p_admin_reason => 'Po prevereni oboch stran a schvalenej pisomnej dohody sa vykonava zdokumentovane vysporiadanie.'
);
```

3. `owner_full_payout` vykoná existujúci každých 5 minút bežiaci `retry-owner-transfers`, ktorého DB aj Edge kontrolujú autorizovanú výnimku. `renter_full_refund` spracuje nový TEST `process-dispute-refunds` každých 5 minút. Worker používa `sk_test_`, osobitné tajomstvo Vault, bezpečné claim/lease, kontrolu charge/refunds, jednotný idempotency key, opätovné zistenie Stripe refundu po nejednoznačnom výsledku; blokuje podozrivé čiastočné/vonkajšie refundy. Nevyžaduje zadávať Stripe kľúč do prehliadača či SQL.
4. Ak Stripe oznámi `succeeded`, incident nevrátenia sa uzavrie ako `financially_settled_owner` alebo `financially_refunded` (nie `confirmed_returned`). Pri 03A incidente pre poškodenie/stratu sa výsledok zaznamená a 03A prípad uzavrie **administrátor** pôvodnou auditovanou funkciou. Riadok rezervácie zostane `picked_up` na preukázanie, že fyzické vrátenie nebolo potvrdené.
5. Po vykonaní výsledku administrátor **manuálne informuje obe strany** e-mailom o rozhodnutí a príslušnom finančnom výsledku. Nie je pridaná automatická SMS ani nový používateľský formulár. Ak Stripe vyžaduje manuálnu kontrolu (`manual_review`), **žiadne ďalšie peniaze sa automaticky neposielajú**.
6. Na obnovenie presne tej istej refundovej vetvy po zdokumentovanom manuálnom preverení je výhradne Owner SQL Editor funkcia (bez možnosti zmeniť trasu, sumu alebo pôvodnú autorizáciu):

```sql
-- ŠABLÓNA, NIE PRÍKAZ NA SPUSTENIE:
SELECT public.bod03b_admin_retry_refund(
  p_settlement_id => '<SCHVALENE_UUID>'::uuid,
  p_admin_reason => 'Rucne potvrdene aktualne Stripe udaje a dalsi bezpecny pokus na tom istom incidente.'
);
```

**Nie je to automatická kompenzácia škody:** Rentulo neuznáva vinu a samo nerozhoduje o škode. Incident môže zostať finančne nevyriešený, kým účastníci nepredložia právne použiteľný podklad. Pri súdnom spore postupovať podľa práva, neprijímať jednostranné tvrdenie ako „dohodu“.

## Bezpečné poradie nasadenia (vždy iba po PR a CI)

1. Na TEST vykonať kontrolu GitHub CI; lokálny `main` musí obsahovať zlúčený PR. Pozrieť, či sa plánovaný test **R-000040** ešte vykonáva; nijako doňho týmto BODOM nezasahovať.
2. **Najprv** nasadiť novú TEST Edge Function `process-dispute-refunds` zo schváleného `main`, so zapnutým interným testovacím kľúčom `STRIPE_SECRET_KEY=sk_test_...` a s výnimkou JWT overenia **iba pre túto novú funkciu**, ak je potrebná pre ne-JWT cron header; požiadavka s chybným osobitným tajomstvom musí vracať `401`. Na PROD nenasadzovať. Zatiaľ je funkcia inertná, kým neexistujú DB RPC.
3. Potom **jedinú novú TEST SQL migráciu** `supabase/migrations/20261021110000_bod03b_exceptional_settlement_TEST.sql`, ktorá overí TEST Vault URL, vytvorí chránené tabuľky/RPC a zaregistruje *jeden* nový refund worker cron. Žiadne staré migrácie nespúšťať znova. Existujúce cron-job.org alarmy, worker prevodov a bežných notifikácií neprestavovať.
4. Až po SQL nasadiť aktualizovanú TEST Edge Function `create-owner-transfer` so zachovaným pôvodným nastavením autorizácie (service-role token, JWT) – obsahuje pomocný DB guard pre exceptional owner payout a blok tenant refundu.
5. Jeden **čítací** dotaz `docs/BOD03B_OVERENIE_TEST.sql`: overí 2 chránené tabuľky, 2 základné auditné triggery, 7 funkcií a nový Cron; neautorizuje žiadne reálne peniaze. Skontrolovať iba nové TEST logy. **Bez skúšobného refundu či transferu na reálnej rezervácii R-000040.** Cielené simulované testy pokrývajú súbeh, autorizáciu a idempotenciu, no nie sú dôkazom bankového pripísania. Prvý skutočný end-to-end Stripe TEST pre výnimočné vysporiadanie vyžaduje osobitne schválený prípad; nikdy nie PROD bez právneho overenia.

## Čítacia diagnostika (TEST)

```sql
SELECT r.reservation_number, r.status AS reservation_status,
       d.settlement_route, d.basis_type, d.status AS dispute_status,
       d.attempt_count, d.last_error,
       p.transfer_status, p.stripe_transfer_id,
       p.refund_status, p.stripe_refund_id
FROM public.reservation_dispute_settlements d
JOIN public.reservations r ON r.id=d.reservation_id
JOIN public.payments p ON p.id=d.payment_id
ORDER BY d.approved_at DESC LIMIT 25;

SELECT e.event_kind, e.old_status, e.new_status, e.actor_label, e.reason, e.occurred_at
FROM public.reservation_dispute_settlement_events e
ORDER BY e.occurred_at DESC LIMIT 25;
```

## Technické limity a záväzné pravidlá

- Pri `manual_review` skontrolovať Stripe Dashboard, refund, stav charge a sumu, **nikdy** nedoplniť ID refundu ručným UPDATE v databáze. Kontrolované opätovné spracovanie je cez `bod03b_admin_retry_refund` so zapísaným dôvodom.
- `reservation_dispute_settlements` bráni dvojnásobnému schváleniu a uchováva finančné dôkazy; právne významné podklady sú mimo verejných storage. UUID odkazy na rezerváciu a platbu sú pri schválení overené; nedrží ich pevný cudzí kľúč, aby dokončená evidencia neblokovala zákonnú BOD02 retenciu a mazanie. Otvorené spory treba včas označiť pomocou existujúceho `gdpr_legal_holds`. GDPR retencia a účel uchovania sa musia preveriť pri finálnom právnom schválení; platené a neuzavreté rezervácie už sú chránené existujúcimi pravidlami.
- **Nerieši** automatické ukončenie fyzickej rezervácie, zmenu jej stavu, účet vymazaného používateľa ani bankové pripísanie. Stav `picked_up` je pravdivý až do neskoršieho faktického potvrdenia, aj keď incident finančne skončil.
- Riešenie je určené pre TEST. Pred produkciou treba potvrdiť, že daný postup zodpovedá právu CZ, pravidlám Stripe, účtovným dokladom a časovým limitom, a až potom rozhodnúť o samostatnom nasadení do PROD.
