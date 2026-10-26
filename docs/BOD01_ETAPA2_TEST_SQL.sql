-- RENTULO / BOD 01 / ETAPA 2 / TEST ONLY / READ ONLY
-- Run only AFTER the 20261017203000 migration has been applied in Supabase TEST.
-- All queries below are SELECT statements. Never run against PROD.

-- 1. Existing booking R-000036 must retain its original six-hour policy;
--    do not silently apply the new 24-hour cutoff to historic contracts.
select
  reservation_number,
  status,
  cancellation_cutoff_hours,
  ((start_date + pickup_time) at time zone 'Europe/Prague')
    - make_interval(hours => cancellation_cutoff_hours) as cancellation_cutoff_utc,
  (((start_date + pickup_time) at time zone 'Europe/Prague')
    - make_interval(hours => cancellation_cutoff_hours)) at time zone 'Europe/Prague'
      as cancellation_cutoff_prague
from public.reservations
where reservation_number = 'R-000036';
-- Expected: 1 row, cancellation_cutoff_hours = 6 (previous policy).

-- 2. New reservations must receive 24 hours and the policy cannot be changed.
select
  a.attname,
  pg_get_expr(d.adbin, d.adrelid) as new_booking_default
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
where n.nspname = 'public'
  and c.relname = 'reservations'
  and a.attname = 'cancellation_cutoff_hours';
-- Expected: 24.

-- 3. Verify the new per-booking cutoff math at absolute times, including DST.
with scenarios(name, pickup_at, hours, expected) as (
  values
  ('new 24h cutoff', '2026-11-06 12:00:00+01'::timestamptz,
     24, '2026-11-05 12:00:00+01'::timestamptz),
  ('legacy 6h cutoff', '2026-11-06 12:00:00+01'::timestamptz,
     6, '2026-11-06 06:00:00+01'::timestamptz),
  ('summer time boundary', '2027-03-28 15:00:00+02'::timestamptz,
     24, '2027-03-27 14:00:00+01'::timestamptz)
)
select name, expected,
  pickup_at - make_interval(hours => hours) as actual,
  expected = pickup_at - make_interval(hours => hours) as passed
from scenarios;
-- Expected: three rows, all passed = true.

-- 4. Later, after a newly created reservation: check 24-hour snapshot.
-- select reservation_number, status, cancellation_cutoff_hours
-- from public.reservations where reservation_number = 'R-NEW-NUMBER';
-- Do not create a test charge/refund from SQL. Use Stripe TEST only.
