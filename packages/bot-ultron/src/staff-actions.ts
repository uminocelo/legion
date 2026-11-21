import type { BotContext } from '@legion/core';
import type { UltronConfig } from './config.js';
import { THREAT_MAX } from './domain/threat.js';
import type { UltronServices } from './services.js';

/** What a staff action did: an i18n key and its vars, shared by the slash commands and the dashboard (US-21). */
export interface StaffOutcome {
  ok: boolean;
  key: string;
  vars?: Record<string, string | number>;
}

export type EventKind = 'invasion' | 'raid';

const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

/** `/ultron evento cancelar`: the active event of that kind, else the next open one. */
export async function cancelEvent(s: UltronServices, kind?: EventKind): Promise<StaffOutcome> {
  const open = await s.eventsRepo.openEvents(kind);
  const target = open.find((e) => e.status === 'active') ?? open[0];
  if (!target) return { ok: false, key: 'ultron.events.nothing_to_cancel' };
  await s.world.cancel(target.id);
  return {
    ok: true,
    key: 'ultron.events.cancelled',
    vars: {
      title: s.world.title(target, (await s.repo.template(target.templateId))?.name ?? target.templateId),
    },
  };
}

/** `/ultron evento agendar` (`startsAt`) and `/ultron evento iniciar` (`now`). */
export async function scheduleEvent(
  ctx: BotContext<UltronConfig>,
  s: UltronServices,
  o: { kind?: EventKind; startsAt: Date | null; now: boolean; actorId: string },
): Promise<StaffOutcome> {
  const startsAt = o.now ? ctx.clock.now() : o.startsAt;
  if (!startsAt) return { ok: false, key: 'ultron.errors.bad_when' };
  if (!ctx.config.channels.events) return { ok: false, key: 'ultron.errors.no_events_channel' };
  const res = await s.world.schedule({
    kind: o.kind ?? 'raid',
    startsAt,
    scheduledBy: o.actorId,
    announceNow: o.now,
  });
  if (!res.ok) return { ok: false, key: `ultron.errors.schedule_${res.error}` };
  if (o.now) {
    await s.world.start(res.event.id);
    return {
      ok: true,
      key: 'ultron.events.started_now',
      vars: { channel: `<#${ctx.config.channels.events}>` },
    };
  }
  return {
    ok: true,
    key: 'ultron.events.scheduled',
    vars: { at: `<t:${unix(res.event.startsAt)}:F>`, announce: `<t:${unix(res.event.announceAt)}:R>` },
  };
}

/** `/ultron guerra iniciar`. */
export async function startWar(s: UltronServices): Promise<StaffOutcome> {
  const res = await s.war.staffStart();
  if (res === 'active') return { ok: false, key: 'ultron.war.already_active' };
  if (res === 'disabled') return { ok: false, key: 'ultron.war.disabled' };
  const active = await s.war.repo.findStatus('active');
  return { ok: true, key: 'ultron.war.started', vars: { at: `<t:${unix(active?.endsAt ?? '')}:F>` } };
}

/** `/ultron guerra encerrar`. */
export async function endWar(s: UltronServices): Promise<StaffOutcome> {
  const res = await s.war.staffEnd();
  if (res === 'none') return { ok: false, key: 'ultron.war.no_war' };
  if (res === 'disabled') return { ok: false, key: 'ultron.war.disabled' };
  return { ok: true, key: 'ultron.war.ended' };
}

/** Dashboard only (no slash command): sets the threat meter, 0–100, when the meter is on. */
export async function setThreat(
  ctx: BotContext<UltronConfig>,
  s: UltronServices,
  level: number,
): Promise<StaffOutcome> {
  if (!ctx.botConfig.threat.enabled) return { ok: false, key: 'ultron.dashboard.actions.threat_disabled' };
  if (!Number.isInteger(level) || level < 0 || level > THREAT_MAX)
    return { ok: false, key: 'ultron.dashboard.actions.threat_range', vars: { max: THREAT_MAX } };
  await s.eventsRepo.setThreatLevel(level);
  return { ok: true, key: 'ultron.dashboard.actions.threat_done', vars: { level, max: THREAT_MAX } };
}
