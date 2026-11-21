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

export type FieldType = 'text' | 'int' | 'member' | 'select' | 'datetime';

/** One form field of a dashboard action (api-contracts § v1.0). */
export interface FieldSpec {
  name: string;
  type: FieldType;
  labelKey: string;
  required?: boolean;
  /** `int`: bounds; `text`: length bounds. */
  min?: number;
  max?: number;
  /** `select`: allowed values (label = i18n key `labelKey` of the option, or the value). */
  options?: { value: string; labelKey?: string }[];
}

/** Parsed input: `int` → number, `datetime` → ISO (UTC), others → string; empty optional → null. */
export type ActionInput = Record<string, string | number | null>;

export interface ActionActor {
  discordUserId: string;
  name: string;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

export interface ActionSpec {
  id: string;
  titleKey: string;
  fields: FieldSpec[];
  /** Calls the same service as the slash command; `message` is shown to staff. */
  run(input: ActionInput, actor: ActionActor): Promise<ActionResult>;
}

/** The registration surface bots get as `ctx.dashboard`. */
export interface DashboardPanels {
  panel(spec: PanelSpec): void;
  action(spec: ActionSpec): void;
}

export interface RegisteredAction extends ActionSpec {
  bot: string;
}

export interface RegisteredPanel extends PanelSpec {
  /** Owner: a bot id or `core`. */
  bot: string;
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Panels bots register for the staff dashboard (D22: bots describe, core renders). */
export class DashboardRegistry {
  private readonly byKey = new Map<string, RegisteredPanel>();
  private readonly actions = new Map<string, RegisteredAction>();

  action(bot: string, spec: ActionSpec): void {
    if (!ID.test(spec.id)) throw new Error(`invalid dashboard action id "${spec.id}"`);
    const key = `${bot}/${spec.id}`;
    if (this.actions.has(key)) throw new Error(`dashboard action "${key}" is already registered`);
    const names = new Set<string>();
    for (const f of spec.fields) {
      if (!/^[a-z][a-zA-Z0-9_]*$/.test(f.name) || names.has(f.name) || ['csrf', 'idem'].includes(f.name))
        throw new Error(`dashboard action "${key}": bad field name "${f.name}"`);
      if (f.type === 'select' && !f.options?.length)
        throw new Error(`dashboard action "${key}": select "${f.name}" has no options`);
      names.add(f.name);
    }
    this.actions.set(key, { ...spec, bot });
  }

  getAction(bot: string, id: string): RegisteredAction | undefined {
    return this.actions.get(`${bot}/${id}`);
  }

  listActions(): RegisteredAction[] {
    return [...this.actions.values()];
  }

  panel(bot: string, spec: PanelSpec): void {
    if (!ID.test(spec.id)) throw new Error(`invalid dashboard panel id "${spec.id}"`);
    const key = `${bot}/${spec.id}`;
    if (this.byKey.has(key)) throw new Error(`dashboard panel "${key}" is already registered`);
    this.byKey.set(key, { ...spec, bot });
  }

  /** Registration handle bound to one owner. */
  forBot(bot: string): DashboardPanels {
    return { panel: (spec) => this.panel(bot, spec), action: (spec) => this.action(bot, spec) };
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
