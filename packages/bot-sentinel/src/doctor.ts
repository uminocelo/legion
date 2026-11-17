import type { BotContext, DoctorCheck, DoctorResult } from '@legion/core';
import type { SentinelConfig } from './config.js';

/** Combat channel, mod queue privacy and moderation readiness. */
export function sentinelDoctorChecks(ctx: BotContext<SentinelConfig>): DoctorCheck[] {
  return [
    {
      id: 'sentinel.channels',
      title: 'Canais do Sentinel',
      run: async (): Promise<DoctorResult> => {
        const { combat, modQueue } = ctx.config.channels;
        const channels = await ctx.gateway.fetchChannels();
        const byId = new Map(channels.map((c) => [c.id, c]));
        const warns: string[] = [];
        const fails: string[] = [];
        if (!combat) warns.push('channels.combat vazio: o /treino abre o combate no canal onde foi usado');
        else if (!byId.has(combat)) fails.push(`channels.combat: canal ${combat} não encontrado`);
        else if (byId.get(combat)?.kind !== 'text')
          warns.push('channels.combat não é um canal de texto: tópicos de combate podem falhar');
        if (ctx.botConfig.moderation.enabled) {
          if (!modQueue)
            warns.push('channels.modQueue vazio: denúncias ficam só no banco (veja /sentinel denuncias)');
          else {
            const q = byId.get(modQueue);
            if (!q) fails.push(`channels.modQueue: canal ${modQueue} não encontrado`);
            else {
              const everyone = q.overwrites.find((o) => o.id === ctx.guildId);
              if (!everyone?.deny.includes('ViewChannel'))
                warns.push('channels.modQueue está visível para @everyone: deixe só a staff ver');
            }
          }
        }
        if (fails.length)
          return {
            status: 'fail',
            message: [...fails, ...warns].join('\n'),
            fix: 'Corrija os IDs em legion.config.yaml (modo desenvolvedor → Copiar ID)',
          };
        if (warns.length) return { status: 'warn', message: warns.join('\n') };
        return {
          status: 'ok',
          message: `combate em <#${combat}>; fila da staff privada${ctx.botConfig.moderation.enabled ? '; timeouts precisam da permissão "Moderar membros" no cargo do bot' : ''}`,
        };
      },
    },
  ];
}
