-- READ-ONLY / TEST first. Manual review only; never auto-rewrite active offers.
-- The bounding box detects obvious foreign coordinates but is not a border polygon.
select
  o.id,
  o.status,
  o.pickup_mode,
  o.pickup_street,
  o.pickup_city,
  o.pickup_postal_code,
  o.pickup_latitude,
  o.pickup_longitude,
  p.country_code as profile_residence_country,
  case
    when o.pickup_latitude is null or o.pickup_longitude is null
      then 'missing_coordinates'
    when o.pickup_latitude not between 48.5 and 51.2
      or o.pickup_longitude not between 12 and 19
      then 'outside_czech_bounding_box'
    when o.pickup_postal_code !~ '^[0-9]{3} ?[0-9]{2}$'
      then 'invalid_czech_postcode'
    when o.pickup_mode = 'profile' and p.country_code is null
      then 'legacy_residence_country_unknown'
    when o.pickup_mode = 'profile' and p.country_code <> 'CZ'
      then 'foreign_profile_pickup'
    else 'needs_geocoder_comparison'
  end as review_reason
from public.offers o
left join public.profiles p on p.id = o.owner_id
where o.status = 'active'
order by review_reason, o.created_at desc;
