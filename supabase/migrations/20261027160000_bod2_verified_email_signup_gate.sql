-- Rentulo V1 / launch point 2: keep verified Auth email authoritative and
-- require the existing server-recorded signup declarations for NEW accounts.
-- Historical accounts are not reclassified or blocked by this migration.
begin;

-- Do not turn on the gate without the existing append-only Auth signup audit.
-- An incomplete database rollout must fail before any policies change.
do $preflight$
begin
  if to_regclass('public.gdpr_terms_acceptances') is null
     or not exists (
       select 1
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'auth'
         and c.relname = 'users'
         and t.tgname = 'trg_gdpr_capture_signup_terms'
         and t.tgenabled in ('O', 'A')
     ) then
    raise exception 'Server-side signup audit must be active before BOD 2';
  end if;
end;
$preflight$;

-- A browser may update profiles directly, but must never use that route to
-- redirect notifications to an unconfirmed email. Auth's existing email-change
-- trigger remains authoritative. Deactivation may intentionally clear the email.
create or replace function public.protect_verified_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.email is distinct from old.email
     and new.account_status = 'active'
     and not exists (
       select 1
       from auth.users u
       where u.id = new.id
         and u.email_confirmed_at is not null
         and lower(btrim(u.email)) = lower(btrim(new.email))
     ) then
    raise exception 'Profile email must match the confirmed Auth email'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

drop trigger if exists protect_verified_profile_email_before_update on public.profiles;
create trigger protect_verified_profile_email_before_update
before update of email on public.profiles
for each row execute function public.protect_verified_profile_email();

revoke all on function public.protect_verified_profile_email()
  from public, anon, authenticated;

-- Mark ONLY auth users created after this migration. Pre-existing users keep
-- their current abilities even if their historical consent audit is absent.
-- The marker is server-only and cannot be forged or removed by the browser.
create table if not exists public.v1_signup_acceptance_required (
  user_id uuid primary key references auth.users(id) on delete cascade,
  marked_at timestamptz not null default clock_timestamp()
);

alter table public.v1_signup_acceptance_required enable row level security;
revoke all on table public.v1_signup_acceptance_required
  from public, anon, authenticated, service_role;

create or replace function public.mark_new_v1_signup_acceptance_required()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.v1_signup_acceptance_required (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$function$;

drop trigger if exists trg_mark_new_v1_signup_acceptance_required on auth.users;
create trigger trg_mark_new_v1_signup_acceptance_required
after insert on auth.users
for each row execute function public.mark_new_v1_signup_acceptance_required();

revoke all on function public.mark_new_v1_signup_acceptance_required()
  from public, anon, authenticated;

-- gdpr_terms_acceptances is append-only, server-created on auth.users INSERT,
-- and is inserted only when the three required signup declarations are true
-- and the document versions match. Editing Auth metadata after signup cannot
-- create this audit record. Do not use editable user metadata as proof here.
create or replace function public.has_v1_signup_acceptance()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null and (
    not exists (
      select 1 from public.v1_signup_acceptance_required r
      where r.user_id = auth.uid()
    )
    or exists (
      select 1 from public.gdpr_terms_acceptances a
      where a.user_id = auth.uid()
        and a.source = 'auth_signup'
    )
  );
$function$;

revoke all on function public.has_v1_signup_acceptance()
  from public, anon, authenticated;
grant execute on function public.has_v1_signup_acceptance()
  to authenticated;

-- Preserve every existing active-account / ownership / booking condition.
-- Add the acceptance check only to marketplace writes; profile corrections,
-- password changes, email confirmation and account deactivation are unchanged.
alter policy offers_insert_own on public.offers
  with check (
    owner_id = auth.uid()
    and public.is_current_account_active()
    and public.has_v1_signup_acceptance()
  );

alter policy offers_update_own on public.offers
  using (
    owner_id = auth.uid()
    and public.is_current_account_active()
    and public.has_v1_signup_acceptance()
  )
  with check (
    owner_id = auth.uid()
    and public.is_current_account_active()
    and public.has_v1_signup_acceptance()
  );

alter policy reservations_insert_as_renter on public.reservations
  with check (
    renter_id = auth.uid()
    and public.is_current_account_active()
    and public.has_v1_signup_acceptance()
    and public.can_create_reservation(offer_id, owner_id, renter_id)
  );

notify pgrst, 'reload schema';
commit;
