begin;

-- Authenticated owners need a narrow read-only view of their own cancellation
-- debts for the My listings UI. Keep the financial table itself inaccessible and
-- expose only the fields required to display/payment-start the debt.
create or replace function public.get_my_owner_cancellation_debts()
returns table(
  id uuid,
  amount_minor integer,
  currency text,
  status text,
  due_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    d.id,
    d.amount_minor,
    d.currency,
    d.status,
    d.due_at
  from public.owner_cancellation_debts d
  where d.owner_id = auth.uid()
  order by
    case when d.status = 'open' then 0 else 1 end,
    d.due_at asc,
    d.issued_at desc;
$function$;

revoke all on function public.get_my_owner_cancellation_debts()
  from public, anon;
grant execute on function public.get_my_owner_cancellation_debts()
  to authenticated;

commit;
