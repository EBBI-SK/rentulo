-- RENTULO V1 / PROD RELEASE CANDIDATE bd1b8d1 / 2026-10-24.
-- Apply only to a verified PROD database after backup and approval.
-- This SQL is staged separately: never copy over TEST migrations.
-- Cron activation is deferred; no automatic deployment is authorized.

-- RENTULO / BOD 02 / V1 TRANSPORT EXCLUSION / PROD ONLY.
-- Apply only to the PROD Supabase project after GitHub CI and merge.
-- No data backfill, deletion, automatic hiding or production rollout is performed.
-- Existing offers must be reviewed separately using the SELECT in the BOD 02 audit.
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


do $prod_project$
begin
  if not exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'rentulo_prod_release_target'
      and btrim(s.decrypted_secret, '/') = 'tfvgxrdjrpicgtvovehl'
  ) then
    raise exception 'BOD 02 transport policy migration is PROD-only';
  end if;
end;
$prod_project$;

create or replace function public.enforce_v1_transport_offer_policy()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  v_category text := lower(btrim(coalesce(new.category, '')));
  v_title text := lower(coalesce(new.name, ''));
begin
  -- Retain old category aliases as a guard against forged API payloads.
  if v_category in (
      'auto a doprava', 'auto & transport', 'vehicles', 'transport',
      'dopravní prostředky', 'dopravné prostriedky'
    )
    or v_title ~ '(^|[^[:alnum:]])(auto|automobil|automobily|osobni auto|osobní auto|osobni automobil|osobní automobil|motorove vozidlo|motorové vozidlo|motorka|motocykl|motocykel|moped|skutr|skútr|scooter|elektroskutr|elektroskútr|jizdni kolo|jízdní kolo|bicykl|bicykel|bicycle|elektrokolo|e-bike|kolobezka|koloběžka|elektrokolobezka|elektrokoloběžka|e-scooter|motorcycle|motorbike|motorboat|caravan|karavan|obytny vuz|obytný vůz|obytny automobil|obytný automobil|privesny vozik|přívěsný vozík|prives|přívěs|lod|loď|clun|člun|kajak|kanoe|boat|motorhome|car|bike|kayak|canoe|trailer|fahrrad|motorrad|roller|boot|kanu|wohnmobil|anhanger|anhänger|samochod|samochód|rower|hulajnoga|lodz|łódź|skuter|motorower|przyczepa|paddleboard)([^[:alnum:]]|$)'
  then
    raise exception using errcode = '23514',
      message = 'RENTULO_V1_TRANSPORT_NOT_ALLOWED';
  end if;

  return new;
end;
$function$;

drop trigger if exists enforce_v1_transport_offer_policy on public.offers;
create trigger enforce_v1_transport_offer_policy
  before insert or update on public.offers
  for each row execute function public.enforce_v1_transport_offer_policy();

revoke all on function public.enforce_v1_transport_offer_policy()
  from public, anon, authenticated;

comment on function public.enforce_v1_transport_offer_policy() is
  'BOD 02 / PROD: reject obvious vehicle listings in V1 regardless of browser UI. Human moderation remains necessary.';

commit;
