-- RENTULO V1 / BOD 1 / RESERVATION EXTENSION -- TEST ONLY.
-- Apply to TEST Supabase before deploying the web files and Edge Functions.
-- The original payments row and its Stripe transfer remain financially immutable.
begin;

do $test_project$
begin
  if not exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'rentulo_project_url'
      and btrim(s.decrypted_secret, '/') = 'https://vspposovhdgvbeukoivh.supabase.co'
  ) then
    raise exception 'Reservation extensions migration is TEST-only';
  end if;
end;
$test_project$;

create table public.reservation_extensions (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id),
  offer_id uuid not null references public.offers(id),
  renter_id uuid not null references public.profiles(id),
  owner_id uuid not null references public.profiles(id),
  previous_end_date date not null,
  new_end_date date not null,
  additional_days integer not null check (additional_days > 0),
  price_per_day integer not null check (price_per_day > 0),
  amount_total integer not null check (amount_total > 0),
  platform_fee_amount integer not null check (platform_fee_amount >= 0),
  owner_payout integer not null check (owner_payout >= 0),
  currency text not null default 'czk' check (currency = 'czk'),
  status text not null default 'pending' check (status in ('pending','approved','paid','rejected','expired')),
  approval_deadline_at timestamptz not null,
  payment_deadline_at timestamptz,
  approved_at timestamptz,
  paid_at timestamptz,
  checkout_started_at timestamptz,
  stripe_checkout_locale text,
  stripe_checkout_session_id text unique,
  stripe_checkout_expires_at timestamptz,
  stripe_payment_intent_id text unique,
  stripe_charge_id text unique,
  stripe_transfer_id text unique,
  stripe_transfer_amount_minor integer,
  stripe_transfer_currency text,
  transfer_status text not null default 'not_created'
    check (transfer_status in ('not_created','pending','failed','succeeded')),
  transfer_attempt_count integer not null default 0 check (transfer_attempt_count >= 0),
  transfer_last_attempt_at timestamptz,
  transfer_next_retry_at timestamptz,
  transfer_last_error text,
  transfer_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (new_end_date > previous_end_date),
  check (amount_total = platform_fee_amount + owner_payout),
  check (new_end_date - previous_end_date = additional_days),
  check (amount_total = additional_days * price_per_day)
);

-- One active request per reservation, but retain all completed/rejected attempts.
create unique index reservation_extensions_one_active
  on public.reservation_extensions (reservation_id)
  where status in ('pending','approved');
create index reservation_extensions_due_transfer on public.reservation_extensions
  (transfer_next_retry_at, paid_at)
  where status = 'paid' and transfer_status in ('not_created','failed','pending');
create index reservation_extensions_offer_active on public.reservation_extensions (offer_id, new_end_date)
  where status in ('pending','approved');

alter table public.reservation_extensions enable row level security;
revoke all on public.reservation_extensions from public, anon, authenticated;
grant select on public.reservation_extensions to authenticated;
grant all on public.reservation_extensions to service_role;
create policy reservation_extensions_participant_read on public.reservation_extensions
  for select to authenticated
  using (renter_id = auth.uid() or owner_id = auth.uid());

-- Do not expose protected payment metadata to the browser; the RPC returns a
-- whitelist of request information. Revoke table SELECT after creating it.
revoke select on public.reservation_extensions from authenticated;
drop policy reservation_extensions_participant_read on public.reservation_extensions;

create or replace function public.get_my_reservation_extensions()
returns table (
  id uuid, reservation_id uuid, previous_end_date date, new_end_date date,
  additional_days integer, amount_total integer, platform_fee_amount integer,
  owner_payout integer, status text, approval_deadline_at timestamptz,
  payment_deadline_at timestamptz, paid_at timestamptz,
  transfer_status text
)
language sql stable security definer set search_path = ''
as $fn$
  select e.id, e.reservation_id, e.previous_end_date, e.new_end_date,
    e.additional_days, e.amount_total, e.platform_fee_amount,
    e.owner_payout, e.status, e.approval_deadline_at,
    e.payment_deadline_at, e.paid_at, e.transfer_status
  from public.reservation_extensions e
  where auth.uid() is not null
    and (e.renter_id = auth.uid() or e.owner_id = auth.uid())
  order by e.created_at, e.id;
$fn$;
revoke all on function public.get_my_reservation_extensions() from public, anon;
grant execute on function public.get_my_reservation_extensions() to authenticated;

-- Same offer-scoped advisory lock as prepare_reservation_insert(). Test-only
-- bookings already use this lock, so creating requests cannot race a booking.
create or replace function public.reservation_extension_has_conflict(
  p_reservation_id uuid, p_end_date date
)
returns boolean language plpgsql volatile security definer set search_path = ''
as $fn$
declare v_r public.reservations%rowtype;
begin
  select * into v_r from public.reservations where id = p_reservation_id;
  if not found or v_r.pickup_time is null or p_end_date <= v_r.end_date then
    return true;
  end if;
  return exists (
    select 1 from public.reservations other
    where other.offer_id = v_r.offer_id
      and other.id <> v_r.id
      and other.status::text in ('pending','approved','paid','picked_up','returned')
      and (
        (other.pickup_time is not null
          and ((v_r.start_date + v_r.pickup_time) at time zone 'Europe/Prague')
            < (
              case when other.status::text='returned' and other.gdpr_finalized_at is not null
                then other.gdpr_finalized_at
                else ((other.end_date + other.pickup_time) at time zone 'Europe/Prague')
              end
            ) + interval '2 hours'
          and ((p_end_date + v_r.pickup_time) at time zone 'Europe/Prague') + interval '2 hours'
            > ((other.start_date + other.pickup_time) at time zone 'Europe/Prague'))
        or (other.pickup_time is null
          and v_r.start_date <= other.end_date and p_end_date >= other.start_date)
      )
  ) or exists (
    select 1 from public.reservation_extensions e
    join public.reservations r on r.id = e.reservation_id
    where e.offer_id = v_r.offer_id and e.reservation_id <> v_r.id
      and e.status in ('pending','approved')
      and (e.checkout_started_at is not null or
           (case when e.status='pending' then e.approval_deadline_at else e.payment_deadline_at end) > clock_timestamp())
      and ((v_r.start_date + v_r.pickup_time) at time zone 'Europe/Prague')
            < ((e.new_end_date + r.pickup_time) at time zone 'Europe/Prague') + interval '2 hours'
      and ((p_end_date + v_r.pickup_time) at time zone 'Europe/Prague') + interval '2 hours'
            > ((r.start_date + r.pickup_time) at time zone 'Europe/Prague')
  );
