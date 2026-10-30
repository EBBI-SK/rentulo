-- RENTULO / BOD 4: recover Stripe extension checkouts without duplicate charges.
-- TEST ONLY. This changes no completed extension payment or original reservation payment.
begin;

do $test_project$
begin
  if not exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'rentulo_project_url'
      and btrim(s.decrypted_secret, '/') = 'https://vspposovhdgvbeukoivh.supabase.co'
  ) then
    raise exception 'BOD 4 checkout retry migration is TEST-only';
  end if;
end;
$test_project$;

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
    or p_expires_at<=clock_timestamp()
    or p_session_id !~ '^cs_(test_|live_)[A-Za-z0-9]+$'
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

commit;
