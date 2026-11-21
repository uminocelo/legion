/** What a panel shows (api-contracts § v1.0). Values are plain data; core renders and escapes them. */
export type PanelView =
  | { kind: 'stats'; items: { labelKey: string; value: string | number }[] }
  | { kind: 'table'; columns: string[]; rows: (string | number)[][] };

export interface PanelSpec {
  /** URL segment: lowercase letters, digits and dashes. */
  id: string;
  /** i18n key of the panel title. */
  titleKey: string;
  render(): Promise<PanelView>;
}

/** The panel registration surface bots get as `ctx.dashboard`. */
export interface DashboardPanels {
  panel(spec: PanelSpec): void;
}

export interface RegisteredPanel extends PanelSpec {
  /** Owner: a bot id or `core`. */
  bot: string;
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Panels bots register for the staff dashboard (D22: bots describe, core renders). */
export class DashboardRegistry {
  private readonly byKey = new Map<string, RegisteredPanel>();

  panel(bot: string, spec: PanelSpec): void {
    if (!ID.test(spec.id)) throw new Error(`invalid dashboard panel id "${spec.id}"`);
    const key = `${bot}/${spec.id}`;
    if (this.byKey.has(key)) throw new Error(`dashboard panel "${key}" is already registered`);
    this.byKey.set(key, { ...spec, bot });
  }

  /** Registration handle bound to one owner. */
  forBot(bot: string): DashboardPanels {
    return { panel: (spec) => this.panel(bot, spec) };
  }

  get(bot: string, id: string): RegisteredPanel | undefined {
    return this.byKey.get(`${bot}/${id}`);
  }

  /** Core panels first, then bots, in registration order. */
  list(): RegisteredPanel[] {
    const all = [...this.byKey.values()];
    return [...all.filter((p) => p.bot === 'core'), ...all.filter((p) => p.bot !== 'core')];
  }
}
