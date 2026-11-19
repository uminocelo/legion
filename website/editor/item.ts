// Item editor: J.A.R.V.I.S. items → itens.yaml for `/jarvis item importar`.
import shippedText from '../../packages/bot-jarvis/content/items/itens.yaml';
import {
  emptyItem,
  fromYaml,
  ITEM_FILE,
  ITEM_SLOTS,
  ITEM_STAT_MAX,
  ITEM_STATS,
  type ItemDraft,
  toYaml,
  validate,
} from './item-model.js';
import { copy, download, field, h, outputPanel, readFile, showResult, store } from './shared.js';

const shipped = fromYaml(shippedText);
const shippedIds = shipped.map((d) => d.id);
const saved = store<{ drafts: ItemDraft[] }>('legion.editor.items');
// JSON has no NaN: a saved "no order" comes back as null.
const state = saved.load() ?? { drafts: [] as ItemDraft[] };
for (const d of state.drafts) if (typeof d.order !== 'number') d.order = Number.NaN;
if (!state.drafts.length) state.drafts.push(emptyItem([]));

const SLOT_LABEL: Record<string, string> = {
  traje: 'Traje',
  acessorio: 'Acessório',
  dispositivo: 'Dispositivo',
};
const STAT_LABEL: Record<string, string> = { hp: 'VIDA', atk: 'ATQ', def: 'DEF', spd: 'VEL', foc: 'FOCO' };
const root = document.getElementById('editor');
if (!root) throw new Error('missing #editor');

const list = h('div', { class: 'items' });
const out = outputPanel('/jarvis item importar arquivo:', ITEM_FILE);

function refresh() {
  saved.save(state);
  const yaml = toYaml(state.drafts);
  showResult(
    out.parts,
    yaml,
    validate(yaml, shippedIds),
    `${state.drafts.length} item(ns) prontos para importar.`,
  );
}

