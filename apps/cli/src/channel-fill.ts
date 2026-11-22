import { DEFAULT_FACTIONS } from '@legion/core';
import { ChannelType } from 'discord.js';
import type { ApiChannel } from './rest.js';
import { TEAMS } from './server-template.js';

/** Config channel keys filled from TEMPLATE names (trivia has no match in this story). */
const CHANNEL_NAMES: Record<string, string | null> = {
  welcome: 'boas-vindas',
  rules: 'regras',
  registry: 'registro',
  events: 'eventos',
  missions: 'missoes',
  combat: 'combate',
  tutorial: 'tutorial',
  modQueue: 'fila-moderacao',
  trivia: null,
};

export type FactionFill = {
  key: string;
  roleKey: string;
  categoryId?: string;
  newsChannelId?: string;
  squadChannelId?: string;
};

export type ChannelFillExisting = {
  channels?: Record<string, string | null | undefined>;
  factions?: FactionFill[];
  herbieTipsChannelId?: string | null;
};

export type ChannelFillResult = {
  channels: Record<string, string | null>;
  factions: FactionFill[];
  herbieTipsChannelId: string | null;
  report: string[];
};

type Match =
  | { kind: 'ok'; id: string; name: string }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; ids: string[] }
  | { kind: 'wrong_type' };

const textNorm = (name: string) => name.trim().toLowerCase();
const categoryNorm = (name: string) => name.trim();

const factionKeyFromRoleKey = (roleKey: string) =>
  roleKey.startsWith('faction_') ? roleKey.slice('faction_'.length) : roleKey;

function matchChannel(
  channels: readonly ApiChannel[],
  targetName: string,
  expectedType: number,
  normalize: (name: string) => string,
): Match {
  const want = normalize(targetName);
  const byName = channels.filter((c) => normalize(c.name) === want);
  if (byName.length === 0) return { kind: 'missing' };
  if (byName.length > 1) return { kind: 'ambiguous', ids: byName.map((c) => c.id) };
  const only = byName[0];
  if (!only || only.type !== expectedType) return { kind: 'wrong_type' };
  return { kind: 'ok', id: only.id, name: only.name };
}

function reportMatch(path: string, match: Match, displayName: string): string {
  switch (match.kind) {
    case 'ok':
      return `filled  ${path} ← #${displayName} (${match.id})`;
    case 'missing':
      return `skipped ${path} (missing)`;
    case 'ambiguous':
      return `ambiguous ${path} (${match.ids.join(', ')})`;
    case 'wrong_type':
      return `skipped ${path} (wrong_type)`;
  }
}

function resolveId(
  path: string,
  match: Match,
  displayName: string,
  existing: string | null | undefined,
  overwrite: boolean,
  report: string[],
): string | null {
  const prev = existing ?? null;
  if (prev !== null && !overwrite) {
    report.push(`kept    ${path} (already set)`);
    return prev;
  }
  report.push(reportMatch(path, match, displayName));
  return match.kind === 'ok' ? match.id : null;
}

function baseFactions(existing?: FactionFill[]): FactionFill[] {
  if (existing) {
    return existing.map((f) => ({
      key: f.key,
      roleKey: f.roleKey,
      ...(f.categoryId ? { categoryId: f.categoryId } : {}),
      ...(f.newsChannelId ? { newsChannelId: f.newsChannelId } : {}),
      ...(f.squadChannelId ? { squadChannelId: f.squadChannelId } : {}),
    }));
  }
  return DEFAULT_FACTIONS.map((f) => ({
    key: f.key,
    roleKey: f.roleKey,
  }));
}

/**
 * Maps Discord guild channels to config channel / faction area IDs by TEMPLATE names.
 * Pure: no REST, no file I/O. `overwrite: false` (default) keeps non-null existing values.
 */
export function fillChannelIds(
  channels: readonly ApiChannel[],
  existing: ChannelFillExisting = {},
  opts: { overwrite?: boolean } = {},
): ChannelFillResult {
  const overwrite = opts.overwrite === true;
  const report: string[] = [];
  const outChannels: Record<string, string | null> = {};

  for (const [key, templateName] of Object.entries(CHANNEL_NAMES)) {
    const path = `channels.${key}`;
    const prev = existing.channels?.[key];
    if (templateName === null) {
      if (prev != null && !overwrite) {
        report.push(`kept    ${path} (already set)`);
        outChannels[key] = prev;
      } else {
        outChannels[key] = null;
        // trivia (and any no-match key) stays null; no Discord lookup in this story
      }
      continue;
    }
    const match = matchChannel(channels, templateName, ChannelType.GuildText, textNorm);
    outChannels[key] = resolveId(path, match, templateName, prev, overwrite, report);
  }

  const teamByKey = new Map(TEAMS.map((t) => [factionKeyFromRoleKey(t.roleKey), t] as const));
  const factions = baseFactions(existing.factions);

  for (const faction of factions) {
    const team = teamByKey.get(faction.key);
    // Independente (and unknown keys) never get category / news / squad IDs.
    if (!team) {
      delete faction.categoryId;
      delete faction.newsChannelId;
      delete faction.squadChannelId;
      continue;
    }

    const catMatch = matchChannel(channels, team.category, ChannelType.GuildCategory, categoryNorm);
    const catId = resolveId(
      `factions.${faction.key}.categoryId`,
      catMatch,
      team.category,
      faction.categoryId,
      overwrite,
      report,
    );
    if (catId) faction.categoryId = catId;
    else delete faction.categoryId;

    const newsName = `noticias-${team.slug}`;
    const newsMatch = matchChannel(channels, newsName, ChannelType.GuildText, textNorm);
    const newsId = resolveId(
      `factions.${faction.key}.newsChannelId`,
      newsMatch,
      newsName,
      faction.newsChannelId,
      overwrite,
      report,
    );
    if (newsId) faction.newsChannelId = newsId;
    else delete faction.newsChannelId;

    const squadName = `esquadroes-${team.slug}`;
    const squadMatch = matchChannel(channels, squadName, ChannelType.GuildText, textNorm);
    const squadId = resolveId(
      `factions.${faction.key}.squadChannelId`,
      squadMatch,
      squadName,
      faction.squadChannelId,
      overwrite,
      report,
    );
    if (squadId) faction.squadChannelId = squadId;
    else delete faction.squadChannelId;
  }

  const guiaMatch = matchChannel(channels, 'guia', ChannelType.GuildText, textNorm);
  const herbieTipsChannelId = resolveId(
    'herbie.tips.channelId',
    guiaMatch,
    'guia',
    existing.herbieTipsChannelId,
    overwrite,
    report,
  );

  return { channels: outChannels, factions, herbieTipsChannelId, report };
}
