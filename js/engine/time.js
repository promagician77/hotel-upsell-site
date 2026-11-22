// Dates and times in the hotel's own time zone, without libraries. Local dates are
// 'YYYY-MM-DD' strings; instants are epoch milliseconds (UTC).

const fmtCache = new Map();
function fmt(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return fmtCache.get(tz);
}

/** Local wall-clock parts of an instant in a time zone. */
export function localParts(ms, tz) {
  const p = {};
  for (const { type, value } of fmt(tz).formatToParts(new Date(ms))) if (type !== 'literal') p[type] = Number(value);
  return { y: p.year, m: p.month, d: p.day, hh: p.hour, mm: p.minute, ss: p.second };
}

/** Offset of the zone from UTC at an instant, in milliseconds. */
export function offsetMs(ms, tz) {
  const p = localParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(ms / 1000) * 1000;
}

/** The instant at which the wall clock in `tz` reads `date` `hh:mm`. Times that do not
 * exist (spring-forward gap) move to the first valid minute after the gap. */
export function zonedToUtc(date, hh, mm, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - offsetMs(guess, tz);
  const o2 = offsetMs(t, tz);
  t = guess - o2;
  const back = localParts(t, tz);
  if (back.hh !== hh || back.mm !== mm || back.d !== d) {
    // inside a gap: step forward minute by minute until the clock is past the asked time
    let probe = t;
    for (let i = 0; i < 180; i++) {
      probe += 60000;
      const lp = localParts(probe, tz);
      if (lp.d === d && (lp.hh > hh || (lp.hh === hh && lp.mm >= mm))) return probe;
    }
  }
  return t;
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** Local date of an instant in tz. */
export function localDate(ms, tz) {
  const p = localParts(ms, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Nights of a stay: arrival inclusive, departure exclusive. */
export function nightsOf(arrival, departure) {
  const out = [];
  for (let d = arrival; d < departure; d = addDays(d, 1)) out.push(d);
  return out;
}

export function weekday(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
}
