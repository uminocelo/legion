// Mission editor: a branching mission → <id>.yaml for `/jarvis missao importar`.
import {
  addChapter,
  CAMPAIGN_KINDS,
  type CampaignDraft,
  campaignFileName,
  campaignFromYaml,
  campaignToYaml,
  DIFFICULTIES,
  emptyCampaign,
  emptyMission,
  emptyScene,
  fileName,
  fromYaml,
  linksTo,
  MISSION_KINDS,
  type MissionDraft,
  mapProblems,
  nextSceneId,
  ORIGINS,
  removeChapter,
  removeScene,
  renameScene,
  type SceneDraft,
  type SceneType,
  type Text2,
  targets,
  toYaml,
  validate,
  validateCampaign,
  withDefaults,
} from './mission-model.js';
import { SHIPPED_MISSIONS } from './missions-shipped.js';
import { copy, download, field, h, outputPanel, readFile, showResult, store } from './shared.js';

const saved = store<MissionDraft>('legion.editor.mission');
let m: MissionDraft = withDefaults(saved.load() ?? emptyMission());
const savedCampaign = store<CampaignDraft>('legion.editor.campaign');
let c: CampaignDraft = savedCampaign.load() ?? emptyCampaign();

const KIND_LABEL: Record<string, string> = { daily: 'Diária', weekly: 'Semanal', story: 'História' };
const CAMPAIGN_LABEL: Record<string, string> = {
  tutorial: 'Tutorial',
  recruitment: 'Recrutamento',
  story: 'História',
};
const ORIGIN_LABEL: Record<string, string> = {
  mutante: 'Mutante',
  inumano: 'Inumano',
  ciencia: 'Ciência',
  tecnologia: 'Tecnologia',
  mistico: 'Místico',
  cosmico: 'Cósmico',
  treinado: 'Treinado',
};
const DIFF_LABEL: Record<string, string> = { facil: 'Fácil', normal: 'Normal', dificil: 'Difícil' };
const TYPE_LABEL: Record<SceneType, string> = { choice: 'Escolhas', combat: 'Combate', end: 'Final' };

const root = document.getElementById('editor');
if (!root) throw new Error('missing #editor');

const meta = h('div');
const map = h('nav', { class: 'scene-map', 'aria-label': 'Mapa das cenas' });
const list = h('div', { class: 'items' });
const out = outputPanel('/jarvis missao importar arquivo:', 'missao.yaml');
const campaignPanel = h('div');
const cOut = outputPanel('/jarvis campanha importar arquivo:', 'campanha.yaml');
cOut.el.querySelector('h2')?.replaceChildren('Arquivo de campanha');

function refresh() {
  saved.save(m);
  out.parts.download.textContent = `Baixar ${fileName(m)}`;
  showResult(out.parts, toYaml(m), validate(m), `Missão pronta: ${m.scenes.length} cena(s).`);
  refreshCampaign();
  drawMap();
}

function refreshCampaign() {
  savedCampaign.save(c);
  cOut.parts.download.textContent = `Baixar ${campaignFileName(c)}`;
  showResult(
    cOut.parts,
    campaignToYaml(c),
    validateCampaign(c),
    `Campanha pronta: ${c.missions.length} capítulo(s).`,
  );
}

const select = (value: string, options: [string, string][], onChange: (v: string) => void, attrs = {}) => {
  const el = h(
    'select',
    attrs,
    ...options.map(([v, l]) => h('option', { value: v, selected: value === v }, l)),
  );
  el.addEventListener('change', () => onChange(el.value));
  return el;
};
const sceneOptions = (): [string, string][] => [
  ['', '(escolha a cena)'],
  ...m.scenes.map((s): [string, string] => [s.id, s.id]),
];
const number = (get: () => number, set: (n: number) => void, min: number, max: number) => {
  const el = h('input', { type: 'number', value: get(), min, max, step: 1, inputmode: 'numeric' });
  el.addEventListener('input', () => {
    set(el.value === '' ? Number.NaN : Number(el.value));
    refresh();
  });
  return el;
};
/** pt-BR and (optional) English side by side. */
function text2(label: string, t: Text2, max: number, area = false, hint?: string) {
  const make = (key: 'pt' | 'en', ph: string) => {
    const el = area
      ? h('textarea', { rows: 3, maxlength: max, placeholder: ph })
      : h('input', { type: 'text', maxlength: max, placeholder: ph });
    el.value = t[key];
    el.addEventListener('input', () => {
      t[key] = el.value;
      refresh();
    });
    return el;
  };
  return field(
    label,
    h('div', { class: 'pair' }, make('pt', 'Português'), make('en', 'English (opcional)')),
    hint,
    true,
  );
}