function card(d: ItemDraft, idx: number): HTMLElement {
  type TextKey = 'id' | 'namePt' | 'nameEn' | 'descPt' | 'descEn';
  const text = (key: TextKey, attrs = {}) => {
    const el = h('input', { type: 'text', value: d[key], ...attrs });
    el.addEventListener('input', () => {
      d[key] = el.value;
      refresh();
    });
    return el;
  };
  const number = (get: () => number, set: (n: number) => void, min: number, max: number, attrs = {}) => {
    const v = get();
    const el = h('input', {
      type: 'number',
      value: Number.isFinite(v) ? v : '',
      min,
      max,
      step: 1,
      inputmode: 'numeric',
      ...attrs,
    });
    el.addEventListener('input', () => {
      set(el.value === '' ? Number.NaN : Number(el.value));
      refresh();
    });
    return el;
  };
  const check = (get: () => boolean, set: (v: boolean) => void, label: string) => {
    const el = h('input', { type: 'checkbox', checked: get() });
    el.addEventListener('change', () => {
      set(el.checked);
      render();
    });
    return h('label', { class: 'check' }, el, ` ${label}`);
  };
  const slot = h(
    'select',
    {},
    ...ITEM_SLOTS.map((x) => h('option', { value: x, selected: d.slot === x }, SLOT_LABEL[x] ?? x)),
  );
  slot.addEventListener('change', () => {
    d.slot = slot.value;
    refresh();
  });
  const del = h('button', { type: 'button', class: 'mini danger' }, 'Remover');
  del.addEventListener('click', () => {
    state.drafts.splice(idx, 1);
    if (!state.drafts.length) state.drafts.push(emptyItem([]));
    render();
  });
  return h(
    'article',
    { class: 'item' },
    h('header', {}, h('h3', {}, d.namePt || `Item ${idx + 1}`), h('div', {}, del)),
    h(
      'div',
      { class: 'grid' },
      field(
        'Nome',
        text('namePt', { maxlength: 60 }),
        'Original: nomes de personagens existentes são recusados',
      ),
      field('Nome em inglês', text('nameEn', { maxlength: 60 }), 'Opcional'),
      field('Id', text('id', { maxlength: 48 }), 'Letras minúsculas, números e "-" (3 a 48)'),
      field('Espaço', slot),
      field(
        'Nível mínimo',
        number(
          () => d.minLevel,
          (n) => {
            d.minLevel = n;
          },
          1,
          50,
        ),
      ),
      field('Descrição', text('descPt', { maxlength: 200 }), 'Opcional, até 200 caracteres', true),
      field('Descrição em inglês', text('descEn', { maxlength: 200 }), 'Opcional', true),
    ),
    h(
      'fieldset',
      { class: 'stats' },
      h('legend', {}, 'Bônus nas lutas (o total equipado tem teto: +2 por atributo e +16 de vida)'),
      check(
        () => d.cosmetic,
        (v) => {
          d.cosmetic = v;
          if (v) for (const s of ITEM_STATS) d.bonus[s] = 0;
          else if (ITEM_STATS.every((s) => d.bonus[s] === 0)) d.bonus.atk = 1;
        },
        'Só visual (sem bônus)',
      ),
      ...(d.cosmetic
        ? []
        : ITEM_STATS.map((s) =>
            field(
              `${STAT_LABEL[s] ?? s} (0 a ${ITEM_STAT_MAX[s]})`,
              number(
                () => d.bonus[s],
                (n) => {
                  d.bonus[s] = n;
                },
                0,
                ITEM_STAT_MAX[s],
              ),
            ),
          )),
    ),
    h(
      'fieldset',
      { class: 'stats' },
      h('legend', {}, 'Loja'),
      check(
        () => d.forSale,
        (v) => {
          d.forSale = v;
        },
        'À venda na /loja',
      ),
      ...(d.forSale
        ? [
            field(
              'Preço (créditos)',
              number(
                () => d.price,
                (n) => {
                  d.price = n;
                },
                1,
                100000,
              ),
              'Os itens do Legion custam de 60 a 360',
            ),
            field(
              'Ordem na loja',
              number(
                () => d.order,
                (n) => {
                  d.order = n;
                },
                0,
                10000,
              ),
              'Opcional: menor aparece antes',
            ),
          ]
        : []),
    ),
  );
}

function render() {
  list.replaceChildren(...state.drafts.map(card));
  refresh();
}

const add = h('button', { type: 'button', class: 'btn primary' }, '+ Novo item');
add.addEventListener('click', () => {
  state.drafts.push(emptyItem(state.drafts));
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
    if (!drafts.length) throw new Error('nenhum item no arquivo');
    state.drafts = drafts;
    openMsg.textContent = `${drafts.length} item(ns) abertos de ${f.name}`;
    render();
  } catch (err) {
    openMsg.textContent = `Não consegui abrir: ${(err as Error).message}`;
  }
  fileInput.value = '';
});
const example = h('button', { type: 'button', class: 'btn' }, 'Ver os itens do Legion');
example.addEventListener('click', () => {
  // A copy with new ids, so the file can be imported as is.
  state.drafts = shipped.map((d) => ({ ...d, bonus: { ...d.bonus }, id: `${d.id}-2`.slice(0, 48) }));
  openMsg.textContent = `${shipped.length} itens de exemplo (ids com "-2")`;
  render();
});
const clear = h('button', { type: 'button', class: 'btn' }, 'Começar do zero');
clear.addEventListener('click', () => {
  state.drafts = [emptyItem([])];
  render();
});

out.parts.download.addEventListener('click', () => download(ITEM_FILE, toYaml(state.drafts)));
out.parts.copy.addEventListener('click', async () => {
  out.parts.status.textContent = (await copy(toYaml(state.drafts)))
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
      h('div', { class: 'toolbar' }, add, open, example, clear, fileInput, openMsg),
      list,
    ),
    out.el,
  ),
);
render();
