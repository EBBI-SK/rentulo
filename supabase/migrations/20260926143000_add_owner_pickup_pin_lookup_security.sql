begin;

create table if not exists public.owner_pickup_pin_security (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  failed_attempts smallint not null default 0 check (failed_attempts between 0 and 3),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.owner_pickup_pin_security enable row level security;

revoke all on table public.owner_pickup_pin_security from public, anon, authenticated;
grant all on table public.owner_pickup_pin_security to service_role;

create or replace function public.register_failed_owner_pickup_pin(
  p_owner_id uuid
)
returns table (
  failed_attempts smallint,
  attempts_remaining integer,
  locked_until timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_security public.owner_pickup_pin_security%rowtype;
  v_now timestamptz := now();
  v_attempts smallint;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 0));

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_owner_id
  ) then
    raise exception 'Owner was not found';
  end if;

  select s.*
  into v_security
  from public.owner_pickup_pin_security s
  where s.owner_id = p_owner_id
  for update;

  if found and v_security.locked_until is not null and v_security.locked_until > v_now then
    return query
    select v_security.failed_attempts, 0, v_security.locked_until;
    return;
  end if;

  if found then
    if v_security.locked_until is not null and v_security.locked_until <= v_now then
      v_attempts := 1;
    else
      v_attempts := least(v_security.failed_attempts + 1, 3);
    end if;

    update public.owner_pickup_pin_security s
    set
      failed_attempts = v_attempts,
      locked_until = case when v_attempts >= 3 then v_now + interval '15 minutes' else null end,
      updated_at = v_now
    where s.owner_id = p_owner_id
    returning s.* into v_security;
  else
    insert into public.owner_pickup_pin_security (
      owner_id,
      failed_attempts,
      locked_until,
      created_at,
      updated_at
    )
    values (
      p_owner_id,
      1,
      null,
      v_now,
      v_now
    )
    returning * into v_security;
  end if;

  return query
  select
    v_security.failed_attempts,
    greatest(0, 3 - v_security.failed_attempts)::integer,
    v_security.locked_until;
end;
$function$;

revoke all on function public.register_failed_owner_pickup_pin(uuid) from public, anon, authenticated;
grant execute on function public.register_failed_owner_pickup_pin(uuid) to service_role;

commit;
