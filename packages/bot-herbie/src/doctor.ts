import type { BotContext, DoctorCheck } from '@legion/core';
import type { HerbieConfig } from './config.js';

/** Channels H.E.R.B.I.E. needs: the tutorial fallback channel, and the tips channel when tips are on. */
export function herbieDoctorChecks(ctx: BotContext<HerbieConfig>): DoctorCheck[] {
  return [
    {
      id: 'herbie.channels',
      title: 'Canais do H.E.R.B.I.E.',
      run: async () => {
        const { channels } = ctx.config;
        const cfg = ctx.botConfig;
        const problems: string[] = [];
        const tutorial = channels.tutorial ?? channels.welcome;
        if (!tutorial)
          problems.push(
            cfg.delivery === 'channel'
              ? 'delivery: channel, mas channels.tutorial e channels.welcome estão vazios'
              : 'sem channels.tutorial nem channels.welcome: quem tem DM fechada não recebe o tutorial',
          );
        if (cfg.tips.enabled && !cfg.tips.channelId)
          problems.push('herbie.tips.enabled, mas herbie.tips.channelId está vazio');
        const existing = new Set((await ctx.gateway.fetchChannels()).map((c) => c.id));
        for (const [key, id] of [
          ['channels.tutorial', channels.tutorial],
          ['herbie.tips.channelId', cfg.tips.enabled ? cfg.tips.channelId : null],
        ] as const)
          if (id && !existing.has(id)) problems.push(`${key}: canal ${id} não encontrado`);
        if (!problems.length)
          return {
            status: 'ok',
            message: `tutorial em ${cfg.delivery === 'dm' ? 'DM (canal de reserva configurado)' : 'canal'}; dicas ${cfg.tips.enabled ? 'ligadas' : 'desligadas'}`,
          };
        const hard =
          cfg.delivery === 'channel' ||
          problems.some((p) => p.includes('não encontrado') || p.startsWith('herbie.tips'));
        return {
          status: hard ? 'fail' : 'warn',
          message: problems.join('\n'),
          fix: 'Preencha os IDs em legion.config.yaml (modo desenvolvedor → Copiar ID)',
        };
      },
    },
  ];
}
