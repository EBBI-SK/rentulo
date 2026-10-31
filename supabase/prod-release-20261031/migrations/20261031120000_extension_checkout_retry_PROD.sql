-- RENTULO / BOD 4 / isolated PROD SQL / 2026-10-31.
-- Stage ONLY. Do NOT run in TEST; do NOT run as an automatic supabase db push.
-- Based on TEST PR #94 + #95 (migrations 20261030150000 and 20261030153000).
-- Run only AFTER explicit PROD approval, backup, and migration-history review,
-- alongside a separately approved LIVE Edge Functions rollout.
-- No Stripe charge, payout, cron, reservation payment, or existing data is
-- changed by applying this SQL. Existing supporting functions are untouched.
-- FAIL CLOSED: no live/ongoing checkout attempt may exist at migration time.
-- Security: service_role-only attempt RPCs/table; accept LIVE session IDs only.
BEGIN;

DO $rentulo_bod4_prod_guard$
DECLARE
  v_claim_definition text;
  v_expiry_definition text;
BEGIN
  -- Must be the designated Rentulo production Supabase project.
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name = 'rentulo_prod_release_target'
      AND btrim(s.decrypted_secret, '/') = 'tfvgxrdjrpicgtvovehl'
  ) THEN
    RAISE EXCEPTION 'STOP: BOD 4 PROD migration requires verified target project';
  END IF;
  -- Runtime URL may still be intentionally unconfigured before LIVE go-live.
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name = 'rentulo_project_url'
      AND btrim(s.decrypted_secret, '/') IN
        ('UNCONFIGURED', 'https://tfvgxrdjrpicgtvovehl.supabase.co')
  ) THEN
    RAISE EXCEPTION 'STOP: BOD 4 PROD migration found an unexpected runtime URL';
  END IF;

  -- One-time migration: existing objects mean manual reconciliation is needed.
  IF to_regclass('public.reservation_extensions') IS NULL
     OR to_regclass('public.reservation_extension_checkout_attempts') IS NOT NULL
     OR to_regprocedure('public.prepare_reservation_extension_checkout_attempt(uuid,uuid,text,text)') IS NOT NULL
     OR to_regprocedure('public.record_reservation_extension_checkout_attempt(uuid,uuid,uuid,text,timestamptz)') IS NOT NULL
     OR to_regprocedure('public.fail_reservation_extension_checkout_attempt(uuid,uuid,uuid)') IS NOT NULL
     OR to_regprocedure('public.get_unrecorded_extension_checkout_recovery_candidates(integer)') IS NOT NULL
     OR to_regprocedure('public.flag_unrecorded_extension_checkout_for_review(uuid,uuid)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'STOP: unexpected or partially installed BOD 4 objects';
  END IF;

  -- Baseline extension and payout logic must already exist; never recreate it.
  IF to_regprocedure('public.claim_reservation_extension_checkout(uuid,uuid,text)') IS NULL
     OR to_regprocedure('public.expire_reservation_extension_checkout(uuid,text)') IS NULL
     OR to_regprocedure('public.get_expired_reservation_extension_checkouts(integer)') IS NULL
     OR to_regprocedure('public.expire_unstarted_reservation_extensions(integer)') IS NULL
     OR to_regprocedure('public.get_due_reservation_extension_transfers(integer)') IS NULL
     OR to_regprocedure('public.reservation_extension_has_conflict(uuid,date)') IS NULL
  THEN
    RAISE EXCEPTION 'STOP: baseline PROD extension functions are missing';
  END IF;

  -- Do not modify functions while there may be an ongoing Stripe checkout.
  IF EXISTS (
    SELECT 1 FROM public.reservation_extensions
    WHERE checkout_started_at IS NOT NULL
      OR stripe_checkout_session_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'STOP: active or historic checkout references require reconciliation first';
  END IF;

  -- We update ONLY the known old versions. Unexpected drift is a hard stop.
  v_claim_definition := pg_get_functiondef(
    'public.claim_reservation_extension_checkout(uuid,uuid,text)'::regprocedure
  );
  v_expiry_definition := pg_get_functiondef(
    'public.expire_reservation_extension_checkout(uuid,text)'::regprocedure
  );
  IF position('23 hours' in v_claim_definition) = 0
     OR position('reservation_extension_has_conflict' in v_claim_definition) = 0
     OR position('service_role' in v_claim_definition) = 0
     OR position('stripe_checkout_session_id' in v_expiry_definition) = 0
     OR position('status=''expired''' in v_expiry_definition) = 0
  THEN
    RAISE EXCEPTION 'STOP: baseline checkout functions differ from reviewed PROD';
  END IF;
END;
$rentulo_bod4_prod_guard$;

-- A. Add the missing attempt ledger/RPCs and update ONLY claim + expiry.
-- Each attempt owns an immutable Stripe request snapshot and idempotency key.
-- Never rotate an ambiguous attempt: it may already exist at Stripe even if
-- the HTTPS response or the database write was lost.
create table public.reservation_extension_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  extension_id uuid not null references public.reservation_extensions(id),
  state text not null default 'creating'
    check (state in ('creating','created','expired','failed_not_created')),
  locale text not null check (locale in ('cs','sk','en','de','pl')),
  offer_name text not null,
  customer_email text,
  checkout_expires_at timestamptz not null,
  stripe_checkout_session_id text unique,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (stripe_checkout_session_id is null or state in ('created','expired'))
);
create unique index reservation_extension_one_active_checkout_attempt
  on public.reservation_extension_checkout_attempts(extension_id)
  where state in ('creating','created');
create index reservation_extension_checkout_attempt_history
  on public.reservation_extension_checkout_attempts(extension_id,created_at,id);
alter table public.reservation_extension_checkout_attempts enable row level security;
revoke all on public.reservation_extension_checkout_attempts from public, anon, authenticated;
grant all on public.reservation_extension_checkout_attempts to service_role;

-- Keep the original authorization/availability lock but do not reject an
-- existing attempt solely because its first start time is 23 hours old.
create or replace function public.claim_reservation_extension_checkout(
  p_extension_id uuid,p_renter_id uuid,p_locale text
)
returns boolean language plpgsql volatile security definer set search_path = ''
as $fn$
declare v_e public.reservation_extensions%rowtype; v_r public.reservations%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Trusted backend required'; end if;
  select * into v_e from public.reservation_extensions where id=p_extension_id;
  if not found or v_e.renter_id<>p_renter_id then return false; end if;
  perform pg_advisory_xact_lock(hashtext(v_e.offer_id::text));
  select * into v_e from public.reservation_extensions where id=p_extension_id for update;
  select * into v_r from public.reservations where id=v_e.reservation_id for update;
  if v_e.status<>'approved' or v_r.status::text <> 'picked_up'
    or v_r.end_date<>v_e.previous_end_date
    or v_e.payment_deadline_at is null or v_e.payment_deadline_at<=clock_timestamp()
    or public.reservation_extension_has_conflict(v_r.id,v_e.new_end_date) then
    return false;
  end if;
  update public.reservation_extensions set
    checkout_started_at=coalesce(checkout_started_at,clock_timestamp()),
    stripe_checkout_locale=coalesce(stripe_checkout_locale,
      case when p_locale in ('cs','sk','en','de','pl') then p_locale else 'cs' end),
    updated_at=clock_timestamp()
  where id=v_e.id;
  return true;
end;
$fn$;
revoke all on function public.claim_reservation_extension_checkout(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.claim_reservation_extension_checkout(uuid,uuid,text) to service_role;

-- Executed under the extension row lock; concurrent clicks get the same
-- attempt id and EXACTLY the same Stripe request parameters.
create function public.prepare_reservation_extension_checkout_attempt(
  p_extension_id uuid,p_renter_id uuid,p_offer_name text,p_customer_email text
)
returns table (
  attempt_id uuid, checkout_expires_at timestamptz, locale text,
  offer_name text, customer_email text
)
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  v_e public.reservation_extensions%rowtype;
  v_r public.reservations%rowtype;
  v_a public.reservation_extension_checkout_attempts%rowtype;
  v_expiry timestamptz;
begin
  if auth.role()<>'service_role' then raise exception 'Trusted backend required'; end if;
  select * into v_e from public.reservation_extensions where id=p_extension_id for update;
  if not found or v_e.renter_id<>p_renter_id or v_e.status<>'approved'
    or v_e.checkout_started_at is null or v_e.stripe_checkout_session_id is not null
    or v_e.payment_deadline_at<=clock_timestamp() then return; end if;
  select * into v_r from public.reservations where id=v_e.reservation_id;
  if not found or v_r.status::text<>'picked_up' or v_r.end_date<>v_e.previous_end_date then return; end if;
  select * into v_a from public.reservation_extension_checkout_attempts a
    where a.extension_id=v_e.id and a.state in ('creating','created')
    order by a.created_at desc,a.id limit 1 for update;
  if not found then
    v_expiry := least(v_e.payment_deadline_at,clock_timestamp()+interval '23 hours');
    if v_expiry<clock_timestamp()+interval '31 minutes' then return; end if;
    insert into public.reservation_extension_checkout_attempts(
      extension_id,locale,offer_name,customer_email,checkout_expires_at
    ) values (
      v_e.id,coalesce(v_e.stripe_checkout_locale,'cs'),
      left(coalesce(nullif(btrim(p_offer_name),''),'Rentulo'),160),
      nullif(left(btrim(coalesce(p_customer_email,'')),254),''),v_expiry
    ) returning * into v_a;
  end if;
  return query select v_a.id,v_a.checkout_expires_at,v_a.locale,
    v_a.offer_name,v_a.customer_email;
end;
$fn$;
revoke all on function public.prepare_reservation_extension_checkout_attempt(uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.prepare_reservation_extension_checkout_attempt(uuid,uuid,text,text)
  to service_role;

-- Both records are written in ONE transaction. Retrying a lost response is
-- idempotent; a different attempt cannot replace a successful session.
-- Only a definite pre-execution Stripe validation rejection (HTTP 400
-- invalid_request_error, not idempotency_error) may abandon an uncreated
-- session. Unknown/network/500 responses must retain the attempt id.
create function public.fail_reservation_extension_checkout_attempt(
  p_extension_id uuid,p_renter_id uuid,p_attempt_id uuid
)
returns boolean language plpgsql volatile security definer set search_path = ''
as $fn$
declare v_e public.reservation_extensions%rowtype;
  v_a public.reservation_extension_checkout_attempts%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Trusted backend required'; end if;
  select * into v_e from public.reservation_extensions where id=p_extension_id for update;
  select * into v_a from public.reservation_extension_checkout_attempts where id=p_attempt_id for update;
  if v_e.id is null or v_e.renter_id<>p_renter_id or v_e.status<>'approved'
    or v_e.stripe_checkout_session_id is not null or v_a.id is null
    or v_a.extension_id<>v_e.id or v_a.state<>'creating'
    or v_a.stripe_checkout_session_id is not null then return false; end if;
  update public.reservation_extension_checkout_attempts
    set state='failed_not_created',updated_at=clock_timestamp() where id=v_a.id;
  update public.reservation_extensions
    set checkout_started_at=null,updated_at=clock_timestamp() where id=v_e.id;
  return true;
end;
$fn$;
revoke all on function public.fail_reservation_extension_checkout_attempt(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.fail_reservation_extension_checkout_attempt(uuid,uuid,uuid)
  to service_role;

-- Called ONLY after Stripe itself returns status=expired, payment_status=unpaid
-- for the exact previously persisted session, plus reservation/amount metadata.
-- Keep the approval if enough time remains to pay again; otherwise close it.
create or replace function public.expire_reservation_extension_checkout(
  p_extension_id uuid,p_session_id text
)
returns boolean language plpgsql volatile security definer set search_path = ''
as $fn$
declare v_e public.reservation_extensions%rowtype;
  v_r public.reservations%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Trusted backend required'; end if;
  select * into v_e from public.reservation_extensions where id=p_extension_id;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtext(v_e.offer_id::text));
  select * into v_e from public.reservation_extensions where id=p_extension_id for update;
  if v_e.status<>'approved' or v_e.stripe_checkout_session_id<>p_session_id then return false; end if;
  select * into v_r from public.reservations where id=v_e.reservation_id for update;
  update public.reservation_extension_checkout_attempts
    set state='expired',updated_at=clock_timestamp()
    where extension_id=v_e.id and stripe_checkout_session_id=p_session_id and state='created';
  if v_r.status::text='picked_up' and v_r.end_date=v_e.previous_end_date
    and v_e.payment_deadline_at>clock_timestamp()+interval '31 minutes'
    and not public.reservation_extension_has_conflict(v_r.id,v_e.new_end_date) then
    update public.reservation_extensions
      set checkout_started_at=null,stripe_checkout_session_id=null,
        stripe_checkout_expires_at=null,updated_at=clock_timestamp()
      where id=v_e.id;
    return true;
  end if;
  update public.reservation_extensions
    set status='expired',updated_at=clock_timestamp() where id=v_e.id;
  insert into public.notifications(user_id,type,title,message,related_reservation_id,related_offer_id)
    values(v_e.renter_id,'reservation_extension_expired','Prodloužení vypršelo',
      'Platba za prodloužení nebyla dokončena. Původní termín vrácení zůstává platný.',
      v_e.reservation_id,v_e.offer_id);
  return true;
end;
$fn$;
revoke all on function public.expire_reservation_extension_checkout(uuid,text)
  from public,anon,authenticated;
grant execute on function public.expire_reservation_extension_checkout(uuid,text) to service_role;

-- B. Add read-only lost-session recovery + operator-review functions.
-- Persist an explicit operator-review marker instead of silently expiring an
-- unverified payment. The original date hold remains until actual Stripe proof.
alter table public.reservation_extension_checkout_attempts
  add column if not exists recovery_review_required_at timestamptz;
create index if not exists reservation_extension_checkout_recovery_due
  on public.reservation_extension_checkout_attempts(created_at,id)
  where state='creating' and stripe_checkout_session_id is null
    and recovery_review_required_at is null;

-- Read-only candidate scan, only for the trusted internal PROD cron worker.
create function public.get_unrecorded_extension_checkout_recovery_candidates(
  p_limit integer default 5
)
returns table (
  attempt_id uuid, extension_id uuid, reservation_id uuid, renter_id uuid,
  attempt_created_at timestamptz, checkout_expires_at timestamptz,
  locale text, offer_name text, customer_email text,
  previous_end_date date, new_end_date date, amount_minor bigint
)
language sql stable security definer set search_path = ''
as $fn$
  select a.id,e.id,e.reservation_id,e.renter_id,a.created_at,a.checkout_expires_at,
         a.locale,a.offer_name,a.customer_email,
         e.previous_end_date,e.new_end_date,e.amount_total::bigint*100
  from public.reservation_extension_checkout_attempts a
  join public.reservation_extensions e on e.id=a.extension_id
  join public.reservations r on r.id=e.reservation_id
  where auth.role()='service_role' and p_limit between 1 and 50
    and a.state='creating' and a.stripe_checkout_session_id is null
    and a.recovery_review_required_at is null
    and a.created_at <= clock_timestamp()-interval '2 minutes'
    and e.status='approved' and e.stripe_checkout_session_id is null
    and e.checkout_started_at is not null
    and r.status::text='picked_up' and r.end_date=e.previous_end_date
  order by a.created_at,a.id limit least(p_limit,5);
$fn$;
revoke all on function public.get_unrecorded_extension_checkout_recovery_candidates(integer)
  from public,anon,authenticated;
grant execute on function public.get_unrecorded_extension_checkout_recovery_candidates(integer)
  to service_role;

-- Record POSITIVELY VERIFIED Stripe evidence even if the Session has already
-- expired. The old function rejected a late record, leaving a paid checkout
-- without its Session id and preventing subsequent webhook reconciliation.
create function public.record_reservation_extension_checkout_attempt(
  p_extension_id uuid,p_renter_id uuid,p_attempt_id uuid,
  p_session_id text,p_expires_at timestamptz
)
returns boolean language plpgsql volatile security definer set search_path = ''
as $fn$
declare v_e public.reservation_extensions%rowtype;
  v_a public.reservation_extension_checkout_attempts%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Trusted backend required'; end if;
  select * into v_e from public.reservation_extensions where id=p_extension_id for update;
  select * into v_a from public.reservation_extension_checkout_attempts where id=p_attempt_id for update;
  if v_e.id is null or v_e.renter_id<>p_renter_id or v_e.status<>'approved'
    or v_e.checkout_started_at is null or v_a.id is null
    or v_a.extension_id<>v_e.id or v_a.state not in ('creating','created')
    or v_a.checkout_expires_at<>p_expires_at
    or p_session_id !~ '^cs_live_[A-Za-z0-9]+$'
    or (v_a.stripe_checkout_session_id is not null and v_a.stripe_checkout_session_id<>p_session_id)
    or (v_e.stripe_checkout_session_id is not null and v_e.stripe_checkout_session_id<>p_session_id)
  then return false; end if;
  update public.reservation_extension_checkout_attempts
    set stripe_checkout_session_id=p_session_id,state='created',updated_at=clock_timestamp()
    where id=v_a.id;
  update public.reservation_extensions
    set stripe_checkout_session_id=p_session_id,stripe_checkout_expires_at=p_expires_at,
      updated_at=clock_timestamp()
    where id=v_e.id;
  return true;
end;
$fn$;
revoke all on function public.record_reservation_extension_checkout_attempt(uuid,uuid,uuid,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.record_reservation_extension_checkout_attempt(uuid,uuid,uuid,text,timestamptz)
  to service_role;

-- This DOES NOT release the reservation or permit a new attempt. It records a
-- payment that cannot be proven absent and needs explicit operator review.
create function public.flag_unrecorded_extension_checkout_for_review(
  p_extension_id uuid,p_attempt_id uuid
)
returns boolean language plpgsql volatile security definer set search_path = ''
as $fn$
declare v_e public.reservation_extensions%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Trusted backend required'; end if;
  select * into v_e from public.reservation_extensions where id=p_extension_id for update;
  if not found or v_e.status<>'approved' or v_e.stripe_checkout_session_id is not null
    then return false; end if;
  update public.reservation_extension_checkout_attempts a
    set recovery_review_required_at=clock_timestamp(),updated_at=clock_timestamp()
    where a.id=p_attempt_id and a.extension_id=v_e.id and a.state='creating'
      and a.stripe_checkout_session_id is null
      and a.recovery_review_required_at is null
      and a.checkout_expires_at < clock_timestamp()-interval '5 minutes';
  return found;
end;
$fn$;
revoke all on function public.flag_unrecorded_extension_checkout_for_review(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.flag_unrecorded_extension_checkout_for_review(uuid,uuid)
  to service_role;
-- All changes are schema-only. Enabling LIVE checkout is a separate release.
COMMIT;
