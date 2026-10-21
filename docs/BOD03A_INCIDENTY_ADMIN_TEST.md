# RENTULO V1 / BOD 03A – evidencia a administrácia incidentov (TEST)

**Rozsah schválený 21. 10. 2026:** iba `rentulo.eu`, Supabase TEST `vspposovhdgvbeukoivh`, GitHub `main`. Produkcia (`production`, rentulo.com, PROD DB, live Stripe) nesmie byť zasiahnutá. Žiadny administračný web; ten je odložený do V2.

**Nasadenie nie je súčasťou ZIP-u.** Jeden ZIP, jedna vývojová vetva, jeden PR, relevantné testy + build, CI a až po merge samostatne schválená migrácia v Supabase TEST a redeploy testovacej Edge Function.

## 1. Čo 03A zahŕňa a neobsahuje

- `platform_incidents`: poškodenie, strata, podvod, problémový používateľ; číslo `I-000001` a ďalej; dátum, popis, overené odkazy na R/N číslo a používateľa, interné referencie na dôkazy, stav `received → reviewing → closed`, rozhodnutie.
- `platform_incident_events`: append-only história založenia, presunu stavu, doplnených referencií na dôkazy a uzavretia.
- `platform_user_blocks`, `platform_offer_moderation`, `platform_admin_actions`: blokovania a moderovanie s povinným dôvodom a auditom. Blokovaný používateľ nemôže vytvoriť novú ponuku, rezerváciu ani schváliť ďalšiu rezerváciu; existujúce zaplatené rezervácie sa dokončia bežnou cestou. Zablokovaný prenajímateľ nemusí mať automaticky skryté všetky staršie ponuky: škodlivé ponuky správca osobitne skryje.
- Ponuka skrytá administrátorom nejde vlastníkovi reaktivovať ani bežne upravovať, kým ju správca neuvoľní. **Zmazanie ponuky a GDPR anonymizácia pri zrušení účtu zostávajú povolené**, aby moderácia neblokovala zákonné práva. Po uvoľnení sa **automaticky nezverejní**. Existujúci zákaz dopravných ponúk zostáva platný; výnimočne možno skryť aj starú problematickú dopravnú ponuku.
- TECHNICKÉ alarmy `monitor-reservation-notifications` po redeployi smerujú na `support@rentulo.com`. Používateľské hlásenia zostávajú na `rentulo@rentulo.com`, GDPR na `policy@rentulo.com`.
- Nedotýka sa stavov existujúcich rezervácií, PIN, Stripe, refundov, no-show ani lehoty prevzatia/vrátenia. Výnimočné finančné vysporiadanie a nevrátenie sú **BOD 03B**. Test R-000040 zostáva nezmenený.
- DSA obsahové hlásenia patria do `dsa_content_notices`, nevrátené veci do `reservation_return_incidents` a GDPR incidenty do `gdpr_security_incidents`. Nesmú sa kvôli BODU 03A duplikovať v `platform_incidents`.

## 2. Príjem podnetu a dôkazy

1. Používateľ napíše na `rentulo@rentulo.com`. Správca vyhodnotí typ hlásenia, vytvorí len relevantný typ evidencie a pošle potvrdenie prijatia ručne.
2. Eviduje sa vecný opis, číslo incidentu, dátum a identifikátory súvisiacich prípadov. Fotografie a komunikácia sa uchovávajú v zabezpečenej schránke, nie vo verejnom Supabase Storage. `evidence_references` obsahuje výhradne interné ID správy, názvy príloh a bezpečné interné identifikátory; **nie** verejné URL, tokeny, plné kontaktné údaje či súbory.
3. Pri otvorenom právne významnom spore treba podľa existujúceho postupu BODU 02 posúdiť `gdpr_legal_holds` **pred** uplynutím bežnej retencie. V 03A sa žiadne právne pozastavenie nevytvára automaticky. Uzavreté prípady treba pravidelne preverovať kvôli minimalizácii a retencii; nie je zapnutý žiadny nový automatický mazací proces.
4. Správca zdokumentuje vyjadrenia dotknutých strán a podklad rozhodnutia. Rentulo rozhoduje o prevádzkových opatreniach na platforme, nie automaticky o vine alebo náhrade škody.

## 3. Kto smie vykonávať zásahy

V1: jediný vlastník organizácie Supabase EBBI s. r. o. (`ebbi@ebbi.sk`) s MFA cez **Supabase TEST → SQL Editor**. Účet `ebbi@ebbi.sk` v aplikácii Rentulo je naďalej **bežný testovací používateľ**, žiadna klientská admin rola nevzniká.

Funkcie `platform_admin_*` sú určené len pre SQL Editor databázovú rolu `postgres`, nie pre browser JWT, `anon`, `authenticated` ani `service_role`. Pred prvým vykonaním v SQL Editore overiť čítacím dotazom `SELECT session_user, current_user, auth.uid();` (očakáva sa `postgres`, `postgres`, `null`). **Ak sa rola líši, nič neobchádzať** a oprávnenia samovoľne neupravovať.

