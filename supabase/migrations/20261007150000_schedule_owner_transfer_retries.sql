begin;

-- Automated Stripe owner-transfer recovery. The worker only discovers eligible
-- reservations here; create-owner-transfer remains the single component that
-- atomically claims an attempt, talks to Stripe and records success/failure.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- Reuse the environment-specific project URL already used by other Rentulo Cron
-- jobs. Keep local/restored databases inert until this Vault secret is configured.
do $block$
begin
  if not exists (
    select 1
    from vault.secrets
    where name = 'rentulo_project_url'
  ) then
    perform vault.create_secret(
      'UNCONFIGURED',
      'rentulo_project_url',
      'Base Supabase project URL used by Rentulo database cron jobs'
    );
  end if;
end;
$block$;

-- Use a dedicated secret for payout retries rather than sharing another Cron
-- worker's credential. The raw value never appears in migrations or Git.
do $block$
declare
  v_cron_secret text;
begin
  if not exists (
    select 1
    from vault.secrets
    where name = 'rentulo_owner_transfer_retry_cron_secret'
  ) then
    v_cron_secret :=
      replace(gen_random_uuid()::text, '-', '') ||
      replace(gen_random_uuid()::text, '-', '') ||
      replace(gen_random_uuid()::text, '-', '') ||
      replace(gen_random_uuid()::text, '-', '');

    perform vault.create_secret(
      v_cron_secret,
      'rentulo_owner_transfer_retry_cron_secret',
      'Authentication secret for the Stripe owner-transfer retry Cron worker'
    );
  end if;
end;
$block$;

create or replace function public.verify_owner_transfer_retry_cron_secret(
  p_secret text
)
returns boolean
language sql
security definer
set search_path = ''
as $function$
  select coalesce(
    length(p_secret) >= 64
    and exists (
      select 1
      from vault.decrypted_secrets s
      where s.name = 'rentulo_owner_transfer_retry_cron_secret'
        and s.decrypted_secret = p_secret
    ),
    false
  );
$function$;

revoke all on function public.verify_owner_transfer_retry_cron_secret(text)
  from public, anon, authenticated;
grant execute on function public.verify_owner_transfer_retry_cron_secret(text)
  to service_role;

-- Discover all classes of payout work that can otherwise be stranded:
--   1. not_created: pickup succeeded but the first internal payout call never ran;
--   2. failed + due: a retryable attempt reached its backoff deadline;
--   3. stale pending: a worker died after claiming and never finalized the attempt.
-- This RPC does not claim or mutate rows. The existing claim RPC inside
-- create-owner-transfer is the concurrency boundary for every returned candidate.
create or replace function public.get_due_stripe_owner_transfer_retry_candidates(
  p_limit integer default 10
)
returns table(
  payment_id uuid,
  reservation_id uuid,
  transfer_status text,
  transfer_attempt_count integer,
  eligible_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_now timestamptz := now();
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Owner transfer retry limit must be between 1 and 50';
  end if;

  return query
  select
    p.id,
    r.id,
    p.transfer_status,
    p.transfer_attempt_count,
    case
      when p.transfer_status = 'failed' then p.transfer_next_retry_at
      when p.transfer_status = 'pending' then
        coalesce(p.transfer_last_attempt_at, p.updated_at) + interval '15 minutes'
      else p.updated_at
    end as eligible_at
  from public.payments p
  join public.reservations r
    on r.id = p.reservation_id
  where p.stripe_transfer_id is null
    and p.provider = 'stripe'
    and p.status = 'paid'
    and p.currency = 'czk'
    and p.stripe_payment_intent_status = 'succeeded'
    and p.stripe_payment_intent_id is not null
    and btrim(p.stripe_payment_intent_id) <> ''
    and p.stripe_charge_id is not null
    and btrim(p.stripe_charge_id) <> ''
    and p.refund_status = 'not_requested'
    and p.stripe_refund_amount_minor = 0
    and r.status in ('picked_up', 'returned')
    and p.owner_id = r.owner_id
    and p.payer_id = r.renter_id
    and p.amount_total = r.total_price
    and p.platform_fee_amount = r.platform_fee_amount
    and p.owner_payout = r.owner_payout
    and p.platform_fee_amount + p.owner_payout = p.amount_total
    and p.stripe_amount_total_minor = p.amount_total * 100
    and (
      p.transfer_status = 'not_created'
      or (
        p.transfer_status = 'failed'
        and p.transfer_next_retry_at is not null
        and p.transfer_next_retry_at <= v_now
      )
      or (
        p.transfer_status = 'pending'
        and coalesce(p.transfer_last_attempt_at, p.updated_at)
          <= v_now - interval '15 minutes'
      )
    )
  order by
    case
      when p.transfer_status = 'failed' then p.transfer_next_retry_at
      when p.transfer_status = 'pending' then
        coalesce(p.transfer_last_attempt_at, p.updated_at) + interval '15 minutes'
      else p.updated_at
    end asc,
    p.id asc
  limit p_limit;
end;
$function$;

revoke all on function public.get_due_stripe_owner_transfer_retry_candidates(integer)
  from public, anon, authenticated;
grant execute on function public.get_due_stripe_owner_transfer_retry_candidates(integer)
  to service_role;

-- The shortest retry backoff is five minutes, so run on the same cadence. A small
-- batch plus bounded worker concurrency avoids bursts while clearing normal retry
-- queues quickly. The worker itself is protected by the dedicated Vault secret.
select cron.schedule(
  'rentulo-retry-owner-transfers-every-5-minutes',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url := trim(trailing '/' from cfg.project_url)
        || '/functions/v1/retry-owner-transfers',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-rentulo-cron-secret', cfg.cron_secret
      ),
      body := jsonb_build_object('limit', 10),
      timeout_milliseconds := 60000
    ) as request_id
    from (
      select
        max(s.decrypted_secret) filter (
          where s.name = 'rentulo_project_url'
        ) as project_url,
        max(s.decrypted_secret) filter (
          where s.name = 'rentulo_owner_transfer_retry_cron_secret'
        ) as cron_secret
      from vault.decrypted_secrets s
      where s.name in (
        'rentulo_project_url',
        'rentulo_owner_transfer_retry_cron_secret'
      )
    ) cfg
    where cfg.project_url ~ '^https://[a-z0-9-]+[.]supabase[.]co/?$'
      and length(cfg.cron_secret) >= 64;
  $cron$
);

commit;
