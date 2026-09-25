begin;

alter table public.profiles
  add column if not exists stripe_connected_account_id text,
  add column if not exists stripe_connect_status text not null default 'not_started',
  add column if not exists stripe_connect_details_submitted boolean not null default false,
  add column if not exists stripe_connect_transfers_enabled boolean not null default false,
  add column if not exists stripe_connect_updated_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_stripe_connect_status_check;

alter table public.profiles
  add constraint profiles_stripe_connect_status_check
  check (stripe_connect_status in ('not_started', 'onboarding', 'restricted', 'ready'));

create unique index if not exists profiles_stripe_connected_account_id_unique
  on public.profiles (stripe_connected_account_id)
  where stripe_connected_account_id is not null;

comment on column public.profiles.stripe_connected_account_id is
  'Stripe Connect Express account id. Rentulo currently creates Czech accounts only.';
comment on column public.profiles.stripe_connect_status is
  'Safe application status derived server-side from the Stripe connected account.';
comment on column public.profiles.stripe_connect_details_submitted is
  'Server-synchronized Stripe details_submitted flag.';
comment on column public.profiles.stripe_connect_transfers_enabled is
  'True when the Stripe transfers capability is active.';
comment on column public.profiles.stripe_connect_updated_at is
  'Last time Rentulo synchronized the connected-account status from Stripe.';

create or replace function public.protect_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.id is distinct from old.id
     or new.is_verified is distinct from old.is_verified
     or new.created_at is distinct from old.created_at then
    raise exception 'Protected profile fields cannot be changed';
  end if;

  if auth.role() <> 'service_role'
     and (
       new.stripe_connected_account_id is distinct from old.stripe_connected_account_id
       or new.stripe_connect_status is distinct from old.stripe_connect_status
       or new.stripe_connect_details_submitted is distinct from old.stripe_connect_details_submitted
       or new.stripe_connect_transfers_enabled is distinct from old.stripe_connect_transfers_enabled
       or new.stripe_connect_updated_at is distinct from old.stripe_connect_updated_at
     ) then
    raise exception 'Stripe Connect profile fields can only be changed by the trusted backend';
  end if;

  return new;
end;
$function$;

drop trigger if exists protect_profile_before_update
on public.profiles;

create trigger protect_profile_before_update
before update on public.profiles
for each row
execute function public.protect_profile_update();

commit;
