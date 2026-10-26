-- RENTULO V1 / PROD RELEASE CANDIDATE bd1b8d1 / 2026-10-24.
-- Apply only to a verified PROD database after backup and approval.
-- This SQL is staged separately: never copy over TEST migrations.
-- Cron activation is deferred; no automatic deployment is authorized.

-- RENTULO / BOD 01 / ETAPA 6 / PROD ONLY.
-- Owner may confirm real handover from two elapsed hours BEFORE agreed pickup.
-- The PIN still expires at the EXACT agreed return timestamp and after one use.
-- All other reservation transitions, paid no-show settlement, booking buffers,
-- refund rules, return follow-ups and Stripe payout rules are unchanged.
begin;


DO $rentulo_prod_release_guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets AS s
    WHERE s.name = 'rentulo_prod_release_target'
      AND s.decrypted_secret = 'tfvgxrdjrpicgtvovehl'
  ) THEN
    RAISE EXCEPTION 'Rentulo PROD release guard missing: check target project and approval';
  END IF;
  IF EXISTS (
    SELECT 1 FROM vault.decrypted_secrets AS s
    WHERE s.name = 'rentulo_project_url'
      AND btrim(s.decrypted_secret, '/') NOT IN
        ('UNCONFIGURED', 'https://tfvgxrdjrpicgtvovehl.supabase.co')
  ) THEN
    RAISE EXCEPTION 'Unexpected runtime project URL; release aborted';
  END IF;
END;
$rentulo_prod_release_guard$;


do $prod_project$
begin
  if not exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'rentulo_prod_release_target'
      and btrim(s.decrypted_secret, '/') = 'tfvgxrdjrpicgtvovehl'
  ) then
    raise exception 'BOD 01 early pickup PIN migration is PROD-only';
  end if;
end;
$prod_project$;

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

  -- A renter can withdraw an unapproved/unpaid request before the owner
  -- has confirmed anything, even inside the 24-hour cancellation cutoff.
  -- Once approved, the stored 6h/24h cutoff still applies as before.
  if old.status = 'pending'
     and new.status = 'cancelled'
     and auth.uid() = old.renter_id then
    return new;
  end if;

  -- Guard the 24-hour owner response deadline even before Cron processes it.
  if old.status = 'pending' and new.status = 'approved'
     and old.expires_at is not null and old.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'RESERVATION_APPROVAL_EXPIRED';
  end if;

  -- Only the trusted, Stripe-safe expiration RPC can unlock overdue dates.
  if auth.role() = 'service_role'
     and current_setting('app.reservation_expiration_authorized', true) = 'on'
     and old.status in ('pending', 'approved')
     and new.status = 'expired'
     and old.expires_at is not null and old.expires_at <= now() then
    return new;
  end if;

  -- Trusted Stripe webhook completion: approved -> paid.
  if
    auth.role() = 'service_role'
    and current_setting('app.stripe_payment_authorized', true) = 'on'
    and old.status = 'approved'
    and new.status = 'paid'
  then
    return new;
  end if;

  -- Trusted pickup PIN confirmation: paid -> picked_up.
  if
    auth.role() = 'service_role'
    and current_setting('app.pickup_pin_authorized', true) = 'on'
    and old.status = 'paid'
    and new.status = 'picked_up'
  then
    -- Return is due at end_date + pickup_time, in Prague local time.
    -- Owner may hand over up to two elapsed hours before scheduled pickup.
    -- PIN expires at the original scheduled return, not two hours later.
    -- Use clock_timestamp(), not transaction-start now(): a confirmation that
    -- waits on a row lock must never succeed after the actual deadline.
    if old.pickup_time is null
       or clock_timestamp() >= ((old.end_date + old.pickup_time) at time zone 'Europe/Prague') then
      raise exception using errcode = 'P0001', message = 'PICKUP_WRONG_DAY';
    end if;
    if clock_timestamp() < (
      ((old.start_date + old.pickup_time) at time zone 'Europe/Prague')
      - interval '2 hours'
    ) then
      raise exception using errcode = 'P0001', message = 'PICKUP_NOT_STARTED';
    end if;

    return new;
  end if;

  -- KROK 79: trusted postgres Cron may settle paid bookings only at/after
  -- the exact agreed Prague-local return instant; not at midnight.
  if session_user = 'postgres'
     and current_setting('app.no_show_authorized', true) = 'on'
     and old.status = 'paid'
     and new.status = 'no_show'
     and old.pickup_time is not null
     and clock_timestamp() >= ((old.end_date + old.pickup_time) at time zone 'Europe/Prague') then
    return new;
  end if;

  -- Trusted paid cancellation. The browser cannot enable this setting and the
  -- RPC that enables it is service-role only.
  if
    auth.role() = 'service_role'
    and current_setting('app.paid_cancellation_authorized', true) = 'on'
    and old.status = 'paid'
    and new.status = 'cancelled'
  then
    return new;
  end if;

  -- Trusted owner-attested exception for approved UNPAID reservations.
  -- The companion RPC checks both identity and the Stripe checkout state.
  if auth.uid() = old.owner_id
     and current_setting('app.owner_unavailable_approved_authorized', true) = 'on'
     and old.status = 'approved' and new.status = 'cancelled' then
    return new;
  end if;

  -- Ordinary cancellation remains subject to each booking's stored cutoff.
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
    -- Fail closed: a pending Stripe Checkout/PaymentIntent cannot be abandoned
    -- by an ordinary client update. Otherwise a renter could still pay a
    -- hosted Checkout page after the reservation had been cancelled.
    if old.status = 'approved' and exists (
      select 1 from public.payments p
      where p.reservation_id = old.id
        and (
          p.status <> 'pending'
          or p.checkout_attempt_started_at is not null
          or p.checkout_inflight_started_at is not null
          or nullif(p.provider_payment_id, '') is not null
        )
    ) then
      raise exception using errcode = 'P0001',
        message = 'RESERVATION_ACTIVE_CHECKOUT';
    end if;
    if
      old.pickup_time is not null
      and clock_timestamp() >= (
        ((old.start_date + old.pickup_time) at time zone 'Europe/Prague')
        - make_interval(hours => old.cancellation_cutoff_hours)
      )
    then
      raise exception
        'Reservation ordinary cancellation deadline has passed';
    end if;

    return new;
  end if;

  if auth.uid() = old.owner_id then
    if
      old.status = 'pending'
      and new.status = 'approved'
      and exists (
        select 1
        from public.owner_cancellation_debts d
        where d.owner_id = auth.uid()
          and d.status = 'open'
          and d.due_at <= now()
      )
    then
      raise exception using
        errcode = 'P0001',
        message = 'OWNER_OVERDUE_CANCELLATION_DEBT';
    end if;

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
