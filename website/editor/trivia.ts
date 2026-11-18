// Trivia editor: questions → perguntas.yaml for `/jarvis trivia importar`.
import { copy, download, field, h, outputPanel, readFile, showResult, store } from './shared.js';
import {
  DEFAULT_CATEGORIES,
  DIFFICULTIES,
  emptyQuestion,
  fromYaml,
  TRIVIA_FILE,
  type TriviaDraft,
  toYaml,
  validate,
} from './trivia-model.js';

interface State {
  drafts: TriviaDraft[];
  categories: string;
}

const saved = store<State>('legion.editor.trivia');
const state: State = saved.load() ?? { drafts: [], categories: DEFAULT_CATEGORIES.join(', ') };
if (!state.drafts.length) state.drafts.push(emptyQuestion([]));

const DIFF_LABEL: Record<string, string> = { facil: 'Fácil', normal: 'Normal', dificil: 'Difícil' };
const root = document.getElementById('editor');
if (!root) throw new Error('missing #editor');

const list = h('div', { class: 'items' });
const out = outputPanel('/jarvis trivia importar arquivo:', TRIVIA_FILE);
const categories = () =>
  state.categories
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

function refresh() {
  saved.save(state);
  const yaml = toYaml(state.drafts);
  const n = state.drafts.length;
  showResult(out.parts, yaml, validate(yaml, categories()), `${n} pergunta(s) prontas para importar.`);
}

function card(d: TriviaDraft, idx: number): HTMLElement {
  const on =
    <K extends keyof TriviaDraft>(key: K, map: (v: string) => TriviaDraft[K] = (v) => v as TriviaDraft[K]) =>
    (e: Event) => {
      d[key] = map((e.target as HTMLInputElement).value);
      refresh();
    };
  const input = (key: 'id' | 'category' | 'source', attrs = {}) => {
    const el = h('input', { type: 'text', value: d[key], ...attrs });
    el.addEventListener('input', on(key));
    return el;
  };
  const area = (key: 'question' | 'explanation', max: number) => {
    const el = h('textarea', { rows: 2, maxlength: max });
    el.value = d[key];
    el.addEventListener('input', on(key));
    return el;
  };
  const select = (key: 'locale' | 'difficulty', options: [string, string][]) => {
    const el = h(
      'select',
      {},
      ...options.map(([v, l]) => h('option', { value: v, selected: d[key] === v }, l)),
    );
    el.addEventListener('change', on(key));
    return el;
  };
  const choices = h(
    'fieldset',
    { class: 'choices' },
    h('legend', {}, 'Alternativas (marque a certa; de 2 a 4)'),
    ...d.choices.map((c, i) => {
      const radio = h('input', {
        type: 'radio',
        name: `answer-${idx}`,
        checked: d.answer === i,
        'aria-label': `Alternativa ${i + 1} é a certa`,
      });
      radio.addEventListener('change', () => {
        d.answer = i;
        refresh();
      });
      const text = h('input', { type: 'text', value: c, maxlength: 80, placeholder: `Alternativa ${i + 1}` });
      text.addEventListener('input', (e) => {
        d.choices[i] = (e.target as HTMLInputElement).value;
        refresh();
      });
      return h('div', { class: 'choice' }, radio, text);
    }),
  );
  const dup = h('button', { type: 'button', class: 'mini' }, 'Duplicar');
  dup.addEventListener('click', () => {
    const copyOf = { ...structuredClone(d), id: emptyQuestion(state.drafts).id };
    state.drafts.splice(idx + 1, 0, copyOf);
    render();
  });
  const del = h('button', { type: 'button', class: 'mini danger' }, 'Remover');
  del.addEventListener('click', () => {
    state.drafts.splice(idx, 1);
    if (!state.drafts.length) state.drafts.push(emptyQuestion([]));
    render();
  });
  return h(
    'article',
    { class: 'item' },
    h('header', {}, h('h3', {}, `Pergunta ${idx + 1}`), h('div', {}, dup, del)),
    h(
      'div',
      { class: 'grid' },
      field('Id', input('id', { maxlength: 64 }), 'Único e estável; mudar cria outra pergunta'),
      field(
        'Idioma',
        select('locale', [
          ['pt-BR', 'Português'],
          ['en', 'English'],
        ]),
      ),
      field('Categoria', input('category', { list: 'cats' }), 'Precisa existir no seu servidor'),
      field(
        'Dificuldade',
        select(
          'difficulty',
          DIFFICULTIES.map((x) => [x, DIFF_LABEL[x] ?? x]),
        ),
      ),
      field('Pergunta', area('question', 300), undefined, true),
    ),
    choices,
    h(
      'div',
      { class: 'grid' },
      field('Explicação', area('explanation', 300), 'Aparece depois da resposta', true),
      field(
        'Fonte',
        input('source', { maxlength: 200 }),
        'Link ou referência, como "Shang-Chi #4 (2021)"',
        true,
      ),
    ),
  );
}

function render() {
  list.replaceChildren(...state.drafts.map(card));
  refresh();
}

const add = h('button', { type: 'button', class: 'btn primary' }, '+ Nova pergunta');
add.addEventListener('click', () => {
  state.drafts.push(emptyQuestion(state.drafts));
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
    if (!drafts.length) throw new Error('nenhuma pergunta no arquivo');
    state.drafts = drafts;
    openMsg.textContent = `${drafts.length} pergunta(s) abertas de ${f.name}`;
    render();
  } catch (err) {
    openMsg.textContent = `Não consegui abrir: ${(err as Error).message}`;
  }
  fileInput.value = '';
});
const clear = h('button', { type: 'button', class: 'btn' }, 'Começar do zero');
clear.addEventListener('click', () => {
  state.drafts = [emptyQuestion([])];
  render();
});
const cats = h('input', { type: 'text', value: state.categories });
cats.addEventListener('input', () => {
  state.categories = cats.value;
  refresh();
});
const datalist = h('datalist', { id: 'cats' }, ...DEFAULT_CATEGORIES.map((c) => h('option', { value: c })));

out.parts.download.addEventListener('click', () => download(TRIVIA_FILE, toYaml(state.drafts)));
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
      h('div', { class: 'toolbar' }, add, open, clear, fileInput, openMsg),
      field(
        'Categorias do seu servidor',
        cats,
        'As de jarvis.trivia.categories, separadas por vírgula',
        true,
      ),
      datalist,
      list,
    ),
    out.el,
  ),
);
render();
