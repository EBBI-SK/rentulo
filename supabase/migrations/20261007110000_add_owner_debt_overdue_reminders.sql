begin;

-- One transactional reminder is sent after an owner cancellation debt becomes
-- overdue. Deliveries are backend-only, auditable and retryable. A unique debt
-- key guarantees that a successful reminder is never intentionally sent twice.
create table if not exists public.owner_cancellation_debt_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null unique
    references public.owner_cancellation_debts(id) on delete cascade,
  status text not null default 'sending'
    check (status in ('sending', 'sent', 'failed', 'skipped')),
  attempt_count integer not null default 0
    check (attempt_count >= 0),
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  provider_message_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_debt_reminder_sent_state_check
    check (
      (status = 'sent' and sent_at is not null)
      or (status <> 'sent' and sent_at is null)
    )
);

create index if not exists owner_debt_reminder_delivery_status_idx
  on public.owner_cancellation_debt_reminder_deliveries (status, claim_expires_at);

alter table public.owner_cancellation_debt_reminder_deliveries enable row level security;
revoke all on table public.owner_cancellation_debt_reminder_deliveries
  from public, anon, authenticated;
grant all on table public.owner_cancellation_debt_reminder_deliveries
  to service_role;

-- Atomically claim a small batch of overdue debts. Failed deliveries and stale
-- claims can be retried; sent/skipped reminders are terminal. Row locking keeps
-- concurrent cron invocations from claiming the same debt at the same time.
create or replace function public.claim_overdue_owner_debt_reminders(
  p_limit integer default 25
)
returns table(
  delivery_id uuid,
  debt_id uuid,
  owner_id uuid,
  amount_minor integer,
  currency text,
  due_at timestamptz,
  recipient_email text,
  recipient_name text,
  preferred_language text,
  reservation_id uuid,
  offer_name text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_now timestamptz := now();
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Reminder claim limit must be between 1 and 100';
  end if;

  return query
  with candidates as (
    select d.id as debt_id
    from public.owner_cancellation_debts d
    join public.reservation_cancellations c
      on c.id = d.cancellation_id
    join public.reservations r
      on r.id = c.reservation_id
    join public.profiles p
      on p.id = d.owner_id
    left join public.owner_cancellation_debt_reminder_deliveries rd
      on rd.debt_id = d.id
    where d.status = 'open'
      and d.due_at <= v_now
      and d.currency = 'czk'
      and c.cancellation_kind = 'paid_refund'
      and c.cancelled_by_role = 'owner'
      and r.owner_id = d.owner_id
      and r.status = 'cancelled'
      and (
        rd.debt_id is null
        or rd.status = 'failed'
        or (
          rd.status = 'sending'
          and rd.claim_expires_at is not null
          and rd.claim_expires_at <= v_now
        )
      )
    order by d.due_at asc, d.id asc
    for update of d skip locked
    limit p_limit
  ), claimed as (
    insert into public.owner_cancellation_debt_reminder_deliveries (
      debt_id,
      status,
      attempt_count,
      claimed_at,
      claim_expires_at,
      provider_message_id,
      error_message,
      sent_at,
      created_at,
      updated_at
    )
    select
      c.debt_id,
      'sending',
      1,
      v_now,
      v_now + interval '15 minutes',
      null,
      null,
      null,
      v_now,
      v_now
    from candidates c
    on conflict (debt_id) do update
    set
      status = 'sending',
      attempt_count = public.owner_cancellation_debt_reminder_deliveries.attempt_count + 1,
      claimed_at = v_now,
      claim_expires_at = v_now + interval '15 minutes',
      error_message = null,
      sent_at = null,
      updated_at = v_now
    where public.owner_cancellation_debt_reminder_deliveries.status = 'failed'
       or (
         public.owner_cancellation_debt_reminder_deliveries.status = 'sending'
         and public.owner_cancellation_debt_reminder_deliveries.claim_expires_at is not null
         and public.owner_cancellation_debt_reminder_deliveries.claim_expires_at <= v_now
       )
    returning
      public.owner_cancellation_debt_reminder_deliveries.id,
      public.owner_cancellation_debt_reminder_deliveries.debt_id
  )
  select
    cl.id,
    d.id,
    d.owner_id,
    d.amount_minor,
    d.currency,
    d.due_at,
    p.email,
    p.full_name,
    p.preferred_language,
    r.id,
    r.offer_name
  from claimed cl
  join public.owner_cancellation_debts d
    on d.id = cl.debt_id
  join public.reservation_cancellations c
    on c.id = d.cancellation_id
  join public.reservations r
    on r.id = c.reservation_id
  join public.profiles p
    on p.id = d.owner_id
  where d.status = 'open'
    and d.due_at <= v_now
    and d.currency = 'czk'
    and c.cancellation_kind = 'paid_refund'
    and c.cancelled_by_role = 'owner'
    and r.owner_id = d.owner_id
    and r.status = 'cancelled';
end;
$function$;

revoke all on function public.claim_overdue_owner_debt_reminders(integer)
  from public, anon, authenticated;
grant execute on function public.claim_overdue_owner_debt_reminders(integer)
  to service_role;

commit;
