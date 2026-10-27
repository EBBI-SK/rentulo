begin;

-- Keep one short-lived lookup per owner. HMAC verification stays in the Edge
-- function; only the current attempt may publish a result or change failures.
alter table public.owner_pickup_pin_security
  add column if not exists lookup_attempt_id uuid,
  add column if not exists lookup_attempt_expires_at timestamptz;

-- During SQL -> Edge rollout an older handler must not delete a newer lock.
-- The security-definer functions below retain the required write access.
revoke delete on table public.owner_pickup_pin_security from service_role;

create or replace function public.begin_owner_pickup_pin_attempt(p_owner_id uuid)
returns table (
  status text,
  attempt_id uuid,
  attempts_remaining integer,
  locked_until timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_security public.owner_pickup_pin_security%rowtype;
  v_now timestamptz;
  v_attempt_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required';
  end if;
  if p_owner_id is null then
    raise exception 'Owner is required';
  end if;

  -- Use the same owner lock as the previous failed-attempt function, including
  -- requests that were already running when the new Edge version was deployed.
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 0));

  insert into public.owner_pickup_pin_security (owner_id)
  values (p_owner_id)
  on conflict (owner_id) do nothing;

  select s.* into v_security
  from public.owner_pickup_pin_security s
  where s.owner_id = p_owner_id
  for update;

  -- Read wall-clock time after all potentially waiting locks.
  v_now := clock_timestamp();

  if v_security.locked_until is not null and v_security.locked_until > v_now then
    return query select 'locked'::text, null::uuid, 0, v_security.locked_until;
    return;
  end if;

  if v_security.locked_until is not null then
    update public.owner_pickup_pin_security s
    set failed_attempts = 0,
        locked_until = null,
        lookup_attempt_id = null,
        lookup_attempt_expires_at = null,
        updated_at = v_now
    where s.owner_id = p_owner_id
    returning s.* into v_security;
  end if;

  if v_security.lookup_attempt_id is not null
     and v_security.lookup_attempt_expires_at > v_now then
    return query select 'busy'::text, null::uuid,
      greatest(0, 3 - v_security.failed_attempts)::integer, null::timestamptz;
    return;
  end if;

  v_attempt_id := gen_random_uuid();
  update public.owner_pickup_pin_security s
  set lookup_attempt_id = v_attempt_id,
      lookup_attempt_expires_at = v_now + interval '60 seconds',
      updated_at = v_now
  where s.owner_id = p_owner_id;

  return query select 'started'::text, v_attempt_id,
    greatest(0, 3 - v_security.failed_attempts)::integer, null::timestamptz;
end;
$function$;

create or replace function public.finish_owner_pickup_pin_attempt(
  p_owner_id uuid,
  p_attempt_id uuid,
  p_outcome text
)
returns table (
  status text,
  attempts_remaining integer,
  locked_until timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_security public.owner_pickup_pin_security%rowtype;
  v_now timestamptz;
  v_attempts smallint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required';
  end if;
  if p_owner_id is null or p_attempt_id is null then
    raise exception 'Owner and attempt are required';
  end if;
  if p_outcome is null or p_outcome not in ('success', 'failure', 'cancelled') then
    raise exception 'Invalid lookup outcome';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 0));

  select s.* into v_security
  from public.owner_pickup_pin_security s
  where s.owner_id = p_owner_id
  for update;

  if not found then
    return query select 'stale'::text, 0, null::timestamptz;
    return;
  end if;

  v_now := clock_timestamp();

  -- Never let a delayed success/cancellation remove an intervening lock.
  if v_security.locked_until is not null and v_security.locked_until > v_now then
    return query select 'locked'::text, 0, v_security.locked_until;
    return;
  end if;

  if v_security.lookup_attempt_id is distinct from p_attempt_id
     or v_security.lookup_attempt_expires_at is null
     or v_security.lookup_attempt_expires_at <= v_now then
    return query select 'stale'::text, 0, null::timestamptz;
    return;
  end if;

  v_attempts := case
    when p_outcome = 'success' then 0
    when p_outcome = 'failure' then least(v_security.failed_attempts + 1, 3)
    else v_security.failed_attempts
  end;

  update public.owner_pickup_pin_security s
  set failed_attempts = v_attempts,
      locked_until = case
        when p_outcome = 'failure' and v_attempts >= 3
          then v_now + interval '15 minutes'
        else null
      end,
      lookup_attempt_id = null,
      lookup_attempt_expires_at = null,
      updated_at = v_now
  where s.owner_id = p_owner_id
  returning s.* into v_security;

  return query select
    case when v_security.locked_until is not null then 'locked' else 'completed' end,
    greatest(0, 3 - v_security.failed_attempts)::integer,
    v_security.locked_until;
end;
$function$;

revoke all on function public.begin_owner_pickup_pin_attempt(uuid) from public, anon, authenticated;
revoke all on function public.finish_owner_pickup_pin_attempt(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.begin_owner_pickup_pin_attempt(uuid) to service_role;
grant execute on function public.finish_owner_pickup_pin_attempt(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';

commit;
