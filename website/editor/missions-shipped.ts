// The missions that ship with J.A.R.V.I.S., inlined so the editor can start from one.
// website/test/editors.test.ts checks this list matches packages/bot-jarvis/content/missions/.
import fabrica from '../../packages/bot-jarvis/content/missions/fabrica-silenciosa.yaml';
import patrulha from '../../packages/bot-jarvis/content/missions/patrulha-noturna.yaml';
import contato from '../../packages/bot-jarvis/content/missions/primeiro-contato.yaml';
import sinal from '../../packages/bot-jarvis/content/missions/sinal-fantasma.yaml';

export const SHIPPED_MISSIONS: Record<string, string> = {
  'patrulha-noturna': patrulha,
  'primeiro-contato': contato,
  'sinal-fantasma': sinal,
  'fabrica-silenciosa': fabrica,
};
