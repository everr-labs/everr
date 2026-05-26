/** Recursive JSON-serializable value type for Perses plugin specs. */
export type PluginSpecValue =
  | string
  | number
  | boolean
  | null
  | PluginSpecValue[]
  | { [key: string]: PluginSpecValue };

export interface DashboardDisplay {
  name?: string;
  description?: string;
}

export interface PanelPlugin {
  kind: string;
  spec: Record<string, PluginSpecValue>;
}

export interface QueryPlugin {
  kind: string;
  spec: Record<string, PluginSpecValue>;
}

export interface PanelQuery {
  kind: string;
  spec: {
    plugin: QueryPlugin;
  };
}

export interface Panel {
  kind: "Panel";
  spec: {
    display: DashboardDisplay;
    plugin: PanelPlugin;
    queries?: PanelQuery[];
  };
}

export interface GridItemContent {
  $ref: string;
}

export interface GridItem {
  x: number;
  y: number;
  width: number;
  height: number;
  content: GridItemContent;
}

export interface GridLayoutDisplay {
  title?: string;
  collapse?: { open: boolean };
}

export interface GridLayout {
  kind: "Grid";
  spec: {
    display?: GridLayoutDisplay;
    items: GridItem[];
  };
}

export interface DatasourceSpec {
  default: boolean;
  plugin: {
    kind: string;
    spec: Record<string, PluginSpecValue>;
  };
}

export interface TextVariable {
  kind: "TextVariable";
  spec: {
    name: string;
    display?: DashboardDisplay & { hidden?: boolean };
    value: string;
    constant?: boolean;
  };
}

export interface ListVariable {
  kind: "ListVariable";
  spec: {
    name: string;
    display?: DashboardDisplay & { hidden?: boolean };
    defaultValue?: string | string[];
    allowAllValue?: boolean;
    allowMultiple?: boolean;
    customAllValue?: string;
    capturingRegexp?: string;
    sort?:
      | "none"
      | "alphabetical-asc"
      | "alphabetical-desc"
      | "numerical-asc"
      | "numerical-desc"
      | "alphabetical-ci-asc"
      | "alphabetical-ci-desc";
    plugin: { kind: string; spec: Record<string, PluginSpecValue> };
  };
}

export type Variable = TextVariable | ListVariable;

export interface DashboardSpec {
  display?: DashboardDisplay;
  datasources?: Record<string, DatasourceSpec>;
  variables?: Variable[];
  panels: Record<string, Panel>;
  layouts: GridLayout[];
  duration?: string;
  refreshInterval?: string;
}

export interface DashboardMetadata {
  name: string;
}

export interface Dashboard {
  kind: "Dashboard";
  metadata: DashboardMetadata;
  spec: DashboardSpec;
}
