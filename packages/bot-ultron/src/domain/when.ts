/** Offset (ms) of `tz` from UTC at instant `at`. */
function tzOffset(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * Parses `AAAA-MM-DD HH:mm` (wall time in `tz`) or a relative `+30m` / `+2h` / `+1d`.
 * Returns null when the text matches neither.
 */
export function parseWhen(text: string, now: Date, tz: string): Date | null {
  const t = text.trim();
  const rel = /^\+(\d{1,4})\s*(m|min|h|d)$/i.exec(t);
  if (rel) {
    const n = Number(rel[1]);
    const unit = (rel[2] ?? 'm').toLowerCase();
    const ms = unit === 'h' ? 3_600_000 : unit === 'd' ? 86_400_000 : 60_000;
    return new Date(now.getTime() + n * ms);
  }
  const abs = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(t);
  if (!abs) return null;
  const [y, mo, d, h, mi] = abs.slice(1).map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes handle a DST change between the guess and the real instant.
  let at = guess - tzOffset(tz, new Date(guess));
  at = guess - tzOffset(tz, new Date(at));
  const back = new Date(at + tzOffset(tz, new Date(at)));
  if (back.getUTCDate() !== d || back.getUTCHours() !== h) return null; // nonexistent wall time (DST gap) or bad day
  return new Date(at);
}

export const hpBar = (hp: number, max: number, width = 12) => {
  const ratio = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
  const full = Math.round(ratio * width);
  return `${'█'.repeat(full)}${'░'.repeat(width - full)} ${Math.round(ratio * 100)}%`;
};

export const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : Math.round(((s[m - 1] as number) + (s[m] as number)) / 2);
};
