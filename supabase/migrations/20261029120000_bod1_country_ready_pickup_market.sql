-- BOD 1 / TEST FIRST. Stores residence independently of where the offered item is.
-- Only the Czech market and CZK are enabled. No Stripe/payment/reservation changes.
begin;

-- Refuse accidental application against PROD or an unrecognized Supabase project.
do $test_project$
begin
  if not exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'rentulo_project_url'
      and btrim(s.decrypted_secret, '/') = 'https://vspposovhdgvbeukoivh.supabase.co'
  ) then
    raise exception 'BOD1 countries and pickup-location migration is TEST-only';
  end if;
end;
$test_project$;

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

commit;
