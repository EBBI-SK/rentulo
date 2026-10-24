-- RENTULO V1 / PROD RELEASE CANDIDATE bd1b8d1 / 2026-10-24.
-- Apply only to a verified PROD database after backup and approval.
-- This SQL is staged separately: never copy over TEST migrations.
-- Cron activation is deferred; no automatic deployment is authorized.

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


-- BOD 13: database cron runs only in the configured environment. Without
-- rentulo_project_url it does not call any Supabase project. No secrets in Git.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

do $block$
begin
  if not exists (select 1 from vault.secrets where name = 'rentulo_project_url') then
    perform vault.create_secret(
      'UNCONFIGURED', 'rentulo_project_url',
      'Supabase project URL for Rentulo cron jobs'
    );
  end if;
end;
$block$;

do $block$
declare
  v_secret text;
begin
  if not exists (
    select 1 from vault.secrets where name = 'rentulo_notification_cron_secret'
  ) then
    v_secret :=
      replace(gen_random_uuid()::text, '-', '') ||
      replace(gen_random_uuid()::text, '-', '') ||
      replace(gen_random_uuid()::text, '-', '') ||
      replace(gen_random_uuid()::text, '-', '');
    perform vault.create_secret(
      v_secret, 'rentulo_notification_cron_secret',
      'Dedicated secret authenticating the unified reservation notification worker'
    );
  end if;
end;
$block$;

create or replace function public.verify_reservation_notification_cron_secret(
  p_secret text
)
returns boolean
language sql
security definer
set search_path = ''
as $function$
  select coalesce(
    length(p_secret) >= 64
    and exists (
      select 1 from vault.decrypted_secrets s
      where s.name = 'rentulo_notification_cron_secret'
        and s.decrypted_secret = p_secret
    ),
    false
  );
$function$;
revoke all on function public.verify_reservation_notification_cron_secret(text)
  from public, anon, authenticated;
grant execute on function public.verify_reservation_notification_cron_secret(text)
  to service_role;

-- PROD cron activation intentionally deferred to BOD 6.

commit;
