// Convert a local Prague date+time into an instant consistent with PostgreSQL
// `AT TIME ZONE 'Europe/Prague'`, including DST gaps and repeated hours.
// The result is used only as an additional Edge guard; the database remains
// authoritative for PIN handover and paid no-show settlement.
const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Prague', hourCycle: 'h23', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

function localFields(instant) {
  const values = {};
  for (const part of formatter.formatToParts(new Date(instant))) {
    if (['year', 'month', 'day', 'hour', 'minute', 'second'].includes(part.type)) {
      values[part.type] = Number(part.value);
    }
  }
  return values;
}

function key(fields) {
  return [fields.year, fields.month, fields.day, fields.hour, fields.minute, fields.second]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, '0')).join('');
}

function utcOffsetAt(instant) {
  const fields = localFields(instant);
  const localAsUtc = Date.UTC(fields.year, fields.month - 1, fields.day,
    fields.hour, fields.minute, fields.second);
  return localAsUtc - Math.floor(instant / 1000) * 1000;
}

export function pragueRentalInstant(date, time) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,6}))?)?$/.exec(String(time || ''));
  if (!dateMatch || !timeMatch) return null;
  const [year, month, day] = dateMatch.slice(1).map(Number);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] || 0);
  const millisecond = Number((timeMatch[4] || '').padEnd(3, '0').slice(0, 3));
  const naive = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const calendar = new Date(naive);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() + 1 !== month ||
      calendar.getUTCDate() !== day) return null;
  const requested = key({ year, month, day, hour, minute, second });
  const offsets = new Set([
    utcOffsetAt(naive - 86400000), utcOffsetAt(naive), utcOffsetAt(naive + 86400000),
  ]);
  const candidates = [...offsets].map((offset) => ({
    instant: naive - offset,
    local: key(localFields(naive - offset)),
  }));
  // On an autumn DST overlap PostgreSQL chooses the later (standard-time)
  // occurrence; for a nonexistent spring time it moves forward over the gap.
  const exact = candidates.filter((candidate) => candidate.local === requested);
  if (exact.length) return Math.max(...exact.map((candidate) => candidate.instant));
  const afterGap = candidates.filter((candidate) => candidate.local > requested);
  return afterGap.length ? Math.min(...afterGap.map((candidate) => candidate.instant)) : null;
}

export function rentalEndReached(endDate, pickupTime, now = new Date()) {
  const deadline = pragueRentalInstant(endDate, pickupTime);
  return deadline === null || now.getTime() >= deadline;
}

export function rentalHandoverOpen(startDate, endDate, pickupTime, now = new Date()) {
  const begin = pragueRentalInstant(startDate, pickupTime);
  const end = pragueRentalInstant(endDate, pickupTime);
  // Two elapsed hours of optional early pickup. The owner still decides whether
  // the item is ready. End-of-rental remains an exclusive, unchanged deadline.
  return begin !== null && end !== null && now.getTime() >= begin - 2 * 60 * 60 * 1000 && now.getTime() < end;
}