const textInput = (get: () => string, set: (v: string) => void, attrs = {}) => {
  const el = h('input', { type: 'text', value: get(), ...attrs });
  el.addEventListener('input', () => {
    set(el.value);
    refresh();
  });
  return el;
};

/** Campaign, chapter, requires and joinFaction of the mission being edited. */
function missionCampaignFields(): HTMLElement {
  const origins = h(
    'div',
    { class: 'checks' },
    ...ORIGINS.map((o) => {
      const box = h('input', { type: 'checkbox', checked: m.requires.origins.includes(o) });
      box.addEventListener('change', () => {
        m.requires.origins = ORIGINS.filter((x) => (x === o ? box.checked : m.requires.origins.includes(x)));
        refresh();
      });
      return h('label', { class: 'check' }, box, ` ${ORIGIN_LABEL[o] ?? o}`);
    }),
  );
  return h(
    'fieldset',
    {},
    h('legend', {}, 'Campanha e requisitos (opcional)'),
    h(
      'div',
      { class: 'grid' },
      field(
        'Campanha (id)',
        textInput(
          () => m.campaign.id,
          (v) => (m.campaign.id = v),
          { maxlength: 41 },
        ),
        'Vazio = missão solta',
      ),
      field(
        'Capítulo',
        number(
          () => m.campaign.chapter,
          (n) => {
            m.campaign.chapter = n;
          },
          1,
          50,
        ),
      ),
      field(
        'Missões antes desta',
        textInput(
          () => m.requires.missions,
          (v) => (m.requires.missions = v),
        ),
        'Ids separados por vírgula, terminadas com sucesso',
      ),
      field(
        'Nível exigido',
        number(
          () => m.requires.level,
          (n) => {
            m.requires.level = n;
          },
          0,
          100,
        ),
        '0 = sem exigência (além do nível mínimo)',
      ),
      field(
        'Equipes aceitas',
        textInput(
          () => m.requires.factions,
          (v) => (m.requires.factions = v),
        ),
        'Chaves separadas por vírgula, como independent, xmen; vazio = todas',
      ),
      field(
        'Entrar na equipe ao vencer',
        textInput(
          () => m.joinFaction,
          (v) => (m.joinFaction = v),
          { maxlength: 40 },
        ),
        'Só no capítulo final de uma campanha de recrutamento',
      ),
    ),
    field('Origens aceitas (nenhuma marcada = todas)', origins, undefined, true),
  );
}

