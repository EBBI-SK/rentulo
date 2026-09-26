begin;

create table if not exists public.reservation_pickup_security (
  reservation_id uuid primary key references public.reservations(id) on delete cascade,
  failed_attempts smallint not null default 0 check (failed_attempts between 0 and 3),
  locked_until timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reservation_pickup_security enable row level security;

revoke all on table public.reservation_pickup_security from public, anon, authenticated;
grant all on table public.reservation_pickup_security to service_role;

create or replace function public.register_failed_pickup_pin(
  p_reservation_id uuid,
  p_owner_id uuid
)
returns table (
  failed_attempts smallint,
  attempts_remaining integer,
  locked_until timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_reservation public.reservations%rowtype;
  v_security public.reservation_pickup_security%rowtype;
  v_now timestamptz := now();
  v_attempts smallint;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;

  select r.*
  into v_reservation
  from public.reservations r
  where r.id = p_reservation_id
  for update;

  if not found then
    raise exception 'Reservation was not found';
  end if;

  if v_reservation.owner_id <> p_owner_id then
    raise exception 'Owner does not match reservation';
  end if;

  if v_reservation.status <> 'paid' then
    raise exception 'Reservation is not ready for pickup';
  end if;

  select s.*
  into v_security
  from public.reservation_pickup_security s
  where s.reservation_id = p_reservation_id
  for update;

  if found and v_security.confirmed_at is not null then
    raise exception 'Pickup is already confirmed';
  end if;

  if found and v_security.locked_until is not null and v_security.locked_until > v_now then
    return query
    select
      v_security.failed_attempts,
      0,
      v_security.locked_until;
    return;
  end if;

  if found then
    if v_security.locked_until is not null and v_security.locked_until <= v_now then
      v_attempts := 1;
    else
      v_attempts := least(v_security.failed_attempts + 1, 3);
    end if;

    update public.reservation_pickup_security s
    set
      failed_attempts = v_attempts,
      locked_until = case when v_attempts >= 3 then v_now + interval '15 minutes' else null end,
      updated_at = v_now
    where s.reservation_id = p_reservation_id
    returning s.* into v_security;
  else
    insert into public.reservation_pickup_security (
      reservation_id,
      failed_attempts,
      locked_until,
      created_at,
      updated_at
    )
    values (
      p_reservation_id,
      1,
      null,
      v_now,
      v_now
    )
    returning * into v_security;
  end if;

  return query
  select
    v_security.failed_attempts,
    greatest(0, 3 - v_security.failed_attempts)::integer,
    v_security.locked_until;
end;
$function$;

create or replace function public.confirm_reservation_pickup(
  p_reservation_id uuid,
  p_owner_id uuid
)
returns table (
  id uuid,
  status public.reservation_status,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_reservation public.reservations%rowtype;
  v_payment public.payments%rowtype;
  v_security public.reservation_pickup_security%rowtype;
  v_now timestamptz := now();
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;

  select r.*
  into v_reservation
  from public.reservations r
  where r.id = p_reservation_id
  for update;

  if not found then
    raise exception 'Reservation was not found';
  end if;

  if v_reservation.owner_id <> p_owner_id then
    raise exception 'Owner does not match reservation';
  end if;

  if v_reservation.status <> 'paid' then
    raise exception 'Reservation is not ready for pickup';
  end if;

  select p.*
  into v_payment
  from public.payments p
  where p.reservation_id = p_reservation_id
  for update;

  if not found
    or v_payment.owner_id <> v_reservation.owner_id
    or v_payment.payer_id <> v_reservation.renter_id
    or v_payment.provider <> 'stripe'
    or v_payment.status <> 'paid'
    or v_payment.currency <> 'czk'
    or v_payment.stripe_payment_intent_status <> 'succeeded'
    or v_payment.stripe_payment_intent_id is null
    or btrim(v_payment.stripe_payment_intent_id) = ''
    or v_payment.stripe_charge_id is null
    or btrim(v_payment.stripe_charge_id) = ''
    or v_payment.refund_status <> 'not_requested'
    or coalesce(v_payment.stripe_refund_amount_minor, 0) <> 0
  then
    raise exception 'Payment is not eligible for pickup';
  end if;

  select s.*
  into v_security
  from public.reservation_pickup_security s
  where s.reservation_id = p_reservation_id
  for update;

  if found and v_security.confirmed_at is not null then
    raise exception 'Pickup is already confirmed';
  end if;

  if found and v_security.locked_until is not null and v_security.locked_until > v_now then
    raise exception 'Pickup PIN is temporarily locked';
  end if;

  perform set_config('app.pickup_pin_authorized', 'on', true);

  update public.reservations r
  set
    status = 'picked_up',
    updated_at = v_now
  where r.id = p_reservation_id
    and r.status = 'paid';

  if not found then
    perform set_config('app.pickup_pin_authorized', 'off', true);
    raise exception 'Reservation could not be marked as picked up';
  end if;

  perform set_config('app.pickup_pin_authorized', 'off', true);

  insert into public.reservation_pickup_security (
    reservation_id,
    failed_attempts,
    locked_until,
    confirmed_at,
    created_at,
    updated_at
  )
  values (
    p_reservation_id,
    0,
    null,
    v_now,
    v_now,
    v_now
  )
  on conflict (reservation_id) do update
  set
    failed_attempts = 0,
    locked_until = null,
    confirmed_at = v_now,
    updated_at = v_now;

  return query
  select r.id, r.status, r.updated_at
  from public.reservations r
  where r.id = p_reservation_id;
end;
$function$;

revoke all on function public.register_failed_pickup_pin(uuid, uuid) from public, anon, authenticated;
revoke all on function public.confirm_reservation_pickup(uuid, uuid) from public, anon, authenticated;
grant execute on function public.register_failed_pickup_pin(uuid, uuid) to service_role;
grant execute on function public.confirm_reservation_pickup(uuid, uuid) to service_role;

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
    auth.role() = 'service_role'
    and current_setting('app.pickup_pin_authorized', true) = 'on'
    and old.status = 'paid'
    and new.status = 'picked_up'
  then
    return new;
  end if;

  if auth.uid() = old.owner_id then
    if
      (old.status = 'pending' and new.status in ('approved', 'rejected'))
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
      return new;
    end if;

    if
      old.status = 'approved'
      and new.status = 'paid'
      and current_setting('app.test_payment_authorized', true) = 'on'
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

revoke all on function public.protect_reservation_status_transition() from public, anon, authenticated;

commit;
