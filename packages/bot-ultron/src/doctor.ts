import type { BotContext, DoctorCheck, DoctorResult } from '@legion/core';
import type { UltronConfig } from './config.js';
import { enemyFiles, readEnemies } from './content.js';
import { ultronServices } from './services.js';

/** Events channel, enemy content and the optional AI provider. */
export function ultronDoctorChecks(ctx: BotContext<UltronConfig>): DoctorCheck[] {
  const cfg = ctx.botConfig;
  return [
    {
      id: 'ultron.events',
      title: 'Canal de eventos do ULTRON',
      run: async (): Promise<DoctorResult> => {
        const needed = cfg.invasion.enabled || cfg.raids.cron !== null;
        const id = ctx.config.channels.events;
        if (!id)
          return needed
            ? {
                status: 'fail',
                message: 'channels.events vazio: invasões e raids precisam de um canal',
                fix: 'Defina channels.events em legion.config.yaml (ou ultron.invasion.enabled: false)',
              }
            : { status: 'warn', message: 'channels.events vazio: /ultron evento não vai funcionar' };
        const ch = (await ctx.gateway.fetchChannels()).find((c) => c.id === id);
        if (!ch)
          return {
            status: 'fail',
            message: `channels.events: canal ${id} não encontrado`,
            fix: 'Corrija o ID em legion.config.yaml (modo desenvolvedor → Copiar ID)',
          };
        if (ch.kind !== 'text' && ch.kind !== 'announcement')
          return {
            status: 'warn',
            message: 'channels.events não é um canal de texto: os tópicos de raid podem falhar',
          };
        return { status: 'ok', message: `#${ch.name} recebe anúncios, HP compartilhado e resultados` };
      },
    },
    {
      id: 'ultron.content',
      title: 'Inimigos do ULTRON',
      run: async (): Promise<DoctorResult> => {
        const { enemies, errors } = readEnemies(enemyFiles());
        if (errors.length)
          return {
            status: 'fail',
            message: errors.slice(0, 5).join('\n'),
            fix: 'Corrija data/content/enemies.yaml; até lá o bot usa os inimigos anteriores',
          };
        const missing = [cfg.invasion.templateId, ...cfg.raids.templateIds].filter(
          (id) => !enemies.some((e) => e.id === id),
        );
        if (missing.length)
          return {
            status: 'fail',
            message: `inimigo(s) não encontrado(s): ${missing.join(', ')}`,
            fix: 'Use ids de content/enemies.yaml em ultron.invasion.templateId e ultron.raids.templateIds',
          };
        return { status: 'ok', message: `${enemies.length} inimigos válidos` };
      },
    },
    {
      id: 'ultron.ai',
      title: 'Texto de IA do ULTRON (opcional)',
      run: async (): Promise<DoctorResult> => {
        if (cfg.ai.provider === 'none')
          return { status: 'ok', message: 'desligado (provider: none); sem chamadas de rede' };
        if (!process.env.AI_BASE_URL || !process.env.AI_MODEL)
          return {
            status: 'warn',
            message:
              'provider: openai-compatible, mas AI_BASE_URL ou AI_MODEL está vazio; usando frases fixas',
            fix: 'Defina AI_BASE_URL e AI_MODEL no .env (veja docs/SELF_HOSTING.md → IA opcional)',
          };
        const text = await ultronServices(ctx).flavor.generate('enemy_taunt', { enemies: 'Drone Vigia' });
        return text
          ? { status: 'ok', message: `${process.env.AI_MODEL} respondeu dentro de ${cfg.ai.timeoutMs} ms` }
          : {
              status: 'warn',
              message: `o modelo não respondeu em ${cfg.ai.timeoutMs} ms (ou respondeu algo filtrado); usando frases fixas`,
              fix: 'Confira se o servidor de IA está no ar (docker compose --profile ai up -d)',
            };
      },
    },
  ];
}
