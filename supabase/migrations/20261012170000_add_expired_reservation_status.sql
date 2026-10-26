-- PostgreSQL enum additions must commit before the new value can be used.
-- Apply this migration BEFORE 20261012171000_reservation_expiration_policy.sql.
alter type public.reservation_status add value if not exists 'expired';
