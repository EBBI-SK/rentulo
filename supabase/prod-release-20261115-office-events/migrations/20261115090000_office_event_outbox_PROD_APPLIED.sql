-- RENTULO PROD / OFFICE BOD 3. APPLIED / DO NOT RERUN.
-- Manually executed once in Rentulo PROD SQL Editor on 2026-11-15; success confirmed by user.
-- This is historical source only, NOT a pending migration; no new database changes on merge.
-- Creates a durable event outbox for operational issues only; no Stripe, booking or cron changes.
-- Exclusively for Supabase PROD tfvgxrdjrpicgtvovehl; never for TEST or Rentulo Office.
begin;

do $preflight$
begin
  if not exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'rentulo_prod_release_target'
      and s.decrypted_secret = 'tfvgxrdjrpicgtvovehl'
  ) then
    raise exception 'Office events release: verified Rentulo PROD Vault guard is missing';
  end if;
  if exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'rentulo_project_url'
      and btrim(s.decrypted_secret, '/') not in
        ('UNCONFIGURED', 'https://tfvgxrdjrpicgtvovehl.supabase.co')
  ) then
    raise exception 'Office events release: incorrect project URL';
  end if;
  if to_regclass('public.reservations') is null
    or to_regclass('public.payments') is null
    or to_regclass('public.platform_incidents') is null
    or to_regclass('public.platform_incident_events') is null
    or to_regclass('public.reservation_return_incidents') is null
    or to_regclass('public.reservation_notification_monitor_alerts') is null
    or to_regclass('public.reservation_dispute_settlements') is null
    or to_regclass('public.reservation_dispute_settlement_events') is null then
    raise exception 'Office events release: required PROD source schema is unavailable';
  end if;
  if to_regclass('public.rentulo_office_event_outbox') is not null then
    raise exception 'Office events outbox already exists: DO NOT RERUN';
  end if;
end;
$preflight$;

