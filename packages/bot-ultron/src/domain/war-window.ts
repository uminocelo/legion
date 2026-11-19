import { localDay } from '@legion/core';

export type WarLength = 'month' | number;

/** UTC instant of `YYYY-MM-DD` 00:00:00 in `timeZone`. */
export function zonedMidnight(day: string, timeZone: string): Date {
  const target = Date.parse(`${day}T00:00:00.000Z`);
  const offsetAt = (instant: Date) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(instant);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    );
    return asUtc - instant.getTime();
  };
  let instant = new Date(target - offsetAt(new Date(target)));
  instant = new Date(target - offsetAt(instant));
  return instant;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The 1st 00:00 of the month of `instant`, or the next 1st when `instant` is already past it. */
export function monthStartAtOrAfter(instant: Date, timeZone: string): Date {
  const [year, month] = localDay(instant, timeZone).split('-').map(Number) as [number, number];
  const thisFirst = zonedMidnight(`${year}-${pad(month)}-01`, timeZone);
  // A job that fires a couple of minutes after midnight still belongs to that 1st.
  if (instant.getTime() <= thisFirst.getTime() + 120_000) return thisFirst;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return zonedMidnight(`${nextYear}-${pad(nextMonth)}-01`, timeZone);
}

/**
 * When the next war runs.
 * A month war starts on the 1st. After one ends on the 1st, the next starts that same midnight.
 * A day length starts when the previous war ends, or now when there is no previous war.
 */
export function nextWarWindow(o: {
  length: WarLength;
  timeZone: string;
  now: Date;
  previousEndsAt: Date | null;
}): { startsAt: Date; endsAt: Date } {
  const previous = o.previousEndsAt;
  const anchor = previous && previous.getTime() <= o.now.getTime() + 2_000 ? previous : o.now;
  if (o.length === 'month') {
    const startsAt = monthStartAtOrAfter(anchor, o.timeZone);
    const endsAt = monthStartAtOrAfter(new Date(startsAt.getTime() + 86_400_000), o.timeZone);
    return { startsAt, endsAt };
  }
  return { startsAt: anchor, endsAt: new Date(anchor.getTime() + o.length * 86_400_000) };
}
