-- The new expiration process uses the already provisioned TEST/PROD-safe
-- Vault project URL and independent Cron secret from BOD 13.
-- An unconfigured environment makes no outbound calls.
begin;

select cron.schedule(
  'rentulo-expire-unpaid-reservations-every-5-minutes',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url := trim(trailing '/' from cfg.project_url)
        || '/functions/v1/expire-reservations',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-rentulo-cron-secret', cfg.cron_secret
      ),
      body := '{}'::jsonb,
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
      where s.name in ('rentulo_project_url', 'rentulo_notification_cron_secret')
    ) cfg
    where cfg.project_url ~ '^https://[a-z0-9-]+[.]supabase[.]co/?$'
      and length(cfg.cron_secret) >= 64;
  $cron$
);

commit;
