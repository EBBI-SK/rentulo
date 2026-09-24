begin;

-- Listings must be priced high enough that the minimum Rentulo fee can never
-- make the owner's payout negative.
alter table public.offers
  drop constraint if exists offers_price_per_day_check;

alter table public.offers
  add constraint offers_price_per_day_check
  check (price_per_day >= 100);

comment on column public.offers.price_per_day is
  'Rental price per day in whole CZK. Minimum allowed listing price is 100 CZK.';

-- Keep the percentage snapshot at 10%, but apply a 50 CZK minimum platform fee
-- per reservation. The renter still pays total_price; the platform fee is
-- deducted from the owner's payout.
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
  new.platform_fee_amount := greatest(
    round(new.total_price * new.platform_fee_percent / 100.0)::integer,
    50
  );
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

revoke all on function public.prepare_reservation_insert()
from public, anon, authenticated;

commit;
