-- RENTULO PROD SEO 19B: READ-ONLY POST-MIGRATION CHECK.
-- Execute on the verified production SQL editor ONLY AFTER both approved PROD migrations.
SELECT
  (SELECT count(*) FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'public_offers') AS public_column_count,
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='offers' AND column_name='subcategory_slug' AND is_generated='ALWAYS') AS subcategory_generated,
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='offers' AND column_name='seo_city_slug' AND is_generated='ALWAYS') AS city_generated,
  public.seo19b3_city_slug('Zlín') AS expected_zlin,
  (SELECT count(*) FROM public.public_offers) AS public_active_offers,
  (SELECT count(*) FROM public.public_offers WHERE subcategory_slug IS NOT NULL) AS classified_active_offers,
  (SELECT count(*) FROM public.public_offers WHERE seo_city_slug IS NOT NULL) AS city_active_offers;
-- Expected public_column_count = 17; flags both true; expected_zlin = 'zlin'.
-- Counts depend on the real PROD offers. Review if any value differs.
