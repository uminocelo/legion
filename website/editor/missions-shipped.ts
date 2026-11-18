// The missions that ship with J.A.R.V.I.S., inlined so the editor can start from one.
// website/test/editors.test.ts checks this list matches packages/bot-jarvis/content/missions/.
import fabrica from '../../packages/bot-jarvis/content/missions/fabrica-silenciosa.yaml';
import patrulha from '../../packages/bot-jarvis/content/missions/patrulha-noturna.yaml';
import contato1 from '../../packages/bot-jarvis/content/missions/primeiro-contato-1.yaml';
import contato2 from '../../packages/bot-jarvis/content/missions/primeiro-contato-2.yaml';
import contato3 from '../../packages/bot-jarvis/content/missions/primeiro-contato-3.yaml';
import sinal from '../../packages/bot-jarvis/content/missions/sinal-fantasma.yaml';

export const SHIPPED_MISSIONS: Record<string, string> = {
  'patrulha-noturna': patrulha,
  'primeiro-contato-1': contato1,
  'primeiro-contato-2': contato2,
  'primeiro-contato-3': contato3,
  'sinal-fantasma': sinal,
  'fabrica-silenciosa': fabrica,
};
