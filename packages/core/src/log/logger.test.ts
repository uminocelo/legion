import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, redactUrl } from './logger.js';

const capture = () => {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { lines, logger: createLogger({ destination, level: 'debug' }) };
};

describe('logger redaction', () => {
  it('never prints secrets', () => {
    const { lines, logger } = capture();
    logger.info({ token: 'SECRET1', env: { DISCORD_TOKEN: 'SECRET2', AI_API_KEY: 'SECRET3' } }, 'boot');
    logger.child({ bot: 'cerebro' }).info({ databaseUrl: 'postgres://legion:SECRET4@db:5432/legion' }, 'db');
    const out = lines.join('');
    for (const s of ['SECRET1', 'SECRET2', 'SECRET3', 'SECRET4']) expect(out).not.toContain(s);
    expect(out).toContain('"bot":"cerebro"');
    expect(out).toContain('postgres://legion:***@db:5432/legion');
  });

  it('redactUrl leaves URLs without passwords alone', () => {
    expect(redactUrl('file:./data/legion.db')).toBe('file:./data/legion.db');
  });
});
