# Rentulo / BOD 01 / Etapa 4: dvojhodinová rezerva medzi prenájmami (TEST)

- Zdroj GitHub `EBBI-SK/rentulo` `main` `68dd89c422499bde1bbaf62a3af4ecf55b19604f`.
- Určené **iba pre Supabase TEST** `vspposovhdgvbeukoivh`, Vercel `rentulo.eu`.
- Nemeniť Supabase PROD `tfvgxrdjrpicgtvovehl`, Stripe LIVE, PIN, refund, storno ani vyplácanie.

## Pravidlo

Pre všetky NOVO vytvárané rezervácie platí: medzi presným plánovaným
vrátením jednej rezervácie a prevzatím druhej musia uplynúť **aspoň
2 skutočné hodiny**. Podozrivé súbehy musí odmietnuť DB trigger;
UI je iba predbežná kontrola. Hraničný okamih presne +2h je povolený.

Pre posúdenie sa použije `start_date`, `end_date` a `pickup_time` v `Europe/Prague`.
V súčasnom Rentule je čas vrátenia rovnaký ako čas prevzatia v posledný deň.
Rezervácie `pending/approved/paid/picked_up` aj už potvrdené `returned` blokujú
počas svojho PLÁNOVANÉHO intervalu a dvojhodinovej rezervy. Predčasné
vrátenie nemôže skrátiť už dohodnutý termín pre ďalšieho nájomcu.
`cancelled/expired/no_show/rejected` neblokujú. Staré záznamy sa nemenia; pri starej rezervácii bez pickup_time
server konzervatívne odmietne aj susediace dni, kým nie je možné overiť čas.

## Postup

1. Najprv overiť PR, 100 % CI a stiahnutie `main`; lokálne `npm test` a `npm run build`.
2. V **Supabase TEST SQL Editore** aplikovať **jedinú NOVÚ** migráciu:
   `supabase/migrations/20261017235500_two_hour_booking_buffer_TEST.sql`.
   Staré migrácie nespúšťať znova. SQL odmietne nesprávny TEST project URL.
3. UI kontrolu vykonáva `has_offer_reservation_time_conflict` cez BEZPEČNÝ boolean RPC.
   Funkcia nikdy nezverejní cudzie rezervácie, mená, ID, ani presné časy.
4. Na ponuke s existujúcou rezerváciou napríklad R-000039, vrátenie
   **19. 10. 2026 10:00**, otestovať: nové prevzatie 19.10 11:45 =
   nedostupné, 19.10 12:00 = dostupné, ak nie je ďalší konflikt.
   Nespúšťať skutočnú duplicitnú platenú rezerváciu.
5. Výsledok RPC porovnať s DB kontrolou a vykonať negatívny pokus
   o rezerváciu s konfliktom cez bežný formulár, bez priameho ručného
   SQL vloženia. Potvrdiť, že sa termín nezablokuje.

## Dôležité

- Staršie rezervácie zostávajú v TEST nedotknuté.
- Fyzické nevrátenie veci je iný proces než 2h plánovaný odstup;
  v tejto etape sa nemení jeho tok, status ani spúsšťanie Stripe transferu.
- V PROD bude pred spustením nová DB bez starých testovacích rezervácií.
