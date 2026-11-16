import { type Logger, type LoggerOptions, pino } from 'pino';

export type { Logger };

/** Paths redacted from every log line. */
export const REDACT_PATHS = [
  'token',
  'DISCORD_TOKEN',
  'AI_API_KEY',
  'apiKey',
  'authorization',
  'password',
  '*.token',
  '*.DISCORD_TOKEN',
  '*.AI_API_KEY',
  '*.apiKey',
  '*.authorization',
  '*.password',
  'env.DISCORD_TOKEN',
  'env.AI_API_KEY',
];

/** Hides the password in a connection URL: postgres://u:secret@h → postgres://u:***@h. */
export function redactUrl(url: string): string {
  return url.replace(/(\/\/[^:/@]+:)[^@]*@/, '$1***@');
}

export interface CreateLoggerOptions {
  level?: string;
  pretty?: boolean;
  /** Custom destination (tests). */
  destination?: pino.DestinationStream;
}

export function createLogger(opts: CreateLoggerOptions = {}): Logger {
  const options: LoggerOptions = {
    level: opts.level ?? 'info',
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { app: 'legion' },
    serializers: {
      err: pino.stdSerializers.err,
      databaseUrl: (v: unknown) => (typeof v === 'string' ? redactUrl(v) : v),
    },
  };
  if (opts.destination) return pino(options, opts.destination);
  if (opts.pretty)
    return pino({ ...options, transport: { target: 'pino-pretty', options: { colorize: true } } });
  return pino(options);
}
