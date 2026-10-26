-- Rentulo V1: owner-selected minimum rental duration, enforced server-side.
-- Safe for existing offers/reservations (default 1 day; no changes to old bookings).
begin;

alter table public.offers
  add column if not exists min_rental_days integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'offers_min_rental_days_check'
      and conrelid = 'public.offers'::regclass
  ) then
    alter table public.offers
      add constraint offers_min_rental_days_check
      check (min_rental_days between 1 and 365);
  end if;
end;
$$;

create or replace function public.enforce_min_rental_days_on_reservation_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minimum_days integer;
begin
  -- Existing reservation preparation validates incomplete dates and offer IDs.
  if new.offer_id is null or new.start_date is null or new.end_date is null then
    return new;
  end if;

  select o.min_rental_days
    into v_minimum_days
    from public.offers o
   where o.id = new.offer_id;

  if found and new.end_date > new.start_date
     and (new.end_date - new.start_date) < coalesce(v_minimum_days, 1) then
    raise exception 'The minimum rental period for this offer is % days', v_minimum_days
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_min_rental_days_on_reservation_insert()
  from public, anon, authenticated;

drop trigger if exists enforce_min_rental_days_on_reservation_insert on public.reservations;
create trigger enforce_min_rental_days_on_reservation_insert
  before insert on public.reservations
  for each row execute function public.enforce_min_rental_days_on_reservation_insert();

comment on column public.offers.min_rental_days is
  'Minimum number of whole rental days required for new reservations (default 1).';

commit;
