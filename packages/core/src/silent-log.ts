import { pino } from 'pino';

/** Logger that drops everything (tests). */
export const silentLogger = () => pino({ level: 'silent' });
