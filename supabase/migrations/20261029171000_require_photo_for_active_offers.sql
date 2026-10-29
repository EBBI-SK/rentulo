-- Rentulo: an active offer must have a photo; drafts and hidden offers may remain photo-free.
-- Apply to Supabase TEST first. Existing active offers without photos must be
-- corrected before applying; this migration does not modify user data.
BEGIN;

DO $check$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.offers
    WHERE status = 'active'::public.offer_status
      AND nullif(btrim(photo_url), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'PHOTO_REQUIRED: active offers without photo exist; add photos or deactivate before migrating';
  END IF;
END;
$check$;

ALTER TABLE public.offers
  ADD CONSTRAINT offers_require_photo_when_active
  CHECK (
    status <> 'active'::public.offer_status
    OR nullif(btrim(photo_url), '') IS NOT NULL
  );

COMMIT;
