-- RENTULO V1 / PROD RELEASE CANDIDATE bd1b8d1 / 2026-10-24.
-- Apply only to a verified PROD database after backup and approval.
-- This SQL is staged separately: never copy over TEST migrations.
-- Cron activation is deferred; no automatic deployment is authorized.

-- BOD 02 / GDPR: remove direct profile data and non-financial offer details
-- when an account is safely deactivated. PROD first. Does not delete
-- reservations, payments, reviews, audit records or existing users.
-- Photo binaries are removed separately by the account-deactivation Edge Function
-- BEFORE Auth soft-delete, with safe retries if Storage is unavailable.
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


-- Defense in depth: this migration MUST NOT be executed on Supabase PROD.
-- Deployment of this PROD variant still requires separate operator approval.
do $prod_project$
begin
  if not exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'rentulo_prod_release_target'
      and btrim(s.decrypted_secret, '/') = 'tfvgxrdjrpicgtvovehl'
  ) then
    raise exception 'BOD02 GDPR account cleanup migration is PROD-only';
  end if;
end;
$prod_project$;

-- Active-account input validation remains identical. A deactivated profile is
-- allowed to have empty identifying fields rather than fake email/phone data.
alter table public.profiles drop constraint if exists profiles_full_name_length_check;
alter table public.profiles add constraint profiles_full_name_length_check
  check (account_status = 'deactivated' or char_length(trim(full_name)) between 1 and 120);
alter table public.profiles drop constraint if exists profiles_email_length_check;
alter table public.profiles add constraint profiles_email_length_check
  check (account_status = 'deactivated' or char_length(trim(email)) between 3 and 254);
alter table public.profiles drop constraint if exists profiles_phone_length_check;
alter table public.profiles add constraint profiles_phone_length_check
  check (account_status = 'deactivated' or char_length(trim(phone)) between 1 and 32);
alter table public.profiles drop constraint if exists profiles_street_length_check;
alter table public.profiles add constraint profiles_street_length_check
  check (account_status = 'deactivated' or char_length(trim(street)) between 1 and 160);
alter table public.profiles drop constraint if exists profiles_city_length_check;
alter table public.profiles add constraint profiles_city_length_check
  check (account_status = 'deactivated' or char_length(trim(city)) between 1 and 100);
alter table public.profiles drop constraint if exists profiles_postal_code_length_check;
alter table public.profiles add constraint profiles_postal_code_length_check
  check (account_status = 'deactivated' or char_length(trim(postal_code)) between 1 and 20);

-- The older Stripe Connect migration replaced protect_profile_update and
-- dropped its original account-lifecycle checks. Restore that protection
-- while retaining every existing Stripe Connect safety check.
create or replace function public.protect_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.id is distinct from old.id
     or new.is_verified is distinct from old.is_verified
     or new.created_at is distinct from old.created_at then
    raise exception 'Protected profile fields cannot be changed';
  end if;

  if coalesce(auth.role(), '') <> 'service_role' and session_user <> 'postgres' then
    if new.account_status is distinct from old.account_status
       or new.deactivation_requested_at is distinct from old.deactivation_requested_at
       or new.deactivated_at is distinct from old.deactivated_at
       or new.anonymized_at is distinct from old.anonymized_at then
      raise exception 'Account lifecycle fields can only be changed by the trusted backend';
    end if;
    if new.stripe_connected_account_id is distinct from old.stripe_connected_account_id
       or new.stripe_connect_status is distinct from old.stripe_connect_status
       or new.stripe_connect_details_submitted is distinct from old.stripe_connect_details_submitted
       or new.stripe_connect_transfers_enabled is distinct from old.stripe_connect_transfers_enabled
       or new.stripe_connect_updated_at is distinct from old.stripe_connect_updated_at then
      raise exception 'Stripe Connect profile fields can only be changed by the trusted backend';
    end if;
  end if;

  return new;
end;
$function$;
revoke all on function public.protect_profile_update()
  from public, anon, authenticated;
grant execute on function public.protect_profile_update() to service_role;

-- An Auth user soft-delete may change auth.users.email. Never copy a changed
-- Auth email back into a deactivated/anonymized profile.
create or replace function public.sync_profile_email_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.email is distinct from old.email
     and nullif(trim(coalesce(new.email, '')), '') is not null then
    update public.profiles p
    set email = lower(trim(new.email)), updated_at = now()
    where p.id = new.id and p.account_status = 'active';
  end if;
  return new;
end;
$function$;
revoke all on function public.sync_profile_email_from_auth()
  from public, anon, authenticated;
grant execute on function public.sync_profile_email_from_auth() to service_role;

