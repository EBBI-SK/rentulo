begin;

alter table public.reservations
  add column if not exists pickup_time time without time zone;

comment on column public.reservations.pickup_time is
  'Scheduled local pickup time. The item is due back at the same time on end_date.';

create or replace function public.prepare_reservation_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_offer public.offers%rowtype;
  v_owner_profile public.profiles%rowtype;
  v_renter_profile public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user is required';
  end if;

  select *
  into v_offer
  from public.offers
  where id = new.offer_id;

  if not found then
    raise exception 'Offer does not exist';
  end if;

  if v_offer.status <> 'active' then
    raise exception 'Offer is not active';
  end if;

  if v_offer.owner_id = auth.uid() then
    raise exception 'Owner cannot reserve own offer';
  end if;

  if new.start_date is null
     or new.end_date is null
     or new.end_date <= new.start_date then
    raise exception 'Invalid reservation dates';
  end if;

  if new.pickup_time is null then
    raise exception 'Pickup time is required';
  end if;

  perform pg_advisory_xact_lock(hashtext(new.offer_id::text));

  if exists (
    select 1
    from public.reservations existing
    where existing.offer_id = new.offer_id
      and existing.status::text in (
        'pending',
        'approved',
        'paid',
        'picked_up'
      )
      and new.start_date < existing.end_date
      and new.end_date > existing.start_date
  ) then
    raise exception
      'Selected reservation dates overlap an existing reservation';
  end if;

  select *
  into v_owner_profile
  from public.profiles
  where id = v_offer.owner_id;

  select *
  into v_renter_profile
  from public.profiles
  where id = auth.uid();

  if not found then
    raise exception 'Renter profile does not exist';
  end if;

  new.owner_id := v_offer.owner_id;
  new.renter_id := auth.uid();

  new.days := greatest(1, new.end_date - new.start_date);
  new.total_days := new.days;
  new.date_from := new.start_date;
  new.date_to := new.end_date;

  new.price_per_day := v_offer.price_per_day;
  new.total_price := new.days * new.price_per_day;
  new.platform_fee_percent := 10;
  new.platform_fee_amount :=
    round(new.total_price * new.platform_fee_percent / 100.0)::integer;
  new.owner_payout :=
    new.total_price - new.platform_fee_amount;

  new.offer_name := v_offer.name;
  new.category := v_offer.category;
  new.city := v_offer.city;

  new.renter_name :=
    coalesce(nullif(v_renter_profile.full_name, ''), 'Nájemce');

  new.renter_email :=
    coalesce(v_renter_profile.email, '');

  new.renter_phone :=
    coalesce(v_renter_profile.phone, '');

  new.owner_name :=
    coalesce(nullif(v_owner_profile.full_name, ''), 'Majitel');

  new.owner_phone :=
    coalesce(v_owner_profile.phone, '');

  new.pickup_phone :=
    coalesce(
      nullif(v_offer.pickup_phone, ''),
      v_owner_profile.phone,
      ''
    );

  new.pickup_street :=
    coalesce(
      nullif(v_offer.pickup_street, ''),
      v_owner_profile.street,
      ''
    );

  new.pickup_city :=
    coalesce(
      nullif(v_offer.pickup_city, ''),
      v_offer.city,
      ''
    );

  new.pickup_postal_code :=
    coalesce(
      nullif(v_offer.pickup_postal_code, ''),
      v_owner_profile.postal_code,
      ''
    );

  new.pickup_note :=
    coalesce(v_offer.pickup_note, '');

  new.status := 'pending'::public.reservation_status;
  new.contact_visible := false;
  new.contact_visible_after_payment := false;
  new.paid_at := null;
  new.payment_provider_status := null;

  return new;
end;
$function$;

