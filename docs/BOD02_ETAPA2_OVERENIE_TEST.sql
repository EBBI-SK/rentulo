-- BOD 02 / Stage 2: read-only verification, Supabase TEST SQL Editor.
-- Do not edit any gate. All values must be false until a separate
-- approved TEST integration run. No private email or UUID is returned.
SELECT
  EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name='rentulo_project_url'
      AND btrim(decrypted_secret,'/')='https://vspposovhdgvbeukoivh.supabase.co'
  ) AS je_test,
  (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public'
      AND ((table_name='reservations' AND column_name='gdpr_finalized_at')
       OR (table_name='offers' AND column_name='gdpr_deleted_at'))
  ) AS trusted_time_columns,
  (
    SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('zzzzzzz_gdpr_stamp_finalized_at',
      'zzzzzzz_gdpr_stamp_offer_deleted_at') AND tgenabled='O'
  ) AS trusted_time_triggers,
  (
    SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relrowsecurity
      AND c.relname IN ('gdpr_retention_execution_gate',
        'gdpr_retention_run_log','gdpr_retention_category_approvals',
        'gdpr_reservation_owner_contact_cleanup_gate',
        'gdpr_photo_cleanup_gate','gdpr_photo_cleanup_jobs')
  ) AS guarded_internal_tables,
  (SELECT is_enabled FROM public.gdpr_reservation_contact_cleanup_gate
   WHERE singleton) AS renter_cleanup_enabled,
  (SELECT is_enabled FROM public.gdpr_reservation_owner_contact_cleanup_gate
   WHERE singleton) AS owner_cleanup_enabled,
  (SELECT is_enabled FROM public.gdpr_retention_execution_gate
   WHERE singleton) AS periodic_cleanup_enabled,
  (SELECT is_enabled FROM public.gdpr_photo_cleanup_gate
   WHERE singleton) AS photo_cleanup_enabled,
  (SELECT count(*) FROM public.gdpr_retention_category_approvals
    WHERE is_enabled) AS enabled_retention_categories,
  (SELECT count(*) FROM public.gdpr_retention_category_approvals)
    AS total_retention_categories,
  (SELECT count(*) FROM cron.job
   WHERE jobname='rentulo-bod02-gdpr-retention-daily-TEST') AS retention_cron_jobs;

-- Counts only, NO writes and NO eligible personal data shown.
SELECT category,eligible_count,applied_count
FROM public.gdpr_retention_maintenance(false);

SELECT public.gdpr_preview_deleted_offer_photos() AS eligible_deleted_offer_photos;
