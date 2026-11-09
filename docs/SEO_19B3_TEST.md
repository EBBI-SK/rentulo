# Rentulo SEO 19B/3 - real category + city SEO pages (TEST)

Base: TEST `main`, PR #144 merge `320c597` (2026-11-09).
**This ZIP is not a PROD release.** It changes no bookings, payments, search forms, or login.

## User-visible behavior

- New stable path `/kategorie/{category}/mesto/{city-slug}` (example: `/kategorie/stavba/mesto/zlin`).
- No user selection added: the city is already supplied on each offer.
- Czech city names are converted to ASCII slugs, e.g. `Zlin`/`Zlín` => `zlin`, `Uherské Hradiště` => `uherske-hradiste`.
- Public pages use the existing restricted `public_offers` view with the `category` and `seo_city_slug` filters.
- Only active offers can appear. An unknown, invalid or empty category+city route returns HTTP 404 and `noindex`; Supabase failures return HTTP 503 and `noindex` (not misleading 200s).
- Each populated page has a unique `title`, `description`, H1, canonical, real offer cards, category breadcrumbs, and pagination without needing JavaScript.
- Existing category and subcategory pages link to real city pages only when a public offer on the visible page proves the link is populated.
- Live PROD sitemap will include exactly one URL per actual active `(category, city-slug)` pair, never invented cities, and never TEST offer data. TEST still returns HTTP 404 for `/sitemap.xml`.
- The prelaunch PROD/TEST/Preview `X-Robots-Tag: noindex` policy remains unchanged.
- The sitemap keeps under 50,000 URLs by limiting the number of active offers to 24,900 in this version; before growth reaches that threshold, implement sitemap splitting instead of raising the cap.

## SQL migration - MUST be done before TEST web deploy

1. **TEST only.** Open Supabase project `vspposovhdgvbeukoivh`, SQL Editor. Do **not** run this on Supabase PROD.
2. Confirm the 19B/2 migration was applied: `public.public_offers` has 16 columns ending with `subcategory_slug`, and view options are `security_invoker=false,security_barrier=true`.
3. Apply the entire file `supabase/migrations/20261109183000_seo19b3_category_cities_TEST.sql` once. The migration has an exact TEST-project guard and executes within `BEGIN`/`COMMIT`.
4. If any error occurs, do not rerun it; send the exact error for inspection. No blind SQL fixes.
5. After success, run this read-only check:

```sql
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'offers'
            AND column_name = 'seo_city_slug' AND is_generated = 'ALWAYS') AS city_generated,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'public_offers'
            AND column_name = 'seo_city_slug') AS public_city,
  public.seo19b3_city_slug('Zlín') AS example_city_slug,
  (SELECT count(*) FROM public.public_offers) AS active_offers,
  (SELECT count(*) FROM public.public_offers WHERE seo_city_slug IS NOT NULL) AS classified_cities;
```

Expected: `city_generated = true`, `public_city = true`, `example_city_slug = zlin`; counts depend on the real TEST data.

## Technical scope and safety

- New immutable `seo19b3_city_slug(text)` function; stored generated, non-client-writable `offers.seo_city_slug`.
- Partial index `(category, seo_city_slug, id)` on active offers only.
- `public_offers` preserves all original 16 fields, the 19B/2 manual override, `status=active`, `security_invoker=false`, `security_barrier=true`, and its existing SELECT privileges. Only a 17th derived, non-private city slug is appended.
- No mass UPDATE of offers, and no updates to reservations, transfers, balances, or owner contacts.
- Old `/kategorie/{category}/{subcategory}` route stays intact. City rewrite is more specific and registered first.
- The Vercel city function requires only the existing publishable Supabase credentials and reads no private tables.
- Environment separation is enforced by `getOfferSeoConfig`: TEST data on rentulo.eu, independent PROD public credentials on rentulo.com. Any deploy to PROD must be independently reviewed and explicitly approved.
- `git diff --check`, targeted unit tests, complete regression tests, TEST build and simulated PROD build are the local acceptance gates.

## Known limitations

- A city name alone is not a unique geographic identifier in the Czech Republic (e.g. multiple towns named Nova Ves); this feature does not invent a region or pretend to distinguish identical city names. Region-aware pages require reliable administrative or address identifiers in a later stage.
- Free-text city misspellings are not inferred or auto-corrected. Unsupported or malformed city values are left unindexed; users can correct their offer city through the existing workflow.
- The SQL migration is statically validated locally; only the authorized user may execute and verify it in Supabase TEST.
