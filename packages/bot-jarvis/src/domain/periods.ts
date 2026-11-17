import { addDays } from '@legion/core';

export const PERIODS = ['semana', 'mes', 'total'] as const;
export type Period = (typeof PERIODS)[number];

/** First local day of the period containing `today` (Monday for the week); null for all time. */
export function periodStart(period: Period, today: string): string | null {
  if (period === 'total') return null;
  if (period === 'mes') return `${today.slice(0, 8)}01`;
  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday
  return addDays(today, -((weekday + 6) % 7));
}
