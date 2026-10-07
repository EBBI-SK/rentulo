begin;

-- Supabase Cron invokes the overdue-debt reminder worker once per hour. The
-- worker is protected by a dedicated random secret stored in Vault; no service
-- role key is copied into the database, migration history or Git repository.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- Environment-specific project URL. It intentionally starts empty so applying
-- the same migrations to a local Supabase stack can never call production.
-- Production sets this Vault value once after db push.
do $block$
begin
  if not exists (
    select 1
    from vault.secrets
    where name = 'rentulo_project_url'
  ) then
    perform vault.create_secret(
      'UNCONFIGURED',
      'rentulo_project_url',
      'Base Supabase project URL used by Rentulo database cron jobs'
    );
  end if;
end;
$block$;

-- Generate the Cron authentication secret entirely inside Postgres. The raw
-- value remains encrypted in Vault and is only decrypted at request time.
do $block$
declare
  v_cron_secret text;
begin
  if not exists (
    select 1
    from vault.secrets
    where name = 'rentulo_owner_debt_cron_secret'
  ) then
    v_cron_secret :=
      replace(gen_random_uuid()::text, '-', '') ||
      replace(gen_random_uuid()::text, '-', '') ||
      replace(gen_random_uuid()::text, '-', '') ||
      replace(gen_random_uuid()::text, '-', '');

    perform vault.create_secret(
      v_cron_secret,
      'rentulo_owner_debt_cron_secret',
      'Authentication secret for the overdue owner debt reminder cron worker'
    );
  end if;
end;
$block$;

-- Only the service-role client inside the Edge Function may validate the Cron
-- secret. Browser roles cannot read Vault or call this verifier.
create or replace function public.verify_overdue_owner_debt_cron_secret(
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
      select 1
      from vault.decrypted_secrets s
      where s.name = 'rentulo_owner_debt_cron_secret'
        and s.decrypted_secret = p_secret
    ),
    false
  );
$function$;

revoke all on function public.verify_overdue_owner_debt_cron_secret(text)
  from public, anon, authenticated;
grant execute on function public.verify_overdue_owner_debt_cron_secret(text)
  to service_role;

-- An existing job with the same name is replaced by pg_cron, which keeps this
-- schedule deterministic across restores and controlled re-application.
select cron.schedule(
  'rentulo-send-overdue-owner-debt-reminders-hourly',
  '0 * * * *',
  $cron$
    select net.http_post(
      url := trim(trailing '/' from cfg.project_url)
        || '/functions/v1/send-overdue-owner-debt-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-rentulo-cron-secret', cfg.cron_secret
      ),
      body := jsonb_build_object('limit', 25),
      timeout_milliseconds := 10000
    ) as request_id
    from (
      select
        max(s.decrypted_secret) filter (
          where s.name = 'rentulo_project_url'
        ) as project_url,
        max(s.decrypted_secret) filter (
          where s.name = 'rentulo_owner_debt_cron_secret'
        ) as cron_secret
      from vault.decrypted_secrets s
      where s.name in (
        'rentulo_project_url',
        'rentulo_owner_debt_cron_secret'
      )
    ) cfg
    where cfg.project_url ~ '^https://[a-z0-9-]+[.]supabase[.]co/?$'
      and length(cfg.cron_secret) >= 64;
  $cron$
);

commit;