-- Replace only the existing, service-role-only finalizer. Preserve its
-- signature, advisory lock and all financial/reservation blockers.
create or replace function public.finalize_account_deactivation(target_user_id uuid)
returns table (
  account_status text,
  closed_offers_count bigint,
  deactivated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_status text;
  v_existing_deactivated_at timestamptz;
  v_blocking_count bigint := 0;
  v_open_debts bigint := 0;
  v_unfinished_refunds bigint := 0;
  v_unresolved_transfers bigint := 0;
  v_closed_offers_count bigint := 0;
  v_deactivated_at timestamptz;
begin
  if target_user_id is null then
    raise exception 'Target user is required' using errcode = '22023';
  end if;

  -- Same serialization lock as reservation creation and the old finalizer.
  perform pg_advisory_xact_lock(860808, hashtext(target_user_id::text));

  select p.account_status, p.deactivated_at
  into v_account_status, v_existing_deactivated_at
  from public.profiles p
  where p.id = target_user_id
  for update;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if v_account_status not in ('active', 'deactivated') then
    raise exception 'Account is not active' using errcode = 'P0001';
  end if;

  -- A retry of a partially completed deactivation must not be blocked by
  -- a previous status change. The first (active) transition keeps ALL guards.
  if v_account_status = 'active' then
    select count(*) into v_blocking_count
    from public.reservations r
    where (r.owner_id = target_user_id or r.renter_id = target_user_id)
      and r.status in (
        'pending'::public.reservation_status,
        'approved'::public.reservation_status,
        'paid'::public.reservation_status,
        'picked_up'::public.reservation_status
      );

    if v_blocking_count > 0 then
      raise exception 'Account has active reservations'
        using errcode = 'P0001',
          detail = 'blocking_reservations=' || v_blocking_count::text;
    end if;

    select count(*) into v_open_debts
    from public.owner_cancellation_debts d
    where d.owner_id = target_user_id and d.status = 'open';

    select count(*) into v_unfinished_refunds
    from public.reservation_cancellations c
    join public.reservations r on r.id = c.reservation_id
    join public.payments p on p.id = c.payment_id
    where c.cancellation_kind = 'paid_refund'
      and (r.owner_id = target_user_id or r.renter_id = target_user_id)
      and (c.financials_finalized_at is null
        or p.refund_status is distinct from 'succeeded');

    select count(*) into v_unresolved_transfers
    from public.payments p
    join public.reservations r on r.id = p.reservation_id
    where p.owner_id = target_user_id
      and r.status in (
        'picked_up'::public.reservation_status,
        'returned'::public.reservation_status
      )
      and p.provider = 'stripe'
      and p.status = 'paid'
      and p.refund_status = 'not_requested'
      and p.transfer_status is distinct from 'succeeded';

    if v_open_debts > 0 or v_unfinished_refunds > 0 or v_unresolved_transfers > 0 then
      raise exception 'Account has unresolved financial obligations'
        using errcode = 'P0001',
          detail = format(
            'open_debts=%s, unfinished_refunds=%s, unresolved_transfers=%s',
            v_open_debts, v_unfinished_refunds, v_unresolved_transfers
          );
    end if;
  end if;

  -- Keep offer IDs, prices and relations for historic reservations/reviews,
  -- but remove user-entered details, exact location, contacts and public URLs.
  select count(*) into v_closed_offers_count
  from public.offers o
  where o.owner_id = target_user_id
    and o.status <> 'deleted'::public.offer_status;

  update public.offers o
  set status = 'deleted'::public.offer_status,
      name = 'Odstranena nabidka',
      category = 'Ostatní',
      description = '',
      city = '',
      postal_code = '',
      photo_url = null,
      pickup_mode = 'profile',
      pickup_street = '',
      pickup_city = '',
      pickup_postal_code = '',
      pickup_note = '',
      pickup_phone = '',
      pickup_latitude = null,
      pickup_longitude = null,
      updated_at = now()
  where o.owner_id = target_user_id;

  v_deactivated_at := coalesce(v_existing_deactivated_at, now());

  -- Direct PII disappears from the profile. User UUID, Stripe Connect account
  -- reference and transaction snapshots are retained as separately governed
  -- pseudonymous/legal records (NOT equivalent to full GDPR erasure).
  update public.profiles p
  set account_status = 'deactivated',
      full_name = '',
      email = '',
      phone = '',
      street = '',
      city = '',
      postal_code = '',
      sms_notifications = false,
      deactivation_requested_at = coalesce(p.deactivation_requested_at, v_deactivated_at),
      deactivated_at = v_deactivated_at,
      anonymized_at = coalesce(p.anonymized_at, now()),
      updated_at = now()
  where p.id = target_user_id;

  return query
  select 'deactivated'::text, v_closed_offers_count, v_deactivated_at;
end;
$function$;

revoke all on function public.finalize_account_deactivation(uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_account_deactivation(uuid)
  to service_role;

comment on column public.profiles.anonymized_at is
  'Time when direct profile identifiers were cleared. Historic reservations, payment snapshots and provider identifiers may remain pseudonymously linkable under separate retention/legal rules.';
comment on function public.finalize_account_deactivation(uuid) is
  'Service-role-only, guarded deactivation: hides and sanitizes offers, clears direct profile fields, and preserves required historic/financial records. Idempotent for retries; photo binaries handled by Edge Function before Auth soft-delete.';

commit;
