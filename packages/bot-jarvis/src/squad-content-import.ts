import { resolveActiveSquad } from '@legion/bot-cerebro';
import type { BotContext, Embed, Locale, SquadContentImport } from '@legion/core';
import type { JarvisConfig } from './config.js';
import { contentHash } from './content.js';
import { type CampaignFile, checkCampaignContent, parseCampaignYaml } from './domain/campaign.js';
import { loc, type Mission, parseMissionYaml } from './domain/mission.js';
import { parseTriviaYaml, type TriviaQuestion } from './domain/trivia.js';
import { campaignColumns, missionColumns, parseCampaign } from './mission-content.js';
import type { JarvisServices } from './services.js';

const stageKey = (id: string) => `jarvis.squad-content.${id}`;
const COLOR = 0x00b0f4;

type Kind = 'mission' | 'campaign' | 'trivia';

interface Staged {
  text: string;
  fileName: string;
  squadId: string;
  founderUserId: string;
  kind: Kind;
  locale: string;
}

/** Founder YAML → staff queue → publish with `squad_id` (US-37). */
export function squadContentImportApi(ctx: BotContext<JarvisConfig>, s: JarvisServices): SquadContentImport {
  const t = (key: string, vars: Record<string, string | number>, l: Locale) => ctx.i18n.t(key, vars, l);

  const requireSquad = async (
    raw: string | undefined,
    squadId: string,
    path: string,
  ): Promise<string | null> => {
    if (!raw?.trim()) return `${path}: squad é obrigatório para conteúdo de esquadrão`;
    const resolved = await resolveActiveSquad(ctx.db, ctx.guildId, raw);
    if (!resolved || resolved.id !== squadId)
      return `${path}: squad deve ser o esquadrão do fundador (nome ou código)`;
    return null;
  };

  const detect = async (
    text: string,
    fileName: string,
  ): Promise<{ kind: Kind; errors?: undefined } | { kind?: undefined; errors: string[] }> => {
    const mission = parseMissionYaml(text);
    if (!('errors' in mission)) return { kind: 'mission' };
    const campaign = parseCampaignYaml(text, {
      factions: ctx.config.factions.map((f) => f.key),
      unknownRequires: 'error',
    });
    if (!('errors' in campaign)) return { kind: 'campaign' };
    const trivia = parseTriviaYaml(text, fileName, {
      categories: ctx.botConfig.trivia.categories,
      locale: ctx.config.locale,
    });
    if (!trivia.errors.length && trivia.questions.length) return { kind: 'trivia' };
    return {
      errors: [
        'Não reconheci o arquivo como missão, campanha ou trivia.',
        ...mission.errors.slice(0, 5),
        ...('errors' in campaign ? campaign.errors.slice(0, 5) : []),
        ...trivia.errors.slice(0, 5),
      ],
    };
  };

  const missionPreview = (m: Mission, l: Locale): Embed => {
    const fights = Object.values(m.scenes).filter((x) => x.combat).length;
    return {
      title: `${t('jarvis.imports.preview', {}, l)}: ${loc(m.title, l)}`,
      description: [
        loc(m.summary, l),
        '',
        t(
          'jarvis.imports.mission_meta',
          {
            id: m.id,
            kind: t(`jarvis.missions.kind.${m.kind}`, {}, l),
            level: m.minLevel,
            party: m.party,
            scenes: Object.keys(m.scenes).length,
            fights,
          },
          l,
        ),
      ].join('\n'),
      color: COLOR,
    };
  };

  const campaignPreview = (f: CampaignFile, l: Locale): Embed => ({
    title: `${t('jarvis.imports.preview', {}, l)}: ${loc(f.campaign.title, l)}`.slice(0, 256),
    description: [
      loc(f.campaign.summary, l),
      '',
      t(
        'jarvis.campaigns.import_meta',
        {
          id: f.campaign.id,
          kind: t(`jarvis.campaigns.kind.${f.campaign.kind}`, {}, l),
          chapters: f.missions.length,
        },
        l,
      ),
    ]
      .join('\n')
      .slice(0, 4000),
    color: COLOR,
  });

  const triviaPreview = (qs: TriviaQuestion[], fileName: string, l: Locale): Embed => ({
    title: `${t('jarvis.imports.preview', {}, l)}: ${fileName}`,
    description: qs
      .map((q) => `• \`${q.id}\` · ${q.category}`)
      .join('\n')
      .slice(0, 4000),
    color: COLOR,
  });

  return {
    async stage(o) {
      const l = (o.locale === 'en' ? 'en' : 'pt-BR') as Locale;
      const detected = await detect(o.text, o.fileName);
      if (detected.errors) return { ok: false, errors: detected.errors };
      const kind = detected.kind;

      if (kind === 'mission') {
        const parsed = parseMissionYaml(o.text);
        if ('errors' in parsed) return { ok: false, errors: parsed.errors };
        const squadErr = await requireSquad(parsed.mission.squad, o.squadId, 'squad');
        if (squadErr) return { ok: false, errors: [squadErr] };
        const m = parsed.mission;
        if (m.campaign || m.requires || m.reward) {
          const rows = (await s.repo.allMissions()).filter((r) => r.active === 1 && r.id !== m.id);
          const others = rows.map((r) => JSON.parse(r.definition) as Mission);
          const campaigns = (await s.repo.allCampaigns()).filter((c) => c.active === 1).map(parseCampaign);
          const problems = checkCampaignContent(campaigns, [...others, m], {
            factions: ctx.config.factions.map((f) => f.key),
            unknownRequires: 'error',
          }).filter((p) => p.missionId === m.id);
          if (problems.length) return { ok: false, errors: problems.map((p) => `${p.path}: ${p.message}`) };
        }
        const stageId = ctx.newId();
        await ctx.kv.set(stageKey(stageId), {
          text: o.text,
          fileName: o.fileName,
          squadId: o.squadId,
          founderUserId: o.founderUserId,
          kind,
          locale: o.locale,
        } satisfies Staged);
        return {
          ok: true,
          stageId,
          kind,
          summary: `${loc(m.title, l)} (\`${m.id}\`)`,
          embed: missionPreview(m, l),
        };
      }

      if (kind === 'campaign') {
        const rows = await s.repo.allMissions();
        const parsed = parseCampaignYaml(o.text, {
          factions: ctx.config.factions.map((f) => f.key),
          knownMissionIds: new Set(rows.filter((m) => m.active === 1).map((m) => m.id)),
        });
        if ('errors' in parsed) return { ok: false, errors: parsed.errors };
        const squadErr = await requireSquad(parsed.file.campaign.squad, o.squadId, 'campaign.squad');
        if (squadErr) return { ok: false, errors: [squadErr] };
        const stageId = ctx.newId();
        await ctx.kv.set(stageKey(stageId), {
          text: o.text,
          fileName: o.fileName,
          squadId: o.squadId,
          founderUserId: o.founderUserId,
          kind,
          locale: o.locale,
        } satisfies Staged);
        return {
          ok: true,
          stageId,
          kind,
          summary: `${loc(parsed.file.campaign.title, l)} (\`${parsed.file.campaign.id}\`, ${parsed.file.missions.length})`,
          embed: campaignPreview(parsed.file, l),
        };
      }

      const trivia = parseTriviaYaml(o.text, o.fileName, {
        categories: ctx.botConfig.trivia.categories,
        locale: ctx.config.locale,
      });
      if (trivia.errors.length) return { ok: false, errors: trivia.errors };
      const squadErrors: string[] = [];
      for (const [i, q] of trivia.questions.entries()) {
        const err = await requireSquad(q.squad, o.squadId, `questions.${i}.squad`);
        if (err) squadErrors.push(err);
      }
      if (squadErrors.length) return { ok: false, errors: squadErrors };
      const stageId = ctx.newId();
      await ctx.kv.set(stageKey(stageId), {
        text: o.text,
        fileName: o.fileName,
        squadId: o.squadId,
        founderUserId: o.founderUserId,
        kind,
        locale: o.locale,
      } satisfies Staged);
      return {
        ok: true,
        stageId,
        kind,
        summary: `${o.fileName} (${trivia.questions.length})`,
        embed: triviaPreview(trivia.questions, o.fileName, l),
      };
    },

    async publish(stageId, staffUserId) {
      const key = stageKey(stageId);
      const staged = await ctx.kv.get<Staged | null>(key);
      if (!staged) return { ok: false, key: 'expired' };
      await ctx.kv.set(key, null);
      const now = ctx.clock.now().toISOString();
      const staff = {
        active: 1 as const,
        updatedAt: now,
        origin: 'staff' as const,
        importedBy: staffUserId,
        disabledBy: null,
        squadId: staged.squadId,
      };

      if (staged.kind === 'mission') {
        const parsed = parseMissionYaml(staged.text);
        if ('errors' in parsed) return { ok: false, key: 'invalid' };
        const m = parsed.mission;
        const row = { ...missionColumns(m), ...staff };
        const table = s.repo.t.jarvisMissions;
        await ctx.db.orm
          .insert(table)
          .values({ id: m.id, ...row })
          .onConflictDoUpdate({ target: table.id, set: row });
        ctx.log.info(
          { staff: staffUserId, missionId: m.id, squadId: staged.squadId },
          'squad mission published',
        );
        return { ok: true, id: m.id };
      }

      if (staged.kind === 'campaign') {
        const rows = await s.repo.allMissions();
        const parsed = parseCampaignYaml(staged.text, {
          factions: ctx.config.factions.map((f) => f.key),
          knownMissionIds: new Set(rows.filter((m) => m.active === 1).map((m) => m.id)),
        });
        if ('errors' in parsed) return { ok: false, key: 'invalid' };
        const f = parsed.file;
        const ct = s.repo.t.jarvisCampaigns;
        const mt = s.repo.t.jarvisMissions;
        await ctx.db.transaction(async (tx) => {
          const c = { ...campaignColumns(f.campaign), ...staff };
          await tx
            .insert(ct)
            .values({ id: f.campaign.id, ...c })
            .onConflictDoUpdate({ target: ct.id, set: c });
          for (const m of f.missions) {
            const row = { ...missionColumns(m), ...staff };
            await tx
              .insert(mt)
              .values({ id: m.id, ...row })
              .onConflictDoUpdate({ target: mt.id, set: row });
          }
        });
        ctx.log.info(
          { staff: staffUserId, campaignId: f.campaign.id, squadId: staged.squadId },
          'squad campaign published',
        );
        return { ok: true, id: f.campaign.id };
      }

      const trivia = parseTriviaYaml(staged.text, staged.fileName, {
        categories: ctx.botConfig.trivia.categories,
        locale: ctx.config.locale,
      });
      if (trivia.errors.length || !trivia.questions.length) return { ok: false, key: 'invalid' };
      const table = s.repo.t.jarvisTriviaQuestions;
      await ctx.db.transaction(async (tx) => {
        for (const q of trivia.questions) {
          const content = {
            locale: q.locale,
            category: q.category,
            difficulty: q.difficulty,
            question: q.question,
            choices: JSON.stringify(q.choices),
            answerIndex: q.answer,
            explanation: q.explanation,
            source: q.source,
            contentHash: contentHash(q),
            updatedAt: now,
            active: 1,
            origin: 'staff' as const,
            review: 'approved' as const,
            createdBy: staffUserId,
            reviewedBy: staffUserId,
            squadId: staged.squadId,
          };
          await tx
            .insert(table)
            .values({ id: q.id, ...content })
            .onConflictDoUpdate({ target: table.id, set: content });
        }
      });
      const first = trivia.questions[0];
      ctx.log.info(
        { staff: staffUserId, count: trivia.questions.length, squadId: staged.squadId },
        'squad trivia published',
      );
      return { ok: true, id: first?.id ?? staged.fileName };
    },

    async cancel(stageId) {
      await ctx.kv.set(stageKey(stageId), null);
    },
  };
}
