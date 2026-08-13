import type { Dashboard } from "../schema";

/** Shelf a template sits on in the gallery. Ordered as declared here. */
export const TEMPLATE_CATEGORIES = [
  "Application",
  "Runtime",
  "Databases",
  "Infrastructure",
  "Browser",
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

/**
 * The kinds of telemetry a requirement can look for. Each is one bucket of
 * `TelemetryCapabilities` and one scan in the probe, so adding a kind here is
 * the single place that has to change — and a kind no template states still
 * costs a ClickHouse scan on every gallery load, so none are declared
 * speculatively.
 */
export const REQUIREMENT_KINDS = [
  "signal",
  "span-attribute",
  "log-attribute",
  "metric",
] as const;

export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

/**
 * One thing the Organization must already be sending for a template to render
 * anything. `match` is a prefix: `"redis."` matches every `redis.*` key, and a
 * key with no trailing dot matches that key exactly or as a namespace root.
 *
 * `label` is what the gallery shows when the requirement is unmet, so it is
 * written the way an engineer would grep for it ("redis.*", "traces").
 */
export interface TemplateRequirement {
  kind: RequirementKind;
  match: string;
  label: string;
}

export interface DashboardTemplate {
  /** Stable id. Doubles as the default slug of the created Dashboard. */
  id: string;
  name: string;
  /** One or two sentences. Shown under the title in the preview pane. */
  description: string;
  category: TemplateCategory;
  /**
   * Every requirement must be met for the template to count as ready. An empty
   * list means the template needs nothing beyond an Organization that exists.
   */
  requires: TemplateRequirement[];
  document: Dashboard;
}
