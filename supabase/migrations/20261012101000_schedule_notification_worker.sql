begin;

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

select cron.schedule(
  'rentulo-process-reservation-notifications-every-minute',
  '* * * * *',
  $cron$
    select net.http_post(
      url := trim(trailing '/' from cfg.project_url)
        || '/functions/v1/process-reservation-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-rentulo-cron-secret', cfg.cron_secret
      ),
      body := jsonb_build_object('limit', 15),
      timeout_milliseconds := 60000
    ) as request_id
    from (
      select
        max(s.decrypted_secret) filter (
          where s.name = 'rentulo_project_url'
        ) as project_url,
        max(s.decrypted_secret) filter (
          where s.name = 'rentulo_notification_cron_secret'
        ) as cron_secret
      from vault.decrypted_secrets s
      where s.name in (
        'rentulo_project_url', 'rentulo_notification_cron_secret'
      )
    ) cfg
    where cfg.project_url ~ '^https://[a-z0-9-]+[.]supabase[.]co/?$'
      and length(cfg.cron_secret) >= 64;
  $cron$
);

commit;
