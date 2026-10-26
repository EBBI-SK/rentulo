-- RENTULO V1 / PROD RELEASE CANDIDATE bd1b8d1 / 2026-10-24.
-- Apply only to a verified PROD database after backup and approval.
-- This SQL is staged separately: never copy over TEST migrations.
-- Cron activation is deferred; no automatic deployment is authorized.

-- RENTULO V1 / PROD ONLY / 2026-10-24.
-- A confirmed early return releases the offer TWO HOURS after its trusted
-- actual return timestamp, instead of after the original scheduled end.
-- Pending/approved/paid/picked_up continue to block their agreed intervals.
-- Returned reservations without a trusted timestamp still block until their
-- agreed end (+2h); cancelled/expired/rejected/no_show remain nonblocking.
-- No reservation, payment, PIN, fee, Stripe or notification records are changed.
BEGIN;


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


DO $rentulo_prod_source_guard$
DECLARE
  v_current_definition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name = 'rentulo_prod_release_target'
      AND btrim(s.decrypted_secret, '/') =
          'tfvgxrdjrpicgtvovehl'
  ) THEN
    RAISE EXCEPTION 'PROD only: wrong Supabase project; no changes made';
  END IF;

  IF to_regprocedure('public.has_offer_reservation_time_conflict(uuid,date,date,time without time zone)') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns c
       WHERE c.table_schema = 'public'
         AND c.table_name = 'reservations'
         AND c.column_name = 'gdpr_finalized_at'
         AND c.data_type = 'timestamp with time zone'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_trigger t
       WHERE t.tgrelid = 'public.reservations'::regclass
         AND t.tgname = 'zzzzzzz_gdpr_stamp_finalized_at'
         AND t.tgenabled <> 'D'
     )
  THEN
    RAISE EXCEPTION 'Expected availability function or trusted return timestamp is missing; no changes made';
  END IF;

  v_current_definition := pg_get_functiondef(
    'public.has_offer_reservation_time_conflict(uuid,date,date,time without time zone)'::regprocedure
  );

  IF position('r.status::text in (''pending'', ''approved'', ''paid'', ''picked_up'', ''returned'')' IN v_current_definition) = 0
     OR position('r.pickup_time is null' IN v_current_definition) = 0
     OR position('r.pickup_time is not null' IN v_current_definition) = 0
     OR position('interval ''2 hours''' IN v_current_definition) = 0
     OR position('at time zone ''Europe/Prague''' IN v_current_definition) = 0
  THEN
    RAISE EXCEPTION 'Unexpected availability rule; no changes made';
  END IF;
END;
$rentulo_prod_source_guard$;

-- Replaces ONLY the existing boolean time-conflict lookup. The reservation
-- INSERT trigger already calls this same function under the per-offer lock.
-- A late confirmed return also extends blocking until actual return +2h.
-- Historical rows with no gdpr_finalized_at conservatively use scheduled end.
CREATE OR REPLACE FUNCTION public.has_offer_reservation_time_conflict(
  p_offer_id uuid,
  p_start_date date,
  p_end_date date,
  p_pickup_time time without time zone
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_offer_id IS NULL
      OR p_start_date IS NULL
      OR p_end_date IS NULL
      OR p_end_date <= p_start_date
      OR p_pickup_time IS NULL
    THEN true
    ELSE EXISTS (
      SELECT 1
      FROM public.reservations r
      WHERE r.offer_id = p_offer_id
        AND r.status::text IN ('pending', 'approved', 'paid', 'picked_up', 'returned')
        AND (
          (
            r.pickup_time IS NOT NULL
            AND ((p_start_date + p_pickup_time) AT TIME ZONE 'Europe/Prague')
                < (
                  CASE
                    WHEN r.status::text = 'returned'
                      AND r.gdpr_finalized_at IS NOT NULL
                    THEN r.gdpr_finalized_at
                    ELSE ((r.end_date + r.pickup_time) AT TIME ZONE 'Europe/Prague')
                  END
                ) + INTERVAL '2 hours'
            AND ((p_end_date + p_pickup_time) AT TIME ZONE 'Europe/Prague')
                + INTERVAL '2 hours'
                > ((r.start_date + r.pickup_time) AT TIME ZONE 'Europe/Prague')
          )
          OR (
            -- Legacy reservation with unknown agreed pickup time: keep the
            -- conservative protection rather than guessing a release time.
            r.pickup_time IS NULL
            AND p_start_date <= r.end_date
            AND p_end_date >= r.start_date
          )
        )
    )
  END;
$function$;

REVOKE ALL ON FUNCTION public.has_offer_reservation_time_conflict(
  uuid, date, date, time without time zone
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_offer_reservation_time_conflict(
  uuid, date, date, time without time zone
) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.has_offer_reservation_time_conflict(
  uuid, date, date, time without time zone
) IS 'Boolean availability guard: returned releases after trusted actual return +2h; otherwise agreed end +2h. No booking details exposed.';

COMMIT;
