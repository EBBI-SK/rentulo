-- RENTULO / BOD 9 / PROD ONLY / country and pickup market.
-- SOURCE: tested TEST migration 20261029120000_bod1_country_ready_pickup_market.sql.
-- NEW PROD VERSION 20261104120000: never replay the older TEST timestamp.
-- SAFETY: stage via an isolated approved PROD migration procedure only.
-- DO NOT run in the TEST project or via an unreviewed root db push.
-- No SMS, payments, reservations, cron, historical backfill or production web deployment.
-- Existing PROD history and backups must be checked separately before deployment.
-- Fails closed if the existing production signup function differs from the
-- repository baseline 20260827143000_add_slovak_language_support.sql.
BEGIN;

DO $prod_guard$
DECLARE
  v_signup_body text;
  v_signup_definer boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name = 'rentulo_prod_release_target'
      AND btrim(s.decrypted_secret, '/') = 'tfvgxrdjrpicgtvovehl'
  ) OR NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name = 'rentulo_project_url'
      AND btrim(s.decrypted_secret, '/') = 'https://tfvgxrdjrpicgtvovehl.supabase.co'
  ) THEN
    RAISE EXCEPTION 'BOD9 country migration: explicit Rentulo PROD target required';
  END IF;

  -- The old TEST migration version was not installed on PROD. Refuse a mixed
  -- migration history or another attempt after this release has run.
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version IN ('20261029120000', '20261104120000')
  ) THEN
    RAISE EXCEPTION 'BOD9 country migration: already recorded or history mismatch';
  END IF;

  IF to_regclass('public.profiles') IS NULL
    OR to_regclass('public.offers') IS NULL
    OR to_regprocedure('public.handle_new_user()') IS NULL
    OR to_regprocedure('public.finalize_account_deactivation(uuid)') IS NULL
    OR to_regclass('auth.users') IS NULL
  THEN
    RAISE EXCEPTION 'BOD9 country migration: required PROD schema objects missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('profiles', 'id'), ('profiles', 'account_status'),
      ('profiles', 'full_name'), ('profiles', 'email'),
      ('profiles', 'phone'), ('profiles', 'street'),
      ('profiles', 'city'), ('profiles', 'postal_code'),
      ('profiles', 'preferred_language'),
      ('offers', 'owner_id'), ('offers', 'status'),
      ('offers', 'pickup_mode'), ('offers', 'pickup_street'),
      ('offers', 'pickup_city'), ('offers', 'pickup_postal_code'),
      ('offers', 'pickup_latitude'), ('offers', 'pickup_longitude')
    ) AS required(table_name, column_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = required.table_name
        AND c.column_name = required.column_name
    )
  ) THEN
    RAISE EXCEPTION 'BOD9 country migration: baseline profile/offer columns missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_postal_code_length_check'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = 'auth.users'::regclass
      AND t.tgname = 'on_auth_user_created'
      AND t.tgenabled <> 'D'
      AND t.tgfoid = 'public.handle_new_user()'::regprocedure
  ) THEN
    RAISE EXCEPTION 'BOD9 country migration: existing signup/PSCs protections differ';
  END IF;

  -- Refuse partial deployments, unexpected duplicate objects and drift.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND ((c.table_name = 'profiles' AND c.column_name = 'country_code')
        OR (c.table_name = 'offers' AND
            c.column_name IN ('pickup_country_code', 'currency_code')))
  ) OR EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE (c.conrelid = 'public.profiles'::regclass
            AND c.conname = 'profiles_country_code_format_check')
       OR (c.conrelid = 'public.offers'::regclass
            AND c.conname IN ('offers_czech_market_only_check',
                             'offers_active_pickup_plausible_location_check'))
  ) OR to_regprocedure('public.scrub_deactivated_residence_country()') IS NOT NULL
    OR to_regprocedure('public.guard_offer_profile_pickup_country()') IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE (t.tgrelid = 'public.profiles'::regclass
             AND t.tgname = 'scrub_deactivated_residence_country')
         OR (t.tgrelid = 'public.offers'::regclass
             AND t.tgname = 'guard_offer_profile_pickup_country')
    )
  THEN
    RAISE EXCEPTION 'BOD9 country migration: new objects already exist; stop';
  END IF;

  -- The baseline function last changed in the repository in Aug 2026.
  -- A strict fingerprint is intentional: do not overwrite unreviewed PROD
  -- registration customizations with CREATE OR REPLACE FUNCTION.
  SELECT p.prosrc, p.prosecdef
    INTO v_signup_body, v_signup_definer
  FROM pg_proc p
  WHERE p.oid = 'public.handle_new_user()'::regprocedure;
  IF v_signup_body IS NULL OR v_signup_definer IS DISTINCT FROM true
     OR md5(v_signup_body) <> 'd334f99f2c9ab43f72d29ae0d2677ca5' THEN
    RAISE EXCEPTION 'BOD9 country migration: PROD signup function has changed; review before replacing';
  END IF;

  -- These counts were checked as zero in PROD on 2026-11-04. Recheck at
  -- execution time so newly added rows cannot silently violate new guards.
  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.account_status::text <> 'deactivated'
      AND (p.postal_code IS NULL OR length(trim(p.postal_code)) NOT BETWEEN 1 AND 20)
  ) OR EXISTS (
    SELECT 1 FROM public.offers o
    WHERE o.status::text = 'active'
      AND (
        nullif(trim(o.pickup_street), '') IS NULL
        OR nullif(trim(o.pickup_city), '') IS NULL
        OR o.pickup_postal_code IS NULL
        OR o.pickup_postal_code !~ '^[0-9]{3} ?[0-9]{2}$'
        OR o.pickup_latitude IS NULL
        OR o.pickup_longitude IS NULL
        OR o.pickup_latitude NOT BETWEEN 48.5 AND 51.2
        OR o.pickup_longitude NOT BETWEEN 12 AND 19
      )
  ) THEN
    RAISE EXCEPTION 'BOD9 country migration: changed profile/offer data require review';
  END IF;
