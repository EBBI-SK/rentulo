-- RENTULO / BOD 8.1 / TEST ONLY: owner email on a NEW extension request.
-- Uses the existing reservation notification outbox, worker, Resend transport,
-- and email-delivery log. Never emits an SMS or calls an external provider in SQL.
-- Deploy new worker + email function AFTER this transactional migration succeeds.
begin;

-- Fail closed: this migration must NEVER run against the PROD Supabase project.
do $test_project$
begin
  if not exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'rentulo_project_url'
      and btrim(s.decrypted_secret, '/') = 'https://vspposovhdgvbeukoivh.supabase.co'
  ) then
    raise exception 'BOD 8.1 extension request email migration is TEST-only';
  end if;
end;
$test_project$;

-- Both deduplication layers must distinguish MULTIPLE extension requests on
-- the same reservation. Regular reservation events keep their old uniqueness.
alter table public.reservation_notification_deliveries
  add column extension_id uuid references public.reservation_extensions(id) on delete cascade;
alter table public.reservation_email_deliveries
  add column extension_id uuid references public.reservation_extensions(id) on delete cascade;

-- Both legacy UNIQUE constraints were generated from unnamed UNIQUE clauses;
-- look them up by their actual columns, not by PostgreSQL's truncated names.
do $replace_uniques$
declare
  v_outbox_name name;
  v_email_name name;
begin
  select c.conname into strict v_outbox_name
  from pg_constraint c
  where c.conrelid = 'public.reservation_notification_deliveries'::regclass
    and c.contype = 'u'
    and array(
      select a.attname::text from unnest(c.conkey) with ordinality u(attnum, ord)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = u.attnum
      order by u.ord
    ) = array['reservation_id','event_type','recipient_id','channel'];

  select c.conname into strict v_email_name
  from pg_constraint c
  where c.conrelid = 'public.reservation_email_deliveries'::regclass
    and c.contype = 'u'
    and array(
      select a.attname::text from unnest(c.conkey) with ordinality u(attnum, ord)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = u.attnum
      order by u.ord
    ) = array['reservation_id','event_type','recipient_id'];

  execute format('alter table public.reservation_notification_deliveries drop constraint %I', v_outbox_name);
  execute format('alter table public.reservation_email_deliveries drop constraint %I', v_email_name);
end;
$replace_uniques$;

create unique index rno_legacy_event_unique
  on public.reservation_notification_deliveries
  (reservation_id, event_type, recipient_id, channel)
  where extension_id is null;
create unique index rno_extension_event_unique
  on public.reservation_notification_deliveries
  (extension_id, event_type, recipient_id, channel)
  where extension_id is not null;

create unique index red_legacy_event_unique
  on public.reservation_email_deliveries
  (reservation_id, event_type, recipient_id)
  where extension_id is null;
create unique index red_extension_event_unique
  on public.reservation_email_deliveries
  (extension_id, event_type, recipient_id)
  where extension_id is not null;

-- Future non-extension events may not impersonate extension delivery rows.
alter table public.reservation_notification_deliveries
  add constraint rno_extension_event_scope_check check (
    (event_type = 'extension_requested' and extension_id is not null and channel = 'email')
    or (event_type <> 'extension_requested' and extension_id is null)
  );
alter table public.reservation_email_deliveries
  add constraint red_extension_event_scope_check check (
    (event_type = 'extension_requested' and extension_id is not null)
    or (event_type <> 'extension_requested' and extension_id is null)
  );

-- Preserve every currently allowed email event. This single new event is
-- email-only. Other events and SMS scopes remain exactly as before.
alter table public.reservation_notification_deliveries
  drop constraint if exists reservation_notification_deliveries_event_type_check;
alter table public.reservation_notification_deliveries
  add constraint reservation_notification_deliveries_event_type_check
  check (event_type in (
    'new_request','approved','rejected','cancelled','paid','picked_up','returned','paid_cancelled',
    'expiry_reminder_pending','expiry_reminder_approved',
    'expired_pending','expired_approved','no_show',
    'return_reminder_30m','return_reminder_2h','return_not_received',
    'extension_requested'
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
    'extension_requested'
  ));

-- The existing queue helper used a column-targeted ON CONFLICT, which no
-- longer identifies the partial legacy index. Keep its original behavior
-- (email + optional opt-in SMS) with conflict-agnostic DO NOTHING.
create or replace function public.queue_reservation_notification(
  p_reservation_id uuid,
  p_event_type text,
  p_recipient_id uuid,
  p_offer_sms boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_recipient_id is null then
    return;
  end if;

  insert into public.reservation_notification_deliveries (
    reservation_id, event_type, recipient_id, channel
  ) values (p_reservation_id, p_event_type, p_recipient_id, 'email')
  on conflict do nothing;

  if p_offer_sms and exists (
    select 1 from public.profiles p
    where p.id = p_recipient_id and p.sms_notifications is true
  ) then
    insert into public.reservation_notification_deliveries (
      reservation_id, event_type, recipient_id, channel
    ) values (p_reservation_id, p_event_type, p_recipient_id, 'sms')
    on conflict do nothing;
  end if;
end;
$function$;
revoke all on function public.queue_reservation_notification(uuid,text,uuid,boolean)
  from public, anon, authenticated;

-- This trigger fires only when the existing authenticated request RPC commits
-- an actual pending extension. No browser call is able to directly queue mail.
create or replace function public.queue_extension_request_owner_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'pending' and new.owner_id is not null then
    insert into public.reservation_notification_deliveries (
      reservation_id, extension_id, event_type, recipient_id, channel
    ) values (
      new.reservation_id, new.id, 'extension_requested', new.owner_id, 'email'
    ) on conflict do nothing;
  end if;
  return new;
end;
$function$;
revoke all on function public.queue_extension_request_owner_email()
  from public, anon, authenticated;

create trigger trg_extension_request_owner_email
  after insert on public.reservation_extensions
  for each row execute function public.queue_extension_request_owner_email();

commit;
