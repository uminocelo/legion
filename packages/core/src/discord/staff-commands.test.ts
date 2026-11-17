import { describe, expect, it } from 'vitest';
import { isDiscordCdn, readTextAttachment } from './attachments.js';
import { roleCanUse } from './staff-commands.js';

describe('attachments', () => {
  it('accepts only https Discord CDN hosts', () => {
    expect(isDiscordCdn('https://cdn.discordapp.com/attachments/1/2/a.yaml')).toBe(true);
    expect(isDiscordCdn('https://media.discordapp.net/attachments/1/2/a.yaml')).toBe(true);
    expect(isDiscordCdn('http://cdn.discordapp.com/a.yaml')).toBe(false);
    expect(isDiscordCdn('https://cdn.discordapp.com.evil.io/a.yaml')).toBe(false);
    expect(isDiscordCdn('not a url')).toBe(false);
  });

  it('checks type and size before downloading', async () => {
    let fetched = 0;
    const gw = {
      fetchAttachment: async () => {
        fetched++;
        throw new Error('Attachment too large');
      },
    };
    const att = (name: string, size = 10) => ({
      url: `https://cdn.discordapp.com/x/${name}`,
      name,
      size,
      contentType: null,
    });
    const o = { maxBytes: 100, extensions: ['.yaml'] };
    expect(await readTextAttachment(gw, undefined, o)).toEqual({ problem: 'missing' });
    expect(await readTextAttachment(gw, att('a.exe'), o)).toEqual({ problem: 'bad_type' });
    expect(await readTextAttachment(gw, att('a.yaml', 101), o)).toEqual({ problem: 'too_big' });
    expect(fetched).toBe(0);
    expect(await readTextAttachment(gw, att('a.YAML'), o)).toEqual({ problem: 'too_big' });
    expect(fetched).toBe(1);
  });
});

describe('roleCanUse', () => {
  it('uses the command overwrite first, then the app-wide one', () => {
    const perms = {
      '*': [{ id: 'r1', type: 'role' as const, allow: true }],
      jarvis: [{ id: 'r1', type: 'role' as const, allow: false }],
    };
    expect(roleCanUse(perms, 'jarvis', 'r1')).toBe(false);
    expect(roleCanUse(perms, 'ultron', 'r1')).toBe(true);
    expect(roleCanUse(perms, 'ultron', 'r2')).toBe(false);
  });
});
