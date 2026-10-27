-- RENTULO V1 / BOD 1 / TEST ONLY.
-- Fix the transfer claim RPC's ambiguous reservation_id identifier.
-- Reservation_id is both a RETURNS TABLE output parameter and a column
-- on public.payments; explicit alias avoids PostgreSQL PL/pgSQL ambiguity.
-- No reservation, payment, extension or Stripe transfer rows are changed here.
BEGIN;

DO $test_project$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name = 'rentulo_project_url'
      AND btrim(s.decrypted_secret, '/') = 'https://vspposovhdgvbeukoivh.supabase.co'
  ) THEN
    RAISE EXCEPTION 'Reservation extension transfer fix is TEST-only';
  END IF;
END;
$test_project$;

create or replace function public.claim_reservation_extension_transfer(p_extension_id uuid)
returns table (
  extension_id uuid, reservation_id uuid, amount_total integer,
  owner_payout integer, stripe_charge_id text,
  stripe_payment_intent_id text, attempt_count integer
)
language plpgsql volatile security definer set search_path = ''
as $fn$
declare v_e public.reservation_extensions%rowtype;
  v_r public.reservations%rowtype; v_p public.payments%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role()<>'service_role' then raise exception 'Trusted payout worker required'; end if;
  select * into v_e from public.reservation_extensions where id=p_extension_id for update;
  if not found then return; end if;
  select * into v_r from public.reservations where id=v_e.reservation_id;
  select * into v_p from public.payments p where p.reservation_id=v_e.reservation_id;
  if v_e.status<>'paid' or v_e.owner_payout <= 0
    or v_e.stripe_charge_id is null or v_e.stripe_payment_intent_id is null
    or v_e.stripe_transfer_id is not null
    or v_e.transfer_attempt_count >= 20
    or not (v_e.transfer_status='not_created'
        or (v_e.transfer_status='failed' and v_e.transfer_next_retry_at<=v_now)
        or (v_e.transfer_status='pending'
            and v_e.transfer_last_attempt_at<=v_now-interval '15 minutes'))
    or v_r.status::text not in ('returned','no_show')
    or v_r.owner_id<>v_e.owner_id or v_r.renter_id<>v_e.renter_id
    or v_p.status<>'paid' or v_p.transfer_status<>'succeeded'
    or v_p.refund_status<>'not_requested'
    or exists (select 1 from public.reservation_dispute_settlements d
      where d.reservation_id=v_e.reservation_id and d.settlement_route='renter_full_refund') then
    return;
  end if;
  update public.reservation_extensions set
    transfer_status='pending',transfer_attempt_count=transfer_attempt_count+1,
    transfer_last_attempt_at=v_now,transfer_next_retry_at=null,
    transfer_last_error=null,updated_at=v_now where id=v_e.id;
  return query select v_e.id,v_e.reservation_id,v_e.amount_total,v_e.owner_payout,
    v_e.stripe_charge_id,v_e.stripe_payment_intent_id,v_e.transfer_attempt_count+1;
end;
$fn$;

REVOKE ALL ON FUNCTION public.claim_reservation_extension_transfer(uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reservation_extension_transfer(uuid)
  TO service_role;

COMMIT;

SELECT CASE WHEN position(
  'from public.payments p where p.reservation_id=v_e.reservation_id;'
  IN pg_get_functiondef('public.claim_reservation_extension_transfer(uuid)'::regprocedure)
) > 0 THEN 'OK - TEST transfer claim ambiguity fixed; payment rows unchanged'
ELSE 'FAIL - inspect transfer claim function'
END AS vysledok;
