-- RENTULO PROD SEO 19B: READ-ONLY PRE-FLIGHT. Do not change any data.
-- Run in Supabase PROD SQL Editor, review result BEFORE either migration or Vercel deployment.
-- Do not paste the DDL migrations until the operator has confirmed the results.
WITH project AS (
  SELECT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name = 'rentulo_project_url'
      AND btrim(s.decrypted_secret, '/') = 'https://tfvgxrdjrpicgtvovehl.supabase.co'
  ) AS correct_prod_project
), view_info AS (
  SELECT array_agg(c.column_name::text ORDER BY c.ordinal_position) AS public_columns
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'public_offers'
), view_security AS (
  SELECT c.reloptions AS view_options
  FROM pg_class c WHERE c.oid = to_regclass('public.public_offers')
)
SELECT
  project.correct_prod_project,
  to_regclass('public.offers') IS NOT NULL AS offers_exists,
  to_regprocedure('public.platform_admin_assert(text)') IS NOT NULL AS admin_guard_exists,
  view_info.public_columns,
  view_security.view_options,
  (SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='offers'
       AND column_name='subcategory_slug') IS NOT NULL AS subcategory_already_exists,
  (SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='offers'
       AND column_name='seo_city_slug') IS NOT NULL AS city_already_exists,
  (SELECT count(*) FROM public.offers) AS offer_count
FROM project CROSS JOIN view_info CROSS JOIN view_security;
-- Before 19B2: correct_prod_project, offers_exists, admin_guard_exists must be true.
-- public_columns must equal 15 original public fields ending with min_rental_days.
-- view_options must include security_invoker=false AND security_barrier=true.
-- subcategory_already_exists and city_already_exists must both be false.
-- If a field differs, STOP: do not rerun/relax the migration guard.