create or replace function public.protect_reservation_immutable_fields()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_payment_update_authorized boolean;
begin
  v_payment_update_authorized :=
    (
      old.status = 'approved'
      and new.status = 'paid'
      and (
        current_setting('app.test_payment_authorized', true) = 'on'
        or current_setting('app.payment_update_authorized', true) = 'on'
      )
    );

  if new.id is distinct from old.id
     or new.offer_id is distinct from old.offer_id
     or new.owner_id is distinct from old.owner_id
     or new.renter_id is distinct from old.renter_id
     or new.start_date is distinct from old.start_date
     or new.end_date is distinct from old.end_date
     or new.pickup_time is distinct from old.pickup_time
     or new.date_from is distinct from old.date_from
     or new.date_to is distinct from old.date_to
     or new.days is distinct from old.days
     or new.price_per_day is distinct from old.price_per_day
     or new.total_price is distinct from old.total_price
     or new.platform_fee_percent is distinct from old.platform_fee_percent
     or new.platform_fee_amount is distinct from old.platform_fee_amount
     or new.owner_payout is distinct from old.owner_payout
     or new.created_at is distinct from old.created_at
     or new.offer_name is distinct from old.offer_name
     or new.category is distinct from old.category
     or new.city is distinct from old.city
     or new.total_days is distinct from old.total_days
     or new.renter_name is distinct from old.renter_name
     or new.renter_email is distinct from old.renter_email
     or new.renter_phone is distinct from old.renter_phone
     or new.owner_name is distinct from old.owner_name
     or new.owner_phone is distinct from old.owner_phone
     or new.pickup_phone is distinct from old.pickup_phone
     or new.pickup_street is distinct from old.pickup_street
     or new.pickup_city is distinct from old.pickup_city
     or new.pickup_postal_code is distinct from old.pickup_postal_code
     or new.pickup_full_address is distinct from old.pickup_full_address
     or new.pickup_note is distinct from old.pickup_note
     or new.pickup_latitude is distinct from old.pickup_latitude
     or new.pickup_longitude is distinct from old.pickup_longitude
     or (
       not v_payment_update_authorized
       and (
         new.paid_at is distinct from old.paid_at
         or new.payment_provider_status
              is distinct from old.payment_provider_status
       )
     )
  then
    raise exception 'Immutable reservation fields cannot be changed';
  end if;

  return new;
end;
$function$;

-- Expose the pickup time and the exact cancellation cutoff to the two users
-- related to a reservation. The cutoff is calculated in the reservation's
-- current CZ/SK operating timezone, not in the viewer's browser timezone.
drop function if exists public.get_my_reservations();

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
  photo_url text
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
    - interval '2 hours' as cancellation_cutoff_at,
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

  coalesce(o.photo_url, '') as photo_url

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


-- Keep the current role-specific status transitions, but stop ordinary renter
-- cancellation exactly two hours before the scheduled pickup time.
create or replace function public.protect_reservation_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.status = old.status then
    return new;
  end if;

  if auth.uid() = old.owner_id then
    if
      (old.status = 'pending' and new.status in ('approved', 'rejected'))
      or (old.status = 'paid' and new.status = 'picked_up')
      or (old.status = 'picked_up' and new.status = 'returned')
    then
      return new;
    end if;

    raise exception
      'Owner is not allowed to change reservation status from % to %',
      old.status,
      new.status;
  end if;

  if auth.uid() = old.renter_id then
    if
      (
        old.status in ('pending', 'approved')
        and new.status = 'cancelled'
      )
    then
      if
        old.pickup_time is not null
        and now() >= (
          ((old.start_date + old.pickup_time) at time zone 'Europe/Prague')
          - interval '2 hours'
        )
      then
        raise exception
          'Reservation can no longer be cancelled within 2 hours of pickup';
      end if;

      return new;
    end if;

    if
      old.status = 'approved'
      and new.status = 'paid'
      and current_setting(
        'app.test_payment_authorized',
        true
      ) = 'on'
      and exists (
        select 1
        from public.test_payment_users t
        where t.user_id = auth.uid()
      )
    then
      return new;
    end if;

    raise exception
      'Renter is not allowed to change reservation status from % to %',
      old.status,
      new.status;
  end if;

  raise exception 'User is not related to this reservation';
end;
$function$;

revoke all on function public.protect_reservation_status_transition()
from public, anon, authenticated;

commit;
