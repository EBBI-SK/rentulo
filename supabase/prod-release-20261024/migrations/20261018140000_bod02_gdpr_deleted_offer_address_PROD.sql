-- RENTULO V1 / PROD RELEASE CANDIDATE bd1b8d1 / 2026-10-24.
-- Apply only to a verified PROD database after backup and approval.
-- This SQL is staged separately: never copy over TEST migrations.
-- Cron activation is deferred; no automatic deployment is authorized.

-- RENTULO / BOD 02 / GDPR / PROD ONLY
-- Fix for real PROD account deletion: the finalizer in 20261018130000 clears
-- offers.city and offers.postal_code in the SAME UPDATE that marks an offer
-- deleted. The pre-existing CHECK constraints currently reject empty values.
--
-- Keep the original validation for every active/draft offer. For a deleted
-- offer ONLY, permit exactly the empty string (not arbitrary invalid text).
-- No reservation/payment changes, data backfill, or existing record deletion.
-- Apply only after PR CI and merge, and only in Supabase PROD.
begin;


DO $rentulo_prod_release_guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets AS s
    WHERE s.name = 'rentulo_prod_release_target'
      AND s.decrypted_secret = 'tfvgxrdjrpicgtvovehl'
  ) THEN
    RAISE EXCEPTION 'Rentulo PROD release guard missing: check target project and approval';
  END IF;
  IF EXISTS (
    SELECT 1 FROM vault.decrypted_secrets AS s
    WHERE s.name = 'rentulo_project_url'
      AND btrim(s.decrypted_secret, '/') NOT IN
        ('UNCONFIGURED', 'https://tfvgxrdjrpicgtvovehl.supabase.co')
  ) THEN
    RAISE EXCEPTION 'Unexpected runtime project URL; release aborted';
  END IF;
END;
$rentulo_prod_release_guard$;


-- Identical tested project guard to the previous GDPR migration.
do $prod_project$
begin
  if not exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'rentulo_prod_release_target'
      and btrim(s.decrypted_secret, '/') = 'tfvgxrdjrpicgtvovehl'
  ) then
    raise exception 'BOD02 GDPR deleted-offer constraints migration is PROD-only';
  end if;
end;
$prod_project$;

-- Original: CHECK (char_length(trim(city)) BETWEEN 1 AND 100).
-- Active and draft offers remain subject to the same original rule.
alter table public.offers
  drop constraint offers_city_length_check;
alter table public.offers
  add constraint offers_city_length_check
  check (
    (char_length(trim(city)) between 1 and 100)
    or (status = 'deleted'::public.offer_status and city = '')
  );

-- Original: CHECK (char_length(trim(postal_code)) BETWEEN 1 AND 20).
-- A deleted offer may clear the field; non-deleted offers cannot.
alter table public.offers
  drop constraint offers_postal_code_length_check;
alter table public.offers
  add constraint offers_postal_code_length_check
  check (
    (char_length(trim(postal_code)) between 1 and 20)
    or (status = 'deleted'::public.offer_status and postal_code = '')
  );

commit;
