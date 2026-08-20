import type { Dashboard } from "../schema";

/** Shelf a built-in sits on in the list. Ordered as declared here. */
export const BUILTIN_CATEGORIES = [
  "Application",
  "Runtime",
  "Databases",
  "Infrastructure",
  "Browser",
] as const;

export type BuiltinCategory = (typeof BUILTIN_CATEGORIES)[number];

/**
 * The signals a requirement can look at. Each is one bucket of
 * `TelemetryCapabilities` and one existence-plus-names scan in the probe, so
 * adding a signal here is the single place that has to change — and a signal
 * no built-in states still costs a ClickHouse scan on every list load, so none
 * are declared speculatively.
 */
export const SIGNALS = ["traces", "logs", "metrics"] as const;

export type Signal = (typeof SIGNALS)[number];

/**
 * One thing the Organization must already be sending for a built-in to render
 * anything. Every requirement names the signal it looks at; `match` narrows it
 * to a name within that signal, and omitting `match` asks only that the signal
 * exists at all.
 *
 * For traces and logs, `match` is an EXACT attribute key ("faas.trigger");
 * prefixes are rejected because only an exact key can use the attribute-key
 * bloom filter index. For metrics, `match` is a name prefix written with a
 * trailing dot ("redis." matches every `redis.*` metric), which `MetricName`
 * in the ORDER BY prunes; a dotless metric match also accepts the exact name.
 *
 * `label` is what the list shows when the requirement is unmet, so it is
 * written the way an engineer would grep for it ("redis.*", "traces").
 */
export interface BuiltinRequirement {
  signal: Signal;
  match?: string;
  label: string;
}

export interface BuiltinDashboard {
  /** Stable id. Doubles as the slug in `/dashboards/built-in/$slug`. */
  id: string;
  name: string;
  /** One or two sentences. Shown under the title in the detail pane. */
  description: string;
  category: BuiltinCategory;
  /**
   * Every requirement must be met for the built-in to count as ready. An empty
   * list means the built-in needs nothing beyond an Organization that exists.
   */
  requires: BuiltinRequirement[];
  document: Dashboard;
}
