-- OPTIONAL / TEST ONLY / ONE EVENT: renter email for an ALREADY approved extension.
-- Run ONLY after PR has merged, TEST SQL migration succeeded, and both Edge Functions
-- have been deployed. Never run this in PROD. No new booking/payment is created.
-- If R-000048 is already paid, rejected, expired, or past its payment deadline,
-- this deliberately inserts zero rows. Never alter a finished extension to resend.
begin;

do $test_project$
begin
  if not exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'rentulo_project_url'
      and btrim(s.decrypted_secret, '/') = 'https://vspposovhdgvbeukoivh.supabase.co'
  ) then
    raise exception 'R-000048 email backfill is TEST-only';
  end if;
end;
$test_project$;

insert into public.reservation_notification_deliveries
  (reservation_id, extension_id, event_type, recipient_id, channel)
select e.reservation_id, e.id, 'extension_approved', e.renter_id, 'email'
from public.reservation_extensions e
join public.reservations r on r.id = e.reservation_id
where r.reservation_number = 'R-000048'
  and r.status::text = 'picked_up'
  and e.status = 'approved'
  and e.payment_deadline_at > clock_timestamp()
  and e.stripe_payment_intent_id is null
on conflict do nothing;

-- The worker will process the claimed delivery. This command does not send email.
commit;
