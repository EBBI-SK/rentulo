-- RENTULO SEO 19B/3 / TEST ONLY / 2026-11-09
-- Dedicated category+city SEO pages backed only by active public offers.
-- Apply ONLY to Supabase TEST before deploying the TEST site. Never run in PROD.
BEGIN;

DO $guard$
DECLARE v_columns text[]; v_options text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name = 'rentulo_project_url'
      AND btrim(s.decrypted_secret, '/') = 'https://vspposovhdgvbeukoivh.supabase.co'
  ) THEN
    RAISE EXCEPTION 'SEO 19B3 is TEST-only; PROD forbidden' USING ERRCODE = '42501';
  END IF;
  IF to_regclass('public.offers') IS NULL
      OR to_regclass('public.public_offers') IS NULL
      OR to_regclass('public.seo19b2_subcategory_overrides') IS NULL
      OR to_regprocedure('public.seo19b2_classify(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'SEO 19B3: required TEST 19B2 objects missing';
  END IF;
  SELECT array_agg(column_name::text ORDER BY ordinal_position)
  INTO v_columns
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'public_offers';
  IF v_columns IS DISTINCT FROM ARRAY[
    'id','owner_id','name','category','description','city','postal_code',
    'price_per_day','status','photo_url','pickup_mode','created_at',
    'updated_at','offer_number','min_rental_days','subcategory_slug'
  ]::text[] THEN
    RAISE EXCEPTION 'SEO 19B3: public_offers columns changed; review before migration';
  END IF;
  SELECT c.reloptions INTO v_options FROM pg_class c
  WHERE c.oid = 'public.public_offers'::regclass;
  IF NOT ('security_invoker=false' = ANY(coalesce(v_options, ARRAY[]::text[])))
     OR NOT ('security_barrier=true' = ANY(coalesce(v_options, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'SEO 19B3: public_offers security settings changed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'offers'
      AND column_name = 'subcategory_slug' AND is_generated = 'ALWAYS'
  ) THEN
    RAISE EXCEPTION 'SEO 19B3: 19B2 generated classification missing';
  END IF;
END;
$guard$;

-- Explicit Czech/central-European transliteration with no unaccent extension.
-- STRICTLY derived from the existing city field: no city guesses, no geolocation.
-- PostgreSQL IMMUTABLE function can be used in a STORED generated column.
CREATE FUNCTION public.seo19b3_city_slug(p_city text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $sql$
  WITH original AS (
    SELECT btrim(coalesce(p_city, '')) AS value
  ),
  candidate AS (
    SELECT btrim(regexp_replace(
      translate(replace(lower(normalize(value, NFC)), 'ß', 'ss'), 'áàâäãåąăčćçďđéěèêëęíìîïĺľłńňóôöòõőøřŕšśşťúůùûüýÿžźż', 'aaaaaaaacccddeeeeeeiiiilllnnooooooorrssstuuuuuyyzzz'),
      '[^a-z0-9]+', '-', 'g'
    ), '-') AS slug,
    value AS city
    FROM original
  )
  SELECT CASE
    WHEN char_length(city) BETWEEN 2 AND 80
      AND city !~ '[<>/@?#]'
      AND char_length(slug) BETWEEN 2 AND 64
      AND slug ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
      AND slug NOT IN (
        'cz', 'cr', 'cesko', 'ceska-republika', 'czech-republic',
        'neuvedeno', 'nezname', 'neznamy', 'online', 'test'
      )
    THEN slug ELSE NULL END
  FROM candidate;
$sql$;

-- Stored field is generated for existing offers by this DDL, without updating
-- business status, reservations, payments or moderation timestamps/triggers.
ALTER TABLE public.offers
  ADD COLUMN seo_city_slug text
  GENERATED ALWAYS AS (public.seo19b3_city_slug(city)) STORED;

-- Index supports precise category + city slug filtering on active listings.
CREATE INDEX seo19b3_public_category_city_slug_id_idx
  ON public.offers (category, seo_city_slug, id)
  WHERE status = 'active'::public.offer_status AND seo_city_slug IS NOT NULL;

-- Preserve all 16 public columns from 19B2, append only a derived public slug.
-- Preserve the 19B2 manual subcategory override and active-only view predicate.
CREATE OR REPLACE VIEW public.public_offers
WITH (security_invoker = false, security_barrier = true) AS
SELECT
  o.id, o.owner_id, o.name, o.category, o.description, o.city,
  o.postal_code, o.price_per_day, o.status, o.photo_url,
  o.pickup_mode, o.created_at, o.updated_at, o.offer_number,
  o.min_rental_days,
  COALESCE(CASE WHEN ov.category = o.category THEN ov.slug END, o.subcategory_slug)
    AS subcategory_slug,
  o.seo_city_slug AS seo_city_slug
FROM public.offers o
LEFT JOIN public.seo19b2_subcategory_overrides ov ON ov.offer_id = o.id
WHERE o.status = 'active'::public.offer_status;

REVOKE ALL ON TABLE public.public_offers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.public_offers TO anon, authenticated;
-- The immutable, read-only generated expression must remain callable on
-- authenticated INSERT/UPDATE of offers; no privileged access is granted.
REVOKE ALL ON FUNCTION public.seo19b3_city_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seo19b3_city_slug(text)
  TO anon, authenticated, service_role;

COMMENT ON COLUMN public.offers.seo_city_slug IS
  'SEO 19B3 TEST: immutable stored slug of the public city; cannot be client-written.';
COMMENT ON COLUMN public.public_offers.seo_city_slug IS
  'SEO 19B3 TEST: public city slug, exposed only for active offers.';
COMMIT;
