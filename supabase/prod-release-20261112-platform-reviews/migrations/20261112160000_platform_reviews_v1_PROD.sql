-- RENTULO V1 / Platform reviews / PROD ONLY.
-- Installation is intentionally limited to the PROD Supabase project.
-- Reviewed production release. No TEST data will be imported.
-- No automatic backfill, no invitations for no-show, and no change to peer reviews.
BEGIN;

DO $prod_guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'rentulo_project_url'
      AND btrim(decrypted_secret, '/') = 'https://tfvgxrdjrpicgtvovehl.supabase.co'
  ) THEN
    RAISE EXCEPTION 'Platform reviews V1 is PROD-only; expected production Supabase project not verified';
  END IF;
  IF to_regclass('public.reservation_notification_deliveries') IS NULL
     OR to_regclass('public.reservation_email_deliveries') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'reservations'
         AND column_name = 'gdpr_finalized_at'
     ) THEN
    RAISE EXCEPTION 'Required Rentulo notification/finalization infrastructure is missing';
  END IF;
END;
$prod_guard$;

CREATE TABLE IF NOT EXISTS public.platform_reviews (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '' CHECK (char_length(comment) <= 500),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  CONSTRAINT platform_reviews_publication_pair CHECK (
    (status = 'published' AND published_at IS NOT NULL)
    OR (status <> 'published' AND published_at IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS platform_reviews_published_idx
  ON public.platform_reviews(published_at DESC, user_id)
  WHERE status = 'published' AND comment <> '';
ALTER TABLE public.platform_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_reviews FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.platform_reviews TO service_role;

-- Use server-controlled eligibility, not a flag passed from the browser.
-- Only the owner or renter of a genuinely picked-up, confirmed-returned booking.
CREATE OR REPLACE FUNCTION public.platform_review_is_eligible(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.reservations r
    WHERE r.status::text = 'returned'
      AND r.gdpr_finalized_at IS NOT NULL
      AND (r.owner_id = p_user OR r.renter_id = p_user)
  );
$function$;
REVOKE ALL ON FUNCTION public.platform_review_is_eligible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_review_is_eligible(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_platform_review()
RETURNS TABLE (eligible boolean, rating smallint, comment text, review_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT public.platform_review_is_eligible(auth.uid()),
         v.rating, v.comment, v.status
  FROM (SELECT 1) marker
  LEFT JOIN public.platform_reviews v ON v.user_id = auth.uid()
  WHERE auth.uid() IS NOT NULL;
$function$;
REVOKE ALL ON FUNCTION public.get_my_platform_review() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_platform_review() TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_platform_review(p_rating integer, p_comment text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_comment text := btrim(coalesce(p_comment, ''));
  v_name text;
  v_parts text[];
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'Rating must be 1-5';
  END IF;
  IF char_length(v_comment) > 500 THEN
    RAISE EXCEPTION 'Review text is too long';
  END IF;
  IF NOT public.platform_review_is_eligible(v_user) THEN
    RAISE EXCEPTION 'A confirmed, completed rental is required';
  END IF;

  SELECT btrim(coalesce(p.full_name, '')) INTO v_name
  FROM public.profiles p WHERE p.id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile unavailable'; END IF;
  -- Only a first name and one initial may be shown, never a full profile name.
  v_parts := regexp_split_to_array(v_name, '\s+');
  v_name := CASE
    WHEN nullif(v_name, '') IS NULL THEN 'Uživatel Rentula'
    WHEN cardinality(v_parts) > 1 THEN left(v_parts[1], 50) || ' ' || left(v_parts[2], 1) || '.'
    ELSE left(v_parts[1], 50)
  END;

  INSERT INTO public.platform_reviews (user_id, rating, comment, display_name)
    VALUES (v_user, p_rating, v_comment, v_name)
  ON CONFLICT (user_id) DO UPDATE
    SET rating = EXCLUDED.rating,
        comment = EXCLUDED.comment,
        display_name = EXCLUDED.display_name,
        status = 'pending',
        published_at = NULL,
        updated_at = clock_timestamp();
END;
$function$;
REVOKE ALL ON FUNCTION public.submit_platform_review(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_platform_review(integer, text) TO authenticated;

-- Public RPCs return only moderated review text and display names.
-- Identifiers, emails and unpublished reviews never leave this table.
CREATE OR REPLACE FUNCTION public.get_platform_review_summary()
RETURNS TABLE (rating_count bigint, rating_average numeric, latest_rating smallint,
               latest_comment text, latest_name text, latest_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT s.rating_count, s.rating_average,
         v.rating, v.comment, v.display_name, v.published_at
  FROM (
    SELECT count(*) AS rating_count, round(avg(rating)::numeric, 1) AS rating_average
    FROM public.platform_reviews WHERE status = 'published'
  ) s
  LEFT JOIN LATERAL (
    SELECT rating, comment, display_name, published_at
    FROM public.platform_reviews
    WHERE status = 'published' AND comment <> ''
    ORDER BY published_at DESC, user_id
    LIMIT 1
  ) v ON true;
$function$;
REVOKE ALL ON FUNCTION public.get_platform_review_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_review_summary() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_platform_reviews(p_offset integer DEFAULT 0)
RETURNS TABLE (rating smallint, comment text, display_name text, published_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF p_offset IS NULL OR p_offset < 0 OR p_offset > 10000 THEN
    RAISE EXCEPTION 'Invalid page offset';
  END IF;
  RETURN QUERY
    SELECT v.rating, v.comment, v.display_name, v.published_at
    FROM public.platform_reviews v
    WHERE v.status = 'published' AND v.comment <> ''
    ORDER BY v.published_at DESC, v.user_id
    LIMIT 6 OFFSET p_offset;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_platform_reviews(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_reviews(integer) TO anon, authenticated;

-- The existing transactional email worker will deliver exactly one invitation
-- per account, 24h after its FIRST confirmed return after activation.
-- A verified, returned status is a prerequisite: never invite on no-show.
CREATE TABLE IF NOT EXISTS public.platform_review_activation (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.platform_review_activation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_review_activation FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.platform_review_activation TO service_role;
INSERT INTO public.platform_review_activation(singleton)
  VALUES (true) ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.reservation_notification_deliveries
  DROP CONSTRAINT IF EXISTS reservation_notification_deliveries_event_type_check;
ALTER TABLE public.reservation_notification_deliveries
  ADD CONSTRAINT reservation_notification_deliveries_event_type_check
  CHECK (event_type IN (
    'new_request', 'approved', 'rejected', 'cancelled', 'paid', 'picked_up',
    'returned', 'paid_cancelled', 'expiry_reminder_pending', 'expiry_reminder_approved',
    'expired_pending', 'expired_approved', 'no_show', 'return_reminder_30m',
    'return_reminder_2h', 'return_not_received',
    'extension_requested', 'extension_approved', 'extension_rejected',
    'extension_paid', 'extension_expired', 'platform_review_invite'
  ));
ALTER TABLE public.reservation_email_deliveries
  DROP CONSTRAINT IF EXISTS reservation_email_deliveries_event_type_check;
ALTER TABLE public.reservation_email_deliveries
  ADD CONSTRAINT reservation_email_deliveries_event_type_check
  CHECK (event_type IN (
    'new_request', 'approved', 'rejected', 'cancelled', 'paid', 'picked_up',
    'returned', 'paid_cancelled', 'expiry_reminder_pending', 'expiry_reminder_approved',
    'expired_pending', 'expired_approved', 'no_show', 'return_reminder_30m',
    'return_reminder_2h', 'return_not_received',
    'extension_requested', 'extension_approved', 'extension_rejected',
    'extension_paid', 'extension_expired', 'platform_review_invite'
  ));
CREATE UNIQUE INDEX IF NOT EXISTS reservation_one_platform_review_invitation_per_account
  ON public.reservation_notification_deliveries(recipient_id)
  WHERE event_type = 'platform_review_invite' AND channel = 'email';

CREATE OR REPLACE FUNCTION public.queue_platform_review_invitation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_activated_at timestamptz;
BEGIN
  IF OLD.status::text <> 'picked_up' OR NEW.status::text <> 'returned'
     OR NEW.gdpr_finalized_at IS NULL THEN RETURN NEW; END IF;
  SELECT activated_at INTO v_activated_at
    FROM public.platform_review_activation WHERE singleton = true;
  IF v_activated_at IS NULL OR NEW.gdpr_finalized_at < v_activated_at THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.reservation_notification_deliveries
    (reservation_id, recipient_id, event_type, channel, next_attempt_at)
  SELECT NEW.id, members.id, 'platform_review_invite', 'email',
         NEW.gdpr_finalized_at + INTERVAL '24 hours'
  FROM (SELECT DISTINCT unnest(ARRAY[NEW.owner_id, NEW.renter_id]) AS id) members
  WHERE members.id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.platform_reviews v WHERE v.user_id = members.id
    )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.queue_platform_review_invitation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_queue_platform_review_invitation ON public.reservations;
CREATE TRIGGER trg_queue_platform_review_invitation
  AFTER UPDATE OF status ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.queue_platform_review_invitation();

COMMIT;
