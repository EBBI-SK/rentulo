-- Rentulo / BOD 5: date-based discovery without exposing reservation records.
-- A result is potentially available if at least one supported 15-minute
-- pickup slot passes the SAME two-hour conflict RPC used on the detail page.
-- The reservation INSERT guard remains the final authority.
BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('public.has_offer_reservation_time_conflict(uuid,date,date,time without time zone)') IS NULL THEN
    RAISE EXCEPTION 'BOD 5 requires the existing exact pickup-time conflict guard';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.get_available_offer_ids_for_dates(
  p_offer_ids uuid[],
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (offer_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  -- Small, bounded batches prevent untrusted public callers from exhausting
  -- the database with arbitrarily large offer arrays.
  IF p_offer_ids IS NULL OR cardinality(p_offer_ids) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Expected between 1 and 50 offer IDs' USING ERRCODE = '22023';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL
    OR p_start_date < (now() AT TIME ZONE 'Europe/Prague')::date
    OR (p_end_date - p_start_date) NOT BETWEEN 1 AND 365 THEN
    RAISE EXCEPTION 'Invalid search date range' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
    SELECT offer.id
    FROM public.offers AS offer
    JOIN (
      SELECT DISTINCT requested.id
      FROM unnest(p_offer_ids) AS requested(id)
      WHERE requested.id IS NOT NULL
    ) AS requested ON requested.id = offer.id
    WHERE offer.status = 'active'::public.offer_status
      AND (p_end_date - p_start_date) >= offer.min_rental_days
      AND EXISTS (
        SELECT 1
        FROM generate_series(0, 95) AS pickup(slot)
        WHERE ((p_start_date + make_time(pickup.slot / 4, (pickup.slot % 4) * 15, 0))
                 AT TIME ZONE 'Europe/Prague') >= now()
          AND NOT public.has_offer_reservation_time_conflict(
            offer.id,
            p_start_date,
            p_end_date,
            make_time(pickup.slot / 4, (pickup.slot % 4) * 15, 0)
          )
      );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_available_offer_ids_for_dates(uuid[], date, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_available_offer_ids_for_dates(uuid[], date, date)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_available_offer_ids_for_dates(uuid[], date, date) IS
  'BOD5: Returns only IDs of public active offers with at least one valid quarter-hour pickup slot; no reservation details. Final booking check is authoritative.';

COMMIT;
