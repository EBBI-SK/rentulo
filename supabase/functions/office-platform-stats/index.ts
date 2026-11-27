// Read-only aggregates from Rentulo PROD for authenticated Rentulo Office server.
// Deploy ONLY to project tfvgxrdjrpicgtvovehl with --no-verify-jwt: a dedicated
// 256-bit header secret is verified inside the handler. Never invoke in a browser.
// Neither the secret Supabase key nor individual records are returned.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { createStatsHandler, PROD_SUPABASE_URL } from './core.mjs';

type Runtime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};
const runtime = (globalThis as typeof globalThis & { Deno: Runtime }).Deno;
const env = (name: string) => runtime.env.get(name);

function readDatabaseKey(): string {
  // Prefer the current server-side Supabase secret key. The legacy service
  // role key is retained as a fallback while Rentulo completes migration.
  let key: unknown;
  try {
    const secretKeys = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}');
    key = secretKeys?.default;
  } catch { /* Fail closed unless the existing legacy key is configured. */ }
  if (typeof key === 'string' && key.length > 0) return key;
  return env('SUPABASE_SERVICE_ROLE_KEY') || '';
}

const CRON_JOBS = {
  no_show: 'rentulo-paid-no-show-every-minute',
  notification_monitor: 'rentulo-prod-notification-monitor-5min',
  owner_transfer_retry: 'rentulo-retry-owner-transfers-every-5-minutes',
  return_followups: 'rentulo-return-followups-every-minute'
} as const;

function isoTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const time = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(time.getTime())) throw new Error('Invalid process timestamp');
  return time.toISOString();
}

// Called only by an authenticated, valid PROD request with ?view=processes.
// Read one bounded snapshot of pg_cron plus the EXISTING notification heartbeat.
// Supabase automatically provides SUPABASE_DB_URL to Edge Functions; no new secret,
// SQL migration, database table or job is required. Never read cron.job.command.
async function readProcesses() {
  const dbUrl = env('SUPABASE_DB_URL') || '';
  if (!dbUrl || env('SUPABASE_URL') !== PROD_SUPABASE_URL) {
    throw new Error('Production database connection unavailable');
  }
  const { default: postgres } = await import('npm:postgres@3.4.7');
  const db = postgres(dbUrl, { max: 1, prepare: false, connect_timeout: 4,
    idle_timeout: 1, max_lifetime: 60 });
  try {
    const rows = await db`
      select j.jobname, j.active, r.status as last_state,
             r.start_time as last_started_at, r.end_time as last_finished_at
      from cron.job j
      left join lateral (
        select status, start_time, end_time
        from cron.job_run_details d
        where d.jobid = j.jobid
        order by d.start_time desc limit 1
      ) r on true
      where j.jobname in (
        'rentulo-paid-no-show-every-minute',
        'rentulo-prod-notification-monitor-5min',
        'rentulo-retry-owner-transfers-every-5-minutes',
        'rentulo-return-followups-every-minute'
      )
    `;
    const pulses = await db`
      select last_success_at
      from public.reservation_notification_worker_health
      where singleton = true limit 1
    `;
    if (!Array.isArray(rows) || rows.length > 4 || !Array.isArray(pulses) || pulses.length !== 1) {
      throw new Error('Invalid process health rows');
    }
    const byName = new Map();
    for (const row of rows) {
      if (!Object.values(CRON_JOBS).includes(row.jobname) || byName.has(row.jobname)) {
        throw new Error('Unexpected process name');
      }
      byName.set(row.jobname, row);
    }
    const jobs = Object.fromEntries(Object.entries(CRON_JOBS).map(([key, name]) => {
      const item = byName.get(name);
      if (!item) return [key, {present: false, active: null, last_state: null,
        last_started_at: null, last_finished_at: null}];
      if (typeof item.active !== 'boolean') throw new Error('Invalid cron active state');
      const state = item.last_state;
      return [key, {present: true, active: item.active,
        last_state: ['succeeded', 'failed', 'running', 'starting'].includes(state) ? state : null,
        last_started_at: isoTimestamp(item.last_started_at),
        last_finished_at: isoTimestamp(item.last_finished_at)}];
    }));
    return {jobs, worker_last_success_at: isoTimestamp(pulses[0].last_success_at)};
  } finally {
    await db.end({timeout: 1});
  }
}

runtime.serve(createStatsHandler({
  readProcesses,
  getEnv: env,
  createCounter() {
    const key = readDatabaseKey();
    if (!key || env('SUPABASE_URL') !== PROD_SUPABASE_URL) {
      throw new Error('Rentulo PROD database configuration missing');
    }
    const db = createClient(PROD_SUPABASE_URL, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    return async (table: string, start: string | null, end: string | null): Promise<number> => {
      if (table !== 'offers' && table !== 'reservations' && table !== 'profiles') {
        throw new Error('Unsupported statistics table');
      }
      // count=exact + head=true returns no rows, only an aggregate count.
      let query = db.from(table).select('id', { head: true, count: 'exact' });
      if (table === 'profiles') query = query.eq('account_status', 'active');
      if (start && end) query = query.gte('created_at', start).lt('created_at', end);
      const { count, error } = await query;
      if (error || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
        throw new Error('Rentulo PROD count query failed');
      }
      return count;
    };
  }
}));
