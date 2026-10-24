-- RENTULO V1 / PROD RELEASE CANDIDATE bd1b8d1 / 2026-10-24.
-- Apply only to a verified PROD database after backup and approval.
-- This SQL is staged separately: never copy over TEST migrations.
-- Cron activation is deferred; no automatic deployment is authorized.

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

-- KROK 79: PostgreSQL enum additions commit before the value is used.
-- Refuse every project except the explicitly approved Rentulo PROD database.
do $prod_project$
begin
  if not exists (
    select 1 from vault.decrypted_secrets v
    where v.name = 'rentulo_prod_release_target'
      and btrim(v.decrypted_secret, '/') = 'tfvgxrdjrpicgtvovehl'
  ) then
    raise exception 'KROK 79 is authorized only for the Rentulo PROD Supabase project';
  end if;
end;
$prod_project$;

alter type public.reservation_status add value if not exists 'no_show';
