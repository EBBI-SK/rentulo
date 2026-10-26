-- BOD 12 / P1-2 (TEST): phone changes invalidate SMS opt-in in the same transaction.
-- This protects changes from every client (including direct DB API calls),
-- not only from the settings page. Existing opt-ins and other profile fields
-- are unchanged by installing this migration.
begin;

create or replace function public.reset_sms_opt_in_on_phone_change()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.phone is distinct from old.phone then
    new.sms_notifications := false;
  end if;
  return new;
end;
$function$;

revoke all on function public.reset_sms_opt_in_on_phone_change()
  from public, anon, authenticated;
grant execute on function public.reset_sms_opt_in_on_phone_change()
  to service_role;

drop trigger if exists trg_reset_sms_opt_in_on_phone_change on public.profiles;
create trigger trg_reset_sms_opt_in_on_phone_change
  before update of phone on public.profiles
  for each row
  execute function public.reset_sms_opt_in_on_phone_change();

commit;
