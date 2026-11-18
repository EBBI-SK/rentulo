// Rentulo PROD -> Rentulo Office: aggregates only. Never read or return row data.
// This module is runtime-neutral so authorization and date logic can be tested
// without connecting to a production database.
export const PROD_SUPABASE_URL = 'https://tfvgxrdjrpicgtvovehl.supabase.co';
const PRAGUE = 'Europe/Prague';
const TOKEN_FORMAT = /^[a-f0-9]{64}$/;
const DAY_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

function response(payload, status = 200, extra = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extra
    }
  });
}

// Reject missing/weak secrets; never compare arbitrary-length bearer input.
// Contents are compared in constant work for correctly shaped 256-bit tokens.
export function secretMatches(input, configured) {
  if (!TOKEN_FORMAT.test(configured || '') || !TOKEN_FORMAT.test(input || '')) return false;
  let difference = 0;
  for (let i = 0; i < 64; i++) {
    difference |= input.charCodeAt(i) ^ configured.charCodeAt(i);
  }
  return difference === 0;
}

export function validDay(value) {
  if (typeof value !== 'string' || !DAY_FORMAT.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 2000 || year > 2100) return false;
  const utc = new Date(Date.UTC(year, month - 1, day));
  return Number.isFinite(utc.valueOf()) && utc.toISOString().slice(0, 10) === value;
}

export function pragueToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: PRAGUE,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const fields = Object.fromEntries(parts.filter(p => ['year', 'month', 'day'].includes(p.type))
    .map(p => [p.type, p.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

// At UTC midnight Prague is at 01:00 or 02:00. The offset at that instant
// equals the offset at Prague midnight, including DST transition dates.
const offsetFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: PRAGUE, timeZoneName: 'longOffset', hour: '2-digit'
});
function midnightUtc(isoDay) {
  const [year, month, day] = isoDay.split('-').map(Number);
  const utcMidnight = Date.UTC(year, month - 1, day);
  const offsetText = offsetFormatter.formatToParts(new Date(utcMidnight))
    .find(part => part.type === 'timeZoneName')?.value || '';
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offsetText);
  if (!match) throw new Error('Prague timezone offset unavailable');
  const offsetMinutes = (match[1] === '+' ? 1 : -1) *
    (Number(match[2]) * 60 + Number(match[3]));
  return new Date(utcMidnight - offsetMinutes * 60_000).toISOString();
}

export function pragueDayWindow(day) {
  if (!validDay(day)) throw new Error('Invalid calendar day');
  const [year, month, date] = day.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, date) + 86_400_000)
    .toISOString().slice(0, 10);
  return { start: midnightUtc(day), end: midnightUtc(tomorrow) };
}

// Fixed, non-sensitive summaries. Raw cron SQL, credentials and job commands stay server-side.
const PROCESS_KEYS = [
  'no_show', 'notification_monitor', 'owner_transfer_retry', 'return_followups'
];
const PROCESS_STATES = new Set(['succeeded', 'failed', 'running', 'starting']);
function validTimestampOrNull(value) {
  return value === null || (typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)));
}
function validProcessSummary(summary) {
  if (!summary || !summary.jobs || typeof summary.jobs !== 'object' ||
      Object.keys(summary.jobs).length !== PROCESS_KEYS.length ||
      !validTimestampOrNull(summary.worker_last_success_at)) return false;
  return PROCESS_KEYS.every(key => {
    const job = summary.jobs[key];
    return job && typeof job.present === 'boolean' &&
      (job.active === null || typeof job.active === 'boolean') &&
      (job.last_state === null || PROCESS_STATES.has(job.last_state)) &&
      validTimestampOrNull(job.last_finished_at) &&
      validTimestampOrNull(job.last_started_at) &&
      (!job.present || typeof job.active === 'boolean');
  });
}

export function createStatsHandler({ getEnv, createCounter, readProcesses, now = () => new Date() }) {
  return async function statsHandler(request) {
    if (request.method !== 'GET') {
      return response({ error: 'method_not_allowed' }, 405, { allow: 'GET' });
    }
    const secret = getEnv('RENTULO_OFFICE_STATS_SECRET');
    if (!TOKEN_FORMAT.test(secret || '')) {
      return response({ error: 'integration_unavailable' }, 503);
    }
    if (!secretMatches(request.headers.get('x-rentulo-office-stats-secret'), secret)) {
      return response({ error: 'unauthorized' }, 401);
    }
    // Prevent TEST/PROD mixing even if a deployment is misconfigured.
    if (getEnv('SUPABASE_URL') !== PROD_SUPABASE_URL) {
      return response({ error: 'integration_unavailable' }, 503);
    }
    let url;
    try { url = new URL(request.url); }
    catch { return response({ error: 'bad_request' }, 400); }
    // Keep the original ?day=... API untouched. The new authenticated process
    // summary is deliberately a separate read-only view on this same endpoint.
    if (url.searchParams.has('view')) {
      if (url.searchParams.size !== 1 || url.searchParams.get('view') !== 'processes') {
        return response({ error: 'bad_request' }, 400);
      }
      try {
        if (typeof readProcesses !== 'function') throw new Error('Process reader missing');
        const summary = await readProcesses();
        if (!validProcessSummary(summary)) throw new Error('Invalid process summary');
        const jobs = Object.fromEntries(PROCESS_KEYS.map(key => {
          const job = summary.jobs[key];
          return [key, {present:job.present, active:job.active,
            last_state:job.last_state, last_started_at:job.last_started_at,
            last_finished_at:job.last_finished_at}];
        }));
        return response({ source: 'rentulo-prod', view: 'processes',
          checked_at: now().toISOString(), jobs,
          worker: { last_success_at: summary.worker_last_success_at }
        });
      } catch {
        console.error('Rentulo Office process summary unavailable');
        return response({ error: 'unavailable' }, 503);
      }
    }
    if ([...url.searchParams.keys()].some(key => key !== 'day') ||
        url.searchParams.getAll('day').length > 1) {
      return response({ error: 'bad_request' }, 400);
    }
    const day = url.searchParams.get('day') ?? pragueToday(now());
    if (!validDay(day)) return response({ error: 'bad_request' }, 400);

    try {
      const { start, end } = pragueDayWindow(day);
      const count = createCounter();
      const [offersTotal, offersDay, reservationsTotal, reservationsDay] = await Promise.all([
        count('offers', null, null),
        count('offers', start, end),
        count('reservations', null, null),
        count('reservations', start, end)
      ]);
      if (![offersTotal, offersDay, reservationsTotal, reservationsDay]
        .every(value => Number.isSafeInteger(value) && value >= 0)) {
        throw new Error('Invalid database count');
      }
      return response({
        source: 'rentulo-prod', day, timezone: PRAGUE,
        offers: { total: offersTotal, day: offersDay },
        reservations: { total: reservationsTotal, day: reservationsDay }
      });
    } catch {
      // Do not emit SQL errors, secrets or any partial totals to the client.
      console.error('Rentulo Office statistics count unavailable');
      return response({ error: 'unavailable' }, 503);
    }
  };
}
