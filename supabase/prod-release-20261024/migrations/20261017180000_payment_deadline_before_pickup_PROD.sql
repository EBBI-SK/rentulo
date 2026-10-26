-- RENTULO V1 / PROD RELEASE CANDIDATE bd1b8d1 / 2026-10-24.
-- Apply only to a verified PROD database after backup and approval.
-- This SQL is staged separately: never copy over TEST migrations.
-- Cron activation is deferred; no automatic deployment is authorized.

-- RENTULO / BOD 01 / STAGE 1 / PROD ONLY
-- Owner decision: retain the existing 24-hour limit (capped at pickup).
-- Renter payment: due 24 hours before pickup when approval is early enough.
-- If approval is at/after that cutoff, allow up to 30 minutes, never past pickup.
-- Existing approved reservations keep their previously stored expires_at.
-- Does not change Stripe checkout, cancellation or payout policy.

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


-- A pure rule that can also be verified using fixed timestamps in PROD SQL.
-- The result is an absolute timestamp; Prague local time is converted by the
-- reservation trigger before this function is called.
create or replace function public.calculate_reservation_payment_deadline(
  p_approved_at timestamptz,
  p_pickup_at timestamptz
)
returns timestamptz
language sql
immutable
set search_path = ''
as $function$
  select case
    when p_approved_at is null or p_pickup_at is null
      or p_pickup_at <= p_approved_at then null::timestamptz
    when p_approved_at < p_pickup_at - interval '24 hours'
      then p_pickup_at - interval '24 hours'
    else least(p_approved_at + interval '30 minutes', p_pickup_at)
  end;
$function$;

revoke all on function public.calculate_reservation_payment_deadline(timestamptz, timestamptz)
  from public, anon, authenticated;

-- Override only the existing reservation expiration trigger function.
-- Keep the insert (owner approval) deadline and all immutable-field checks.
create or replace function public.set_and_protect_reservation_expiration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pickup_at timestamptz;
begin
  if tg_op = 'INSERT' then
    if new.pickup_time is null then
      raise exception 'Pickup time is required';
    end if;
    v_pickup_at := (new.start_date + new.pickup_time) at time zone 'Europe/Prague';
    if v_pickup_at <= now() then
      raise exception using errcode = 'P0001', message = 'PICKUP_TIME_PASSED';
    end if;
    new.expires_at := least(now() + interval '24 hours', v_pickup_at);
    new.approved_at := null;
    new.expired_at := null;
    new.expiry_reason := null;
    return new;
  end if;

  if old.status = 'pending' and new.status = 'approved' then
    if old.expires_at is not null and old.expires_at <= now() then
      raise exception using errcode = 'P0001', message = 'RESERVATION_APPROVAL_EXPIRED';
    end if;
    v_pickup_at := (old.start_date + old.pickup_time) at time zone 'Europe/Prague';
    if v_pickup_at <= now() then
      raise exception using errcode = 'P0001', message = 'PICKUP_TIME_PASSED';
    end if;
    new.approved_at := now();
    new.expires_at := public.calculate_reservation_payment_deadline(new.approved_at, v_pickup_at);
    new.expired_at := old.expired_at;
    new.expiry_reason := old.expiry_reason;
  elsif new.status = 'expired' and old.status in ('pending', 'approved') then
    new.expires_at := old.expires_at;
    new.approved_at := old.approved_at;
    new.expired_at := now();
    new.expiry_reason := case when old.status = 'pending'
      then 'owner_no_response' else 'payment_timeout' end;
  elsif new.expires_at is distinct from old.expires_at
     or new.approved_at is distinct from old.approved_at
     or new.expired_at is distinct from old.expired_at
     or new.expiry_reason is distinct from old.expiry_reason
  then
    raise exception 'Reservation expiration fields cannot be changed';
  end if;
  return new;
end;
$function$;

revoke all on function public.set_and_protect_reservation_expiration()
  from public, anon, authenticated;

-- Avoid sending a "4 hours left" email instantly after the approval
-- of an urgent reservation that has only 30 minutes (or less) to pay.
-- For short payment windows, send one reminder in the final 10 minutes.
-- Existing pending (owner) reminders and longer payment windows are unchanged.
create or replace function public.queue_expiry_reminders(p_limit integer default 40)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row record;
  v_count integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;
  for v_row in
    select r.id, r.status, r.owner_id, r.renter_id
    from public.reservations r
    where r.status in ('pending', 'approved')
      and r.expires_at is not null
      and r.expires_at > now()
      and r.expires_at <= now() + interval '4 hours'
      and (
        r.status = 'pending'
        or r.approved_at is null
        or r.expires_at - r.approved_at > interval '30 minutes'
        or r.expires_at <= now() + interval '10 minutes'
      )
      and not exists (
        select 1 from public.reservation_notification_deliveries d
        where d.reservation_id = r.id
          and d.channel = 'email'
          and d.event_type = case when r.status = 'pending'
            then 'expiry_reminder_pending' else 'expiry_reminder_approved' end
      )
    order by r.expires_at, r.id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 40), 1), 100)
  loop
    perform public.queue_reservation_notification(
      v_row.id,
      case when v_row.status = 'pending'
        then 'expiry_reminder_pending' else 'expiry_reminder_approved' end,
      case when v_row.status = 'pending' then v_row.owner_id else v_row.renter_id end,
      false
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

revoke all on function public.queue_expiry_reminders(integer)
  from public, anon, authenticated;
grant execute on function public.queue_expiry_reminders(integer)
  to service_role;

commit;