**Bezpečnostná hranica:** organizácia má jedného Ownera. Každý schválený postup cez uvedené funkcie zapisuje dôvod, čas a `Supabase Owner / SQL Editor`, plus databázového vykonávateľa `session_user`. Samotná databáza nedokáže kryptograficky potvrdiť totožnosť človeka za privilegovaným SQL Editorom ani mu zabrániť v priamom UPDATE/ALTER alebo vypnutí triggera. Preto je povinné MFA, výlučne schválené funkcie a zachovanie auditu Supabase. Nejde o ochranu pred samotným postgres superuserom. Žiadne priame zmeny tabuľky `offers` na obídenie moderácie.

## 4. Administrátorské operácie – vzory (iba TEST a až po nasadení)

Každú činnosť vykonávať **samostatne**, s vlastným pravdivým, dostatočným dôvodom. Príklady sú šablóny; nikdy ich nespúšťať na náhodne zvolenej skutočnej rezervácii.

```sql
-- Vytvorenie incidentu (bez odkazu na existujúcu rezerváciu):
SELECT public.platform_admin_create_incident(
  p_type => 'fraud',
  p_description => 'Prijaté podozrenie na podvodné konanie pri komunikácii.',
  p_admin_reason => 'Manuálne zaevidovanie prijatého oznámenia používateľa.',
  p_evidence_references => 'mailbox:interny-identifikator-spravy'
);

-- Preverovanie konkrétneho už vytvoreného prípadu:
SELECT public.platform_admin_update_incident(
  p_incident_number => 'I-000001',
  p_admin_reason => 'Začína sa kontrola zaslaných podkladov.',
  p_new_status => 'reviewing'
);

-- Uzavretie po zdokumentovanom posúdení:
SELECT public.platform_admin_update_incident(
  p_incident_number => 'I-000001',
  p_admin_reason => 'Preverenie a kontaktovanie účastníkov bolo dokončené.',
  p_new_status => 'closed',
  p_decision_reason => 'Vysvetlenie prijatého opatrenia a jeho zdokumentovaný podklad.'
);

-- Zablokovanie konkrétneho používateľa:
SELECT public.platform_admin_block_user(
  '<SKUTOCNE_USER_UUID>'::uuid,
  'Zdokumentované opakované podozrenie na zneužitie platformy.'
);

-- Odblokovanie:
SELECT public.platform_admin_unblock_user(
  '<SKUTOCNE_USER_UUID>'::uuid,
  'Po preverení už neexistuje dôvod pre obmedzenie účtu.'
);

-- Administrátorské skrytie ponuky:
SELECT public.platform_admin_hide_offer(
  'N-000001', 'Posúdená ponuka porušuje pravidlá publikovania.'
);

-- Zrušenie moderácie: status ponuky zostane hidden (vlastník ju môže neskôr aktivovať):
SELECT public.platform_admin_release_offer(
  'N-000001', 'Odstránený nedostatok a zamietnutý dôvod pôvodného obmedzenia.'
);
```

Vzory obsahujú čísla **len ako príklady**. Nevykonávať ich pri R-000040 ani reálnych používateľoch bez konkrétneho schváleného dôvodu. Každý krok zvlášť, nie hromadne.

**Čítanie evidencie (bez zmeny):**

```sql
SELECT incident_number, incident_type, status, received_at, closed_at
FROM public.platform_incidents ORDER BY created_at DESC LIMIT 25;
SELECT action_type, target_id, operator_label, reason, occurred_at
FROM public.platform_admin_actions ORDER BY occurred_at DESC LIMIT 25;
```

## 5. Nasadenie a minimálna kontrola

1. GitHub PR / testy / build / CI / merge / synchronizácia lokálneho `main`. ZIP neobsahuje `.env`, kľúče, `node_modules` ani `.git`.
2. Po osobitnom potvrdení spustiť **jediný nový SQL súbor** `supabase/migrations/20261021100000_bod03a_incidents_moderation_TEST.sql` v **Supabase TEST**. Jeho preflight kontroluje tajný TEST projektový údaj; v inom projekte sa celá transakcia zruší.
3. Spustiť **jednu čítaciu kontrolu** `docs/BOD03A_OVERENIE_TEST.sql` (RLS, tabuľky, funkcie, triggery a databázová rola). Potom jedna účelná funkčná kontrola na vopred dohodnutom testovacom incidente, bez opakovania starých rezervácií.
4. Nasadiť zmenenú **len TEST** Edge Function `monitor-reservation-notifications`. Až potom je v nej adresát `support@rentulo.com`; GitHub merge sám funkciu nenasadí. Nedotýkať sa existujúceho cron-job.org jobu a nevytvárať druhý job.
5. V cron-job.org samostatne a ručne nastaviť e-mail na upozornenia **o zlyhaní samotného externého HTTP jobu** na `support@rentulo.com`, pokiaľ poskytovateľ tento typ notifikácií umožňuje. Toto nemožno zmeniť SQL migráciou ani Edge Function. Bez potvrdenia nastavenia netvrdiť, že všetky cron-job.org alarmy sú presmerované.

**Hotovo 03A až po:** CI OK, SQL len na TEST, RLS/trigger kontrola OK, funkčný test jednej schválenej akcie, monitorovací adresát reálne overený. 03B zostáva samostatný bod.
