// Enemy editor: ULTRON enemies → inimigos.yaml for `/ultron inimigo importar`.
import {
  ENEMY_FILE,
  type EnemyDraft,
  emptyEnemy,
  fromYaml,
  STATS,
  TIER_DEFAULTS,
  TIERS,
  toYaml,
  validate,
} from './enemy-model.js';
import { copy, download, field, h, outputPanel, readFile, showResult, store } from './shared.js';

const saved = store<{ drafts: EnemyDraft[] }>('legion.editor.enemies');
const state = saved.load() ?? { drafts: [] as EnemyDraft[] };
if (!state.drafts.length) state.drafts.push(emptyEnemy([]));

const TIER_LABEL: Record<string, string> = { minion: 'Lacaio', elite: 'Elite', boss: 'Chefe' };
const STAT_LABEL: Record<string, string> = { hp: 'HP', atk: 'ATQ', def: 'DEF', spd: 'VEL', foc: 'FOC' };
const root = document.getElementById('editor');
if (!root) throw new Error('missing #editor');

const list = h('div', { class: 'items' });
const out = outputPanel('/ultron inimigo importar arquivo:', ENEMY_FILE);

function refresh() {
  saved.save(state);
  const yaml = toYaml(state.drafts);
  showResult(out.parts, yaml, validate(yaml), `${state.drafts.length} inimigo(s) prontos para importar.`);
}

function card(d: EnemyDraft, idx: number): HTMLElement {
  const text = (key: 'id' | 'name', attrs = {}) => {
    const el = h('input', { type: 'text', value: d[key], ...attrs });
    el.addEventListener('input', () => {
      d[key] = el.value;
      refresh();
    });
    return el;
  };
  const number = (get: () => number, set: (n: number) => void, min: number, max: number) => {
    const el = h('input', { type: 'number', value: get(), min, max, step: 1, inputmode: 'numeric' });
    el.addEventListener('input', () => {
      set(el.value === '' ? Number.NaN : Number(el.value));
      refresh();
    });
    return el;
  };
  const tier = h(
    'select',
    {},
    ...TIERS.map((x) => h('option', { value: x, selected: d.tier === x }, TIER_LABEL[x] ?? x)),
  );
  tier.addEventListener('change', () => {
    d.tier = tier.value;
    d.base = { ...(TIER_DEFAULTS[d.tier] ?? d.base) };
    render();
  });
  const del = h('button', { type: 'button', class: 'mini danger' }, 'Remover');
  del.addEventListener('click', () => {
    state.drafts.splice(idx, 1);
    if (!state.drafts.length) state.drafts.push(emptyEnemy([]));
    render();
  });
  return h(
    'article',
    { class: 'item' },
    h('header', {}, h('h3', {}, d.name || `Inimigo ${idx + 1}`), h('div', {}, del)),
    h(
      'div',
      { class: 'grid' },
      field(
        'Nome',
        text('name', { maxlength: 60 }),
        'Original: nomes de personagens existentes são recusados',
      ),
      field('Id', text('id', { maxlength: 41 }), 'Letras minúsculas, números e "-"'),
      field('Tipo', tier, d.tier === 'boss' ? 'Chefes usam HP 0: o HP vem do evento' : undefined),
      field(
        'Nível mínimo',
        number(
          () => d.minLevel,
          (n) => {
            d.minLevel = n;
          },
          1,
          100,
        ),
      ),
      field(
        'Recarga do poder (rodadas)',
        number(
          () => d.powerCooldownMax,
          (n) => {
            d.powerCooldownMax = n;
          },
          1,
          10,
        ),
      ),
    ),
    h(
      'fieldset',
      { class: 'stats' },
      h('legend', {}, 'Atributos base (nível 1; o ULTRON escala pelo nível do grupo)'),
      ...STATS.map((s) =>
        field(
          STAT_LABEL[s] ?? s,
          number(
            () => d.base[s],
            (n) => {
              d.base[s] = n;
            },
            s === 'hp' ? 0 : 1,
            5000,
          ),
        ),
      ),
    ),
  );
}

function render() {
  list.replaceChildren(...state.drafts.map(card));
  refresh();
}

const add = h('button', { type: 'button', class: 'btn primary' }, '+ Novo inimigo');
add.addEventListener('click', () => {
  state.drafts.push(emptyEnemy(state.drafts));
  render();
  list.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
const fileInput = h('input', { type: 'file', accept: '.yaml,.yml', hidden: true });
const open = h('button', { type: 'button', class: 'btn' }, 'Abrir arquivo');
open.addEventListener('click', () => fileInput.click());
const openMsg = h('span', { class: 'copied', role: 'status' });
fileInput.addEventListener('change', async () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  try {
    const drafts = fromYaml(await readFile(f));
    if (!drafts.length) throw new Error('nenhum inimigo no arquivo');
    state.drafts = drafts;
    openMsg.textContent = `${drafts.length} inimigo(s) abertos de ${f.name}`;
    render();
  } catch (err) {
    openMsg.textContent = `Não consegui abrir: ${(err as Error).message}`;
  }
  fileInput.value = '';
});
const clear = h('button', { type: 'button', class: 'btn' }, 'Começar do zero');
clear.addEventListener('click', () => {
  state.drafts = [emptyEnemy([])];
  render();
});

out.parts.download.addEventListener('click', () => download(ENEMY_FILE, toYaml(state.drafts)));
out.parts.copy.addEventListener('click', async () => {
  out.parts.status.textContent = (await copy(toYaml(state.drafts)))
    ? 'Copiado!'
    : 'Não deu para copiar; use Baixar.';
});

root.replaceChildren(
  h(
    'div',
    { class: 'ed' },
    h('div', { class: 'main' }, h('div', { class: 'toolbar' }, add, open, clear, fileInput, openMsg), list),
    out.el,
  ),
);
render();
