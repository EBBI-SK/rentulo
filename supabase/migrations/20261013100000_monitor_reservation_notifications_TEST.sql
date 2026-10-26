begin;

-- BOD 12 / P1-4: TEST-only monitoring. No cron or outbound messages are
-- installed here. An external scheduler must explicitly call the guarded
-- Edge Function after a separate deployment/enablement step.
-- Neither table is readable or writable by browser roles.
create table if not exists public.reservation_notification_worker_health (
  singleton boolean primary key default true check (singleton),
  last_success_at timestamptz not null default now(),
  last_claimed integer not null default 0,
  last_sent integer not null default 0,
  last_retried integer not null default 0,
  last_dead integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.reservation_notification_worker_health enable row level security;
revoke all on public.reservation_notification_worker_health from public, anon, authenticated;
grant all on public.reservation_notification_worker_health to service_role;

-- Installation grace period: allow up to eight minutes for the updated
-- worker to be deployed before reporting the first missed heartbeat.
insert into public.reservation_notification_worker_health (singleton)
values (true) on conflict (singleton) do nothing;

create or replace function public.record_reservation_notification_worker_success(
  p_claimed integer, p_sent integer, p_retried integer, p_dead integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;
  if p_claimed < 0 or p_claimed > 10
     or p_sent < 0 or p_retried < 0 or p_dead < 0
     or p_sent + p_retried + p_dead > p_claimed then
    raise exception 'Invalid notification worker counters';
  end if;
  insert into public.reservation_notification_worker_health (
    singleton, last_success_at, last_claimed, last_sent,
    last_retried, last_dead, updated_at
  ) values (
    true, clock_timestamp(), p_claimed, p_sent,
    p_retried, p_dead, clock_timestamp()
  )
  on conflict (singleton) do update set
    last_success_at = excluded.last_success_at,
    last_claimed = excluded.last_claimed,
    last_sent = excluded.last_sent,
    last_retried = excluded.last_retried,
    last_dead = excluded.last_dead,
    updated_at = excluded.updated_at;
  return true;
end;
$function$;
revoke all on function public.record_reservation_notification_worker_success(
  integer, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.record_reservation_notification_worker_success(
  integer, integer, integer, integer
) to service_role;

-- One durable record per alert fingerprint. If a problem disappears and later
-- recurs, generation increments and a NEW one-time notification is permitted.
-- A lease prevents two overlapping monitor invocations from emailing twice.
create table if not exists public.reservation_notification_monitor_alerts (
  alert_key text primary key check (length(alert_key) between 1 and 120),
  issue_kind text not null check (issue_kind in ('dead', 'overdue', 'stuck', 'worker_stale')),
  reservation_number text,
  detail text not null,
  active boolean not null default true,
  generation integer not null default 1 check (generation > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  claim_token uuid,
  claim_expires_at timestamptz,
  sent_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table public.reservation_notification_monitor_alerts enable row level security;
revoke all on public.reservation_notification_monitor_alerts from public, anon, authenticated;
grant all on public.reservation_notification_monitor_alerts to service_role;
create index if not exists reservation_notification_monitor_alerts_due_idx
  on public.reservation_notification_monitor_alerts (next_attempt_at, first_seen_at)
  where active and sent_at is null;

-- Detect failures in the source-of-truth queue and an absent real worker pulse.
-- No trigger or database cron is used for monitoring: the independent GitHub
-- scheduler invokes this RPC through the authenticated TEST-only Edge Function.
create or replace function public.claim_reservation_notification_monitor_alerts(
  p_limit integer default 10
)
returns table (
  alert_key text,
  claim_token uuid,
  alert_generation integer,
  issue_kind text,
  reservation_number text,
  detail text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_checked_at timestamptz := clock_timestamp();
  v_issue record;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;

  -- Keep each fingerprint active only while its underlying fault persists.
  for v_issue in
    select
      'dead:' || d.id::text as alert_key,
      'dead'::text as issue_kind,
      r.reservation_number::text as reservation_number,
      left('Kanál: ' || d.channel || ', udalosť: ' || d.event_type ||
        ', chyba: ' || coalesce(d.last_error, 'neuvedená'), 350) as detail
    from public.reservation_notification_deliveries d
    left join public.reservations r on r.id = d.reservation_id
    where d.status = 'dead'
    union all
    select
      'overdue:' || d.id::text, 'overdue'::text,
      r.reservation_number::text,
      left('Kanál: ' || d.channel || ', udalosť: ' || d.event_type ||
        ', fronta je po termíne spracovania viac než 10 minút', 350)
    from public.reservation_notification_deliveries d
    left join public.reservations r on r.id = d.reservation_id
    where d.status in ('queued', 'retry')
      and d.next_attempt_at < v_checked_at - interval '10 minutes'
    union all
    select
      'stuck:' || d.id::text, 'stuck'::text,
      r.reservation_number::text,
      left('Kanál: ' || d.channel || ', udalosť: ' || d.event_type ||
        ', lease odosielania vypršal pred viac než 3 minútami', 350)
    from public.reservation_notification_deliveries d
    left join public.reservations r on r.id = d.reservation_id
    where d.status = 'sending'
      and coalesce(d.lease_until, d.updated_at) < v_checked_at - interval '3 minutes'
    union all
    select
      'worker-stale'::text, 'worker_stale'::text, null::text,
      'Notifikačný worker nepotvrdil úspešné dokončenie aspoň 8 minút'::text
    where not exists (
      select 1 from public.reservation_notification_worker_health h
      where h.singleton and h.last_success_at >= v_checked_at - interval '8 minutes'
    )
  loop
    insert into public.reservation_notification_monitor_alerts as a (
      alert_key, issue_kind, reservation_number, detail, last_seen_at, updated_at
    ) values (
      v_issue.alert_key, v_issue.issue_kind, v_issue.reservation_number,
      v_issue.detail, v_checked_at, v_checked_at
    )
    on conflict on constraint reservation_notification_monitor_alerts_pkey do update set
      issue_kind = excluded.issue_kind,
      reservation_number = excluded.reservation_number,
      detail = excluded.detail,
      last_seen_at = v_checked_at,
      updated_at = v_checked_at,
      generation = case when not a.active then a.generation + 1 else a.generation end,
      first_seen_at = case when not a.active then v_checked_at else a.first_seen_at end,
      attempt_count = case when not a.active then 0 else a.attempt_count end,
      sent_at = case when not a.active then null else a.sent_at end,
      claim_token = case when not a.active then null else a.claim_token end,
      claim_expires_at = case when not a.active then null else a.claim_expires_at end,
      next_attempt_at = case when not a.active then v_checked_at else a.next_attempt_at end,
      last_error = case when not a.active then null else a.last_error end,
      resolved_at = null,
      active = true;
  end loop;

  update public.reservation_notification_monitor_alerts a
  set active = false, resolved_at = v_checked_at,
      claim_token = null, claim_expires_at = null,
      updated_at = v_checked_at
  where a.active and a.last_seen_at < v_checked_at;

  -- An unsuccessful email is retried with backoff. An acknowledged alert
  -- stays silent until the problem has resolved and recurred.
  return query
    with eligible as (
      select a.alert_key
      from public.reservation_notification_monitor_alerts a
      where a.active and a.sent_at is null
        and a.next_attempt_at <= v_checked_at
        and (a.claim_expires_at is null or a.claim_expires_at < v_checked_at)
      order by a.first_seen_at, a.alert_key
      for update skip locked
      limit least(greatest(coalesce(p_limit, 10), 1), 10)
    ), claimed as (
      update public.reservation_notification_monitor_alerts a
      set claim_token = gen_random_uuid(),
          claim_expires_at = v_checked_at + interval '2 minutes',
          attempt_count = a.attempt_count + 1,
          updated_at = v_checked_at
      from eligible e
      where a.alert_key = e.alert_key
      returning a.alert_key, a.claim_token, a.generation,
                a.issue_kind, a.reservation_number, a.detail
    )
    select c.alert_key, c.claim_token, c.generation,
           c.issue_kind, c.reservation_number, c.detail
    from claimed c;
end;
$function$;
revoke all on function public.claim_reservation_notification_monitor_alerts(integer)
  from public, anon, authenticated;
grant execute on function public.claim_reservation_notification_monitor_alerts(integer)
  to service_role;

create or replace function public.finish_reservation_notification_monitor_alert(
  p_alert_key text,
  p_claim_token uuid,
  p_generation integer,
  p_sent boolean,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;
  update public.reservation_notification_monitor_alerts a
  set sent_at = case when p_sent then clock_timestamp() else a.sent_at end,
      next_attempt_at = case when p_sent then a.next_attempt_at else
        clock_timestamp() + make_interval(secs =>
          least(3600, 60 * power(2, least(a.attempt_count - 1, 6))::integer)) end,
      last_error = case when p_sent then null else left(p_error, 350) end,
      claim_token = null,
      claim_expires_at = null,
      updated_at = clock_timestamp()
  where a.alert_key = p_alert_key
    and a.claim_token = p_claim_token
    and a.generation = p_generation
    and a.active;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$function$;
revoke all on function public.finish_reservation_notification_monitor_alert(
  text, uuid, integer, boolean, text
) from public, anon, authenticated;
grant execute on function public.finish_reservation_notification_monitor_alert(
  text, uuid, integer, boolean, text
) to service_role;

commit;
