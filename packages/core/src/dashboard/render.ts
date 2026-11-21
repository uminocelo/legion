import { escapeHtml } from './http.js';
import type { PanelView } from './registry.js';

/** Formats numbers in the server locale; everything else as text. Always escaped. */
export function cell(v: string | number, locale: string): string {
  return escapeHtml(typeof v === 'number' ? new Intl.NumberFormat(locale).format(v) : v);
}

/** HTML for one panel view. `t` translates stat labels. No scripts, no inline styles. */
export function renderPanelView(view: PanelView, t: (key: string) => string, locale: string): string {
  if (view.kind === 'stats')
    return `<dl class="stats">${view.items
      .map((i) => `<div><dt>${escapeHtml(t(i.labelKey))}</dt><dd>${cell(i.value, locale)}</dd></div>`)
      .join('')}</dl>`;
  const head = view.columns.map((c) => `<th scope="col">${escapeHtml(c)}</th>`).join('');
  const body = view.rows
    .map(
      (r) =>
        `<tr>${r.map((v) => `<td${typeof v === 'number' ? ' class="num"' : ''}>${cell(v, locale)}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Served as `/assets/dashboard.css` (the CSP forbids inline styles). Mobile first, works at 375 px. */
export const DASHBOARD_CSS = `
:root{color-scheme:light dark;--bg:#f6f7f9;--fg:#1b1f24;--muted:#5b6472;--card:#fff;--line:#dde1e6;--accent:#3b5bdb}
@media (prefers-color-scheme:dark){:root{--bg:#14171b;--fg:#e8eaed;--muted:#9aa3ad;--card:#1d2126;--line:#2e343b;--accent:#8ea2ff}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent)}
header{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--card)}
header p{margin:0;color:var(--muted)}
header form{margin:0}
button{font:inherit;padding:6px 12px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);cursor:pointer}
nav ul{display:flex;flex-wrap:wrap;gap:4px 12px;list-style:none;margin:0;padding:8px 16px;border-bottom:1px solid var(--line)}
nav a[aria-current=page]{font-weight:600;text-decoration:none;color:var(--fg)}
main{max-width:960px;margin:0 auto;padding:16px}
h1{font-size:1.4rem;margin:0 0 12px}
h2{font-size:1.1rem;margin:0 0 8px}
section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 16px;margin:0 0 16px}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin:0}
.stats div{min-width:0}.stats dt{color:var(--muted);font-size:.85rem}.stats dd{margin:0;font-size:1.3rem;font-weight:600}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
th{color:var(--muted);font-weight:600;font-size:.85rem}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.muted{color:var(--muted)}
.pager{display:flex;gap:16px;margin-top:12px}
`;