END;
$prod_guard$;

-- TEST-tested DDL below remains unchanged, except final PostgREST reload.
alter table public.profiles
  add column if not exists country_code text;

alter table public.profiles
  add constraint profiles_country_code_format_check
  check (country_code is null or country_code ~ '^[A-Z]{2}$');

-- Legacy profiles have unknown residence. Never guess CZ from a Czech-looking PSČ.
comment on column public.profiles.country_code is
  'ISO 3166-1 alpha-2 country of residence; NULL means not yet selected by legacy user.';

-- An optional postal code is legitimate in some countries. Central European
-- launch-neighbour countries still require a postcode, as before.
alter table public.profiles drop constraint if exists profiles_postal_code_length_check;
alter table public.profiles add constraint profiles_postal_code_length_check
  check (
    account_status = 'deactivated'
    or char_length(trim(postal_code)) between 1 and 20
    or (country_code is not null and country_code not in ('CZ','SK','PL','AT','DE','HU')
        and char_length(trim(postal_code)) = 0)
  );

-- The account-deactivation finalizer already erases direct address fields.
-- Erase the newly introduced residence country in that same transaction,
-- without modifying the existing financial/legal deactivation workflow.
create or replace function public.scrub_deactivated_residence_country()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.account_status = 'deactivated' then
    new.country_code := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists scrub_deactivated_residence_country on public.profiles;
create trigger scrub_deactivated_residence_country
  before update on public.profiles
  for each row execute function public.scrub_deactivated_residence_country();

-- Keep the current five-language signup metadata behaviour intact.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  insert into public.profiles (
    id, full_name, email, phone, street, city, postal_code,
    preferred_language, country_code
  ) values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    coalesce(new.raw_user_meta_data->>'street', ''),
    coalesce(new.raw_user_meta_data->>'city', ''),
    coalesce(new.raw_user_meta_data->>'postal_code', ''),
    case lower(coalesce(new.raw_user_meta_data->>'preferred_language', 'cs'))
      when 'sk' then 'sk'
      when 'en' then 'en'
      when 'de' then 'de'
      when 'pl' then 'pl'
      else 'cs'
    end,
    case
      when upper(coalesce(new.raw_user_meta_data->>'country_code', '')) ~ '^[A-Z]{2}$'
      then upper(new.raw_user_meta_data->>'country_code')
      else null
    end
  )
  on conflict (id) do update set
    email = excluded.email,
    preferred_language = excluded.preferred_language,
    updated_at = now();
  return new;
end;
$function$;

alter table public.offers
  add column if not exists pickup_country_code text not null default 'CZ',
  add column if not exists currency_code text not null default 'CZK';

comment on column public.offers.pickup_country_code is
  'ISO country where the item is collected. Only CZ is enabled for Rentulo launch.';
comment on column public.offers.currency_code is
  'ISO 4217 currency for the offer price. Only CZK is enabled for Rentulo launch.';

-- Future markets can get their own country/currency pair and validation in a
-- later approved migration. Existing payments are intentionally CZK-only.
alter table public.offers
  add constraint offers_czech_market_only_check
    check (pickup_country_code = 'CZ' and currency_code = 'CZK');

-- Existing active listings might predate geocoding. Do not bulk-modify them:
-- NOT VALID still protects any new INSERT/UPDATE; audit/remediate legacy separately.
alter table public.offers
  add constraint offers_active_pickup_plausible_location_check
  check (
    status <> 'active' or (
      char_length(trim(pickup_street)) > 0 and
      char_length(trim(pickup_city)) > 0 and
      pickup_postal_code ~ '^[0-9]{3} ?[0-9]{2}$' and
      pickup_latitude is not null and
      pickup_longitude is not null and
      pickup_latitude between 48.5 and 51.2 and
      pickup_longitude between 12 and 19
    )
  ) not valid;

-- A profile address in another country (or with unknown country) may never be
-- used silently as a Czech pickup point, even by a bypassed browser form.
create or replace function public.guard_offer_profile_pickup_country()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'active' and new.pickup_mode = 'profile' and not exists (
    select 1 from public.profiles p
    where p.id = new.owner_id
      and p.country_code = 'CZ'
      and trim(p.street) = trim(new.pickup_street)
      and trim(p.city) = trim(new.pickup_city)
      and regexp_replace(p.postal_code, '[[:space:]]+', '', 'g') =
          regexp_replace(new.pickup_postal_code, '[[:space:]]+', '', 'g')
  ) then
    raise exception 'rentulo_pickup_requires_czech_profile_address';
  end if;
  return new;
end;
$function$;

drop trigger if exists guard_offer_profile_pickup_country on public.offers;
create trigger guard_offer_profile_pickup_country
  before insert or update on public.offers
  for each row execute function public.guard_offer_profile_pickup_country();

-- Refresh PostgREST schema cache after adding new public columns.
NOTIFY pgrst, 'reload schema';
COMMIT;