function drawMeta() {
  const id = h('input', { type: 'text', value: m.id, maxlength: 41 });
  id.addEventListener('input', () => {
    m.id = id.value;
    refresh();
  });
  const xp = h('input', { type: 'checkbox', checked: m.customXp });
  xp.addEventListener('change', () => {
    m.customXp = xp.checked;
    drawMeta();
    refresh();
  });
  const cr = h('input', { type: 'checkbox', checked: m.customCredits });
  cr.addEventListener('change', () => {
    m.customCredits = cr.checked;
    drawMeta();
    refresh();
  });
  const pair = (label: string, v: { success: number; failure: number }) =>
    h(
      'div',
      { class: 'grid' },
      field(
        `${label} no sucesso`,
        number(
          () => v.success,
          (n) => {
            v.success = n;
          },
          0,
          10000,
        ),
      ),
      field(
        `${label} na falha`,
        number(
          () => v.failure,
          (n) => {
            v.failure = n;
          },
          0,
          10000,
        ),
      ),
    );
  meta.replaceChildren(
    h(
      'article',
      { class: 'item' },
      h('header', {}, h('h3', {}, 'Missão')),
      h(
        'div',
        { class: 'grid' },
        text2('Título', m.title, 80, false, 'Pode citar heróis e lugares da Marvel; inimigos são originais'),
        text2('Resumo', m.summary, 300, true),
        field('Id', id, 'Mesmo id substitui a missão no servidor'),
        field(
          'Tipo',
          select(
            m.kind,
            MISSION_KINDS.map((k) => [k, KIND_LABEL[k] ?? k]),
            (v) => {
              m.kind = v;
              refresh();
            },
          ),
        ),
        field(
          'Dificuldade',
          select(
            m.difficulty,
            DIFFICULTIES.map((d) => [d, DIFF_LABEL[d] ?? d]),
            (v) => {
              m.difficulty = v;
              refresh();
            },
          ),
        ),
        field(
          'Nível mínimo',
          number(
            () => m.minLevel,
            (n) => {
              m.minLevel = n;
            },
            1,
            100,
          ),
        ),
        field(
          'Jogadores',
          number(
            () => m.party,
            (n) => {
              m.party = n;
            },
            1,
            4,
          ),
          '1 = solo; até 4 em grupo',
        ),
        field(
          'Cena inicial',
          select(m.start, sceneOptions(), (v) => {
            m.start = v;
            refresh();
          }),
        ),
      ),
      missionCampaignFields(),
      h('label', { class: 'check' }, xp, ' XP próprio (senão vale o padrão do servidor para o tipo)'),
      m.customXp ? pair('XP', m.xp) : null,
      h('label', { class: 'check' }, cr, ' Créditos próprios (senão vale o padrão do servidor para o tipo)'),
      m.customCredits ? pair('Créditos', m.credits) : null,
    ),
  );
}

function drawMap() {
  const problems = mapProblems(m);
  const rows = m.scenes.map((s) => {
    const issues = problems.get(s.id) ?? [];
    const tags = [
      s.id === m.start ? 'início' : '',
      s.type === 'end' ? (s.end === 'success' ? 'sucesso' : 'falha') : '',
    ].filter(Boolean);
    return h(
      'li',
      { class: issues.length ? 'bad' : '' },
      h('a', { href: `#cena-${s.id}` }, s.id || '(sem id)'),
      tags.length ? h('span', { class: 'tag' }, tags.join(' · ')) : null,
      targets(s).length
        ? h(
            'span',
            { class: 'to' },
            ` → ${targets(s)
              .map((x) => x || '?')
              .join(', ')}`,
          )
        : null,
      ...issues.map((x) => h('div', { class: 'why' }, x)),
    );
  });
  const general = [...(problems.get('start') ?? []), ...(problems.get('scenes') ?? [])].map((x) =>
    h('li', { class: 'bad' }, x),
  );
  map.replaceChildren(h('h3', {}, 'Mapa das cenas'), h('ul', {}, ...general, ...rows));
}

