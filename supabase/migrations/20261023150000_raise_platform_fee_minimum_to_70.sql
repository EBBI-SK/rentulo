-- Rentulo V1: minimum commission on NEW reservations is 70 CZK instead of 50 CZK.
-- The fee remains 10% of the whole booking; listing price minimum remains 100 CZK/day.
-- Existing reservation/payment snapshots are deliberately NOT changed.
-- Patch only the commission expression in the currently installed trigger function;
-- preserve the remaining rules, including the TEST two-hour booking buffer.
-- Any later rewrite of prepare_reservation_insert must also preserve the 70 CZK floor.
begin;

do $raise_fee$
declare
  v_function_oid oid := to_regprocedure('public.prepare_reservation_insert()');
  v_definition text;
  v_old_expression constant text := E'new.platform_fee_amount := greatest(\n    round(new.total_price * new.platform_fee_percent / 100.0)::integer,\n    50\n  );';
  v_new_expression constant text := E'new.platform_fee_amount := greatest(\n    round(new.total_price * new.platform_fee_percent / 100.0)::integer,\n    70\n  );';
begin
  if v_function_oid is null then
    raise exception 'Missing reservation pricing function public.prepare_reservation_insert()';
  end if;

  v_definition := pg_get_functiondef(v_function_oid);

  if position(v_new_expression in v_definition) > 0 then
    raise notice 'Minimum reservation commission is already 70 CZK';
  elsif position(v_old_expression in v_definition) > 0 then
    execute replace(v_definition, v_old_expression, v_new_expression);
  else
    raise exception 'Unexpected reservation pricing logic; no changes made';
  end if;
end;
$raise_fee$;

commit;
