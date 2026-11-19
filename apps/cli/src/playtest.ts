// `legion playtest-report`: what happened since a moment, read straight from the database, plus
// consistency checks (XP paid once and equally, ledger = progress, limits, fights resolved).
// Read-only. Meant to run inside the container after a live session (US-12).
import { cerebroTables } from '@legion/bot-cerebro';
import { jarvisTables } from '@legion/bot-jarvis';
import { ultronTables } from '@legion/bot-ultron';
import type { LegionDb } from '@legion/core';
import { and, eq, gte, inArray } from 'drizzle-orm';

export interface PlaytestOptions {
  guildId: string;
  since: Date;
  now: Date;
  /** Enabled bots: sections of disabled bots are skipped (their tables may not exist). */
  bots: readonly string[];
  /** jarvis.missions.limits from the config. */
  limits?: { dailyPerMember: number; weeklyPerMember: number };
  /** An open mission older than this is reported (its timer may not have fired). */
  staleMinutes?: number;
}

export interface RunReport {
  id: string;
  missionId: string;
  kind: string;
  status: string;
  scene: string;
  leader: string;
  members: { who: string; xp: number | null }[];
  createdAt: string;
  endedAt: string | null;
}

export interface PlaytestReport {
  since: string;
  now: string;
  registrations: {
    who: string;
    step: string;
    codename: string | null;
    archetype: string | null;
    powers: number;
    at: string;
  }[];
  runs: RunReport[];
  xp: { who: string; reason: string; total: number; rows: number }[];
  encounters: {
    missionId: string | null;
    partySize: number;
    partyLevel: number;
    enemies: number;
    outcome: string | null;
    createdAt: string;
  }[];
  content: {
    kind: 'missão' | 'pergunta' | 'inimigo';
    id: string;
    by: string | null;
    state: string;
    at: string;
  }[];
  /** Credits (v0.10); null when J.A.R.V.I.S. is off. */
  economy: {
    byReason: { reason: string; total: number; rows: number }[];
    purchases: number;
    staff: { who: string; amount: number; by: string | null; note: string | null; at: string }[];
  } | null;
  /** Mismatches that fail the merge gate. */
  problems: string[];
  /** Worth a look, not necessarily wrong. */
  warnings: string[];
}

const OPEN = ['lobby', 'active', 'fighting'];

