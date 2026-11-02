# Rentulo – Bod 8.5 – Supabase Auth Send Email Hook (iba TEST)

**Cieľ:** Odosielateľ Auth správ zostáva `Rentulo <support@rentulo.com>`;
**Reply-To = `rentulo@rentulo.com`** pre registráciu, obnovu hesla, zmenu e-mailu a ostatné Auth správy.
Doterajšia SMTP konfigurácia Resend sa **nemení**. `policy@rentulo.com` zostáva GDPR kontakt.

## Prečo samostatný hook

Supabase Auth používa vlastné SMTP nastavenie bez bežného samostatného poľa Reply-To.
Zapnutie Send Email Auth Hook **nahrádza** odosielanie Auth e-mailov cez SMTP; SMTP zostáva
nastavené ako okamžitá návratová cesta pri vypnutí hooku. Preto nesmieme hook zapnúť
pred pripravením a otestovaním Edge Function.

Funkcia: `supabase/functions/send-auth-email/index.ts`.
Schválené zdrojové šablóny (CZ/SK/EN/DE/PL): `supabase/auth-email-templates/`.
Ich presná kópia je vložená v `supabase/functions/_shared/auth-email-render.mjs`;
Node testy kontrolujú zhodu oboch kópií pri budúcich úpravách.

## Bezpečnosť

- Verejný Edge Function endpoint sa musí nasadiť s `--no-verify-jwt`, pretože volania
  pochádzajú z Auth a nie z prihlásenej používateľskej relácie.
- **Každá požiadavka je overená podpisom Standard Webhooks** (`SEND_EMAIL_HOOK_SECRET`).
  Neoverené požiadavky nesmú posielať e-maily.
- `RESEND_API_KEY`, `SEND_EMAIL_HOOK_SECRET` sa ukladajú do Supabase TEST **Edge Function Secrets**,
  nikdy nie do Gitu, ZIP, terminálového výstupu alebo chatu.
- Používa sa identifikátor webhooku na oddelené idempotentné odosielanie; pri Secure Email Change
  sú samostatné potvrdenia starej a novej adresy s **rôznymi token_hash** (pozor na opačné názvy
  `token_hash_new` a `token_hash` v payload Supabase).
- Pri chybe Resend funkcia vráti chybu a Auth nesmie považovať odoslanie za úspešné.
- Pri dvojitom potvrdení odosielame oba e-maily súbežne, aby sme dodržali 5-sekundový HTTP hook limit.
- Funkcia neloguje e-mailové adresy, tokeny ani URL; overovací odkaz ide cez HTTPS Supabase Auth a následný redirect smie smerovať iba na HTTPS rentulo.eu/com.
- Táto zmena nemení rezervačné e-maily, Stripe, SMS, RLS, databázové tabuľky ani PROD.

## Pred aktiváciou – postup jedna vec naraz

1. Zlúčiť PR až po úspešných `npm test`, kontrole diffu a CI; aktualizovať lokálny `main`.
2. Skontrolovať Supabase TEST: Authentication → Email Templates, SMTP Settings, URL Configuration,
   Auth Hooks – či neexistuje iný zapnutý Send Email Hook.
3. Skontrolovať, že v **TEST** Edge Function Secrets existuje platný `RESEND_API_KEY`
   a prípadne `EMAIL_FROM` (`Rentulo <support@rentulo.com>`); **neodhaľovať hodnoty**.
4. Funkciu nasadiť iba do TEST:

   ```powershell
   npx supabase functions deploy send-auth-email --project-ref vspposovhdgvbeukoivh --no-verify-jwt --use-api
   ```

   Nasadenie funkcie **ešte nezapína Auth Hook**.
5. V TEST → Authentication → Auth Hooks pripraviť **Send Email → HTTPS** a adresu:
   `https://vspposovhdgvbeukoivh.supabase.co/functions/v1/send-auth-email`.
   Vygenerovať signing secret podľa dashboardu, bezpečne uložiť v TEST Edge Function Secrets
   pod **`SEND_EMAIL_HOOK_SECRET`** vo formáte `v1,whsec_...`; secret neposielať do chatu.
   **Nezapnúť hook pred nastavením secretu.**
6. Zapnúť Send Email Hook v **TEST**, pričom Custom SMTP a Email Provider ponechať zapnuté.
7. Bezprostredne otestovať skutočný doručený Auth e-mail (overenie registrácie, obnova hesla)
   vrátane úspešného kliknutia, adresy odpovede **rentulo@rentulo.com** a správneho jazyka.
8. Otestovať zmenu e-mailu (stará aj nová adresa), pozvánku/magic link/reauth ak používame.
   Overiť Resend status **Delivered**, Edge logs bez 401/422/502, žiadne duplicitné správy.
9. Až po úspešnom TEST uvažovať samostatne o PROD (nový secret, nový project ref).

## Rollback (okamžitý)

Supabase TEST → Authentication → Auth Hooks → **vypnúť Send Email Hook**.
Auth sa vráti k existujúcemu nakonfigurovanému Resend SMTP, ak Email Provider ostáva zapnutý.
Funkciu netreba mazať. Overiť testovaciu obnovu hesla.

## Dôležitá hranica testov

Automatické Node testy overujú šablóny, bezpečné URL a mapovanie potvrdení.
**Neoverujú reálne prijatie do Resend, podpis Auth Hook-u v Supabase ani kliknutie na link.**
Bod označiť za hotový až po praktických testoch v TEST; nevydávať úspešné `npm test`
za potvrdenie doručenia.

Dokumentácia: https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook
