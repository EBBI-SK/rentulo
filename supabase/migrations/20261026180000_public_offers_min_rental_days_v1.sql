-- Rentulo V1 / BOD 2: expose the configured minimum rental days in public offer details.
-- Preserve the existing public columns, active-only filtering, and view security settings.
-- No reservation, payment, or Stripe data is changed.
begin;

create or replace view public.public_offers
with (security_invoker = false, security_barrier = true)
as
select
  id,
  owner_id,
  name,
  category,
  description,
  city,
  postal_code,
  price_per_day,
  status,
  photo_url,
  pickup_mode,
  created_at,
  updated_at,
  offer_number,
  min_rental_days
from public.offers
where status = 'active'::public.offer_status;

revoke all on table public.public_offers from public, anon, authenticated;
grant select on table public.public_offers to anon, authenticated;

commit;
