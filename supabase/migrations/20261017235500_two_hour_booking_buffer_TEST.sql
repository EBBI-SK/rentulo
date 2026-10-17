-- RENTULO / BOD 01 / 2-HOUR BUFFER / SUPABASE TEST ONLY.
-- A reservation can begin only >= 2 elapsed hours after an existing booking
-- ends; the symmetric guard also protects bookings placed before another.
-- Applies to NEW reservations; existing rows and their dates are unchanged.
-- Does not touch payments, Stripe, PIN, cancellation or return flow.
begin;

do $test_project$
begin
  if not exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'rentulo_project_url'
      and btrim(s.decrypted_secret, '/') = 'https://vspposovhdgvbeukoivh.supabase.co'
  ) then
    raise exception 'BOD 01 two-hour booking buffer is TEST-only';
  end if;
end;
$test_project$;

-- Secure BOOLEAN availability lookup. Unlike the legacy availability reader,
-- it does not expose dates, times, user IDs or status of other reservations.
-- The SQL insert trigger below uses the EXACT SAME predicate.
-- A confirmed returned booking still reserves its AGREED window and the last
-- 2 hours of turnover; a premature return cannot shorten the next-booking gap.
-- VOLATILE is intentional: after an advisory-lock wait, re-read freshly
-- committed competing reservations rather than the caller's old snapshot.
create or replace function public.has_offer_reservation_time_conflict(
  p_offer_id uuid,
  p_start_date date,
  p_end_date date,
  p_pickup_time time without time zone
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $function$
  select case
    when p_offer_id is null
      or p_start_date is null
      or p_end_date is null
      or p_end_date <= p_start_date
      or p_pickup_time is null
    then true -- invalid or incomplete requests fail CLOSED
    else exists (
      select 1
      from public.reservations r
      where r.offer_id = p_offer_id
        and r.status::text in ('pending', 'approved', 'paid', 'picked_up', 'returned')
        and (
          (
            r.pickup_time is not null
            and ((p_start_date + p_pickup_time) at time zone 'Europe/Prague')
                < ((r.end_date + r.pickup_time) at time zone 'Europe/Prague')
                  + interval '2 hours'
            and ((p_end_date + p_pickup_time) at time zone 'Europe/Prague')
                + interval '2 hours'
                > ((r.start_date + r.pickup_time) at time zone 'Europe/Prague')
          )
          or (
            -- Rare pre-pickup_time legacy TEST bookings: without an actual
            -- time, a precise 2h promise cannot be made; block boundary days.
            r.pickup_time is null
            and p_start_date <= r.end_date
            and p_end_date >= r.start_date
          )
        )
    )
  end;
$function$;
revoke all on function public.has_offer_reservation_time_conflict(
  uuid, date, date, time without time zone
) from public, anon, authenticated;
grant execute on function public.has_offer_reservation_time_conflict(
  uuid, date, date, time without time zone
) to anon, authenticated, service_role;
comment on function public.has_offer_reservation_time_conflict(
  uuid, date, date, time without time zone
) is 'Returns one boolean for a proposed pickup/return window including a two-hour turnover interval; reveals no booking records.';

-- Preserve the latest pricing/metadata logic without modifying old migrations.
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

  -- Exact local pickup/return instants plus the mandatory two-hour buffer.
  -- This check runs AFTER the offer-scoped advisory lock, so two concurrent
  -- bookings cannot both pass while the other transaction is uncommitted.
  if public.has_offer_reservation_time_conflict(
    new.offer_id, new.start_date, new.end_date, new.pickup_time
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
