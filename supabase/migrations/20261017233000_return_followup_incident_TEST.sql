-- RENTULO / BOD 01 / RETURN FOLLOW-UP / TEST ONLY.
-- Agreed scope: owner email at +30m, second email and voluntary incident report
-- at +2h, renter notified of an actual owner report, auto-close on confirmed return.
-- No fines, refunds, transfers, new reservation statuses, or booking-policy changes.
-- Pre-existing reservations are intentionally NOT enrolled.
begin;

do $test_project$
begin
  if not exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'rentulo_project_url'
      and btrim(s.decrypted_secret, '/') = 'https://vspposovhdgvbeukoivh.supabase.co'
  ) then
    raise exception 'BOD 01 return follow-up migration is TEST-only';
  end if;
end;
$test_project$;

create table if not exists public.reservation_return_followup_activation (
  singleton boolean primary key default true check (singleton),
  activated_at timestamptz not null default clock_timestamp()
);
alter table public.reservation_return_followup_activation enable row level security;
revoke all on public.reservation_return_followup_activation from public, anon, authenticated;
insert into public.reservation_return_followup_activation (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.reservation_return_incidents (
  reservation_id uuid primary key references public.reservations(id) on delete cascade,
  reported_by uuid not null references public.profiles(id),
  description text not null check (char_length(btrim(description)) between 15 and 500),
  reported_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  resolution text check (resolution is null or resolution = 'confirmed_returned'),
  constraint return_incident_resolution_pair_check
    check ((resolved_at is null and resolution is null)
        or (resolved_at is not null and resolution = 'confirmed_returned'))
);
create index if not exists reservation_return_incidents_unresolved_idx
  on public.reservation_return_incidents(reported_at)
  where resolved_at is null;
alter table public.reservation_return_incidents enable row level security;
revoke all on public.reservation_return_incidents from public, anon, authenticated;
grant all on public.reservation_return_incidents to service_role;

-- Extend ONLY the known outbox event allowlists. Email-only, no new SMS events.
alter table public.reservation_notification_deliveries
  drop constraint if exists reservation_notification_deliveries_event_type_check;
alter table public.reservation_notification_deliveries
  add constraint reservation_notification_deliveries_event_type_check
  check (event_type in (
    'new_request', 'approved', 'rejected', 'cancelled',
    'paid', 'picked_up', 'returned', 'paid_cancelled',
    'expiry_reminder_pending', 'expiry_reminder_approved',
    'expired_pending', 'expired_approved', 'no_show',
    'return_reminder_30m', 'return_reminder_2h', 'return_not_received'
  ));
alter table public.reservation_email_deliveries
  drop constraint if exists reservation_email_deliveries_event_type_check;
alter table public.reservation_email_deliveries
  add constraint reservation_email_deliveries_event_type_check
  check (event_type in (
    'new_request', 'approved', 'rejected', 'cancelled',
    'paid', 'picked_up', 'returned', 'paid_cancelled',
    'expiry_reminder_pending', 'expiry_reminder_approved',
    'expired_pending', 'expired_approved', 'no_show',
    'return_reminder_30m', 'return_reminder_2h', 'return_not_received'
  ));

-- A single, owner-scoped query makes the UI rely on authoritative server time.
-- Missing/old reservations and broken dates never enable incident reporting.
create or replace function public.get_my_return_followup_overview()
returns table (
  reservation_id uuid,
  can_report boolean,
  reported_at timestamptz,
  resolved_at timestamptz
)
language sql
security definer
set search_path = ''
as $function$
  select
    r.id,
    (
      r.status = 'picked_up'
      and a.activated_at is not null
      and r.created_at >= a.activated_at
      and r.pickup_time is not null
      and clock_timestamp() >= (
        ((r.end_date + r.pickup_time) at time zone 'Europe/Prague')
        + interval '2 hours'
      )
      and i.reservation_id is null
    ) as can_report,
    i.reported_at,
    i.resolved_at
  from public.reservations r
  left join public.reservation_return_followup_activation a on a.singleton = true
  left join public.reservation_return_incidents i on i.reservation_id = r.id
  where auth.uid() is not null
    and auth.uid() = r.owner_id
    and r.status in ('picked_up', 'returned');
$function$;
revoke all on function public.get_my_return_followup_overview() from public, anon;
grant execute on function public.get_my_return_followup_overview() to authenticated;

-- Explicit owner report only, locked to the reservation and current DB clock.
-- No automatic report is created when 2h elapse.
create or replace function public.report_my_reservation_not_returned(
  p_reservation_id uuid,
  p_description text
)
returns table (reservation_id uuid, reported_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_reservation public.reservations%rowtype;
  v_description text := btrim(coalesce(p_description, ''));
begin
  if auth.uid() is null or p_reservation_id is null then
    raise exception using errcode = '42501', message = 'RETURN_REPORT_FORBIDDEN';
  end if;
  if char_length(v_description) not between 15 and 500 then
    raise exception using errcode = '22023', message = 'RETURN_REPORT_DESCRIPTION_REQUIRED';
  end if;

  select r.* into v_reservation
  from public.reservations r
  where r.id = p_reservation_id and r.owner_id = auth.uid()
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'RETURN_REPORT_FORBIDDEN';
  end if;
  if v_reservation.status <> 'picked_up'
     or v_reservation.pickup_time is null
     or not exists (
       select 1 from public.reservation_return_followup_activation a
       where a.singleton = true and v_reservation.created_at >= a.activated_at
     )
     or clock_timestamp() < (
       ((v_reservation.end_date + v_reservation.pickup_time) at time zone 'Europe/Prague')
       + interval '2 hours'
     ) then
    raise exception using errcode = 'P0001', message = 'RETURN_REPORT_NOT_AVAILABLE';
  end if;

  if exists (
    select 1 from public.reservation_return_incidents i
    where i.reservation_id = v_reservation.id
  ) then
    raise exception using errcode = 'P0001', message = 'RETURN_REPORT_ALREADY_EXISTS';
  end if;

  insert into public.reservation_return_incidents (
    reservation_id, reported_by, description
  ) values (v_reservation.id, auth.uid(), v_description);

  -- Transactional outbox: one renter email, never an SMS or a payment action.
  perform public.queue_reservation_notification(
    v_reservation.id, 'return_not_received', v_reservation.renter_id, false
  );

  return query
    select i.reservation_id, i.reported_at
    from public.reservation_return_incidents i
    where i.reservation_id = v_reservation.id;
end;
$function$;
revoke all on function public.report_my_reservation_not_returned(uuid, text)
  from public, anon;
grant execute on function public.report_my_reservation_not_returned(uuid, text)
  to authenticated;

-- Once the owner confirms a return, close any open incident automatically.
-- This never changes reservations.status, Stripe transfers or the release time.
create or replace function public.close_return_incident_on_confirmed_return()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'picked_up' and new.status = 'returned' then
    update public.reservation_return_incidents i
    set resolved_at = clock_timestamp(), resolution = 'confirmed_returned'
    where i.reservation_id = new.id and i.resolved_at is null;
  end if;
  return new;
end;
$function$;
revoke all on function public.close_return_incident_on_confirmed_return()
  from public, anon, authenticated;
drop trigger if exists trg_close_return_incident_on_confirmed_return on public.reservations;
create trigger trg_close_return_incident_on_confirmed_return
  after update of status on public.reservations
  for each row
  execute function public.close_return_incident_on_confirmed_return();

-- Reuse the existing email outbox and unique event/recipient/channel key.
-- Only picked-up, still-unreturned, newly-created bookings are considered.
-- If Cron missed the 30m window, send ONLY the 2h follow-up, never two late
-- reminders together. Once an incident is reported, reminders stop.
create or replace function public.queue_due_return_followups(p_limit integer default 40)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_reservation record;
  v_event text;
  v_queued integer := 0;
begin
  if session_user <> 'postgres' then
    raise exception 'Only the database Cron role can queue return follow-ups';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Return follow-up batch limit must be 1-100';
  end if;

  for v_reservation in
    select r.id, r.owner_id,
      ((r.end_date + r.pickup_time) at time zone 'Europe/Prague') as return_due
    from public.reservations r
    join public.reservation_return_followup_activation a
      on a.singleton = true and r.created_at >= a.activated_at
    where r.status = 'picked_up'
      and r.pickup_time is not null
      and clock_timestamp() >= (
        ((r.end_date + r.pickup_time) at time zone 'Europe/Prague')
        + interval '30 minutes'
      )
      and not exists (
        select 1 from public.reservation_return_incidents i
        where i.reservation_id = r.id
      )
      and (
        (clock_timestamp() < (
           ((r.end_date + r.pickup_time) at time zone 'Europe/Prague') + interval '2 hours'
         ) and not exists (
           select 1 from public.reservation_notification_deliveries d
           where d.reservation_id = r.id and d.event_type = 'return_reminder_30m'
             and d.recipient_id = r.owner_id and d.channel = 'email'
         ))
        or
        (clock_timestamp() >= (
           ((r.end_date + r.pickup_time) at time zone 'Europe/Prague') + interval '2 hours'
         ) and not exists (
           select 1 from public.reservation_notification_deliveries d
           where d.reservation_id = r.id and d.event_type = 'return_reminder_2h'
             and d.recipient_id = r.owner_id and d.channel = 'email'
         ))
      )
    order by r.end_date, r.id
    for update of r skip locked
    limit p_limit
  loop
    v_event := case
      when clock_timestamp() < v_reservation.return_due + interval '2 hours'
        then 'return_reminder_30m'
      else 'return_reminder_2h'
    end;
    perform public.queue_reservation_notification(
      v_reservation.id, v_event, v_reservation.owner_id, false
    );
    v_queued := v_queued + 1;
  end loop;
  return v_queued;
end;
$function$;
revoke all on function public.queue_due_return_followups(integer)
  from public, anon, authenticated, service_role;

select cron.schedule(
  'rentulo-return-followups-every-minute',
  '* * * * *',
  $cron$select public.queue_due_return_followups(40);$cron$
);

commit;
