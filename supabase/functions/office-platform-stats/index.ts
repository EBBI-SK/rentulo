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

runtime.serve(createStatsHandler({
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
      if (table !== 'offers' && table !== 'reservations') {
        throw new Error('Unsupported statistics table');
      }
      // count=exact + head=true returns no rows, only an aggregate count.
      let query = db.from(table).select('id', { head: true, count: 'exact' });
      if (start && end) query = query.gte('created_at', start).lt('created_at', end);
      const { count, error } = await query;
      if (error || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
        throw new Error('Rentulo PROD count query failed');
      }
      return count;
    };
  }
}));
