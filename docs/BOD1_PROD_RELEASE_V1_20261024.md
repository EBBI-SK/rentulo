# Rentulo V1 – BOD 1: produkčný release kandidát (príprava)

**Dátum:** 24. 10. 2026  
**Stav:** **PRIPRAVENÉ NA KONTROLU / NO-GO PRE NASADENIE.** Bez samostatného súhlasu nič nespúšťať na PROD.  
**Repo:** `EBBI-SK/rentulo`  
**TEST:** `rentulo.eu`, Supabase `vspposovhdgvbeukoivh` (zachovať nezmenené)  
**PROD:** `rentulo.com`, Supabase `tfvgxrdjrpicgtvovehl` (verejne nespustené)

## 1. Presne zmrazený zdroj

- GitHub `main`: **`bd1b8d19358842e20194a4551471dab543a4767d`** (PR #58).
- Zdrojový Git tree: **`f175056d5087adf00925e6ef89c56148d6e9fa2a`**. Priložený ZIP bol na `e8595fb3073e6afded43c3400c7662292e10ee6e`, s tým istým stromom súborov ako merge commit.
- GitHub `production`: **`a79d3bb93bbf37a7d36c35484fadcdeb461419ea`**.
- Overený rozdiel na GitHube k uvedenému stavu: **144 commitov**, `production` nemá odlišné vlastné commity. Diff v checkoute: 232 zmenených súborov (vrátane zdrojových, testov a dokumentácie).
- Rentulo CI pre `main` commit: **#519 `success`** (24. 10. 2026). Toto **nie je** dôkaz aplikovateľnosti PROD SQL ani pripravenosti LIVE Stripe.
- Pôvodná vetva `production` obsahuje **73 SQL migrácií** do verzie `20261008100000`. Zdroj `main` obsahuje **111**, rozdiel = **38**.
- Po akomkoľvek novom commite do `main` je tento balík stále viazaný na `bd1b8d1` a treba znovu odsúhlasiť finálny release commit. GitHub automaticky nič nenasádzať.

## 2. Obsah jediného ZIP-u

- `supabase/prod-release-20261024/migrations/` – **38** produkčných SQL variantov (samostatná cesta, *nie* `supabase/migrations`). Verzie/timestamps sú rovnaké ako zdrojové SQL; pôvodné TEST súbory sa **nemenia**.
- `docs/BOD1_PROD_RELEASE_V1_20261024.md` – tento dokument: poradie, preflight, záloha, rollback, závislosti.
- `tests/prod-release-bundle.test.mjs` – **jeden** offline statický test balíka: SHA-256 vstupov, počty migrácií, environment guard, cron, GDPR gate, enumy a posledná oprava.

**V ZIP-e nie sú žiadne TEST dáta, účty, API kľúče, databázové zálohy ani `.env` súbory.** SQL nie je spustiteľné bez zvláštneho autorizovaného produkčného guardu.

## 3. Produkčná identita a ochrana pred náhodným spustením

Každé z 38 SQL overuje vo **Vault cieľovej databázy** explicitný záznam:

- názov: `rentulo_prod_release_target`
- hodnota: `tfvgxrdjrpicgtvovehl` (verejný identifikátor projektu, **nie** kľúč / heslo)

Tento záznam sa **nevytvára sám**. Jeho vytvorenie je **PROD zmena** a vyžaduje nový súhlas pri BODE 2 po ručnom overení projektu v Supabase Dashboard. Samotný guard nie je náhrada za kontrolu DB hostiteľa, rolí, zálohy a zoznamu migrácií. Ak sa hodnota nezhoduje, SQL vyvolá výnimku. Takisto zlyhá, ak existujúca Vault hodnota `rentulo_project_url` ukazuje na inú URL ako `UNCONFIGURED` alebo PROD URL.

**Zámerne sa nepoužíva `rentulo_project_url` na schválenie migrácií.** Táto prevádzková hodnota môže zapnúť už existujúce pg_cron úlohy z predchádzajúcich 73 migrácií. Jej nastavenie na PROD URL až v neskoršej, výslovne schválenej fáze musí byť koordinované s pripravenosťou workerov.

## 4. Presné poradie 38 SQL migrácií

Názvy PROD súborov boli vytvorené zo zdrojových súborov `supabase/migrations/`; prípona `_TEST.sql` je nahradená `_PROD.sql`. **Poradie je striktne podľa 14-ciferného čísla verzie.**

| # | PROD migrácia | Poznámka |
|---:|---|---|
| 01 | `20261009130000_add_offer_and_reservation_numbers.sql` | Prebratá neutrálna SQL migrácia. |
| 02 | `20261011103000_guard_pickup_and_remove_test_payment.sql` | Prebratá neutrálna SQL migrácia. |
| 03 | `20261011170000_limit_pickup_pin_to_pickup_day.sql` | Prebratá neutrálna SQL migrácia. |
| 04 | `20261012100000_unify_reservation_notification_outbox.sql` | Prebratá neutrálna SQL migrácia. |
| 05 | `20261012101000_schedule_notification_worker.sql` | Len definícia Vault/verifikátora; cron odložený. |
| 06 | `20261012150000_harden_reservation_notification_worker.sql` | Prebratá neutrálna SQL migrácia. |
| 07 | `20261012170000_add_expired_reservation_status.sql` | Prebratá neutrálna SQL migrácia. |
| 08 | `20261012171000_reservation_expiration_policy.sql` | Prebratá neutrálna SQL migrácia. |
| 09 | `20261012172000_schedule_reservation_expiration.sql` | Aktivácia cron odložená. |
| 10 | `20261013090000_reset_sms_opt_in_on_phone_change.sql` | Prebratá neutrálna SQL migrácia. |
| 11 | `20261013100000_monitor_reservation_notifications_PROD.sql` | Monitorovacie tabuľky/RPC; TEST Edge endpoint nezapínať. |
| 12 | `20261014100000_fix_owner_debt_reminder_claim_ambiguity.sql` | Prebratá neutrálna SQL migrácia. |
| 13 | `20261014110000_pin_stripe_checkout_locale.sql` | Prebratá neutrálna SQL migrácia. |
| 14 | `20261014120000_fix_paid_cancellation_refund_finalization.sql` | Prebratá neutrálna SQL migrácia. |
| 15 | `20261015160000_add_paid_no_show_status.sql` | `no_show` enum, samostatne mimo transakcie. |
| 16 | `20261015161000_paid_no_show_settlement_PROD.sql` | No-show DB pravidlá; cron odložený. |
| 17 | `20261017180000_payment_deadline_before_pickup_PROD.sql` | TEST odvodená PROD SQL verzia. |
| 18 | `20261017203000_cancellation_cutoff_24h_exception_PROD.sql` | TEST odvodená PROD SQL verzia. |
| 19 | `20261017223000_pending_withdrawal_cutoff_FIX_PROD.sql` | TEST odvodená PROD SQL verzia. |
| 20 | `20261017233000_return_followup_incident_PROD.sql` | Follow-up DB pravidlá; cron odložený. |
| 21 | `20261017235500_two_hour_booking_buffer_PROD.sql` | TEST odvodená PROD SQL verzia. |
| 22 | `20261018001000_transfer_only_after_return_PROD.sql` | TEST odvodená PROD SQL verzia. |
| 23 | `20261018090000_pickup_pin_two_hours_early_PROD.sql` | TEST odvodená PROD SQL verzia. |
| 24 | `20261018110000_bod02_v1_transport_rule_PROD.sql` | TEST odvodená PROD SQL verzia. |
| 25 | `20261018130000_bod02_gdpr_deactivation_cleanup_PROD.sql` | TEST odvodená PROD SQL verzia. |
| 26 | `20261018140000_bod02_gdpr_deleted_offer_address_PROD.sql` | TEST odvodená PROD SQL verzia. |
| 27 | `20261020120000_bod02_gdpr_reservation_contacts_gate_PROD.sql` | TEST odvodená PROD SQL verzia. |
| 28 | `20261020150000_bod02_gdpr_closed_status_90_days_PROD.sql` | TEST odvodená PROD SQL verzia. |
| 29 | `20261020170000_bod02_v1_compliance_registry_PROD.sql` | GDPR súhlas: PROD identifikátor 1.0; frontend zatiaľ neprešiel právnym schválením. |
| 30 | `20261020170500_bod02_v1_trusted_finalized_timestamps_PROD.sql` | TEST odvodená PROD SQL verzia. |
| 31 | `20261020171000_bod02_v1_guarded_retention_PROD.sql` | GDPR retencia: gate OFF; cron odložený. |
| 32 | `20261020172000_bod02_v1_owner_contacts_legal_hold_PROD.sql` | TEST odvodená PROD SQL verzia. |
| 33 | `20261020173000_bod02_v1_deleted_offer_photo_retention_PROD.sql` | Storage URL prepnuté na PROD; foto-gate OFF. |
| 34 | `20261021100000_bod03a_incidents_moderation_PROD.sql` | TEST odvodená PROD SQL verzia. |
| 35 | `20261021110000_bod03b_exceptional_settlement_PROD.sql` | Spory/refundy: cron odložený; Edge TEST-only. |
| 36 | `20261023150000_raise_platform_fee_minimum_to_70.sql` | Nové rezervácie: min. provízia 70 CZK. |
| 37 | `20261023175000_fix_stripe_payment_immutable_guard_PROD.sql` | Guard Stripe `approved -> paid`. |
| 38 | `20261024150000_returned_booking_actual_return_buffer_PROD.sql` | Uvoľnenie termínu po potvrdenom vrátení +2 h; bez TEST výpisu. |

**Dôležité:** `20261012170000` (`expired`) a `20261015160000` (`no_show`) rozširujú PostgreSQL enum; vykonať ich ako samostatné migrations/commity pred súbormi, ktoré používajú nové hodnoty. Vo všetkých pôvodných funkciách zostáva obchodná logika bez zmeny. Sú odstránené iba automatické `cron.schedule` príkazy, TEST guardy, TEST referencie a finálna diagnostická SELECT otázka na konkrétnu TEST rezerváciu.

### Oddelené cron úlohy – teraz NEAKTIVOVAŤ

Zo šiestich SQL súborov je odložená registrácia nasledujúcich jobov; SQL definície funkcií/RPC zostávajú v migráciách:

| Cron | Dôvod odloženia |
|---|---|
| `rentulo-process-reservation-notifications-every-minute` | Najprv PROD email/SMS konfigurácia (BOD 4) |
| `rentulo-expire-unpaid-reservations-every-5-minutes` | Najprv nasadenie a overenie `expire-reservations` |
| `rentulo-paid-no-show-every-minute` | Najprv Stripe LIVE/Connect a payout pravidlá |
| `rentulo-return-followups-every-minute` | Najprv nasadené notifikácie a kontrola návratov |
| `rentulo-bod02-gdpr-retention-daily-TEST` | **Neaktivovať ani premenovanú PROD verziu bez právneho súhlasu**; vykonávací gate OFF |
| `rentulo-process-dispute-refunds-every-5-minutes` | TEST-only Edge Function blokuje PROD, najprv samostatná implementácia |

Dva staršie pg_cron joby (`rentulo-send-overdue-owner-debt-reminders-hourly` a `rentulo-retry-owner-transfers-every-5-minutes`) **môžu už existovať** v PROD, pretože patria do pôvodných 73 migrácií. Pred nastavením `rentulo_project_url` skontrolovať `cron.job` a výslovne schváliť ich aktiváciu. TEST monitoring cez cron-job.org zostáva nedotknutý.

## 5. Kontrola pred akýmkoľvek nasadením (BOD 2, zatiaľ NEVYKONÁVAŤ)

1. Znovu potvrdiť GitHub `main` a `production` SHA. Pri inom SHA zastaviť a preveriť diff.
2. V Supabase Dashboard ručne potvrdiť, že **databázové pripojenie je PROD `tfvgxrdjrpicgtvovehl`**, nie TEST. Overiť, že sa používa samostatná produkčná databáza a žiadna TEST služba/kľúč.
3. V PROD **iba prečítať** tabuľku `supabase_migrations.schema_migrations`, porovnať verzie a očakávané DB objekty s poslednými 73 migráciami `production`. Názvy súborov v Gite **nedokazujú**, že boli v DB spustené. Ak schéma vznikla aj ručnými SQL zásahmi alebo je rozdiel v histórii, **NO-GO**, žiadne automatické `migration repair`.
4. Prečítať existujúce názvy Vault záznamov a `cron.job` (bez vypisovania dešifrovaných kľúčov); potvrdiť, že nebeží worker, ktorý by predčasne odosielal LIVE správy alebo payout.
5. Potvrdiť **použiteľnú zálohu**: DB dump v šifrovanom úložisku s obmedzeným prístupom, skontrolovaný obsah dumpu, ak je možné skúška obnovy v izolovanej databáze; zároveň preveriť Supabase backup/PITR podľa dostupného plánu. Upozornenie: bežný `pg_dump` **neobsahuje samotné súbory Storage**; zvlášť zohľadniť Auth/Storage a externú finančnú evidenciu Stripe. Nikdy nekopírovať zákaznícke údaje do TEST.
6. Až po samostatnom súhlase operátora pripraviť vo **Vault PROD** `rentulo_prod_release_target` a vytvoriť **oddelenú dočasnú produkčnú migráciu** so 73 presne odsúhlasenými baseline súbormi + 38 PROD variantmi. **Nepripájať PROD k bežnému `supabase db push` spustenému z rootu `rentulo`:** ten obsahuje originálne TEST SQL a neoddelené crony.
7. Migrácie aplikovať výlučne cez kontrolovaný proces, ktorý ukladá **skutočne vykonané čísla verzií** do histórie Supabase migrácií. Nespúšťať ručne sériu SQL v editore bez konzistentnej migračnej histórie. Prvá chyba, nesúlad schémy, URL alebo RLS = **STOP / NO-GO**, zaznamenať poslednú vykonanú verziu.
8. Až po pripravení Auth/Storage/Edge, secrets a LIVE poskytovateľov v ďalších bodoch aktivovať potrebné produkčné joby **oddeleným schválením**. V tomto ZIP-e sa nenachádza žiadny aktivačný SQL skript.

### Read-only preflight dotazy – spúšťať iba na overenom PROD a až v BODE 2

```sql
-- Výpis verzií, bez akejkoľvek opravy migrácií:
select version from supabase_migrations.schema_migrations order by version;

-- Názvy jobov, nie ich URL ani obsahy secrets:
select jobname, active from cron.job where jobname like 'rentulo-%' order by jobname;

-- Názvy vault položiek, NIE decrypted_secrets:
select name from vault.secrets where name like 'rentulo_%' order by name;
```

## 6. Edge Functions / chýbajúce produkčné predpoklady

Súčasný `main` obsahuje funkcie pre bežný booking, PIN, refund, Connect, transfer, notifikácie a adresy. BOD 1 ich **neupravuje ani nenasadzuje**. Pred aktiváciou ostávajú konkrétne prekážky:

- `process-reservation-notifications`: **LIVE SMS blokované mimo TEST** (`vspposovhdgvbeukoivh` + TEST allowlist), samostatná PROD úprava až v BODE 4. Databázové monitorovacie tabuľky/RPC v balíku môžu existovať bez spustenia PROD alertov.
- `monitor-reservation-notifications`: hardcoded TEST URL a TEST režim; **do PROD nenasadzovať**. Produkčnú verziu / oddelené alarmy až v BODE 6.
- `process-dispute-refunds`: hardcoded TEST projekt a `sk_test_` Stripe; **do PROD nenasadzovať** bez schválenej LIVE úpravy (BOD 3/6).
- `gdpr-cleanup-offer-photo`: iba TEST URL; PROD vykonávací gate fotografií zostáva **OFF**, Edge funkciu neaktivovať.
- `js/registration-page.js` stále posiela `terms_version` a `privacy_notice_version` = `1.0-test-2026-10-20`. PROD SQL `20261020170000` očakáva **`1.0`**. **NO-GO pre registráciu**, kým sa po právnom schválení (issue #7) nezjednotí formulár a dokumenty. Tento ZIP frontend nemení; `1.0` je zatiaľ pripravený, nie schválený produkčný záznam.
- `address-suggestions`, `geocode-pickup`: preveriť oddelené produkčné Geoapify EU kľúče; TEST projekt/klúče nepresúvať.
- `create-checkout-session`, `stripe-webhook`, `create-owner-transfer`, `retry-owner-transfers`: potreba samostatných Stripe LIVE secrets/webhooku a kontrola payout po `returned/no_show` (BOD 3).

Ďalšie samostatné kroky: produkčná SMTP/Resend/BulkGate konfigurácia (BOD 4), Vercel Pro/doména/`noindex` (BOD 5), monitoring/zálohy (BOD 6), jediná produkčná funkčná kontrola a 1 LIVE finančný cyklus (BOD 7–8), dokumentácia/GO (BOD 9–10). Tento ZIP nerobí žiadnu z týchto akcií.

## 7. Rollback a rozhodnutie NO-GO

**Pred produkčným zásahom:** záloha DB vrátane možnosti overenia obnovy, inventár Storage, SHA pôvodnej `production`, zoznam nasadených Edge Functions, stav Vercelu, názvy cronu a potvrdenie Stripe LIVE konfigurácie. Záloha nepatrí do Gitu ani do tohto ZIP-u.

**Ak SQL zlyhá:** ihneď stop, neoznačovať verzie ako vykonané. Transakčné migrácie majú vlastné `BEGIN/COMMIT` a zlyhaná transakcia sa rollbackne. Enum `ADD VALUE` je zámerne oddelené; pri úspešne vykonaných predošlých migráciách neexistuje bezpečné univerzálne automatické „DOWN“ SQL. Podľa skutočného stavu sa rozhodne o obnove zo zálohy v izolovanom režime alebo o schválenej doprednej oprave. Pred obnovením vypnúť všetky produkčné workery. Nevymazávať statusy, platby ani Stripe udalosti.

**Ak zlyhá web/Edge:** vrátiť Vercel/Edge na potvrdené predošlé verzie; následne skontrolovať kompatibilitu s aktuálnou DB. `git reset --hard` či revert commitu **nevracia DB migrácie**.

**Po prvej skutočnej platbe/Stripe prevode:** nevykonať slepý návrat starého DB snapshotu – vznikol by rozpor s kartovými platbami/refundmi a Connect prevodmi. Prioritou je zastaviť ďalší finančný tok, zrekoncilovať Stripe udalosti a pripraviť opravu so zachovaním auditnej stopy.

**NO-GO**, ak: sa nezhoduje DB projekt / migračná história / SHA; záloha nie je overená; RLS nesedí; LIVE provider má TEST kľúče; neplánovaný cron je aktívny; niektorá GDPR brána je zapnutá bez súhlasu; alebo nie je schválená právna verzia / zosúladený registračný formulár, prípadne stále existuje testovacia platobná obchádzka. Verejný `noindex` sa odstraňuje výhradne až v BODE 10, po ďalšom súhlase.

## 8. Jediný automatický test

Po rozbalení ZIP-u **do koreňa aktualizovaného workspace Rentulo** (bez prepísania existujúcich súborov):

```bash
node --test tests/prod-release-bundle.test.mjs
```

Je to offline kontrola štruktúry a zhody 38 SQL s pinovanými vstupmi; **neaplikuje SQL a neotvára sieť**. Nepredstiera reálny test databázy, SQL parser ani pripravenosť Stripe LIVE. Po schválení obsahu sa pokračuje dohodnutým postupom: **jeden ZIP → lokálny test → pracovná vetva → PR do chráneného `main` → CI → merge → samostatné schválenie PROD nasadenia**.
