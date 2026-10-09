-- Add immutable, human-readable references without changing UUID primary keys.
-- Apply to TEST first. Independent database sequences start from 1 in a new PROD.
-- Keeping this operation in one transaction serializes the historical backfill
-- with new inserts and allows the whole migration to roll back on error.
begin;

alter table public.offers
  add column offer_number text;

alter table public.reservations
  add column reservation_number text;

create sequence public.rentulo_offer_number_seq
  as bigint start with 1 increment by 1 no cycle;

create sequence public.rentulo_reservation_number_seq
  as bigint start with 1 increment by 1 no cycle;

-- Existing TEST records receive deterministic chronological references. Use
-- UUID as a tie-breaker if rows share the same created_at timestamp.
with ordered_offers as (
  select id, row_number() over (order by created_at, id) as position
  from public.offers
)
update public.offers as o
set offer_number = 'N-' || lpad(
  ordered_offers.position::text,
  greatest(6, length(ordered_offers.position::text)),
  '0'
)
from ordered_offers
where o.id = ordered_offers.id;

with ordered_reservations as (
  select id, row_number() over (order by created_at, id) as position
  from public.reservations
)
update public.reservations as r
set reservation_number = 'R-' || lpad(
  ordered_reservations.position::text,
  greatest(6, length(ordered_reservations.position::text)),
  '0'
)
from ordered_reservations
where r.id = ordered_reservations.id;

-- The next number follows all backfilled rows. With no existing rows, the
-- first nextval() returns 1 rather than skipping to 2.
select setval(
  'public.rentulo_offer_number_seq'::regclass,
  greatest((select count(*) from public.offers), 1),
  exists (select 1 from public.offers)
);

select setval(
  'public.rentulo_reservation_number_seq'::regclass,
  greatest((select count(*) from public.reservations), 1),
  exists (select 1 from public.reservations)
);

alter table public.offers
  alter column offer_number set not null,
  add constraint offers_offer_number_key unique (offer_number),
  add constraint offers_offer_number_format check (offer_number ~ '^N-[0-9]{6,}$');

alter table public.reservations
  alter column reservation_number set not null,
  add constraint reservations_reservation_number_key unique (reservation_number),
  add constraint reservations_reservation_number_format check (reservation_number ~ '^R-[0-9]{6,}$');

-- Assign on INSERT on the server even if a client supplies its own number.
-- Prevent updates by every normal table writer, including service_role.
-- Readable numbers never replace internal UUIDs used by payments and PINs.
create function public.assign_and_protect_offer_number()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_next bigint;
begin
  if tg_op = 'INSERT' then
    v_next := nextval('public.rentulo_offer_number_seq'::regclass);
    new.offer_number := 'N-' || lpad(
      v_next::text, greatest(6, length(v_next::text)), '0'
    );
  elsif new.offer_number is distinct from old.offer_number then
    raise exception 'Offer number cannot be changed' using errcode = '23514';
  end if;
  return new;
end;
$function$;

create function public.assign_and_protect_reservation_number()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_next bigint;
begin
  if tg_op = 'INSERT' then
    v_next := nextval('public.rentulo_reservation_number_seq'::regclass);
    new.reservation_number := 'R-' || lpad(
      v_next::text, greatest(6, length(v_next::text)), '0'
    );
  elsif new.reservation_number is distinct from old.reservation_number then
    raise exception 'Reservation number cannot be changed' using errcode = '23514';
  end if;
  return new;
end;
$function$;

-- These triggers run for all inserts and updates. Their names sort after the
-- existing BEFORE ROW triggers, so unchanged reservations retain their rules.
create trigger zzz_assign_and_protect_offer_number
before insert or update on public.offers
for each row execute function public.assign_and_protect_offer_number();

create trigger zzz_assign_and_protect_reservation_number
before insert or update on public.reservations
for each row execute function public.assign_and_protect_reservation_number();

-- Browsers cannot consume numbers or call trigger functions directly.
revoke all on sequence public.rentulo_offer_number_seq
  from public, anon, authenticated;
revoke all on sequence public.rentulo_reservation_number_seq
  from public, anon, authenticated;
revoke all on function public.assign_and_protect_offer_number()
  from public, anon, authenticated;
revoke all on function public.assign_and_protect_reservation_number()
  from public, anon, authenticated;

-- Append the public offer reference; keep the other view columns in the
-- existing order and preserve the security-barrier public read model.
create or replace view public.public_offers
with (security_invoker = false, security_barrier = true)
as
select
  id,
  owner_id,
  name,
  category,
  description,
  city,
  postal_code,
  price_per_day,
  status,
  photo_url,
  pickup_mode,
  created_at,
  updated_at,
  offer_number