end;
$fn$;
revoke all on function public.reservation_extension_has_conflict(uuid,date)
  from public, anon, authenticated;
grant execute on function public.reservation_extension_has_conflict(uuid,date) to service_role;

-- Incoming bookings must also respect pending/approved extension requests.
-- A started Stripe Checkout retains its hold until it is reconciled; a paid
-- extension is covered by the committed reservations.end_date directly.
create or replace function public.has_offer_reservation_time_conflict(
  p_offer_id uuid, p_start_date date, p_end_date date,
  p_pickup_time time without time zone
)
returns boolean language sql volatile security definer set search_path = ''
as $fn$
  select case
    when p_offer_id is null or p_start_date is null or p_end_date is null
      or p_end_date <= p_start_date or p_pickup_time is null
    then true
    else exists (
      select 1 from public.reservations r
      where r.offer_id = p_offer_id
        and r.status::text in ('pending','approved','paid','picked_up','returned')
        and ((r.pickup_time is not null
          and ((p_start_date + p_pickup_time) at time zone 'Europe/Prague')
            < (
              case when r.status::text='returned' and r.gdpr_finalized_at is not null
                then r.gdpr_finalized_at
                else ((r.end_date + r.pickup_time) at time zone 'Europe/Prague')
              end
            ) + interval '2 hours'
          and ((p_end_date + p_pickup_time) at time zone 'Europe/Prague') + interval '2 hours'
            > ((r.start_date + r.pickup_time) at time zone 'Europe/Prague'))
          or (r.pickup_time is null and p_start_date <= r.end_date and p_end_date >= r.start_date))
    ) or exists (
      select 1 from public.reservation_extensions e
      join public.reservations r on r.id = e.reservation_id
      where e.offer_id = p_offer_id and e.status in ('pending','approved')
        and (e.checkout_started_at is not null or
          (case when e.status='pending' then e.approval_deadline_at else e.payment_deadline_at end) > clock_timestamp())
        and r.pickup_time is not null
        and ((p_start_date + p_pickup_time) at time zone 'Europe/Prague')
          < ((e.new_end_date + r.pickup_time) at time zone 'Europe/Prague') + interval '2 hours'
        and ((p_end_date + p_pickup_time) at time zone 'Europe/Prague') + interval '2 hours'
          > ((r.start_date + r.pickup_time) at time zone 'Europe/Prague')
    )
  end;
$fn$;
revoke all on function public.has_offer_reservation_time_conflict(
  uuid,date,date,time without time zone) from public, anon, authenticated;
grant execute on function public.has_offer_reservation_time_conflict(
  uuid,date,date,time without time zone) to anon, authenticated, service_role;

create or replace function public.request_reservation_extension(
  p_reservation_id uuid, p_new_end_date date
)
returns uuid language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  v_r public.reservations%rowtype;
  v_base public.payments%rowtype;
  v_extra_total bigint;
  v_extra_fee bigint;
  v_existing_total bigint;
  v_existing_fee bigint;
  v_target_fee bigint;
  v_days integer;
  v_current_return timestamptz;
  v_id uuid;