function sceneCard(s: SceneDraft): HTMLElement {
  const id = h('input', { type: 'text', value: s.id, maxlength: 32 });
  // Renamed on change (not each key) so links are updated once, to the final name.
  id.addEventListener('change', () => {
    const to = id.value.trim();
    if (to && to !== s.id) renameScene(m, s.id, to);
    render();
  });
  const del = h('button', { type: 'button', class: 'mini danger' }, 'Remover');
  del.addEventListener('click', () => {
    removeScene(m, s.id);
    render();
  });
  const incoming = linksTo(m, s.id);
  let body: HTMLElement;
  if (s.type === 'choice') {
    const rows = s.choices.map((c, i) => {
      const rm = h('button', { type: 'button', class: 'mini danger', disabled: s.choices.length <= 2 }, '×');
      rm.addEventListener('click', () => {
        s.choices.splice(i, 1);
        render();
      });
      return h(
        'div',
        { class: 'choice-row' },
        text2(`Escolha ${i + 1}`, c.label, 80),
        field(
          'Leva a',
          select(c.next, sceneOptions(), (v) => {
            c.next = v;
            render();
          }),
        ),
        rm,
      );
    });
    const add = h('button', { type: 'button', class: 'mini', disabled: s.choices.length >= 4 }, '+ Escolha');
    add.addEventListener('click', () => {
      s.choices.push({ label: { pt: '', en: '' }, next: '' });
      render();
    });
    body = h('fieldset', {}, h('legend', {}, 'Escolhas (2 a 4; o grupo vota)'), ...rows, add);
  } else if (s.type === 'combat') {
    body = h(
      'fieldset',
      {},
      h('legend', {}, 'Combate (o ULTRON escolhe os inimigos pelo nível e tamanho do grupo)'),
      h(
        'div',
        { class: 'grid' },
        field(
          'Se vencer',
          select(s.win, sceneOptions(), (v) => {
            s.win = v;
            render();
          }),
        ),
        field(
          'Se perder',
          select(s.lose, sceneOptions(), (v) => {
            s.lose = v;
            render();
          }),
        ),
      ),
    );
  } else {
    body = field(
      'Resultado',
      select(
        s.end,
        [
          ['success', 'Sucesso'],
          ['failure', 'Falha'],
        ],
        (v) => {
          s.end = v as 'success' | 'failure';
          render();
        },
      ),
    );
  }
  return h(
    'article',
    { class: 'item', id: `cena-${s.id}` },
    h('header', {}, h('h3', {}, `Cena ${s.id}${s.id === m.start ? ' (início)' : ''}`), h('div', {}, del)),
    h(
      'div',
      { class: 'grid' },
      field(
        'Id da cena',
        id,
        incoming.length ? `Chegam aqui: ${incoming.join(', ')}` : 'Nenhuma cena leva aqui ainda',
      ),
      field(
        'Tipo',
        select(s.type, Object.entries(TYPE_LABEL) as [string, string][], (v) => {
          s.type = v as SceneType;
          render();
        }),
      ),
      text2('Texto', s.text, 1500, true),
    ),
    body,
  );
}

function drawCampaign() {
  const kind = select(
    c.kind,
    CAMPAIGN_KINDS.map((k) => [k, CAMPAIGN_LABEL[k] ?? k]),
    (v) => {
      c.kind = v;
      drawCampaign();
      refreshCampaign();
    },
  );
  const cText = (label: string, t: Text2, max: number, area = false) => {
    const el = text2(label, t, max, area);
    el.addEventListener('input', () => refreshCampaign());
    return el;
  };
  const addThis = h(
    'button',
    { type: 'button', class: 'btn primary' },
    'Adicionar esta missão como capítulo',
  );
  addThis.addEventListener('click', () => {
    m.campaign.id = c.id.trim();
    addChapter(c, m);
    render();
  });
  const chapters = c.missions.map((x) => {
    const edit = h('button', { type: 'button', class: 'mini' }, 'Editar');
    edit.addEventListener('click', () => {
      m = withDefaults(structuredClone(x));
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    const rm = h('button', { type: 'button', class: 'mini danger' }, 'Remover');
    rm.addEventListener('click', () => {
      removeChapter(c, x.id);
      drawCampaign();
      refreshCampaign();
    });
    return h('li', {}, `${x.campaign.chapter}. ${x.title.pt || x.id} (${x.id}) `, edit, ' ', rm);
  });
  const fileIn = h('input', { type: 'file', accept: '.yaml,.yml', hidden: true });
  const openC = h('button', { type: 'button', class: 'btn' }, 'Abrir arquivo de campanha');
  const msg = h('span', { class: 'copied', role: 'status' });
  openC.addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0];
    fileIn.value = '';
    if (!f) return;
    try {
      c = campaignFromYaml(await readFile(f));
      drawCampaign();
      refreshCampaign();
    } catch (err) {
      msg.textContent = `Não consegui abrir: ${(err as Error).message}`;
    }
  });
  const fresh = h('button', { type: 'button', class: 'btn' }, 'Campanha em branco');
  fresh.addEventListener('click', () => {
    c = emptyCampaign();
    drawCampaign();
    refreshCampaign();
  });
  const id = h('input', { type: 'text', value: c.id, maxlength: 41 });
  id.addEventListener('input', () => {
    c.id = id.value;
    refreshCampaign();
  });
  const faction = h('input', { type: 'text', value: c.faction, maxlength: 40 });
  faction.addEventListener('input', () => {
    c.faction = faction.value;
    refreshCampaign();
  });
  campaignPanel.replaceChildren(
    h(
      'article',
      { class: 'item', id: 'campanha' },
      h('header', {}, h('h3', {}, 'Campanha'), h('div', {}, openC, ' ', fresh, fileIn, msg)),
      h(
        'p',
        {},
        'Junte missões em capítulos e baixe um arquivo só para ',
        h('code', {}, '/jarvis campanha importar'),
        '.',
      ),
      h(
        'div',
        { class: 'grid' },
        cText('Título da campanha', c.title, 80),
        cText('Resumo da campanha', c.summary, 300, true),
        field('Id da campanha', id),
        field('Tipo', kind),
        c.kind === 'recruitment' ? field('Equipe que recruta', faction, 'Chave, como avengers') : null,
      ),
      h('ol', { class: 'chapters' }, ...chapters),
      addThis,
    ),
  );
}

