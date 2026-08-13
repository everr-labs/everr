import type {
  GridItem,
  GridLayout,
  Panel,
  PanelQuery,
  PluginSpecValue,
} from "../schema";
import { PANEL_REF_PREFIX } from "../schema";

/** Grid width every layout is measured in, matching DashboardGrid's GRID_COLS. */
const GRID_COLS = 24;

type Options = Record<string, PluginSpecValue>;

function clickHouseQuery(query: string): PanelQuery {
  return {
    kind: "ClickHouseSQL",
    spec: { plugin: { kind: "ClickHouseSQL", spec: { query } } },
  };
}

/**
 * Panel constructors. Templates are authored in TypeScript rather than YAML so
 * a mistyped visualization option or a dangling panel ref fails the build
 * instead of the render: the catalog ships inside the app, where there is no
 * `everr apply` to validate it on the way in.
 */
function panel(
  kind: string,
  name: string,
  options: Options,
  query: string,
  description?: string,
): Panel {
  return {
    kind: "Panel",
    spec: {
      display: description ? { name, description } : { name },
      plugin: { kind, spec: options },
      queries: [clickHouseQuery(query)],
    },
  };
}

export const stat = (
  name: string,
  options: Options,
  query: string,
  description?: string,
) => panel("StatChart", name, options, query, description);

export const timeSeries = (
  name: string,
  options: Options,
  query: string,
  description?: string,
) => panel("TimeSeriesChart", name, options, query, description);

export const table = (name: string, query: string, description?: string) =>
  panel("Table", name, { stickyHeader: true }, query, description);

/**
 * A row of panels: keys plus their widths in grid columns, and one shared
 * height. Laying rows out this way (rather than hand-written x/y) keeps every
 * template's grid arithmetic correct by construction — the read-only grid uses
 * no compactor, so a wrong y leaves a visible hole.
 */
export interface Row {
  height: number;
  cells: Array<{ panel: string; width: number }>;
}

/** Evenly split a row across its panels, absorbing the remainder on the left. */
export const split = (height: number, ...panels: string[]): Row => {
  const base = Math.floor(GRID_COLS / panels.length);
  const extra = GRID_COLS - base * panels.length;
  return {
    height,
    cells: panels.map((p, i) => ({
      panel: p,
      width: base + (i < extra ? 1 : 0),
    })),
  };
};

export function layout(rows: Row[]): GridLayout[] {
  const items: GridItem[] = [];
  let y = 0;
  for (const { height, cells } of rows) {
    let x = 0;
    for (const cell of cells) {
      items.push({
        x,
        y,
        width: cell.width,
        height,
        content: { $ref: `${PANEL_REF_PREFIX}${cell.panel}` },
      });
      x += cell.width;
    }
    y += height;
  }
  return [{ kind: "Grid", spec: { items } }];
}

/** Green under the first step, amber, then red. Used by rate/latency tiles. */
export const thresholds = (warn: number, bad: number) => ({
  mode: "absolute" as const,
  defaultColor: "#22c55e",
  steps: [
    { value: warn, color: "#f59e0b" },
    { value: bad, color: "#ef4444" },
  ],
});
