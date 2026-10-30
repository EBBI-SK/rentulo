-- RENTULO / BOD 4 FOLLOW-UP: reconcile a lost Stripe Checkout response.
-- TEST ONLY. Apply AFTER 20261030150000_extension_checkout_retry_TEST.sql.
-- Missing Stripe evidence NEVER authorizes a second idempotency key or a payout.
begin;

do $test_project$
begin
  if not exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'rentulo_project_url'
      and btrim(s.decrypted_secret, '/') = 'https://vspposovhdgvbeukoivh.supabase.co'
  ) then
    raise exception 'BOD 4 missing-session recovery is TEST-only';
  end if;
end;
$test_project$;

-- Persist an explicit operator-review marker instead of silently expiring an
-- unverified payment. The original date hold remains until actual Stripe proof.
alter table public.reservation_extension_checkout_attempts
  add column if not exists recovery_review_required_at timestamptz;
create index if not exists reservation_extension_checkout_recovery_due
  on public.reservation_extension_checkout_attempts(created_at,id)
  where state='creating' and stripe_checkout_session_id is null
    and recovery_review_required_at is null;

-- Read-only candidate scan, only for the trusted internal TEST cron worker.
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
create or replace function public.record_reservation_extension_checkout_attempt(
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
    or p_session_id !~ '^cs_test_[A-Za-z0-9]+$'
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

commit;