/** `90m`, `3h`, `2d`, or an ISO date/time. */
export function parseSince(value: string, now: Date): Date | null {
  const rel = /^(\d+)\s*(m|h|d)$/.exec(value.trim());
  if (rel) {
    const ms = { m: 60_000, h: 3_600_000, d: 86_400_000 }[rel[2] as 'm' | 'h' | 'd'];
    return new Date(now.getTime() - Number(rel[1]) * ms);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function playtestReport(db: LegionDb, o: PlaytestOptions): Promise<PlaytestReport> {
  const since = o.since.toISOString();
  const r: PlaytestReport = {
    since,
    now: o.now.toISOString(),
    registrations: [],
    runs: [],
    xp: [],
    encounters: [],
    content: [],
    economy: null,
    problems: [],
    warnings: [],
  };
  const has = (bot: string) => o.bots.includes(bot);
  const orm = db.orm;

  // Names: codename when registered, else the Discord id.
  const names = new Map<string, string>();
  const c = cerebroTables(db);
  const members = await orm.select().from(c.members).where(eq(c.members.guildId, o.guildId));
  const mutants = await orm.select().from(c.mutants).where(eq(c.mutants.guildId, o.guildId));
  const codename = new Map(mutants.map((m) => [m.memberId, m]));
  for (const m of members) names.set(m.id, codename.get(m.id)?.codename ?? `<@${m.discordUserId}>`);
  const who = (id: string) => names.get(id) ?? id;

  const powers = await orm.select().from(c.cerebroMutantPowers);
  for (const m of members.filter((x) => x.createdAt >= since)) {
    const mu = codename.get(m.id);
    r.registrations.push({
      who: who(m.id),
      step: m.onboardingStep,
      codename: mu?.codename ?? null,
      archetype: mu?.archetype ?? null,
      powers: mu ? powers.filter((p) => p.mutantId === mu.id).length : 0,
      at: m.createdAt,
    });
  }

  // The bot does not pay members who left the server.
  const left = new Set(members.filter((m) => m.leftAt).map((m) => m.id));
  if (has('jarvis')) await jarvisSection(db, o, r, who, left);
  if (has('jarvis')) await economySection(db, o, r, who);
  if (has('ultron')) await ultronSection(db, o, r);
  return r;
}

async function jarvisSection(
  db: LegionDb,
  o: PlaytestOptions,
  r: PlaytestReport,
  who: (id: string) => string,
  left: ReadonlySet<string> = new Set(),
) {
  const j = jarvisTables(db);
  const orm = db.orm;
  const since = r.since;

  const runs = await orm
    .select()
    .from(j.jarvisMissionRuns)
    .where(and(eq(j.jarvisMissionRuns.guildId, o.guildId), gte(j.jarvisMissionRuns.createdAt, since)));
  const runIds = runs.map((x) => x.id);
  const runMembers = runIds.length
    ? await orm.select().from(j.jarvisMissionMembers).where(inArray(j.jarvisMissionMembers.runId, runIds))
    : [];
  const ledger = await orm
    .select()
    .from(j.jarvisXpLedger)
    .where(and(eq(j.jarvisXpLedger.guildId, o.guildId), gte(j.jarvisXpLedger.createdAt, since)));
  const paid = new Map(ledger.filter((l) => l.reason === 'mission').map((l) => [l.sourceKey, l]));

  for (const run of runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const ids = runMembers.filter((m) => m.runId === run.id).map((m) => m.memberId);
    const xp = ids.map((id) => ({ id, row: paid.get(`mission:${run.id}:${id}`) }));
    r.runs.push({
      id: run.id,
      missionId: run.missionId,
      kind: run.kind,
      status: run.status,
      scene: run.sceneId,
      leader: who(run.leaderMemberId),
      members: xp.map((x) => ({ who: who(x.id), xp: x.row?.amount ?? null })),
      createdAt: run.createdAt,
      endedAt: run.endedAt,
    });
    const tag = `${run.missionId} (${run.id.slice(0, 8)})`;
    if (['abandoned', 'cancelled'].includes(run.status) && xp.some((x) => x.row))
      r.problems.push(`${tag}: ${run.status}, mas pagou XP`);
    if (['success', 'failure'].includes(run.status)) {
      const unpaid = xp.filter((x) => !x.row && !left.has(x.id)).map((x) => who(x.id));
      if (unpaid.length === xp.length)
        r.warnings.push(`${tag}: ${run.status} sem XP para ninguém (XP 0 na config?)`);
      else if (unpaid.length) r.problems.push(`${tag}: ${run.status}, mas sem XP para ${unpaid.join(', ')}`);
      const amounts = new Set(xp.filter((x) => x.row).map((x) => x.row?.amount));
      if (amounts.size > 1)
        r.problems.push(`${tag}: membros receberam XP diferente (${[...amounts].join(', ')})`);
    }
    if (OPEN.includes(run.status)) {
      const idle = (o.now.getTime() - new Date(run.updatedAt).getTime()) / 60_000;
      if (idle > (o.staleMinutes ?? 30))
        r.warnings.push(
          `${tag}: ainda "${run.status}" há ${Math.round(idle)} min sem mudança (o timer rodou?)`,
        );
    }
  }

  // XP by member and reason, and the ledger = progress check for everyone touched.
  const sums = new Map<string, { who: string; reason: string; total: number; rows: number }>();
  for (const l of ledger) {
    const k = `${l.memberId}|${l.reason}`;
    const s = sums.get(k) ?? { who: who(l.memberId), reason: l.reason, total: 0, rows: 0 };
    s.total += l.amount;
    s.rows += 1;
    sums.set(k, s);
  }
  r.xp = [...sums.values()].sort((a, b) => a.who.localeCompare(b.who) || a.reason.localeCompare(b.reason));
  const touched = [...new Set(ledger.map((l) => l.memberId))];
  if (touched.length) {
    const all = await orm.select().from(j.jarvisXpLedger).where(inArray(j.jarvisXpLedger.memberId, touched));
    const progress = await orm
      .select()
      .from(j.jarvisProgress)
      .where(inArray(j.jarvisProgress.memberId, touched));
    for (const id of touched) {
      const total = all.filter((l) => l.memberId === id).reduce((n, l) => n + l.amount, 0);
      const p = progress.find((x) => x.memberId === id);
      if (!p) r.problems.push(`${who(id)}: tem XP no histórico, mas nenhuma linha de progresso`);
      else if (p.xp !== total)
        r.problems.push(`${who(id)}: progresso mostra ${p.xp} XP, histórico soma ${total}`);
    }
  }

  // Limits: counted runs (not cancelled) per member per day / week.
  if (o.limits) {
    const counted = runs.filter((x) => x.status !== 'cancelled');
    const per = new Map<string, number>();
    for (const run of counted)
      for (const m of runMembers.filter((x) => x.runId === run.id)) {
        const key =
          run.kind === 'daily'
            ? `${m.memberId}|daily|${run.day}`
            : run.kind === 'weekly'
              ? `${m.memberId}|weekly|${run.week}`
              : '';
        if (key) per.set(key, (per.get(key) ?? 0) + 1);
      }
    for (const [key, n] of per) {
      const [id = '', kind, period] = key.split('|');
      const max = kind === 'daily' ? o.limits.dailyPerMember : o.limits.weeklyPerMember;
      if (n > max)
        r.problems.push(
          `${who(id)}: ${n} missões ${kind === 'daily' ? 'diárias' : 'semanais'} em ${period} (limite ${max})`,
        );
    }
  }

  const missions = await orm
    .select()
    .from(j.jarvisMissions)
    .where(and(eq(j.jarvisMissions.origin, 'staff'), gte(j.jarvisMissions.updatedAt, since)));
  for (const m of missions)
    r.content.push({
      kind: 'missão',
      id: m.id,
      by: m.importedBy ? who(m.importedBy) : null,
      state: m.active ? 'ativa' : 'desativada',
      at: m.updatedAt,
    });
  const questions = await orm
    .select()
    .from(j.jarvisTriviaQuestions)
    .where(and(eq(j.jarvisTriviaQuestions.origin, 'staff'), gte(j.jarvisTriviaQuestions.updatedAt, since)));
  for (const q of questions)
    r.content.push({
      kind: 'pergunta',
      id: q.id,
      by: q.createdBy ? who(q.createdBy) : null,
      state: `${q.active ? 'ativa' : 'desativada'}${q.review ? ` · revisão: ${q.review}` : ''}`,
      at: q.updatedAt,
    });
}

async function ultronSection(db: LegionDb, o: PlaytestOptions, r: PlaytestReport) {
  const u = ultronTables(db);
  const orm = db.orm;
  const encounters = await orm
    .select()
    .from(u.ultronEncounters)
    .where(and(eq(u.ultronEncounters.guildId, o.guildId), gte(u.ultronEncounters.createdAt, r.since)));
  for (const e of encounters.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    let enemies = 0;
    try {
      enemies = (JSON.parse(e.enemies) as unknown[]).length;
    } catch {
      // keep 0
    }
    r.encounters.push({
      missionId: e.missionId,
      partySize: e.partySize,
      partyLevel: e.partyLevel,
      enemies,
      outcome: e.outcome,
      createdAt: e.createdAt,
    });
    const age = (o.now.getTime() - new Date(e.createdAt).getTime()) / 60_000;
    if (!e.outcome && age > (o.staleMinutes ?? 30))
      r.warnings.push(`luta ${e.missionId ?? e.combatId}: sem resultado há ${Math.round(age)} min`);
  }
  // A mission fight is `<runId>:<sceneId>`: its run must exist and match the party size.
  const fights = r.encounters.filter((e) => e.missionId?.includes(':'));
  for (const f of fights) {
    const run = r.runs.find((x) => f.missionId?.startsWith(`${x.id}:`));
    if (!run) continue;
    if (run.members.length !== f.partySize)
      r.problems.push(
        `luta de ${run.missionId}: grupo de ${f.partySize}, mas a missão tem ${run.members.length} membro(s)`,
      );
  }
  const enemies = await orm
    .select()
    .from(u.ultronEnemyTemplates)
    .where(and(eq(u.ultronEnemyTemplates.origin, 'staff'), gte(u.ultronEnemyTemplates.updatedAt, r.since)));
  for (const e of enemies)
    r.content.push({
      kind: 'inimigo',
      id: e.id,
      by: e.importedBy ?? null,
      state: e.active ? 'ativo' : 'desativado',
      at: e.updatedAt,
    });
}

const hm = (iso: string | null) => (iso ? iso.slice(11, 16) : '—');

/** Credits in the period by reason, staff movements, and every wallet against its ledger (ADR 0028). */
async function economySection(
  db: LegionDb,
  o: PlaytestOptions,
  r: PlaytestReport,
  who: (id: string) => string,
): Promise<void> {
  const j = jarvisTables(db);
  const l = j.jarvisWalletLedger;
  const since = o.since.toISOString();
  const rows = await db.orm
    .select()
    .from(l)
    .where(and(eq(l.guildId, o.guildId), gte(l.createdAt, since)));
  const by = new Map<string, { total: number; rows: number }>();
  for (const x of rows) {
    const e = by.get(x.reason) ?? { total: 0, rows: 0 };
    e.total += x.amount;
    e.rows++;
    by.set(x.reason, e);
  }
  r.economy = {
    byReason: [...by.entries()]
      .map(([reason, e]) => ({ reason, ...e }))
      .sort((a, b) => a.reason.localeCompare(b.reason)),
    purchases: rows.filter((x) => x.reason === 'purchase').length,
    staff: rows
      .filter((x) => x.reason === 'staff')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((x) => ({
        who: who(x.memberId),
        amount: x.amount,
        by: x.createdBy,
        note: x.note,
        at: x.createdAt,
      })),
  };
  // Every wallet, whatever the period: the cached balance must equal its ledger and never be negative.
  const wallets = await db.orm.select().from(j.jarvisWallets).where(eq(j.jarvisWallets.guildId, o.guildId));
  const sums = new Map<string, number>();
  for (const x of await db.orm.select().from(l).where(eq(l.guildId, o.guildId)))
    sums.set(x.memberId, (sums.get(x.memberId) ?? 0) + x.amount);
  for (const w of wallets) {
    const total = sums.get(w.memberId) ?? 0;
    if (w.balance !== total)
      r.problems.push(`${who(w.memberId)}: carteira mostra ${w.balance} créditos, histórico soma ${total}`);
    if (w.balance < 0) r.problems.push(`${who(w.memberId)}: saldo negativo (${w.balance} créditos)`);
    sums.delete(w.memberId);
  }
  for (const [id, total] of sums)
    r.problems.push(`${who(id)}: tem créditos no histórico (${total}), mas nenhuma carteira`);
}

export function formatPlaytest(r: PlaytestReport): string {
  const out: string[] = [];
  const h = (t: string) => out.push('', `== ${t} ==`);
  out.push(
    `Relatório da sessão: ${r.since.replace('T', ' ').slice(0, 16)} → ${r.now.replace('T', ' ').slice(0, 16)} (UTC)`,
  );

  h(`Cadastros (${r.registrations.length})`);
  for (const x of r.registrations)
    out.push(
      `${hm(x.at)}  ${x.who}  etapa: ${x.step}${x.archetype ? ` · ${x.archetype}` : ''} · poderes: ${x.powers}`,
    );

  h(`Missões (${r.runs.length})`);
  for (const x of r.runs) {
    const team = x.members.map((m) => `${m.who}${m.xp === null ? '' : ` +${m.xp}`}`).join(', ');
    out.push(
      `${hm(x.createdAt)}–${hm(x.endedAt)}  ${x.missionId} [${x.kind}] ${x.status} @ ${x.scene}  líder: ${x.leader}  grupo: ${team || '—'}`,
    );
  }

  h('XP no período');
  for (const x of r.xp)
    out.push(`${x.who}  ${x.reason}: ${x.total > 0 ? '+' : ''}${x.total} (${x.rows} linha(s))`);

  h(`Lutas (${r.encounters.length})`);
  for (const e of r.encounters)
    out.push(
      `${hm(e.createdAt)}  ${e.missionId ?? '—'}  grupo ${e.partySize} · nível ${e.partyLevel} · ${e.enemies} inimigo(s) → ${e.outcome ?? 'em andamento'}`,
    );

  h(`Conteúdo da staff (${r.content.length})`);
  for (const x of r.content)
    out.push(`${hm(x.at)}  ${x.kind} ${x.id}  ${x.state}${x.by ? ` · por ${x.by}` : ''}`);

  if (r.economy) {
    h('Economia (créditos no período)');
    for (const x of r.economy.byReason)
      out.push(`${x.reason}: ${x.total > 0 ? '+' : ''}${x.total} (${x.rows} linha(s))`);
    out.push(`compras: ${r.economy.purchases}`);
    for (const x of r.economy.staff)
      out.push(
        `${hm(x.at)}  staff ${x.amount > 0 ? '+' : ''}${x.amount} → ${x.who}${x.by ? ` · por <@${x.by}>` : ''}${x.note ? ` · ${x.note}` : ''}`,
      );
  }

  h(
    `Conferência: ${r.problems.length ? `❌ ${r.problems.length} problema(s)` : '✅ XP, créditos, limites e lutas batem'}`,
  );
  for (const p of r.problems) out.push(`❌ ${p}`);
  for (const w of r.warnings) out.push(`⚠️ ${w}`);
  out.push(
    '',
    `Erros no log do período (fora do container): docker compose logs legion --since ${r.since} | grep '"level":50'`,
  );
  return out.join('\n');
}
