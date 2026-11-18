// Small DOM helpers shared by the editors. Everything stays in the browser.

export type Attrs = Record<string, string | number | boolean | undefined | null>;

/** Creates an element: `h('input', { type: 'text', value: 'x' })`. Booleans toggle attributes. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'value' && 'value' in el) (el as HTMLInputElement).value = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** Drafts kept in this browser only; storage can be unavailable (private mode), so never required. */
export function store<T>(key: string) {
  return {
    load(): T | null {
      try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
      } catch {
        return null;
      }
    },
    save(value: T) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Not saved; the page keeps working.
      }
    },
    clear() {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
    },
  };
}

export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/yaml;charset=utf-8' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Reads a file the user picked. */
export const readFile = (file: File) => file.text();

/** A labelled field wrapper. */
export const field = (label: string, input: HTMLElement, hint?: string, wide = false) =>
  h(
    'label',
    { class: wide ? 'f wide' : 'f' },
    h('span', {}, label),
    input,
    hint ? h('small', {}, hint) : null,
  );

export interface OutputParts {
  errors: HTMLElement;
  preview: HTMLElement;
  download: HTMLButtonElement;
  copy: HTMLButtonElement;
  status: HTMLElement;
}

/** The right-hand panel: errors, YAML preview, Download / Copy and the import command. */
export function outputPanel(command: string, fileName: string): { el: HTMLElement; parts: OutputParts } {
  const errors = h('div', { class: 'errs', role: 'status', 'aria-live': 'polite' });
  const preview = h('pre', { class: 'yaml' });
  const dl = h('button', { type: 'button', class: 'btn primary' }, `Baixar ${fileName}`);
  const cp = h('button', { type: 'button', class: 'btn' }, 'Copiar');
  const status = h('span', { class: 'copied', role: 'status' });
  const el = h(
    'aside',
    { class: 'out' },
    h('h2', {}, 'Arquivo'),
    errors,
    h('div', { class: 'actions' }, dl, cp, status),
    h(
      'ol',
      { class: 'howto' },
      h('li', {}, 'Baixe o arquivo.'),
      h('li', {}, 'No seu servidor, rode ', h('code', {}, command), ' e anexe o arquivo.'),
      h('li', {}, 'Confira a prévia e clique em ', h('strong', {}, 'Publicar'), '.'),
    ),
    h('details', {}, h('summary', { class: 'yaml-toggle' }, 'Ver o YAML'), preview),
  );
  return { el, parts: { errors, preview, download: dl, copy: cp, status } };
}

/** Shows errors (or the ok line) and enables Download / Copy only for a valid file. */
export function showResult(p: OutputParts, yaml: string, errors: string[], okLine: string) {
  p.preview.textContent = yaml;
  p.errors.replaceChildren(
    errors.length
      ? h(
          'div',
          { class: 'bad' },
          h('strong', {}, `${errors.length} problema(s) para corrigir:`),
          // The file name is the same on every line; the bot shows it, the editor does not need to.
          h('ul', {}, ...errors.slice(0, 30).map((e) => h('li', {}, e.replace(/^[^→:]+ → /, '')))),
        )
      : h('div', { class: 'ok' }, `✓ ${okLine}`),
  );
  p.download.disabled = errors.length > 0;
  p.copy.disabled = errors.length > 0;
}
