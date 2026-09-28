begin;

alter table public.reservation_email_deliveries
  drop constraint if exists reservation_email_deliveries_event_type_check;

alter table public.reservation_email_deliveries
  add constraint reservation_email_deliveries_event_type_check
  check (event_type in (
    'new_request',
    'approved',
    'rejected',
    'cancelled',
    'paid',
    'picked_up',
    'returned',
    'paid_cancelled'
  ));

commit;
