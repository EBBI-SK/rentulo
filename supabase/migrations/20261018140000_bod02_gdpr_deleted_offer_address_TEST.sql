-- RENTULO / BOD 02 / GDPR / TEST ONLY
-- Fix for real TEST account deletion: the finalizer in 20261018130000 clears
-- offers.city and offers.postal_code in the SAME UPDATE that marks an offer
-- deleted. The pre-existing CHECK constraints currently reject empty values.
--
-- Keep the original validation for every active/draft offer. For a deleted
-- offer ONLY, permit exactly the empty string (not arbitrary invalid text).
-- No reservation/payment changes, data backfill, or existing record deletion.
-- Apply only after PR CI and merge, and only in Supabase TEST.
begin;

-- Identical tested project guard to the previous GDPR migration.
-- Do not apply this change to rentulo-prod without separately reviewed rollout.
do $test_project$
begin
  if not exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'rentulo_project_url'
      and btrim(s.decrypted_secret, '/') = 'https://vspposovhdgvbeukoivh.supabase.co'
  ) then
    raise exception 'BOD02 GDPR deleted-offer constraints migration is TEST-only';
  end if;
end;
$test_project$;

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
