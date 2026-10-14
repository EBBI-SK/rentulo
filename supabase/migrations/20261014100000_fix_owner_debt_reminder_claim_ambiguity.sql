-- P1 fix (14 Oct 2026): PostgreSQL 42702 in the hourly owner debt reminder.
-- The RETURNS TABLE output parameter debt_id conflicts with the unqualified
-- ON CONFLICT (debt_id) target. Name the existing UNIQUE constraint explicitly.
-- Restore the same service-role-only function, preserving all other behavior.
-- No table data, cron schedule, Edge Function or production settings change.
begin;

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
    on conflict on constraint owner_cancellation_debt_reminder_deliveries_debt_id_key do update
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
