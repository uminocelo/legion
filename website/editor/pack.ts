// Pack editor: metadata + YAML section lists → pack.yaml for `/jarvis pack importar`.
import { emptyPack, fromYaml, PACK_FILE, type PackDraft, toYaml, validate } from './pack-model.js';
import { copy, download, field, h, outputPanel, readFile, showResult, store } from './shared.js';

const saved = store<{ draft: PackDraft }>('legion.editor.pack');
const state = saved.load() ?? { draft: emptyPack() };
if (!state.draft) state.draft = emptyPack();

const editor = document.getElementById('editor');
if (!editor) throw new Error('missing #editor');
const root: HTMLElement = editor;

const out = outputPanel('/jarvis pack importar arquivo:', PACK_FILE);

function refresh() {
  saved.save(state);
  const yaml = toYaml(state.draft);
  const errors = validate(state.draft);
  showResult(
    out.parts,
    yaml,
    errors,
    errors.length ? '' : `Pacote \`${state.draft.id || '…'}\` pronto para importar.`,
  );
}

function textInput(get: () => string, set: (v: string) => void, attrs: Record<string, string | number> = {}) {
  const el = h('input', { type: 'text', value: get(), ...attrs });
  el.addEventListener('input', () => {
    set(el.value);
    refresh();
  });
  return el;
}

function area(get: () => string, set: (v: string) => void, placeholder: string) {
  const el = h('textarea', {
    rows: 8,
    spellcheck: 'false',
    placeholder,
  }) as HTMLTextAreaElement;
  el.value = get();
  el.addEventListener('input', () => {
    set(el.value);
    refresh();
  });
  return el;
}

function render() {
  const d = state.draft;
  root.replaceChildren();
  const form = h(
    'div',
    { class: 'pack-editor' },
    h('h2', {}, 'Metadados'),
    h(
      'div',
      { class: 'grid' },
      field(
        'Id',
        textInput(
          () => d.id,
          (v) => {
            d.id = v;
          },
          { maxlength: 48 },
        ),
        'Letras minúsculas, números e "-" (3 a 48)',
      ),
      field(
        'Nome',
        textInput(
          () => d.namePt,
          (v) => {
            d.namePt = v;
          },
          { maxlength: 80 },
        ),
        'pt-BR (obrigatório)',
      ),
      field(
        'Nome em inglês',
        textInput(
          () => d.nameEn,
          (v) => {
            d.nameEn = v;
          },
          { maxlength: 80 },
        ),
        'Opcional',
      ),
      field(
        'Versão',
        textInput(
          () => d.version,
          (v) => {
            d.version = v;
          },
          { maxlength: 32 },
        ),
        'Semver (ex.: 1.0.0). Só sobe versão ao atualizar.',
      ),
      field(
        'Autor',
        textInput(
          () => d.author,
          (v) => {
            d.author = v;
          },
          { maxlength: 80 },
        ),
      ),
    ),
    h('h2', {}, 'Conteúdo (listas YAML)'),
    h(
      'p',
      { class: 'hint' },
      'Cole o YAML de cada editor (lista com ',
      h('code', {}, '- id:'),
      '). Deixe em branco o que não for usar. Pelo menos uma seção precisa ter itens.',
    ),
    field(
      'Trivia',
      area(
        () => d.triviaYaml,
        (v) => {
          d.triviaYaml = v;
        },
        '- id: minha-pergunta\n  category: geral\n  …',
      ),
      'Mesmo formato de editor-trivia / perguntas.yaml',
      true,
    ),
    field(
      'Missões',
      area(
        () => d.missionsYaml,
        (v) => {
          d.missionsYaml = v;
        },
        '- id: minha-missao\n  kind: daily\n  …',
      ),
      'Lista de missões (cada item no formato do editor de missões)',
      true,
    ),
    field(
      'Inimigos',
      area(
        () => d.enemiesYaml,
        (v) => {
          d.enemiesYaml = v;
        },
        '- id: meu-inimigo\n  name: …\n  tier: minion\n  …',
      ),
      'Mesmo formato de editor-inimigos / inimigos.yaml',
      true,
    ),
    field(
      'Itens',
      area(
        () => d.itemsYaml,
        (v) => {
          d.itemsYaml = v;
        },
        '- id: meu-item\n  slot: acessorio\n  …',
      ),
      'Mesmo formato de editor-itens / itens.yaml',
      true,
    ),
  );

  const fileInput = h('input', { type: 'file', accept: '.yaml,.yml', hidden: true });
  const open = h('button', { type: 'button', class: 'btn' }, 'Abrir arquivo');
  open.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = (fileInput as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      state.draft = fromYaml(await readFile(file));
      render();
    } catch (err) {
      showResult(out.parts, '', [(err as Error).message], '');
    }
    (fileInput as HTMLInputElement).value = '';
  });
  const clear = h('button', { type: 'button', class: 'btn' }, 'Limpar rascunho');
  clear.addEventListener('click', () => {
    state.draft = emptyPack();
    saved.clear();
    render();
  });

  root.append(
    h(
      'div',
      { class: 'editor-layout' },
      h('div', { class: 'editor-main' }, h('div', { class: 'actions' }, open, clear, fileInput), form),
      out.el,
    ),
  );

  out.parts.download.onclick = () => {
    if (validate(state.draft).length) return;
    download(PACK_FILE, toYaml(state.draft));
  };
  out.parts.copy.onclick = async () => {
    if (validate(state.draft).length) return;
    out.parts.status.textContent = (await copy(toYaml(state.draft))) ? 'Copiado.' : 'Não copiou.';
  };
  refresh();
}

render();
