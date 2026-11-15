// Rentulo PROD -> isolated Rentulo Office. Transport only: no reservation/payment mutations.
// Safe to import from Deno Edge Functions and to test in Node (Web Crypto).
const encoder = new TextEncoder();
const LIMIT = 4;
const TIMEOUT_MS = 5000;

export function officeEventConfigValid(config) {
  if (config?.enabled !== 'true' || typeof config.secret !== 'string' ||
      encoder.encode(config.secret).byteLength < 64 ||
      typeof config.bypassSecret !== 'string' || config.bypassSecret.length < 32) return false;
  try {
    const u = new URL(config.url);
    return u.protocol === 'https:' && !u.username && !u.password &&
      !u.search && !u.hash && u.pathname === '/api/integrations/rentulo/events' &&
      u.hostname !== 'localhost' && !u.hostname.endsWith('.localhost');
  } catch { return false; }
}

export async function signOfficeEvent(secret, timestamp, body, cryptoImpl = globalThis.crypto) {
  const key = await cryptoImpl.subtle.importKey('raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await cryptoImpl.subtle.sign('HMAC', key,
    encoder.encode(`${timestamp}\nprod\n${body}`)));
  return `sha256=${Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('')}`;
}

function safePayload(row) {
  const keys = ['event_id', 'issue_key', 'event_type', 'state', 'severity',
    'occurred_at', 'reservation_number', 'diagnostic_code'];
  const obj = {};
  for (const key of keys) obj[key] = row[key] ?? null;
  if (typeof obj.occurred_at !== 'string' || !Number.isFinite(Date.parse(obj.occurred_at))) {
    throw new Error('Invalid event time');
  }
  obj.occurred_at = new Date(obj.occurred_at).toISOString();
  return obj;
}

async function callRpc(admin, name, args) {
  const request = admin.rpc(name, args);
  const response = typeof request.abortSignal === 'function'
    ? await request.abortSignal(AbortSignal.timeout(4500)) : await request;
  if (response?.error) throw new Error(`Office event RPC failure: ${name}`);
  return response?.data;
}

async function deliverOne({ row, admin, config, fetchImpl, now, cryptoImpl }) {
  let outcome = 'retry';
  let failure = 'TRANSPORT_ERROR';
  try {
    const body = JSON.stringify(safePayload(row));
    const timestamp = String(Math.floor(now() / 1000));
    const signature = await signOfficeEvent(config.secret, timestamp, body, cryptoImpl);
    const response = await fetchImpl(config.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-rentulo-environment': 'prod',
        'x-rentulo-timestamp': timestamp,
        'x-rentulo-signature': signature,
        'x-vercel-protection-bypass': config.bypassSecret,
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 200 || response.status === 201) {
      const confirmation = await response.json().catch(() => null);
      if (confirmation?.accepted === true) { outcome = 'sent'; failure = null; }
      else failure = 'UNCONFIRMED_DELIVERY';
    } else if (response.status === 409) {
      // An event ID with changed content must be reviewed, not retried forever.
      outcome = 'dead';
      failure = 'EVENT_ID_CONFLICT';
    } else failure = `OFFICE_HTTP_${response.status}`;
  } catch {
    failure = 'TRANSPORT_ERROR'; // Never log or store response bodies, secrets or PII.
  }
  try {
    const ack = await callRpc(admin, 'finish_rentulo_office_event_delivery', {
      p_event_id: row.event_id,
      p_claim_token: row.claim_token,
      p_outcome: outcome,
      p_error: failure,
    });
    if (ack !== true) return { outcome: 'ack_failed' };
  } catch { return { outcome: 'ack_failed' }; }
  return { outcome };
}

export async function dispatchOfficeEvents({ admin, config, fetchImpl = fetch,
  now = () => Date.now(), cryptoImpl = globalThis.crypto }) {
  if (config?.enabled !== 'true') return { enabled: false, ok: true, claimed: 0 };
  if (!officeEventConfigValid(config)) return { enabled: true, ok: false, error: 'CONFIGURATION_MISSING' };
  let rows;
  try {
    rows = await callRpc(admin, 'claim_rentulo_office_event_deliveries', { p_limit: LIMIT });
    if (!Array.isArray(rows)) throw new Error('Bad claim response');
  } catch { return { enabled: true, ok: false, error: 'OUTBOX_UNAVAILABLE' }; }
  const summary = { enabled: true, ok: true, claimed: rows.length, sent: 0, retry: 0,
    dead: 0, ack_failed: 0 };
  let cursor = 0;
  async function consume() {
    for (;;) {
      const index = cursor++;
      if (index >= rows.length) break;
      const result = await deliverOne({ row: rows[index], admin, config, fetchImpl, now, cryptoImpl });
      summary[result.outcome] += 1;
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, rows.length) }, () => consume()));
  summary.ok = summary.retry === 0 && summary.dead === 0 && summary.ack_failed === 0;
  return summary;
}