create table public.rentulo_office_event_outbox (
  event_id text primary key check (event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'),
  issue_key text not null check (issue_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'),
  event_type text not null check (event_type in (
    'return_not_received', 'platform_incident', 'owner_transfer_failure',
    'refund_failure', 'notification_delivery_failure', 'notification_worker_failure'
  )),
  state text not null check (state in ('open','resolved')),
  severity text not null check (severity in ('normal','high','urgent')),
  occurred_at timestamptz not null,
  reservation_number text check (reservation_number is null or reservation_number ~ '^R-[0-9]{6,20}$'),
  diagnostic_code text check (diagnostic_code is null or diagnostic_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  delivery_status text not null default 'queued' check (delivery_status in ('queued','sent','dead')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz default clock_timestamp(),
  claim_token uuid,
  claim_expires_at timestamptz,
  sent_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 100),
  created_at timestamptz not null default clock_timestamp(),
  constraint rentulo_office_lease_pair check ((claim_token is null) = (claim_expires_at is null))
);
create index rentulo_office_event_outbox_due_idx
  on public.rentulo_office_event_outbox (next_attempt_at, created_at)
  where delivery_status = 'queued';
create index rentulo_office_event_outbox_issue_idx
  on public.rentulo_office_event_outbox (issue_key, occurred_at);
alter table public.rentulo_office_event_outbox enable row level security;
revoke all on public.rentulo_office_event_outbox from public, anon, authenticated, service_role;
grant select, insert, update on public.rentulo_office_event_outbox to service_role;

-- The sender signs only these minimal fields. No incident descriptions, contacts, PIN or Stripe IDs.
create function public.rentulo_office_capture_issue()
returns trigger language plpgsql security definer set search_path = '' as $capture$
declare
  v_event_id text;
  v_issue_key text;
  v_type text;
  v_state text;
  v_severity text := 'high';
  v_time timestamptz;
  v_reservation text;
  v_diagnostic text;
  v_case record;
  v_issue_hash text;
begin
  if TG_TABLE_NAME = 'platform_incident_events' and TG_OP = 'INSERT' then
    if new.event_kind not in ('created','closed') then return new; end if;
    select i.incident_number, i.reservation_number, i.incident_type
      into v_case from public.platform_incidents i where i.id = new.incident_id;
    v_event_id := 'platform:' || new.id::text;
    v_issue_key := 'platform:' || v_case.incident_number;
    v_type := 'platform_incident';
    v_state := case when new.event_kind = 'closed' then 'resolved' else 'open' end;
    v_severity := case when v_case.incident_type in ('fraud','loss') then 'urgent' else 'high' end;
    v_time := new.occurred_at;
    v_reservation := v_case.reservation_number;
    v_diagnostic := 'PLATFORM_INCIDENT';
  elsif TG_TABLE_NAME = 'reservation_return_incidents' then
    if TG_OP = 'INSERT' then
      v_state := 'open';
      v_event_id := 'return:' || new.reservation_id::text || ':open';
      v_time := new.reported_at;
    elsif TG_OP = 'UPDATE' and old.resolved_at is null and new.resolved_at is not null then
      v_state := 'resolved';
      v_event_id := 'return:' || new.reservation_id::text || ':resolved';
      v_time := new.resolved_at;
    else return new;
    end if;
    v_issue_key := 'return:' || new.reservation_id::text;
    v_type := 'return_not_received';
    v_diagnostic := 'RETURN_NOT_RECEIVED';
    select r.reservation_number into v_reservation
      from public.reservations r where r.id = new.reservation_id;
  elsif TG_TABLE_NAME = 'reservation_notification_monitor_alerts' then
    if TG_OP = 'INSERT' and new.active then
      v_state := 'open'; v_time := new.first_seen_at;
    elsif TG_OP = 'UPDATE' and new.active and
      (not old.active or new.generation is distinct from old.generation) then
      v_state := 'open'; v_time := new.first_seen_at;
    elsif TG_OP = 'UPDATE' and old.active and not new.active then
      v_state := 'resolved'; v_time := new.resolved_at;
    else return new;
    end if;
    v_issue_hash := md5(new.alert_key);
    v_issue_key := 'notification:' || v_issue_hash || ':' || new.generation::text;
    v_event_id := v_issue_key || ':' || v_state;
    v_type := case when new.issue_kind = 'worker_stale'
      then 'notification_worker_failure' else 'notification_delivery_failure' end;
    v_severity := case when new.issue_kind in ('dead','worker_stale')
      then 'urgent' else 'high' end;
    v_reservation := new.reservation_number;
    v_diagnostic := case new.issue_kind
      when 'dead' then 'NOTIFICATION_DEAD'
      when 'overdue' then 'NOTIFICATION_OVERDUE'
      when 'stuck' then 'NOTIFICATION_STUCK'
      else 'NOTIFICATION_WORKER_STALE' end;
  elsif TG_TABLE_NAME = 'payments' then
    v_issue_key := 'transfer:' || new.id::text;
    if new.transfer_status = 'failed' and new.transfer_next_retry_at is null and
      new.transfer_attempt_count > 0 and
      (old.transfer_status is distinct from new.transfer_status or
       old.transfer_next_retry_at is distinct from new.transfer_next_retry_at) then
      v_state := 'open';
    elsif new.transfer_status = 'succeeded' and old.transfer_status is distinct from 'succeeded' and
      exists (select 1 from public.rentulo_office_event_outbox o
              where o.issue_key = v_issue_key and o.state = 'open') then
      v_state := 'resolved';
    else return new;
    end if;
    v_event_id := v_issue_key || ':' || v_state;
    v_type := 'owner_transfer_failure';
    v_time := clock_timestamp();
    v_diagnostic := 'OWNER_TRANSFER_NEEDS_REVIEW';
    select r.reservation_number into v_reservation
      from public.reservations r where r.id = new.reservation_id;
  elsif TG_TABLE_NAME = 'reservation_dispute_settlement_events' and TG_OP = 'INSERT' then
    select d.reservation_id, d.settlement_route into v_case
      from public.reservation_dispute_settlements d where d.id = new.settlement_id;
    v_issue_key := 'settlement:' || new.settlement_id::text;
    if new.new_status = 'manual_review' then
      v_state := 'open';
    elsif new.new_status = 'succeeded' and exists (
      select 1 from public.rentulo_office_event_outbox o
      where o.issue_key = v_issue_key and o.state = 'open') then
      v_state := 'resolved';
    else return new;
    end if;
    v_event_id := 'settlement:' || new.id::text;
    v_type := case when v_case.settlement_route = 'renter_full_refund'
      then 'refund_failure' else 'owner_transfer_failure' end;
    v_time := new.occurred_at;
    v_diagnostic := 'SETTLEMENT_MANUAL_REVIEW';
    select r.reservation_number into v_reservation
      from public.reservations r where r.id = v_case.reservation_id;
  else return new;
  end if;

  insert into public.rentulo_office_event_outbox
    (event_id, issue_key, event_type, state, severity, occurred_at,
     reservation_number, diagnostic_code)
  values (v_event_id, v_issue_key, v_type, v_state, v_severity, v_time,
          v_reservation, v_diagnostic)
  on conflict (event_id) do nothing;
  return new;
end;
$capture$;
revoke all on function public.rentulo_office_capture_issue()
  from public, anon, authenticated;

create trigger trg_rentulo_office_platform_issue
  after insert on public.platform_incident_events
  for each row execute function public.rentulo_office_capture_issue();
create trigger trg_rentulo_office_return_issue
  after insert or update of resolved_at on public.reservation_return_incidents
  for each row execute function public.rentulo_office_capture_issue();
create trigger trg_rentulo_office_notification_issue
  after insert or update on public.reservation_notification_monitor_alerts
  for each row execute function public.rentulo_office_capture_issue();
create trigger trg_rentulo_office_transfer_issue
  after update of transfer_status, transfer_next_retry_at on public.payments
  for each row execute function public.rentulo_office_capture_issue();
create trigger trg_rentulo_office_settlement_issue
  after insert on public.reservation_dispute_settlement_events
  for each row execute function public.rentulo_office_capture_issue();

-- An independent lease protects overlapping monitor runs. Lost acknowledgements retry safely.
create function public.claim_rentulo_office_event_deliveries(p_limit integer default 4)
returns table (
  event_id text, claim_token uuid, issue_key text, event_type text,
  state text, severity text, occurred_at timestamptz,
  reservation_number text, diagnostic_code text
) language plpgsql security definer set search_path = '' as $claim$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  return query
    with candidates as (
      select q.event_id from public.rentulo_office_event_outbox q
      where q.delivery_status = 'queued'
        and q.next_attempt_at <= clock_timestamp()
        and (q.claim_expires_at is null or q.claim_expires_at < clock_timestamp())
      order by q.created_at, q.event_id
      for update skip locked
      limit least(greatest(coalesce(p_limit,4),1),4)
    ), claimed as (
      update public.rentulo_office_event_outbox q
      set claim_token = gen_random_uuid(),
          claim_expires_at = clock_timestamp() + interval '2 minutes',
          attempt_count = q.attempt_count + 1
      from candidates c where q.event_id = c.event_id
      returning q.event_id, q.claim_token, q.issue_key, q.event_type, q.state,
                q.severity, q.occurred_at, q.reservation_number, q.diagnostic_code
    )
    select c.* from claimed c;
end;
$claim$;
revoke all on function public.claim_rentulo_office_event_deliveries(integer)
  from public, anon, authenticated;
grant execute on function public.claim_rentulo_office_event_deliveries(integer)
  to service_role;

create function public.finish_rentulo_office_event_delivery(
  p_event_id text, p_claim_token uuid, p_outcome text, p_error text default null
) returns boolean language plpgsql security definer set search_path = '' as $finish$
declare v_count integer;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_outcome not in ('sent','retry','dead') then
    raise exception 'Invalid Office event result';
  end if;
  update public.rentulo_office_event_outbox q
  set delivery_status = case when p_outcome='retry' then 'queued' else p_outcome end,
      next_attempt_at = case when p_outcome='retry' then
        clock_timestamp() + make_interval(secs => least(3600,
          60 * power(2, least(q.attempt_count - 1, 6))::integer)) else null end,
      claim_token = null,
      claim_expires_at = null,
      sent_at = case when p_outcome='sent' then clock_timestamp() else q.sent_at end,
      last_error = case when p_outcome='sent' then null else left(coalesce(p_error,'UNAVAILABLE'),100) end
  where q.event_id = p_event_id and q.claim_token = p_claim_token and q.delivery_status='queued';
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$finish$;
revoke all on function public.finish_rentulo_office_event_delivery(text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.finish_rentulo_office_event_delivery(text, uuid, text, text)
  to service_role;

commit;