function render() {
  drawMeta();
  drawCampaign();
  list.replaceChildren(...m.scenes.map(sceneCard));
  refresh();
}

const add = h('button', { type: 'button', class: 'btn primary' }, '+ Nova cena');
add.addEventListener('click', () => {
  const s = emptyScene(nextSceneId(m));
  m.scenes.push(s);
  render();
  document.getElementById(`cena-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
const openMsg = h('span', { class: 'copied', role: 'status' });
const load = (text: string, from: string) => {
  try {
    m = withDefaults(fromYaml(text));
    openMsg.textContent = `Aberta: ${from}`;
    render();
  } catch (err) {
    openMsg.textContent = `Não consegui abrir: ${(err as Error).message}`;
  }
};
const shipped = select(
  '',
  [
    ['', 'Começar de uma missão pronta…'],
    ...Object.keys(SHIPPED_MISSIONS).map((k): [string, string] => [k, k]),
  ],
  (v) => {
    const text = SHIPPED_MISSIONS[v];
    if (text) load(text, v);
    shipped.value = '';
  },
  { 'aria-label': 'Começar de uma missão pronta' },
);
const fileInput = h('input', { type: 'file', accept: '.yaml,.yml', hidden: true });
const open = h('button', { type: 'button', class: 'btn' }, 'Abrir arquivo');
open.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const f = fileInput.files?.[0];
  if (f) load(await readFile(f), f.name);
  fileInput.value = '';
});
const clear = h('button', { type: 'button', class: 'btn' }, 'Missão em branco');
clear.addEventListener('click', () => {
  m = emptyMission();
  render();
});

out.parts.download.addEventListener('click', () => download(fileName(m), toYaml(m)));
out.parts.copy.addEventListener('click', async () => {
  out.parts.status.textContent = (await copy(toYaml(m))) ? 'Copiado!' : 'Não deu para copiar; use Baixar.';
});
out.el.insertBefore(map, out.el.querySelector('.howto'));
cOut.parts.download.addEventListener('click', () => download(campaignFileName(c), campaignToYaml(c)));
cOut.parts.copy.addEventListener('click', async () => {
  cOut.parts.status.textContent = (await copy(campaignToYaml(c)))
    ? 'Copiado!'
    : 'Não deu para copiar; use Baixar.';
});

root.replaceChildren(
  h(
    'div',
    { class: 'ed' },
    h(
      'div',
      { class: 'main' },
      h('div', { class: 'toolbar' }, add, shipped, open, clear, fileInput, openMsg),
      meta,
      list,
      campaignPanel,
    ),
    h('div', { class: 'outs' }, out.el, cOut.el),
  ),
);
render();
