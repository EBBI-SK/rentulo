-- Rentulo V1: minimum commission on NEW reservations is 70 CZK (10% rate unchanged).
-- Existing reservations/payment snapshots remain unchanged; minimum listing price stays 100 CZK/day.
-- Use whitespace-tolerant but formula-specific matching; leave all other trigger rules intact.
-- This migration is safe to rerun after a successful application.

begin;

do $raise_fee$
declare
  v_function_oid oid := to_regprocedure('public.prepare_reservation_insert()');
  v_definition text;
  v_updated text;
  v_prefix constant text :=
    '(new\.platform_fee_amount[[:space:]]*:=[[:space:]]*greatest[[:space:]]*\([[:space:]]*round[[:space:]]*\([[:space:]]*new\.total_price[[:space:]]*\*[[:space:]]*new\.platform_fee_percent[[:space:]]*/[[:space:]]*100\.0[[:space:]]*\)[[:space:]]*::[[:space:]]*integer[[:space:]]*,[[:space:]]*)';
  v_suffix constant text := '([[:space:]]*\)[[:space:]]*;)';
  v_old_pattern text := v_prefix || '50' || v_suffix;
  v_new_pattern text := v_prefix || '70' || v_suffix;
  v_old_count integer;
  v_new_count integer;
begin
  if v_function_oid is null then
    raise exception 'Missing reservation pricing function public.prepare_reservation_insert()';
  end if;

  v_definition := pg_get_functiondef(v_function_oid);

  -- Never replace a different pricing formula or an older version without booking-time protection.
  if position('has_offer_reservation_time_conflict' in v_definition) = 0
     or v_definition !~ 'new\.platform_fee_percent[[:space:]]*:=[[:space:]]*10[[:space:]]*;' then
    raise exception 'Reservation pricing or time protection is different; no changes made';
  end if;

  select count(*) into v_old_count
  from regexp_matches(v_definition, v_old_pattern, 'g');
  select count(*) into v_new_count
  from regexp_matches(v_definition, v_new_pattern, 'g');

  if v_old_count = 0 and v_new_count = 1 then
    raise notice 'Minimum commission is already 70 CZK; no changes needed';
  elsif v_old_count = 1 and v_new_count = 0 then
    -- Backreferences preserve whitespace and the entire formula around the literal 50.
    v_updated := regexp_replace(
      v_definition,
      v_old_pattern,
      E'\\1' || '70' || E'\\2'
    );
    if v_updated = v_definition then
      raise exception 'Commission replacement did not occur; no changes made';
    end if;

    execute v_updated;

    if pg_get_functiondef(v_function_oid) !~ v_new_pattern
       or position('has_offer_reservation_time_conflict' in pg_get_functiondef(v_function_oid)) = 0 then
      raise exception 'Commission verification failed; rolling back';
    end if;
    raise notice 'Minimum commission changed from 50 to 70 CZK';
  else
    raise exception 'Unexpected or ambiguous reservation pricing; no changes made';
  end if;
end;
$raise_fee$;

commit;

-- Read-only confirmation without creating or modifying a reservation.
select
  case
    when pg_get_functiondef('public.prepare_reservation_insert()'::regprocedure)
         ~ 'new\.platform_fee_amount[[:space:]]*:=[[:space:]]*greatest[[:space:]]*\([[:space:]]*round[[:space:]]*\([[:space:]]*new\.total_price[[:space:]]*\*[[:space:]]*new\.platform_fee_percent[[:space:]]*/[[:space:]]*100\.0[[:space:]]*\)[[:space:]]*::[[:space:]]*integer[[:space:]]*,[[:space:]]*70[[:space:]]*\)'
      then 'OK - minimum 70 CZK'
    else 'CHECK - minimum 70 CZK not confirmed'
  end as provizia,
  position('has_offer_reservation_time_conflict' in
           pg_get_functiondef('public.prepare_reservation_insert()'::regprocedure)) > 0
    as casova_ochrana;
