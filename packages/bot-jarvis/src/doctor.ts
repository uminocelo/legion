import type { BotContext, DoctorCheck, DoctorResult } from '@legion/core';
import type { JarvisConfig } from './config.js';
import { hasCombat } from './domain/mission.js';
import { missionDirs, readMissions } from './mission-content.js';

/** Missions: content, the missions channel and whether fights can run. */
export function jarvisDoctorChecks(ctx: BotContext<JarvisConfig>): DoctorCheck[] {
  const cfg = ctx.botConfig.missions;
  return [
    {
      id: 'jarvis.missions',
      title: 'Missões do J.A.R.V.I.S.',
      run: async (): Promise<DoctorResult> => {
        if (!cfg.enabled)
          return { status: 'ok', message: 'missões desligadas (jarvis.missions.enabled: false)' };
        const { missions, errors } = readMissions(missionDirs());
        if (errors.length)
          return {
            status: 'fail',
            message: `${errors.length} erro(s) nos arquivos de missão: ${errors.slice(0, 3).join(' · ')}`,
            fix: 'Corrija os arquivos em data/content/missions (veja docs/MISSIONS.md)',
          };
        const bots = ctx.config.bots;
        const fights = missions.filter(hasCombat).length;
        if (fights && !(bots.includes('ultron') && bots.includes('sentinel')))
          return {
            status: 'warn',
            message: `${fights} missão(ões) com luta ficam escondidas: precisam do ULTRON e do Sentinel`,
            fix: 'Adicione ultron e sentinel em bots (ou remova as lutas das missões)',
          };
        const id = ctx.config.channels.missions ?? ctx.config.channels.combat;
        if (!id)
          return {
            status: 'warn',
            message: 'channels.missions vazio: as missões abrem tópicos no canal onde o /missao foi usado',
          };
        const ch = (await ctx.gateway.fetchChannels()).find((c) => c.id === id);
        if (!ch)
          return {
            status: 'fail',
            message: `channels.missions: canal ${id} não encontrado`,
            fix: 'Corrija o ID em legion.config.yaml (modo desenvolvedor → Copiar ID)',
          };
        if (ch.kind !== 'text')
          return {
            status: 'warn',
            message: 'channels.missions não é um canal de texto: os tópicos podem falhar',
          };
        return { status: 'ok', message: `${missions.length} missões; tópicos em #${ch.name}` };
      },
    },
  ];
}
