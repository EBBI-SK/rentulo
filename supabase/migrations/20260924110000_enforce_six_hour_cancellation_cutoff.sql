begin;

-- Ordinary cancellation is available only before the exact six-hour cutoff.
-- The cutoff is calculated in the current CZ/SK operating timezone and is
-- exposed to both reservation parties from the trusted reservation reader.
create or replace function public.get_my_reservations()
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

-- Keep the existing lifecycle, add approved -> cancelled for the owner, and
-- apply the same exact six-hour cutoff to both parties. Pending owner requests
-- are still rejected, not cancelled. Paid reservations are intentionally not
-- enabled for ordinary cancellation here.
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

  if
    new.status = 'cancelled'
    and (
      (
        auth.uid() = old.owner_id
        and old.status = 'approved'
      )
      or (
        auth.uid() = old.renter_id
        and old.status in ('pending', 'approved')
      )
    )
  then
    if
      old.pickup_time is not null
      and now() >= (
        ((old.start_date + old.pickup_time) at time zone 'Europe/Prague')
        - interval '6 hours'
      )
    then
      raise exception
        'Reservation can no longer be cancelled within 6 hours of pickup';
    end if;

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
