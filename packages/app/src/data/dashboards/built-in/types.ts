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
 * to a name within that signal — an attribute key for traces and logs, a
 * metric name for metrics — and omitting `match` asks only that the signal
 * exists at all.
 *
 * `match` is a prefix: `"redis."` matches every `redis.*` name, and a match
 * with no trailing dot matches that name exactly or as a namespace root.
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
