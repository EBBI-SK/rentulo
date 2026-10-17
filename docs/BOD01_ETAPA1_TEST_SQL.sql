-- READ-ONLY checks for Supabase TEST after applying the 20261017180000 migration.
-- Run in TEST SQL Editor only. These statements change no data.
-- All expected and actual timestamps are absolute; the reservation trigger
-- converts the local pickup time using Europe/Prague before calling the function.

with scenarios(scenario, approved_at, pickup_at, expected_deadline) as (
  values
    ('approve five days early', '2026-11-01 09:00:00+01'::timestamptz,
      '2026-11-06 12:00:00+01'::timestamptz, '2026-11-05 12:00:00+01'::timestamptz),
    ('approve 25 hours early', '2026-11-05 11:00:00+01'::timestamptz,
      '2026-11-06 12:00:00+01'::timestamptz, '2026-11-05 12:00:00+01'::timestamptz),
    ('approve at payment cutoff', '2026-11-05 12:00:00+01'::timestamptz,
      '2026-11-06 12:00:00+01'::timestamptz, '2026-11-05 12:30:00+01'::timestamptz),
    ('approve 6 hours early', '2026-11-06 06:00:00+01'::timestamptz,
      '2026-11-06 12:00:00+01'::timestamptz, '2026-11-06 06:30:00+01'::timestamptz),
    ('approve 20 minutes early', '2026-11-06 11:40:00+01'::timestamptz,
      '2026-11-06 12:00:00+01'::timestamptz, '2026-11-06 12:00:00+01'::timestamptz),
    ('pickup time has passed', '2026-11-06 12:00:00+01'::timestamptz,
      '2026-11-06 12:00:00+01'::timestamptz, null::timestamptz),
    ('DST switches to summer time', '2027-03-25 09:00:00+01'::timestamptz,
      '2027-03-28 15:00:00+02'::timestamptz, '2027-03-27 14:00:00+01'::timestamptz)
)
select scenario,
  expected_deadline,
  public.calculate_reservation_payment_deadline(approved_at, pickup_at) as actual_deadline,
  expected_deadline is not distinct from
    public.calculate_reservation_payment_deadline(approved_at, pickup_at) as passed
from scenarios;

-- Expected: seven rows with passed = true.
-- Additionally verify against a NEW reservation end-to-end on TEST:
-- pending owner approval (24h) -> approved due date -> paid / safe expiration.
-- Do not validate financial behavior using LIVE Stripe or PROD Supabase.
