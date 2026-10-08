-- Extend account-deactivation eligibility without changing the old RPC signature.
-- Financial obligations are checked for both the UI and the trusted finalizer.
-- Deploy before the updated account-deactivation Edge Function and frontend.
begin;

-- A new name is intentional: CREATE OR REPLACE cannot change the output
-- columns of get_my_account_deactivation_status() on a live database.
create function public.get_my_account_deactivation_status_v2()
returns table (
  account_status text,
  can_deactivate boolean,
  blocking_reservations_count bigint,
  blocking_as_owner_count bigint,
  blocking_as_renter_count bigint,
  offers_to_close_count bigint,
  open_owner_debts_count bigint,
  unfinished_refunds_count bigint,
  unresolved_owner_transfers_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_account_status text;
  v_reservations bigint := 0;
  v_as_owner bigint := 0;
  v_as_renter bigint := 0;
  v_offers bigint := 0;
  v_debts bigint := 0;
  v_refunds bigint := 0;
  v_transfers bigint := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select p.account_status into v_account_status
  from public.profiles p
  where p.id = v_user_id;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  select
    count(*),
    count(*) filter (where r.owner_id = v_user_id),
    count(*) filter (where r.renter_id = v_user_id)
  into v_reservations, v_as_owner, v_as_renter
  from public.reservations r
  where (r.owner_id = v_user_id or r.renter_id = v_user_id)
    and r.status in (
      'pending'::public.reservation_status,
      'approved'::public.reservation_status,
      'paid'::public.reservation_status,
      'picked_up'::public.reservation_status
    );

  select count(*) into v_offers
  from public.offers o
  where o.owner_id = v_user_id
    and o.status <> 'deleted'::public.offer_status;

  -- Settled ('paid') or waived debts do not block account deletion.
  select count(*) into v_debts
  from public.owner_cancellation_debts d
  where d.owner_id = v_user_id
    and d.status = 'open';

  -- A paid cancellation can leave a refund pending after its reservation is
  -- already 'cancelled'. Neither party should lose access before settlement.
  select count(*) into v_refunds
  from public.reservation_cancellations c
  join public.reservations r on r.id = c.reservation_id
  join public.payments p on p.id = c.payment_id
  where c.cancellation_kind = 'paid_refund'
    and (r.owner_id = v_user_id or r.renter_id = v_user_id)
    and (
      c.financials_finalized_at is null
      or p.refund_status is distinct from 'succeeded'
    );

  -- A returned reservation is no longer active, but its owner's transfer can
  -- still be missing, pending, failed, or reversed. The retry worker must be
  -- allowed to finish while the owner retains access to payout setup.
  select count(*) into v_transfers
  from public.payments p
  join public.reservations r on r.id = p.reservation_id
  where p.owner_id = v_user_id
    and r.status in (
      'picked_up'::public.reservation_status,
      'returned'::public.reservation_status
    )
    and p.provider = 'stripe'
    and p.status = 'paid'
    and p.refund_status = 'not_requested'
    and p.transfer_status is distinct from 'succeeded';

  return query
  select
    v_account_status,
    (
      v_account_status = 'active'
      and v_reservations = 0
      and v_debts = 0
      and v_refunds = 0
      and v_transfers = 0
    ),
    v_reservations,
    v_as_owner,
    v_as_renter,
    v_offers,
    v_debts,
    v_refunds,
    v_transfers;
end;
$function$;

revoke all on function public.get_my_account_deactivation_status_v2()
  from public, anon, authenticated;
grant execute on function public.get_my_account_deactivation_status_v2()
  to authenticated;

comment on function public.get_my_account_deactivation_status_v2() is
  'Read-only account deactivation eligibility with active reservations, open owner cancellation debts, unfinished paid refunds, and unresolved owner Stripe transfers.';

-- Recheck eligibility under the trusted finalizer's account lock. Its original
-- return shape and service_role-only access remain unchanged. A deactivated
-- account may still retry an interrupted Auth soft-delete without a new check.
create or replace function public.finalize_account_deactivation(target_user_id uuid)
returns table (
  account_status text,
  closed_offers_count bigint,
  deactivated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_status text;
  v_existing_deactivated_at timestamptz;
  v_blocking_count bigint := 0;
  v_open_debts bigint := 0;
  v_unfinished_refunds bigint := 0;
  v_unresolved_transfers bigint := 0;
  v_closed_offers_count bigint := 0;
  v_deactivated_at timestamptz;
begin
  if target_user_id is null then
    raise exception 'Target user is required' using errcode = '22023';
  end if;

  -- The same advisory lock as prepare_reservation_insert() protects against
  -- a reservation appearing between the eligibility check and deactivation.
  perform pg_advisory_xact_lock(860808, hashtext(target_user_id::text));

  select p.account_status, p.deactivated_at
  into v_account_status, v_existing_deactivated_at
  from public.profiles p
  where p.id = target_user_id
  for update;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if v_account_status = 'deactivated' then
    return query select v_account_status, 0::bigint, v_existing_deactivated_at;
    return;
  end if;

  if v_account_status <> 'active' then
    raise exception 'Account is not active' using errcode = 'P0001';
  end if;

  select count(*) into v_blocking_count
  from public.reservations r
  where (r.owner_id = target_user_id or r.renter_id = target_user_id)
    and r.status in (
      'pending'::public.reservation_status,
      'approved'::public.reservation_status,
      'paid'::public.reservation_status,
      'picked_up'::public.reservation_status
    );

  if v_blocking_count > 0 then
    raise exception 'Account has active reservations'
      using errcode = 'P0001',
        detail = 'blocking_reservations=' || v_blocking_count::text;
  end if;

  select count(*) into v_open_debts
  from public.owner_cancellation_debts d
  where d.owner_id = target_user_id
    and d.status = 'open';

  select count(*) into v_unfinished_refunds
  from public.reservation_cancellations c
  join public.reservations r on r.id = c.reservation_id
  join public.payments p on p.id = c.payment_id
  where c.cancellation_kind = 'paid_refund'
    and (r.owner_id = target_user_id or r.renter_id = target_user_id)
    and (
      c.financials_finalized_at is null
      or p.refund_status is distinct from 'succeeded'
    );

  select count(*) into v_unresolved_transfers
  from public.payments p
  join public.reservations r on r.id = p.reservation_id
  where p.owner_id = target_user_id
    and r.status in (
      'picked_up'::public.reservation_status,
      'returned'::public.reservation_status
    )
    and p.provider = 'stripe'
    and p.status = 'paid'
    and p.refund_status = 'not_requested'
    and p.transfer_status is distinct from 'succeeded';

  if v_open_debts > 0 or v_unfinished_refunds > 0 or v_unresolved_transfers > 0 then
    raise exception 'Account has unresolved financial obligations'
      using errcode = 'P0001',
        detail = format(
          'open_debts=%s, unfinished_refunds=%s, unresolved_transfers=%s',
          v_open_debts, v_unfinished_refunds, v_unresolved_transfers
        );
  end if;

  update public.offers o
  set status = 'deleted'::public.offer_status,
      updated_at = now()
  where o.owner_id = target_user_id
    and o.status <> 'deleted'::public.offer_status;

  get diagnostics v_closed_offers_count = row_count;
  v_deactivated_at := now();

  update public.profiles p
  set account_status = 'deactivated',
      deactivation_requested_at = coalesce(p.deactivation_requested_at, v_deactivated_at),
      deactivated_at = v_deactivated_at,
      updated_at = v_deactivated_at
  where p.id = target_user_id;

  return query
  select 'deactivated'::text, v_closed_offers_count, v_deactivated_at;
end;
$function$;

revoke all on function public.finalize_account_deactivation(uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_account_deactivation(uuid)
  to service_role;

comment on function public.finalize_account_deactivation(uuid) is
  'Service-role-only account soft-deactivation; serialized with reservation creation and guarded against active reservations and unresolved owner debts, Stripe transfers and paid refunds.';

commit;
