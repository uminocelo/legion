import { escapeHtml } from './http.js';
import type { ActionInput, FieldSpec, RegisteredAction } from './registry.js';

const SNOWFLAKE = /^\d{5,25}$/;
const LOCAL_DT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const TEXT_MAX = 2000;

/** Offset (ms) of `timeZone` from UTC at instant `at`. */
function offsetAt(at: number, timeZone: string): number {
  const parts: Record<string, string> = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  const n = (k: string) => Number(parts[k] ?? 0);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** `YYYY-MM-DDTHH:mm` read in `timeZone` → ISO (UTC), or null when invalid. */
export function zonedLocalToIso(local: string, timeZone: string): string | null {
  const m = LOCAL_DT.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(naive);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) return null;
  let at = naive - offsetAt(naive, timeZone);
  at = naive - offsetAt(at, timeZone);
  return new Date(at).toISOString();
}

export type FieldErrors = Record<string, string>;

/**
 * Validates raw form values against the fields. Error values are i18n keys under
 * `core.dashboard.field_errors.*`.
 */
export function parseActionInput(
  fields: FieldSpec[],
  form: URLSearchParams,
  timeZone: string,
): { input: ActionInput; errors: FieldErrors } {
  const input: ActionInput = {};
  const errors: FieldErrors = {};
  for (const f of fields) {
    const raw = (form.get(f.name) ?? '').trim();
    if (!raw) {
      if (f.required) errors[f.name] = 'required';
      input[f.name] = null;
      continue;
    }
    switch (f.type) {
      case 'int': {
        if (!/^-?\d+$/.test(raw)) {
          errors[f.name] = 'int';
          break;
        }
        const n = Number(raw);
        if (
          !Number.isSafeInteger(n) ||
          (f.min !== undefined && n < f.min) ||
          (f.max !== undefined && n > f.max)
        )
          errors[f.name] = 'range';
        else input[f.name] = n;
        break;
      }
      case 'member': {
        const id = /^<@!?(\d+)>$/.exec(raw)?.[1] ?? raw;
        if (!SNOWFLAKE.test(id)) errors[f.name] = 'member';
        else input[f.name] = id;
        break;
      }
      case 'select':
        if (!f.options?.some((o) => o.value === raw)) errors[f.name] = 'select';
        else input[f.name] = raw;
        break;
      case 'datetime': {
        const iso = zonedLocalToIso(raw, timeZone);
        if (!iso) errors[f.name] = 'datetime';
        else input[f.name] = iso;
        break;
      }
      default: {
        const max = Math.min(f.max ?? TEXT_MAX, TEXT_MAX);
        if (raw.length > max || (f.min !== undefined && raw.length < f.min)) errors[f.name] = 'length';
        else input[f.name] = raw;
      }
    }
  }
  return { input, errors };
}

export interface FormRender {
  action: RegisteredAction;
  csrf: string;
  idem: string;
  values: URLSearchParams;
  errors: FieldErrors;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

/** The action form: one labelled input per field, its error under it, hidden CSRF and idempotency key. */
export function renderActionForm(o: FormRender): string {
  const fields = o.action.fields
    .map((f) => {
      const id = `f-${f.name}`;
      const value = o.values.get(f.name) ?? '';
      const err = o.errors[f.name];
      const req = f.required ? ' required' : '';
      const described = err ? ` aria-invalid="true" aria-describedby="${id}-err"` : '';
      const common = `id="${id}" name="${escapeHtml(f.name)}"${req}${described}`;
      let control: string;
      if (f.type === 'select')
        control = `<select ${common}>${f.required ? '' : '<option value=""></option>'}${(f.options ?? [])
          .map(
            (op) =>
              `<option value="${escapeHtml(op.value)}"${op.value === value ? ' selected' : ''}>${escapeHtml(op.labelKey ? o.t(op.labelKey) : op.value)}</option>`,
          )
          .join('')}</select>`;
      else {
        const type = f.type === 'int' ? 'number' : f.type === 'datetime' ? 'datetime-local' : 'text';
        const bounds =
          f.type === 'int'
            ? `${f.min !== undefined ? ` min="${f.min}"` : ''}${f.max !== undefined ? ` max="${f.max}"` : ''} step="1"`
            : f.type === 'text'
              ? ` maxlength="${Math.min(f.max ?? TEXT_MAX, TEXT_MAX)}"`
              : f.type === 'member'
                ? ' inputmode="numeric" autocomplete="off"'
                : '';
        control = `<input type="${type}" ${common} value="${escapeHtml(value)}"${bounds}>`;
      }
      const hint =
        f.type === 'member'
          ? `<small class="muted">${escapeHtml(o.t('core.dashboard.member_hint'))}</small>`
          : '';
      const error = err
        ? `<p class="field-error" id="${id}-err">${escapeHtml(o.t(`core.dashboard.field_errors.${err}`, { min: f.min ?? '', max: f.max ?? '' }))}</p>`
        : '';
      return `<div class="field"><label for="${id}">${escapeHtml(o.t(f.labelKey))}</label>${control}${hint}${error}</div>`;
    })
    .join('');
  return `<form method="post" class="action"><input type="hidden" name="csrf" value="${escapeHtml(o.csrf)}"><input type="hidden" name="idem" value="${escapeHtml(o.idem)}">${fields}<button type="submit">${escapeHtml(o.t('core.dashboard.run'))}</button></form>`;
}