begin
  if auth.uid() is null or p_reservation_id is null or p_new_end_date is null then
    raise exception 'Authentication and dates required';
  end if;
  select * into v_r from public.reservations where id = p_reservation_id;
  if not found or v_r.renter_id <> auth.uid() or v_r.status::text <> 'picked_up' then
    raise exception 'Only the renter may extend a handed-over reservation';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_r.offer_id::text));
  select * into v_r from public.reservations where id = p_reservation_id for update;
  v_current_return := (v_r.end_date + v_r.pickup_time) at time zone 'Europe/Prague';
  if v_r.status::text <> 'picked_up' or v_current_return <= clock_timestamp() + interval '45 minutes' then
    raise exception 'Reservation is too close to return or already closed';
  end if;
  if p_new_end_date <= v_r.end_date then
    raise exception 'New return date must be later';
  end if;
  -- An old unapproved/unpaid request may expire, but never expire an
  -- ambiguous Stripe attempt merely by a local clock.
  update public.reservation_extensions
    set status='expired', updated_at=clock_timestamp()
  where reservation_id=p_reservation_id and status in ('pending','approved')
    and checkout_started_at is null
    and (case when status='pending' then approval_deadline_at else payment_deadline_at end) <= clock_timestamp();
  if exists (select 1 from public.reservation_extensions e
    where e.reservation_id = p_reservation_id and e.status in ('pending','approved')) then
    raise exception 'There is already an open extension request';
  end if;
  select * into v_base from public.payments p
  where p.reservation_id=p_reservation_id and p.status='paid'
    and p.provider='stripe' and p.refund_status='not_requested';
  if not found or v_base.stripe_payment_intent_status <> 'succeeded'
    or v_base.stripe_charge_id is null then
    raise exception 'Original Stripe payment is not eligible';
  end if;
  if exists (select 1 from public.reservation_dispute_settlements d
    where d.reservation_id=p_reservation_id and d.settlement_route='renter_full_refund') then
    raise exception 'Unresolved financial dispute prevents extension';
  end if;
  if public.reservation_extension_has_conflict(p_reservation_id,p_new_end_date) then
    raise exception 'Selected new return date conflicts with another reservation';
  end if;
  v_days := p_new_end_date-v_r.end_date;
  v_extra_total := v_days::bigint * v_r.price_per_day::bigint;
  -- Stripe supports at most eight digits in minor currency units; CZK uses
  -- 100 haléřů, so amount_total cannot exceed 999999 CZK.
  if v_extra_total <= 0 or v_extra_total > 999999 then
    raise exception 'Invalid amount of the extension';
  end if;
  select coalesce(sum(e.amount_total),0),coalesce(sum(e.platform_fee_amount),0)
    into v_existing_total,v_existing_fee from public.reservation_extensions e
    where e.reservation_id=p_reservation_id and e.status='paid';
  -- Minimum 70 CZK is for the WHOLE reservation, only once. Historical fee
  -- snapshots remain unchanged, even if created before the minimum changed.
  v_target_fee := greatest(
    round((v_r.total_price::numeric + v_existing_total + v_extra_total)
      * v_r.platform_fee_percent::numeric / 100)::bigint, 70
  );
  v_extra_fee := greatest(0,v_target_fee-(v_r.platform_fee_amount+v_existing_fee));
  if v_extra_fee > v_extra_total then
    raise exception 'Extension would exceed the payable amount';
  end if;
  insert into public.reservation_extensions (
    reservation_id,offer_id,renter_id,owner_id,previous_end_date,new_end_date,
    additional_days,price_per_day,amount_total,platform_fee_amount,owner_payout,
    approval_deadline_at
  ) values (
    v_r.id,v_r.offer_id,v_r.renter_id,v_r.owner_id,v_r.end_date,p_new_end_date,
    v_days,v_r.price_per_day,v_extra_total::integer,v_extra_fee::integer,
    (v_extra_total-v_extra_fee)::integer,
    least(clock_timestamp() + interval '24 hours',v_current_return)
  ) returning id into v_id;
  insert into public.notifications(user_id,type,title,message,related_reservation_id,related_offer_id)
  values(v_r.owner_id,'reservation_extension_requested','Žádost o prodloužení pronájmu',
    'Nájemce žádá o prodloužení pronájmu do ' || to_char(p_new_end_date,'DD.MM.YYYY') || '.',v_r.id,v_r.offer_id);
  return v_id;
end;
$fn$;
revoke all on function public.request_reservation_extension(uuid,date) from public,anon;
grant execute on function public.request_reservation_extension(uuid,date) to authenticated;

create or replace function public.decide_reservation_extension(
  p_extension_id uuid, p_approve boolean
)
returns boolean language plpgsql volatile security definer set search_path = ''
as $fn$
declare v_e public.reservation_extensions%rowtype; v_r public.reservations%rowtype;
  v_return timestamptz;
begin
  if auth.uid() is null or p_extension_id is null or p_approve is null then
    raise exception 'Unauthorized or invalid decision';
  end if;
  select * into v_e from public.reservation_extensions where id=p_extension_id;
  if not found or v_e.owner_id<>auth.uid() then raise exception 'Only the owner may decide'; end if;
  perform pg_advisory_xact_lock(hashtext(v_e.offer_id::text));
  select * into v_e from public.reservation_extensions where id=p_extension_id for update;
  select * into v_r from public.reservations where id=v_e.reservation_id for update;
  v_return := (v_r.end_date + v_r.pickup_time) at time zone 'Europe/Prague';
  if v_e.status<>'pending' or v_e.approval_deadline_at<=clock_timestamp()
    or v_r.status::text <> 'picked_up'
    or v_r.end_date<>v_e.previous_end_date then
    raise exception 'Extension request is not eligible for a decision';
  end if;
  if p_approve then
    -- The same overdue-owner-debt restriction as ordinary reservation approval.
    if exists (select 1 from public.owner_cancellation_debts debt
      where debt.owner_id=auth.uid() and debt.status='open'
        and debt.due_at<=clock_timestamp()) then
      raise exception 'OWNER_OVERDUE_CANCELLATION_DEBT';
    end if;
    if v_return<=clock_timestamp()+interval '45 minutes'
      or public.reservation_extension_has_conflict(v_r.id,v_e.new_end_date) then
      raise exception 'Requested extension is unavailable';
    end if;
    update public.reservation_extensions set status='approved',approved_at=clock_timestamp(),
      payment_deadline_at=least(clock_timestamp()+interval '24 hours',v_return),
      updated_at=clock_timestamp() where id=v_e.id;
    insert into public.notifications(user_id,type,title,message,related_reservation_id,related_offer_id)
    values(v_e.renter_id,'reservation_extension_approved','Prodloužení schváleno',
      'Majitel schválil prodloužení. Zaplaťte doplatek ' || v_e.amount_total || ' Kč.',v_r.id,v_r.offer_id);
  else
    update public.reservation_extensions set status='rejected',updated_at=clock_timestamp()
    where id=v_e.id;
    insert into public.notifications(user_id,type,title,message,related_reservation_id,related_offer_id)
    values(v_e.renter_id,'reservation_extension_rejected','Prodloužení zamítnuto',
      'Majitel žádost o prodloužení pronájmu zamítl.',v_r.id,v_r.offer_id);
  end if;
  return true;