from public.offers
where status = 'active'::public.offer_status;

revoke all on table public.public_offers from public, anon, authenticated;
grant select on table public.public_offers to anon, authenticated;

-- The existing get_my_reservations() return type cannot be changed in place.
-- Re-create it with its existing security and contact-visibility rules,
-- appending only the two human-readable reference fields.
drop function public.get_my_reservations();

create function public.get_my_reservations()
returns table(
  id uuid,
  offer_id uuid,
  owner_id uuid,
  renter_id uuid,
  start_date date,
  end_date date,
  pickup_time time without time zone,
  cancellation_cutoff_at timestamp with time zone,
  days integer,
  price_per_day integer,
  total_price integer,
  platform_fee_percent integer,
  platform_fee_amount integer,
  owner_payout integer,
  status reservation_status,
  contact_visible boolean,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  offer_name text,
  category text,
  city text,
  total_days integer,
  renter_name text,
  renter_email text,
  renter_phone text,
  owner_name text,
  contact_visible_after_payment boolean,
  date_from date,
  date_to date,
  paid_at timestamp with time zone,
  payment_provider_status text,
  owner_phone text,
  pickup_phone text,
  pickup_street text,
  pickup_city text,
  pickup_postal_code text,
  pickup_full_address text,
  pickup_note text,
  pickup_latitude double precision,
  pickup_longitude double precision,
  photo_url text,
  reservation_number text,
  offer_number text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
select
  r.id,
  r.offer_id,
  r.owner_id,
  r.renter_id,
  r.start_date,
  r.end_date,
  r.pickup_time,
  ((r.start_date + r.pickup_time) at time zone 'Europe/Prague')
    - interval '6 hours' as cancellation_cutoff_at,
  r.days,
  r.price_per_day,
  r.total_price,
  r.platform_fee_percent,
  r.platform_fee_amount,
  r.owner_payout,
  r.status,

  r.status in ('paid', 'picked_up', 'returned')
    as contact_visible,

  r.created_at,
  r.updated_at,
  r.offer_name,
  r.category,
  r.city,
  r.total_days,

  case
    when r.renter_id = auth.uid()
      or r.status in ('paid', 'picked_up', 'returned')
      then r.renter_name
    else null
  end as renter_name,

  case
    when r.status in ('paid', 'picked_up', 'returned')
      then r.renter_email
    else null
  end as renter_email,

  case
    when r.status in ('paid', 'picked_up', 'returned')
      then r.renter_phone
    else null
  end as renter_phone,

  case
    when r.owner_id = auth.uid()
      or r.status in ('paid', 'picked_up', 'returned')
      then r.owner_name
    else null
  end as owner_name,

  r.status in ('paid', 'picked_up', 'returned')
    as contact_visible_after_payment,

  r.date_from,
  r.date_to,
  r.paid_at,
  r.payment_provider_status,

  case
    when r.status in ('paid', 'picked_up', 'returned')
      then r.owner_phone
    else null
  end as owner_phone,

  case
    when r.status in ('paid', 'picked_up', 'returned')
      then r.pickup_phone
    else null
  end as pickup_phone,

  case
    when r.status in ('paid', 'picked_up', 'returned')
      then r.pickup_street
    else null
  end as pickup_street,

  r.pickup_city,

  case
    when r.status in ('paid', 'picked_up', 'returned')
      then r.pickup_postal_code
    else null
  end as pickup_postal_code,

  case
    when r.status in ('paid', 'picked_up', 'returned')
      then r.pickup_full_address
    else null
  end as pickup_full_address,

  case
    when r.status in ('paid', 'picked_up', 'returned')
      then r.pickup_note
    else null
  end as pickup_note,

  case
    when r.status in ('paid', 'picked_up', 'returned')
      then r.pickup_latitude
    else null
  end as pickup_latitude,

  case
    when r.status in ('paid', 'picked_up', 'returned')
      then r.pickup_longitude
    else null
  end as pickup_longitude,

  coalesce(o.photo_url, '') as photo_url,
  r.reservation_number,
  o.offer_number

from public.reservations r
left join public.offers o
  on o.id = r.offer_id
where auth.uid() is not null
  and (
    r.owner_id = auth.uid()
    or r.renter_id = auth.uid()
  )
order by r.created_at desc;
$function$;

revoke all on function public.get_my_reservations() from public;
revoke all on function public.get_my_reservations() from anon;
revoke all on function public.get_my_reservations() from authenticated;

grant execute on function public.get_my_reservations() to authenticated;
grant execute on function public.get_my_reservations() to service_role;
grant execute on function public.get_my_reservations() to postgres;

-- Refresh PostgREST's cached signature for the expanded reservation reader.
notify pgrst, 'reload schema';

commit;
