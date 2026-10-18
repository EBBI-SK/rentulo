-- RENTULO / BOD 02 / V1 TRANSPORT EXCLUSION / TEST ONLY.
-- Apply only to the TEST Supabase project after GitHub CI and merge.
-- No data backfill, deletion, automatic hiding or production rollout is performed.
-- Existing offers must be reviewed separately using the SELECT in the BOD 02 audit.
begin;

do $test_project$
begin
  if not exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'rentulo_project_url'
      and btrim(s.decrypted_secret, '/') = 'https://vspposovhdgvbeukoivh.supabase.co'
  ) then
    raise exception 'BOD 02 transport policy migration is TEST-only';
  end if;
end;
$test_project$;

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
  'BOD 02 / TEST: reject obvious vehicle listings in V1 regardless of browser UI. Human moderation remains necessary.';

commit;