end;
$fn$;
revoke all on function public.decide_reservation_extension(uuid,boolean) from public,anon;
grant execute on function public.decide_reservation_extension(uuid,boolean) to authenticated;

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
    or (v_e.checkout_started_at is null and v_e.payment_deadline_at<=clock_timestamp()+interval '30 minutes')
    or (v_e.checkout_started_at is not null
        and v_e.checkout_started_at<clock_timestamp()-interval '23 hours')
    or public.reservation_extension_has_conflict(v_r.id,v_e.new_end_date) then
    return false;
  end if;
  update public.reservation_extensions set
    checkout_started_at=coalesce(checkout_started_at,clock_timestamp()),
    stripe_checkout_locale=coalesce(stripe_checkout_locale,
      case when p_locale in ('cs','sk','en','de','pl') then
        case p_locale when 'cs' then 'cs' when 'sk' then 'sk'
         when 'en' then 'en' when 'de' then 'de' else 'pl' end
      else 'cs' end),
    updated_at=clock_timestamp()
  where id=v_e.id;
  return true;
end;
$fn$;
revoke all on function public.claim_reservation_extension_checkout(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.claim_reservation_extension_checkout(uuid,uuid,text) to service_role;

create or replace function public.record_reservation_extension_checkout(
  p_extension_id uuid,p_renter_id uuid,p_session_id text,p_expires_at timestamptz
)
returns boolean language plpgsql volatile security definer set search_path = ''
as $fn$
declare v_e public.reservation_extensions%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Trusted backend required'; end if;
  select * into v_e from public.reservation_extensions where id=p_extension_id for update;
  if not found or v_e.renter_id<>p_renter_id or v_e.status<>'approved'
    or v_e.checkout_started_at is null or p_session_id !~ '^cs_(test_|live_)[A-Za-z0-9]+$'
    or p_expires_at <= clock_timestamp() then return false; end if;
  if v_e.stripe_checkout_session_id is not null
    and v_e.stripe_checkout_session_id<>p_session_id then return false; end if;
  update public.reservation_extensions set stripe_checkout_session_id=p_session_id,
    stripe_checkout_expires_at=p_expires_at,updated_at=clock_timestamp()
  where id=v_e.id;
  return true;
end;
$fn$;
revoke all on function public.record_reservation_extension_checkout(uuid,uuid,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.record_reservation_extension_checkout(uuid,uuid,text,timestamptz) to service_role;

-- Used only after a VERIFIED expired Stripe Checkout session, so an ambiguous
-- payment never releases its dates just because the browser clock advanced.
create or replace function public.expire_reservation_extension_checkout(
  p_extension_id uuid,p_session_id text
)
returns boolean language plpgsql volatile security definer set search_path = ''
as $fn$
declare v_e public.reservation_extensions%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Trusted backend required'; end if;
  select * into v_e from public.reservation_extensions where id=p_extension_id for update;
  if not found or v_e.status<>'approved' or v_e.stripe_checkout_session_id<>p_session_id then return false; end if;
  update public.reservation_extensions set status='expired',updated_at=clock_timestamp()
    where id=v_e.id;
  insert into public.notifications(user_id,type,title,message,related_reservation_id,related_offer_id)
    values(v_e.renter_id,'reservation_extension_expired','Prodloužení vypršelo',
      'Platba za prodloužení nebyla dokončena. Původní termín vrácení zůstává platný.',v_e.reservation_id,v_e.offer_id);
  return true;
end;
$fn$;
revoke all on function public.expire_reservation_extension_checkout(uuid,text) from public,anon,authenticated;
grant execute on function public.expire_reservation_extension_checkout(uuid,text) to service_role;

-- The existing 5-minute payout cron can reconcile abandoned extension checkouts
-- without changing the original cron schedule or issuing a second billing job.
create or replace function public.get_expired_reservation_extension_checkouts(p_limit integer default 10)
returns table(extension_id uuid, reservation_id uuid, session_id text, amount_minor integer)
language sql stable security definer set search_path = ''
as $fn$
  select e.id,e.reservation_id,e.stripe_checkout_session_id,e.amount_total*100
  from public.reservation_extensions e
  where auth.role()='service_role' and p_limit between 1 and 50
    and e.status='approved' and e.checkout_started_at is not null
    and e.stripe_checkout_session_id is not null
    and e.stripe_checkout_expires_at <= clock_timestamp() - interval '2 minutes'
  order by e.stripe_checkout_expires_at,e.id limit least(p_limit,50);
$fn$;
revoke all on function public.get_expired_reservation_extension_checkouts(integer)
  from public,anon,authenticated;
grant execute on function public.get_expired_reservation_extension_checkouts(integer) to service_role;

-- Automatically expire unanswered and unpaid requests whose Stripe checkout
-- never started. Otherwise a stale "approved" badge could remain indefinitely.
create or replace function public.expire_unstarted_reservation_extensions(p_limit integer default 10)
returns integer language plpgsql volatile security definer set search_path = ''
as $fn$
declare v_count integer;
begin
  if auth.role()<>'service_role' or p_limit not between 1 and 50 then
    raise exception 'Trusted extension expiry worker required';
  end if;
  with candidates as (
    select e.id from public.reservation_extensions e
    where e.status in ('pending','approved') and e.checkout_started_at is null
      and (case when e.status='pending' then e.approval_deadline_at
            else e.payment_deadline_at end) <= clock_timestamp()
    order by e.created_at,e.id
    for update skip locked
    limit p_limit
  ), expired as (
    update public.reservation_extensions e
      set status='expired',updated_at=clock_timestamp()
    from candidates c where e.id=c.id
    returning e.renter_id,e.offer_id,e.reservation_id
  ), queued as (
    insert into public.notifications(user_id,type,title,message,related_reservation_id,related_offer_id)
    select renter_id,'reservation_extension_expired','Prodloužení vypršelo',
      'Žádost o prodloužení nebyla včas vyřízena nebo zaplacena.',reservation_id,offer_id
    from expired returning id
  ) select count(*)::integer into v_count from queued;
  return v_count;
end;
$fn$;
revoke all on function public.expire_unstarted_reservation_extensions(integer)
  from public,anon,authenticated;
grant execute on function public.expire_unstarted_reservation_extensions(integer) to service_role;

-- The only function that can change a previously agreed return date is the
-- verified Stripe webhook finalizer. It holds the exact same offer lock as a
-- new booking and rechecks the two-hour buffer atomically with the update.
create or replace function public.complete_reservation_extension_payment(
  p_extension_id uuid,p_reservation_id uuid,p_payment_intent_id text,
  p_charge_id text,p_amount_minor integer,p_currency text
)
returns boolean language plpgsql volatile security definer set search_path = ''
as $fn$
declare v_e public.reservation_extensions%rowtype; v_r public.reservations%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Trusted webhook required'; end if;
  select * into v_e from public.reservation_extensions where id=p_extension_id;
  if not found or v_e.reservation_id<>p_reservation_id then raise exception 'Extension not found'; end if;
  perform pg_advisory_xact_lock(hashtext(v_e.offer_id::text));
  select * into v_e from public.reservation_extensions where id=p_extension_id for update;
  select * into v_r from public.reservations where id=p_reservation_id for update;
  if v_e.status='paid' then
    if v_e.stripe_payment_intent_id=p_payment_intent_id and v_e.stripe_charge_id=p_charge_id
      and p_amount_minor=v_e.amount_total*100 and p_currency='czk' then return true; end if;
    raise exception 'Different payment attempted for already paid extension';
  end if;
  if v_e.status<>'approved' or v_e.checkout_started_at is null
    or v_e.stripe_checkout_session_id is null
    or v_r.status::text <> 'picked_up' or v_r.end_date<>v_e.previous_end_date
    or p_payment_intent_id !~ '^pi_[A-Za-z0-9]+$'
    or p_charge_id !~ '^ch_[A-Za-z0-9]+$'
    or p_amount_minor<>v_e.amount_total*100 or p_currency<>'czk'
    or public.reservation_extension_has_conflict(v_r.id,v_e.new_end_date) then
    raise exception 'Extension payment failed contract, time or availability guard';
  end if;
  -- Keep all original booking days, total_days, prices, fees and payout fixed.
  -- The effective return date changes only after verified Stripe payment.
  -- Client totals/duration are derived from separately paid extension rows.
  -- The application marker must be checked by the existing immutable-fields trigger.
  perform set_config('app.reservation_extension_authorized','on',true);
  perform set_config('app.reservation_extension_id',v_e.id::text,true);
  update public.reservations set
    end_date=v_e.new_end_date,date_to=v_e.new_end_date,
    updated_at=clock_timestamp()
  where id=v_r.id;
  perform set_config('app.reservation_extension_authorized','',true);
  perform set_config('app.reservation_extension_id','',true);
  update public.reservation_extensions set status='paid',paid_at=clock_timestamp(),
    stripe_payment_intent_id=p_payment_intent_id,stripe_charge_id=p_charge_id,
    updated_at=clock_timestamp() where id=v_e.id;
  insert into public.notifications(user_id,type,title,message,related_reservation_id,related_offer_id)
  values(v_e.renter_id,'reservation_extension_paid','Prodloužení zaplaceno',
      'Nový termín vrácení: '||to_char(v_e.new_end_date,'DD.MM.YYYY')||'.',v_e.reservation_id,v_e.offer_id),
    (v_e.owner_id,'reservation_extension_paid','Pronájem byl prodloužen',
      'Doplatek '||v_e.amount_total||' Kč byl zaplacen. Nový termín vrácení: '
      ||to_char(v_e.new_end_date,'DD.MM.YYYY')||'.',v_e.reservation_id,v_e.offer_id);
  return true;
end;
$fn$;
revoke all on function public.complete_reservation_extension_payment(uuid,uuid,text,text,integer,text)
 from public,anon,authenticated;
grant execute on function public.complete_reservation_extension_payment(uuid,uuid,text,text,integer,text) to service_role;

-- Block return/no-show only while an extension Stripe payment can still settle
-- asynchronously. This avoids accepting money after the reservation is closed.
create or replace function public.block_return_during_extension_checkout()
returns trigger language plpgsql security definer set search_path = ''
as $fn$
begin
  if old.status::text = 'picked_up' and new.status::text in ('returned','no_show') then
    if exists (select 1 from public.reservation_extensions e
      where e.reservation_id=old.id and e.status='approved'
        and e.checkout_started_at is not null) then
      raise exception 'Extension checkout must be reconciled before closing the reservation';
    end if;
    -- If the item is already returned and no Stripe attempt started, the
    -- pending date request must not block other renters unnecessarily.
    with expired as (
      update public.reservation_extensions e
        set status='expired', updated_at=clock_timestamp()
      where e.reservation_id=old.id and e.status in ('pending','approved')
        and e.checkout_started_at is null
      returning e.renter_id,e.reservation_id,e.offer_id
    )
    insert into public.notifications(user_id,type,title,message,related_reservation_id,related_offer_id)
      select renter_id,'reservation_extension_expired','Prodloužení vypršelo',
        'Pronájem byl uzavřen před dokončením prodloužení.',reservation_id,offer_id
      from expired;
  end if;
  return new;
end;
$fn$;
revoke all on function public.block_return_during_extension_checkout() from public,anon,authenticated;
create trigger block_return_during_extension_checkout
  before update of status on public.reservations for each row
  execute function public.block_return_during_extension_checkout();

-- Transfer eligibility is independent of the original payment. The main
-- reservation transfer remains unchanged, and each paid extension produces
-- exactly one additional Stripe Connect transfer from its own charge.
create or replace function public.claim_reservation_extension_transfer(p_extension_id uuid)
returns table (
  extension_id uuid, reservation_id uuid, amount_total integer,
  owner_payout integer, stripe_charge_id text,
  stripe_payment_intent_id text, attempt_count integer
)
language plpgsql volatile security definer set search_path = ''
as $fn$
declare v_e public.reservation_extensions%rowtype;
  v_r public.reservations%rowtype; v_p public.payments%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role()<>'service_role' then raise exception 'Trusted payout worker required'; end if;
  select * into v_e from public.reservation_extensions where id=p_extension_id for update;
  if not found then return; end if;
  select * into v_r from public.reservations where id=v_e.reservation_id;
  select * into v_p from public.payments where reservation_id=v_e.reservation_id;
  if v_e.status<>'paid' or v_e.owner_payout <= 0
    or v_e.stripe_charge_id is null or v_e.stripe_payment_intent_id is null
    or v_e.stripe_transfer_id is not null
    or v_e.transfer_attempt_count >= 20
    or not (v_e.transfer_status='not_created'
        or (v_e.transfer_status='failed' and v_e.transfer_next_retry_at<=v_now)
        or (v_e.transfer_status='pending'
            and v_e.transfer_last_attempt_at<=v_now-interval '15 minutes'))
    or v_r.status::text not in ('returned','no_show')
    or v_r.owner_id<>v_e.owner_id or v_r.renter_id<>v_e.renter_id
    or v_p.status<>'paid' or v_p.transfer_status<>'succeeded'
    or v_p.refund_status<>'not_requested'
    or exists (select 1 from public.reservation_dispute_settlements d
      where d.reservation_id=v_e.reservation_id and d.settlement_route='renter_full_refund') then
    return;
  end if;
  update public.reservation_extensions set
    transfer_status='pending',transfer_attempt_count=transfer_attempt_count+1,
    transfer_last_attempt_at=v_now,transfer_next_retry_at=null,
    transfer_last_error=null,updated_at=v_now where id=v_e.id;
  return query select v_e.id,v_e.reservation_id,v_e.amount_total,v_e.owner_payout,
    v_e.stripe_charge_id,v_e.stripe_payment_intent_id,v_e.transfer_attempt_count+1;
end;
$fn$;
revoke all on function public.claim_reservation_extension_transfer(uuid) from public,anon,authenticated;
grant execute on function public.claim_reservation_extension_transfer(uuid) to service_role;

create or replace function public.finish_reservation_extension_transfer(
  p_extension_id uuid,p_attempt_count integer,p_stripe_transfer_id text,
  p_transfer_amount_minor integer,p_currency text
)
returns boolean language plpgsql volatile security definer set search_path = ''
as $fn$
declare v_e public.reservation_extensions%rowtype; v_r public.reservations%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Trusted payout worker required'; end if;
  select * into v_e from public.reservation_extensions where id=p_extension_id for update;
  select * into v_r from public.reservations where id=v_e.reservation_id;
  if v_e.status<>'paid' or v_e.transfer_status<>'pending'
    or v_e.transfer_attempt_count<>p_attempt_count or v_e.stripe_transfer_id is not null
    or v_r.status::text not in ('returned','no_show')
    or p_stripe_transfer_id !~ '^tr_[A-Za-z0-9]+$'
    or p_transfer_amount_minor <= 0 or p_transfer_amount_minor>v_e.owner_payout*100
    or p_currency !~ '^[a-z]{3}$' then return false; end if;
  update public.reservation_extensions set transfer_status='succeeded',
    stripe_transfer_id=p_stripe_transfer_id,stripe_transfer_amount_minor=p_transfer_amount_minor,
    stripe_transfer_currency=p_currency,transfer_created_at=clock_timestamp(),
    updated_at=clock_timestamp() where id=v_e.id;
  return true;
end;
$fn$;
revoke all on function public.finish_reservation_extension_transfer(uuid,integer,text,integer,text)
  from public,anon,authenticated;
grant execute on function public.finish_reservation_extension_transfer(uuid,integer,text,integer,text)
  to service_role;

create or replace function public.fail_reservation_extension_transfer(
  p_extension_id uuid,p_attempt_count integer,p_error text,p_retryable boolean
)
returns boolean language plpgsql volatile security definer set search_path = ''
as $fn$
begin
  if auth.role()<>'service_role' then raise exception 'Trusted payout worker required'; end if;
  update public.reservation_extensions set transfer_status='failed',
    transfer_next_retry_at=case when p_retryable and transfer_attempt_count<20
      then clock_timestamp()+interval '5 minutes' else null end,
    transfer_last_error=left(coalesce(p_error,'Unknown payout error'),500),
    updated_at=clock_timestamp()
  where id=p_extension_id and transfer_status='pending'
    and transfer_attempt_count=p_attempt_count and stripe_transfer_id is null;
  return found;
end;
$fn$;
revoke all on function public.fail_reservation_extension_transfer(uuid,integer,text,boolean)
  from public,anon,authenticated;
grant execute on function public.fail_reservation_extension_transfer(uuid,integer,text,boolean)
  to service_role;

create or replace function public.get_due_reservation_extension_transfers(p_limit integer default 10)
returns table(extension_id uuid, reservation_id uuid)
language sql stable security definer set search_path = ''
as $fn$
  select e.id,e.reservation_id from public.reservation_extensions e
    join public.reservations r on r.id=e.reservation_id
    join public.payments p on p.reservation_id=r.id
  where auth.role()='service_role' and p_limit between 1 and 50
    and e.status='paid' and e.owner_payout>0 and e.stripe_transfer_id is null
    and e.transfer_attempt_count<20 and r.status::text in ('returned','no_show')
    and p.status='paid' and p.transfer_status='succeeded' and p.refund_status='not_requested'
    and not exists (select 1 from public.reservation_dispute_settlements d
      where d.reservation_id=r.id and d.settlement_route='renter_full_refund')
    and (e.transfer_status='not_created'
      or (e.transfer_status='failed' and e.transfer_next_retry_at<=clock_timestamp())
      or (e.transfer_status='pending'
        and e.transfer_last_attempt_at<=clock_timestamp()-interval '15 minutes'))
  order by e.paid_at,e.id limit least(p_limit,50);
$fn$;
revoke all on function public.get_due_reservation_extension_transfers(integer)
  from public,anon,authenticated;
grant execute on function public.get_due_reservation_extension_transfers(integer) to service_role;

-- Preserve the latest GDPR scrub guards; allow ONLY webhook-authenticated return-date edits.
CREATE OR REPLACE FUNCTION public.protect_reservation_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_payment_update_authorized boolean;
  v_gdpr_contact_scrub_authorized boolean;
  v_owner_contact_scrub_authorized boolean;
  v_extension_change_authorized boolean;
BEGIN
  v_payment_update_authorized := coalesce((
    old.status = 'approved'
    AND new.status = 'paid'
    AND (
      current_setting('app.test_payment_authorized', true) = 'on'
      OR current_setting('app.payment_update_authorized', true) = 'on'
      -- Preserve the trusted Stripe webhook authorization from the 2026-10-23 fix.
      -- Never allow the Stripe session flag without service_role.
      OR (
        coalesce(auth.role(), '') = 'service_role'
        AND current_setting('app.stripe_payment_authorized', true) = 'on'
      )
    )
  ), false);

  v_gdpr_contact_scrub_authorized := (
    (coalesce(auth.role(), '') = 'service_role' OR session_user = 'postgres')
    AND coalesce(current_setting('app.gdpr_reservation_scrub_authorized', true), '') = 'on'
    AND coalesce(current_setting('app.gdpr_reservation_scrub_renter_id', true), '') = old.renter_id::text
    AND new.status IS NOT DISTINCT FROM old.status
    AND old.status::text IN ('cancelled', 'expired', 'rejected')
    AND new.renter_name IS NOT DISTINCT FROM ''
    AND new.renter_email IS NOT DISTINCT FROM ''
    AND new.renter_phone IS NOT DISTINCT FROM ''
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = old.renter_id AND p.account_status = 'deactivated'
    )
    AND EXISTS (
      SELECT 1 FROM public.gdpr_reservation_contact_cleanup_gate g
      WHERE g.singleton = true AND g.is_enabled = true
        AND g.approved_at IS NOT NULL
        AND length(btrim(coalesce(g.approval_reference, ''))) >= 8
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.payments pay WHERE pay.reservation_id = old.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.reservation_cancellations c
      WHERE c.reservation_id = old.id AND c.cancellation_kind = 'paid_refund'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.reservation_return_incidents i
      WHERE i.reservation_id = old.id
    )
    AND NOT public.gdpr_has_reservation_legal_hold(old.id)
  );

  -- Narrowly scrub operational owner/pickup snapshots. Owner name and all
  -- financial / booking fields stay immutable as contractual evidence.
  v_owner_contact_scrub_authorized := (
    (coalesce(auth.role(), '') = 'service_role' OR session_user='postgres')
    AND coalesce(current_setting('app.gdpr_owner_contact_scrub_authorized',true),'')='on'
    AND coalesce(current_setting('app.gdpr_owner_contact_scrub_reservation_id',true),'')=old.id::text
    AND new.status IS NOT DISTINCT FROM old.status
    AND new.owner_phone IS NOT DISTINCT FROM ''
    AND new.pickup_phone IS NOT DISTINCT FROM ''
    AND new.pickup_street IS NOT DISTINCT FROM ''
    AND new.pickup_postal_code IS NOT DISTINCT FROM ''
    AND new.pickup_full_address IS NOT DISTINCT FROM ''
    AND new.pickup_note IS NOT DISTINCT FROM ''
    AND new.pickup_latitude IS NULL AND new.pickup_longitude IS NULL
    AND (CASE
      WHEN old.status::text IN ('cancelled','rejected') THEN old.gdpr_closed_at
      WHEN old.status::text='expired' THEN old.expired_at
      WHEN old.status::text IN ('returned','no_show') THEN old.gdpr_finalized_at
      ELSE NULL::timestamptz END) <= now()-interval '90 days'
    AND NOT public.gdpr_has_reservation_legal_hold(old.id)
    AND NOT EXISTS (SELECT 1 FROM public.reservation_return_incidents i WHERE i.reservation_id=old.id)
    AND NOT EXISTS (SELECT 1 FROM public.reservation_cancellations c
      WHERE c.reservation_id=old.id AND c.cancellation_kind='paid_refund')
    AND NOT EXISTS (SELECT 1 FROM public.owner_cancellation_debts debt
      JOIN public.reservation_cancellations c ON c.id=debt.cancellation_id
      WHERE c.reservation_id=old.id AND debt.status='open')
    AND (
      (old.status::text IN ('cancelled','rejected','expired')
       AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.reservation_id=old.id))
      OR
      (old.status::text IN ('returned','no_show')
       AND EXISTS (SELECT 1 FROM public.payments p WHERE p.reservation_id=old.id
         AND p.status='paid' AND p.transfer_status='succeeded'
         AND p.refund_status='not_requested')
       AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.reservation_id=old.id
         AND (p.status<>'paid' OR p.transfer_status<>'succeeded'
              OR p.refund_status<>'not_requested')))
    )
    AND EXISTS (SELECT 1 FROM public.gdpr_reservation_owner_contact_cleanup_gate g
      WHERE g.singleton=true AND g.is_enabled=true AND g.approved_at IS NOT NULL
        AND char_length(btrim(coalesce(g.approval_reference,'')))>=12)
  );

  -- The webhook may update only the effective return dates. Original booking
  -- days and total_days stay immutable because of their legacy CHECK; paid
  -- extensions supply effective duration and combined totals to the UI.
  v_extension_change_authorized := (
    auth.role() = 'service_role'
    AND current_setting('app.reservation_extension_authorized', true) = 'on'
    AND old.status::text = 'picked_up'
    AND new.status IS NOT DISTINCT FROM old.status
    AND EXISTS (
      SELECT 1 FROM public.reservation_extensions e
      WHERE e.id::text = current_setting('app.reservation_extension_id',true)
        AND e.reservation_id = old.id AND e.status = 'approved'
        AND e.previous_end_date = old.end_date
        AND e.new_end_date = new.end_date
        AND e.new_end_date = new.date_to
        AND new.days IS NOT DISTINCT FROM old.days
        AND new.total_days IS NOT DISTINCT FROM old.total_days
    )
  );

  IF new.id IS DISTINCT FROM old.id
     OR new.offer_id IS DISTINCT FROM old.offer_id
     OR new.owner_id IS DISTINCT FROM old.owner_id
     OR new.renter_id IS DISTINCT FROM old.renter_id
     OR new.start_date IS DISTINCT FROM old.start_date
     OR (new.end_date IS DISTINCT FROM old.end_date
       AND NOT v_extension_change_authorized)
     OR new.pickup_time IS DISTINCT FROM old.pickup_time
     OR new.date_from IS DISTINCT FROM old.date_from
     OR (new.date_to IS DISTINCT FROM old.date_to
       AND NOT v_extension_change_authorized)
     OR (new.days IS DISTINCT FROM old.days
       AND NOT v_extension_change_authorized)
     OR new.price_per_day IS DISTINCT FROM old.price_per_day
     OR new.total_price IS DISTINCT FROM old.total_price
     OR new.platform_fee_percent IS DISTINCT FROM old.platform_fee_percent
     OR new.platform_fee_amount IS DISTINCT FROM old.platform_fee_amount
     OR new.owner_payout IS DISTINCT FROM old.owner_payout
     OR new.created_at IS DISTINCT FROM old.created_at
     OR new.offer_name IS DISTINCT FROM old.offer_name
     OR new.category IS DISTINCT FROM old.category
     OR new.city IS DISTINCT FROM old.city
     OR (new.total_days IS DISTINCT FROM old.total_days
       AND NOT v_extension_change_authorized)
     OR (
       new.renter_name IS DISTINCT FROM old.renter_name
       AND NOT v_gdpr_contact_scrub_authorized
     )
     OR (
       new.renter_email IS DISTINCT FROM old.renter_email
       AND NOT v_gdpr_contact_scrub_authorized
     )
     OR (
       new.renter_phone IS DISTINCT FROM old.renter_phone
       AND NOT v_gdpr_contact_scrub_authorized
     )
     OR new.owner_name IS DISTINCT FROM old.owner_name
     OR (new.owner_phone IS DISTINCT FROM old.owner_phone AND NOT v_owner_contact_scrub_authorized)
     OR (new.pickup_phone IS DISTINCT FROM old.pickup_phone AND NOT v_owner_contact_scrub_authorized)
     OR (new.pickup_street IS DISTINCT FROM old.pickup_street AND NOT v_owner_contact_scrub_authorized)
     OR new.pickup_city IS DISTINCT FROM old.pickup_city
     OR (new.pickup_postal_code IS DISTINCT FROM old.pickup_postal_code AND NOT v_owner_contact_scrub_authorized)
     OR (new.pickup_full_address IS DISTINCT FROM old.pickup_full_address AND NOT v_owner_contact_scrub_authorized)
     OR (new.pickup_note IS DISTINCT FROM old.pickup_note AND NOT v_owner_contact_scrub_authorized)
     OR (new.pickup_latitude IS DISTINCT FROM old.pickup_latitude AND NOT v_owner_contact_scrub_authorized)
     OR (new.pickup_longitude IS DISTINCT FROM old.pickup_longitude AND NOT v_owner_contact_scrub_authorized)
     OR (
       NOT v_payment_update_authorized
       AND (
         new.paid_at IS DISTINCT FROM old.paid_at
         OR new.payment_provider_status IS DISTINCT FROM old.payment_provider_status
       )
     )
  THEN
    RAISE EXCEPTION 'Immutable reservation fields cannot be changed';
  END IF;
  RETURN new;
END;
$function$;

commit;
