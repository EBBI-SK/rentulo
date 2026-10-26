-- RENTULO V1 / PROD RELEASE CANDIDATE bd1b8d1 / 2026-10-24.
-- Apply only to a verified PROD database after backup and approval.
-- This SQL is staged separately: never copy over TEST migrations.
-- Cron activation is deferred; no automatic deployment is authorized.

-- BOD 12 / P1-2 (PROD): phone changes invalidate SMS opt-in in the same transaction.
-- This protects changes from every client (including direct DB API calls),
-- not only from the settings page. Existing opt-ins and other profile fields
-- are unchanged by installing this migration.
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
