// The missions that ship with J.A.R.V.I.S., inlined so the editor can start from one.
// website/test/editors.test.ts checks this list matches packages/bot-jarvis/content/missions/.
import m_agente_em_teste_1 from '../../packages/bot-jarvis/content/missions/agente-em-teste-1.yaml';
import m_agente_em_teste_2 from '../../packages/bot-jarvis/content/missions/agente-em-teste-2.yaml';
import m_agente_em_teste_3 from '../../packages/bot-jarvis/content/missions/agente-em-teste-3.yaml';
import m_armadura_roubada_1 from '../../packages/bot-jarvis/content/missions/armadura-roubada-1.yaml';
import m_armadura_roubada_2 from '../../packages/bot-jarvis/content/missions/armadura-roubada-2.yaml';
import m_armadura_roubada_3 from '../../packages/bot-jarvis/content/missions/armadura-roubada-3.yaml';
import m_aula_na_mansao_1 from '../../packages/bot-jarvis/content/missions/aula-na-mansao-1.yaml';
import m_aula_na_mansao_2 from '../../packages/bot-jarvis/content/missions/aula-na-mansao-2.yaml';
import m_aula_na_mansao_3 from '../../packages/bot-jarvis/content/missions/aula-na-mansao-3.yaml';
import m_carona_espacial_1 from '../../packages/bot-jarvis/content/missions/carona-espacial-1.yaml';
import m_carona_espacial_2 from '../../packages/bot-jarvis/content/missions/carona-espacial-2.yaml';
import m_carona_espacial_3 from '../../packages/bot-jarvis/content/missions/carona-espacial-3.yaml';
import m_convite_no_metro_1 from '../../packages/bot-jarvis/content/missions/convite-no-metro-1.yaml';
import m_convite_no_metro_2 from '../../packages/bot-jarvis/content/missions/convite-no-metro-2.yaml';
import m_convite_no_metro_3 from '../../packages/bot-jarvis/content/missions/convite-no-metro-3.yaml';
import m_depois_da_meia_noite_1 from '../../packages/bot-jarvis/content/missions/depois-da-meia-noite-1.yaml';
import m_depois_da_meia_noite_2 from '../../packages/bot-jarvis/content/missions/depois-da-meia-noite-2.yaml';
import m_depois_da_meia_noite_3 from '../../packages/bot-jarvis/content/missions/depois-da-meia-noite-3.yaml';
import m_fabrica_silenciosa from '../../packages/bot-jarvis/content/missions/fabrica-silenciosa.yaml';
import m_noites_no_bairro_1 from '../../packages/bot-jarvis/content/missions/noites-no-bairro-1.yaml';
import m_noites_no_bairro_2 from '../../packages/bot-jarvis/content/missions/noites-no-bairro-2.yaml';
import m_noites_no_bairro_3 from '../../packages/bot-jarvis/content/missions/noites-no-bairro-3.yaml';
import m_patrulha_noturna from '../../packages/bot-jarvis/content/missions/patrulha-noturna.yaml';
import m_primeiro_contato_1 from '../../packages/bot-jarvis/content/missions/primeiro-contato-1.yaml';
import m_primeiro_contato_2 from '../../packages/bot-jarvis/content/missions/primeiro-contato-2.yaml';
import m_primeiro_contato_3 from '../../packages/bot-jarvis/content/missions/primeiro-contato-3.yaml';
import m_segunda_chance_1 from '../../packages/bot-jarvis/content/missions/segunda-chance-1.yaml';
import m_segunda_chance_2 from '../../packages/bot-jarvis/content/missions/segunda-chance-2.yaml';
import m_segunda_chance_3 from '../../packages/bot-jarvis/content/missions/segunda-chance-3.yaml';
import m_sinal_fantasma from '../../packages/bot-jarvis/content/missions/sinal-fantasma.yaml';
import m_visita_ao_baxter_1 from '../../packages/bot-jarvis/content/missions/visita-ao-baxter-1.yaml';
import m_visita_ao_baxter_2 from '../../packages/bot-jarvis/content/missions/visita-ao-baxter-2.yaml';
import m_visita_ao_baxter_3 from '../../packages/bot-jarvis/content/missions/visita-ao-baxter-3.yaml';
import m_visita_ao_baxter_4 from '../../packages/bot-jarvis/content/missions/visita-ao-baxter-4.yaml';

export const SHIPPED_MISSIONS: Record<string, string> = {
  'agente-em-teste-1': m_agente_em_teste_1,
  'agente-em-teste-2': m_agente_em_teste_2,
  'agente-em-teste-3': m_agente_em_teste_3,
  'armadura-roubada-1': m_armadura_roubada_1,
  'armadura-roubada-2': m_armadura_roubada_2,
  'armadura-roubada-3': m_armadura_roubada_3,
  'aula-na-mansao-1': m_aula_na_mansao_1,
  'aula-na-mansao-2': m_aula_na_mansao_2,
  'aula-na-mansao-3': m_aula_na_mansao_3,
  'carona-espacial-1': m_carona_espacial_1,
  'carona-espacial-2': m_carona_espacial_2,
  'carona-espacial-3': m_carona_espacial_3,
  'convite-no-metro-1': m_convite_no_metro_1,
  'convite-no-metro-2': m_convite_no_metro_2,
  'convite-no-metro-3': m_convite_no_metro_3,
  'depois-da-meia-noite-1': m_depois_da_meia_noite_1,
  'depois-da-meia-noite-2': m_depois_da_meia_noite_2,
  'depois-da-meia-noite-3': m_depois_da_meia_noite_3,
  'fabrica-silenciosa': m_fabrica_silenciosa,
  'noites-no-bairro-1': m_noites_no_bairro_1,
  'noites-no-bairro-2': m_noites_no_bairro_2,
  'noites-no-bairro-3': m_noites_no_bairro_3,
  'patrulha-noturna': m_patrulha_noturna,
  'primeiro-contato-1': m_primeiro_contato_1,
  'primeiro-contato-2': m_primeiro_contato_2,
  'primeiro-contato-3': m_primeiro_contato_3,
  'segunda-chance-1': m_segunda_chance_1,
  'segunda-chance-2': m_segunda_chance_2,
  'segunda-chance-3': m_segunda_chance_3,
  'sinal-fantasma': m_sinal_fantasma,
  'visita-ao-baxter-1': m_visita_ao_baxter_1,
  'visita-ao-baxter-2': m_visita_ao_baxter_2,
  'visita-ao-baxter-3': m_visita_ao_baxter_3,
  'visita-ao-baxter-4': m_visita_ao_baxter_4,
};
