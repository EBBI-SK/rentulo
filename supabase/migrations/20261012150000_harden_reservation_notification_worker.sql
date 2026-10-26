begin;

-- BOD 12 / P1-1: keep SMS at-most-once-attempted across interrupted workers.
-- This marker MUST be persisted before a live BulkGate request starts.  If
-- the worker dies before it can acknowledge the result, a later Cron run may
-- NOT automatically resend a possibly already accepted/charged SMS.
alter table public.reservation_notification_deliveries
  add column if not exists sms_dispatch_started_at timestamptz;

create index if not exists reservation_notification_deliveries_sending_lease_idx
  on public.reservation_notification_deliveries (lease_until)
  where status = 'sending';

-- On the one-time upgrade, older SMS sending records have no dispatch marker;
-- their outcome is unknown. Fail closed instead of risking a duplicate SMS.
-- The records remain visible for manual investigation.
update public.reservation_notification_deliveries d
set status = 'dead',
    claim_token = null,
    lease_until = null,
    last_error = 'Pre-upgrade SMS send status unknown; manual review required',
    updated_at = now()
where d.channel = 'sms' and d.status = 'sending';

-- Only the currently claimed SMS may cross the external-provider boundary.
-- A missing/ambiguous database acknowledgement MUST prevent the API call.
create or replace function public.mark_reservation_sms_dispatch_started(
  p_delivery_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_updated integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;

  update public.reservation_notification_deliveries d
  set sms_dispatch_started_at = now(),
      updated_at = now()
  where d.id = p_delivery_id
    and d.claim_token = p_claim_token
    and d.channel = 'sms'
    and d.status = 'sending'
    and d.lease_until > now()
    and d.sms_dispatch_started_at is null;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$function$;
revoke all on function public.mark_reservation_sms_dispatch_started(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.mark_reservation_sms_dispatch_started(uuid, uuid)
  to service_role;

-- A fresh claim can be safely retried if it expired BEFORE live SMS dispatch.
-- Expired jobs with a dispatch marker must instead go to manual review.
-- The same recovery also closes the old fifth-attempt 'sending' deadlock.
create or replace function public.claim_reservation_notification_deliveries(
  p_limit integer default 15
)
returns table (
  delivery_id uuid,
  claim_token uuid,
  reservation_id uuid,
  event_type text,
  recipient_id uuid,
  channel text
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;

  update public.reservation_notification_deliveries d
  set status = 'dead',
      claim_token = null,
      lease_until = null,
      last_error = case
        when d.channel = 'sms' and d.sms_dispatch_started_at is not null
          then 'Live SMS dispatch outcome unknown; manual review required'
        else 'Notification attempts exhausted after worker interruption'
      end,
      updated_at = now()
  where (
    (d.status = 'sending' and d.lease_until < now() and (
      d.attempt_count >= 5
      or (d.channel = 'sms' and d.sms_dispatch_started_at is not null)
    ))
    or (d.status in ('queued', 'retry') and (
      d.attempt_count >= 5
      or (d.channel = 'sms' and d.sms_dispatch_started_at is not null)
    ))
  );

  return query
    with eligible as (
      select d.id
      from public.reservation_notification_deliveries d
      where (
        (d.status in ('queued', 'retry') and d.next_attempt_at <= now())
        or (d.status = 'sending' and d.lease_until < now())
      )
        and d.attempt_count < 5
        and (d.channel <> 'sms' or d.sms_dispatch_started_at is null)
      order by d.created_at, d.id
      for update skip locked
      limit least(greatest(coalesce(p_limit, 15), 1), 25)
    ), claimed as (
      update public.reservation_notification_deliveries d
      set status = 'sending',
          attempt_count = d.attempt_count + 1,
          claim_token = gen_random_uuid(),
          lease_until = now() + interval '3 minutes',
          updated_at = now()
      from eligible e
      where d.id = e.id
      returning d.id, d.claim_token, d.reservation_id, d.event_type,
                d.recipient_id, d.channel
    )
    select c.id, c.claim_token, c.reservation_id, c.event_type,
           c.recipient_id, c.channel
    from claimed c;
end;
$function$;
revoke all on function public.claim_reservation_notification_deliveries(integer)
  from public, anon, authenticated;
grant execute on function public.claim_reservation_notification_deliveries(integer)
  to service_role;

-- Defense in depth: if code accidentally acknowledges a retry AFTER a live
-- SMS dispatch was started, fail closed to 'dead', never enqueue another send.
create or replace function public.finish_reservation_notification_delivery(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_provider_message_id text default null,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_updated integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;
  if p_outcome not in ('sent', 'retry', 'simulated', 'skipped', 'dead') then
    raise exception 'Invalid delivery outcome';
  end if;

  update public.reservation_notification_deliveries d
  set status = case
        when p_outcome = 'retry' and (
          d.attempt_count >= 5
          or (d.channel = 'sms' and d.sms_dispatch_started_at is not null)
        ) then 'dead'
        else p_outcome end,
      provider_message_id = case when p_outcome = 'sent' then left(p_provider_message_id, 200) else null end,
      last_error = case
        when p_outcome = 'retry'
          and d.channel = 'sms' and d.sms_dispatch_started_at is not null
          then 'Live SMS outcome uncertain; manual review required'
        else left(p_error, 400) end,
      claim_token = null,
      lease_until = null,
      next_attempt_at = case
        when p_outcome = 'retry' then now() +
          make_interval(secs => least(3600, 60 * power(2, least(d.attempt_count - 1, 6))::integer))
        else d.next_attempt_at end,
      sent_at = case when p_outcome = 'sent' then now() else null end,
      updated_at = now()
  where d.id = p_delivery_id
    and d.claim_token = p_claim_token
    and d.status = 'sending';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$function$;
revoke all on function public.finish_reservation_notification_delivery(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.finish_reservation_notification_delivery(uuid, uuid, text, text, text)
  to service_role;

commit;
