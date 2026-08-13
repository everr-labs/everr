import type {
  GridItem,
  GridLayout,
  Panel,
  PanelQuery,
  PluginSpecValue,
} from "../schema";
import { GRID_COLS, PANEL_REF_PREFIX } from "../schema";

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
 * A row of panels sharing one height. Laying rows out this way (rather than
 * hand-written x/y) keeps every template's grid arithmetic correct by
 * construction — the read-only grid uses no compactor, so a wrong y leaves a
 * visible hole.
 */
interface Row {
  height: number;
  panels: string[];
}

/** A row whose panels divide the grid evenly, remainder absorbed on the left. */
export const split = (height: number, ...panels: string[]): Row => ({
  height,
  panels,
});

export function layout(rows: Row[]): GridLayout[] {
  const items: GridItem[] = [];
  let y = 0;
  for (const { height, panels } of rows) {
    const base = Math.floor(GRID_COLS / panels.length);
    const extra = GRID_COLS - base * panels.length;
    let x = 0;
    for (const [index, panel] of panels.entries()) {
      const width = base + (index < extra ? 1 : 0);
      items.push({
        x,
        y,
        width,
        height,
        content: { $ref: `${PANEL_REF_PREFIX}${panel}` },
      });
      x += width;
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
