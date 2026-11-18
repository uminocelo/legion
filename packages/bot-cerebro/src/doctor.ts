import { type BotContext, type DoctorCheck, TIKTOK_ROLE_NAME } from '@legion/core';
import type { CerebroConfig } from './config.js';
import { allowsOrigin, powerFiles, readPowers } from './powers.js';
import type { CerebroSetup } from './setup.js';

/**
 * Cérebro's `legion doctor` checks. The Server Members intent and channel send/embed permissions
 * are checked by the CLI with REST data (US-3); these cover what the gateway can see.
 */
export function cerebroDoctorChecks(ctx: BotContext<CerebroConfig>, setup: CerebroSetup): DoctorCheck[] {
  return [
    {
      id: 'cerebro.powers',
      title: 'Catálogo de poderes',
      run: async () => {
        if (!ctx.botConfig.powers.enabled)
          return { status: 'ok', message: 'Desligado (registro usa o menu de arquétipos)' };
        const res = readPowers(powerFiles());
        if (res.errors.length)
          return {
            status: 'fail',
            message: res.errors.slice(0, 5).join('\n'),
            fix: 'Corrija data/content/powers.yaml (veja docs/POWERS.md); até lá vale o catálogo anterior',
          };
        const empty: string[] = [];
        const thin: string[] = [];
        for (const { key } of ctx.botConfig.origins) {
          const ps = res.powers.filter(
            (p) =>
              allowsOrigin(p, key) &&
              ctx.botConfig.archetypes.includes(ctx.botConfig.powers.typeToArchetype[p.type]),
          );
          if (!ps.length) empty.push(key);
          else if (new Set(ps.map((p) => p.type)).size < 2) thin.push(key);
        }
        if (empty.length)
          return {
            status: 'fail',
            message: `Origens sem nenhum poder (escondidas do registro): ${empty.join(', ')}`,
            fix: 'Acrescente poderes com essas origens em data/content/powers.yaml, ou tire a origem de cerebro.origins',
          };
        if (thin.length)
          return {
            status: 'warn',
            message: `Origens com poderes de um tipo só: ${thin.join(', ')}`,
            fix: 'Dê a cada origem poderes de pelo menos 2 tipos (veja docs/POWERS.md)',
          };
        return { status: 'ok', message: `${res.powers.length} poderes; todas as origens têm poderes` };
      },
    },
    {
      id: 'cerebro.channels',
      title: 'Canais de boas-vindas e regras',
      run: async () => {
        const { welcome, rules } = ctx.config.channels;
        const missing = Object.entries({ welcome, rules })
          .filter(([, v]) => !v)
          .map(([k]) => `channels.${k}`);
        if (missing.length)
          return {
            status: 'fail',
            message: `Faltando: ${missing.join(', ')}`,
            fix: 'Preencha os IDs em legion.config.yaml',
          };
        const existing = new Set((await ctx.gateway.fetchChannels()).map((c) => c.id));
        const unknown = [welcome, rules].filter(
          (id): id is string => Boolean(id) && !existing.has(id as string),
        );
        if (unknown.length)
          return {
            status: 'fail',
            message: `Canais não encontrados: ${unknown.join(', ')}`,
            fix: 'Copie o ID do canal (modo desenvolvedor → Copiar ID)',
          };
        return { status: 'ok', message: 'welcome e rules configurados' };
      },
    },
    {
      id: 'cerebro.hierarchy',
      title: 'Hierarquia de cargos',
      run: async () => {
        const problems = await setup.hierarchyProblems();
        if (!problems.length)
          return { status: 'ok', message: 'O cargo do bot está acima dos cargos gerenciados' };
        return {
          status: 'fail',
          message: `Cargo do bot abaixo de: ${problems.map((p) => p.name).join(', ')}`,
          fix: 'Configurações do servidor → Cargos: arraste o cargo do bot acima desses cargos',
        };
      },
    },
    {
      id: 'cerebro.tiktok',
      title: 'Cargo Assinante TikTok',
      run: async () => {
        const role = (await ctx.roles.refresh()).find((r) => r.name === TIKTOK_ROLE_NAME);
        if (!role)
          return { status: 'ok', message: 'Não existe (normal se a integração do TikTok não está ligada)' };
        if (!role.managed)
          return {
            status: 'warn',
            message: 'Existe, mas não é gerenciado por uma integração',
            fix: 'O Legion nunca mexe nele; confira a integração do TikTok',
          };
        return { status: 'ok', message: 'Gerenciado pela integração (o Legion nunca mexe nele)' };
      },
    },
  ];
}
