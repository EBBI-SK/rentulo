-- RENTULO / BOD 8.2 / TEST ONLY: extension approval, rejection, payment, expiry.
-- Builds on 20261102130000_bod8_1_extension_request_email_TEST.sql.
-- Only creates email outbox entries after REAL extension state changes.
-- Never sends messages from SQL; existing claimed worker + Resend handles delivery.
begin;

do $test_project$
begin
  if not exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'rentulo_project_url'
      and btrim(s.decrypted_secret, '/') = 'https://vspposovhdgvbeukoivh.supabase.co'
  ) then
    raise exception 'BOD 8.2 extension outcome email migration is TEST-only';
  end if;
end;
$test_project$;

-- New events MUST use the extension-specific deduplication keys added in BOD 8.1.
-- Legacy reservation notifications remain unchanged, including all SMS scopes.
alter table public.reservation_notification_deliveries
  drop constraint if exists reservation_notification_deliveries_event_type_check;
alter table public.reservation_notification_deliveries
  add constraint reservation_notification_deliveries_event_type_check
  check (event_type in (
    'new_request','approved','rejected','cancelled','paid','picked_up','returned','paid_cancelled',
    'expiry_reminder_pending','expiry_reminder_approved',
    'expired_pending','expired_approved','no_show',
    'return_reminder_30m','return_reminder_2h','return_not_received',
    'extension_requested','extension_approved','extension_rejected',
    'extension_paid','extension_expired'
  ));

alter table public.reservation_email_deliveries
  drop constraint if exists reservation_email_deliveries_event_type_check;
alter table public.reservation_email_deliveries
  add constraint reservation_email_deliveries_event_type_check
  check (event_type in (
    'new_request','approved','rejected','cancelled','paid','picked_up','returned','paid_cancelled',
    'expiry_reminder_pending','expiry_reminder_approved',
    'expired_pending','expired_approved','no_show',
    'return_reminder_30m','return_reminder_2h','return_not_received',
    'extension_requested','extension_approved','extension_rejected',
    'extension_paid','extension_expired'
  ));

alter table public.reservation_notification_deliveries
  drop constraint if exists rno_extension_event_scope_check;
alter table public.reservation_notification_deliveries
  add constraint rno_extension_event_scope_check check (
    (event_type in (
      'extension_requested','extension_approved','extension_rejected','extension_paid','extension_expired'
    ) and extension_id is not null and channel = 'email')
    or
    (event_type not in (
      'extension_requested','extension_approved','extension_rejected','extension_paid','extension_expired'
    ) and extension_id is null)
  );

alter table public.reservation_email_deliveries
  drop constraint if exists red_extension_event_scope_check;
alter table public.reservation_email_deliveries
  add constraint red_extension_event_scope_check check (
    (event_type in (
      'extension_requested','extension_approved','extension_rejected','extension_paid','extension_expired'
    ) and extension_id is not null)
    or
    (event_type not in (
      'extension_requested','extension_approved','extension_rejected','extension_paid','extension_expired'
    ) and extension_id is null)
  );

create or replace function public.queue_extension_outcome_email()
returns trigger language plpgsql security definer set search_path = ''
as $fn$
begin
  if old.status is not distinct from new.status
     or new.status not in ('approved','rejected','paid','expired') then
    return new;
  end if;

  -- Status changes happen inside the existing authenticated RPC / trusted webhook.
  -- The renter always receives the outcome; the owner ALSO receives payment proof.
  insert into public.reservation_notification_deliveries
    (reservation_id, extension_id, event_type, recipient_id, channel)
  values
    (new.reservation_id, new.id, 'extension_' || new.status, new.renter_id, 'email')
  on conflict do nothing;

  if new.status = 'paid' and new.owner_id <> new.renter_id then
    insert into public.reservation_notification_deliveries
      (reservation_id, extension_id, event_type, recipient_id, channel)
    values
      (new.reservation_id, new.id, 'extension_paid', new.owner_id, 'email')
    on conflict do nothing;
  end if;

  return new;
end;
$fn$;

revoke all on function public.queue_extension_outcome_email()
  from public, anon, authenticated;

drop trigger if exists trg_extension_outcome_email on public.reservation_extensions;
create trigger trg_extension_outcome_email
  after update of status on public.reservation_extensions
  for each row execute function public.queue_extension_outcome_email();

-- Deliberately NO historical backfill and NO external HTTP/SMS call.
-- For R-000048 a separate explicitly approved, guarded one-time backfill exists.
commit;
