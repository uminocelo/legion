// Mission editor: a branching mission → <id>.yaml for `/jarvis missao importar`.
import {
  DIFFICULTIES,
  emptyMission,
  emptyScene,
  fileName,
  fromYaml,
  linksTo,
  MISSION_KINDS,
  type MissionDraft,
  mapProblems,
  nextSceneId,
  removeScene,
  renameScene,
  type SceneDraft,
  type SceneType,
  type Text2,
  targets,
  toYaml,
  validate,
} from './mission-model.js';
import { SHIPPED_MISSIONS } from './missions-shipped.js';
import { copy, download, field, h, outputPanel, readFile, showResult, store } from './shared.js';

const saved = store<MissionDraft>('legion.editor.mission');
let m: MissionDraft = saved.load() ?? emptyMission();

const KIND_LABEL: Record<string, string> = { daily: 'Diária', weekly: 'Semanal', story: 'História' };
const DIFF_LABEL: Record<string, string> = { facil: 'Fácil', normal: 'Normal', dificil: 'Difícil' };
const TYPE_LABEL: Record<SceneType, string> = { choice: 'Escolhas', combat: 'Combate', end: 'Final' };

const root = document.getElementById('editor');
if (!root) throw new Error('missing #editor');

const meta = h('div');
const map = h('nav', { class: 'scene-map', 'aria-label': 'Mapa das cenas' });
const list = h('div', { class: 'items' });
const out = outputPanel('/jarvis missao importar arquivo:', 'missao.yaml');

function refresh() {
  saved.save(m);
  out.parts.download.textContent = `Baixar ${fileName(m)}`;
  showResult(out.parts, toYaml(m), validate(m), `Missão pronta: ${m.scenes.length} cena(s).`);
  drawMap();
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
      h('label', { class: 'check' }, xp, ' XP próprio (senão vale o padrão do servidor para o tipo)'),
      m.customXp
        ? h(
            'div',
            { class: 'grid' },
            field(
              'XP no sucesso',
              number(
                () => m.xp.success,
                (n) => {
                  m.xp.success = n;
                },
                0,
                10000,
              ),
            ),
            field(
              'XP na falha',
              number(
                () => m.xp.failure,
                (n) => {
                  m.xp.failure = n;
                },
                0,
                10000,
              ),
            ),
          )
        : null,
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

function render() {
  drawMeta();
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
    m = fromYaml(text);
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
    ),
    out.el,
  ),
);
render();
