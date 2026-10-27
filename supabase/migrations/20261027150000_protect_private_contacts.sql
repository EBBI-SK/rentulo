-- Rentulo V1 / launch point 1: keep private contacts behind the safe readers.
begin;

-- Public offer pages use public_offers and get_public_map_offers().
-- The base table must only expose an active account's own offers, via the
-- existing offers_select_own policy. Keep its SELECT/INSERT/UPDATE grants.
drop policy if exists offers_select_active_public on public.offers;

-- get_my_reservations() masks contacts until payment and checks both parties.
-- A direct table SELECT must not bypass that masking. Revoking table SELECT
-- also revokes any existing SELECT grants on its individual columns.
revoke select on table public.reservations from public, anon, authenticated;

-- The booking form uses INSERT ... RETURNING id. Preserve this one safe
-- column and the existing related-user RLS policy, INSERT and UPDATE grants.
grant select (id) on table public.reservations to authenticated;

notify pgrst, 'reload schema';
commit;
