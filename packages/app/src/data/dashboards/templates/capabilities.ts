import type { DashboardTemplate, RequirementKind } from "./types";
import { REQUIREMENT_KINDS } from "./types";

/**
 * Per-bucket cap on the discovery scan. Attribute and metric names are
 * low-cardinality in practice, so this shows effectively all of them while
 * keeping one runaway map from crowding out the other buckets.
 */
const CAPABILITY_NAMES_LIMIT = 500;

/**
 * What the Organization is actually sending in the probed time range, one list
 * per requirement kind. Keyed by the kind a requirement states rather than by
 * hand-named fields, so a new kind is one entry in `REQUIREMENT_KINDS` and
 * nothing else.
 */
export type TelemetryCapabilities = Record<RequirementKind, string[]>;

const byKind = (
  names: (kind: RequirementKind) => string[],
): TelemetryCapabilities =>
  Object.fromEntries(
    REQUIREMENT_KINDS.map((kind) => [kind, names(kind)]),
  ) as TelemetryCapabilities;

export const EMPTY_CAPABILITIES: TelemetryCapabilities = byKind(() => []);

export interface CapabilityRow {
  kind: string;
  name: string;
}

/**
 * One scan per bucket, unioned into `(kind, name)` rows.
 *
 * Signals are probed with `LIMIT 1` rather than a count: existence is the whole
 * question, and the limit lets ClickHouse stop at the first matching granule
 * instead of reading the range. The name scans follow the shape of the
 * explorer's attribute discovery (`buildAttributeKeysQuery`), including its
 * per-source cap and its per-column time-bound parsing.
 *
 * `{from}`/`{to}` are the same bound parameters every panel query gets, so the
 * probe and the previews it grades always look at one identical window.
 */
export function buildCapabilitiesQuery(): string {
  // The bounds arrive as one ClickHouse datetime string with milliseconds, but
  // the columns differ: `Timestamp`/`TimeUnix` are DateTime64(9) and accept it,
  // while `logs.TimestampTime` is a plain DateTime and rejects the fraction
  // outright. Parse each bound to the column's own type rather than leaning on
  // implicit comparison, which is what the explorer's discovery does too.
  const dt64 = (bound: string) =>
    `parseDateTime64BestEffort({${bound}:String}, 9)`;
  const dt = (bound: string) => `parseDateTimeBestEffort({${bound}:String})`;

  const withinTraces = `Timestamp >= ${dt64("from")} AND Timestamp <= ${dt64("to")}`;
  const withinLogs = `TimestampTime >= ${dt("from")} AND TimestampTime <= ${dt("to")}`;
  const withinMetrics = `TimeUnix >= ${dt64("from")} AND TimeUnix <= ${dt64("to")}`;

  // `toString` on every name is load-bearing: attribute keys come out of a
  // Map(LowCardinality(String), …) while metric names and the signal literals
  // are plain String, and the union rejects the mix with a TYPE_MISMATCH.
  const names = (kind: RequirementKind, expression: string, source: string) => `
    SELECT '${kind}' AS kind, name FROM (
      SELECT DISTINCT toString(${expression}) AS name FROM ${source}
    )
    WHERE name != ''
    ORDER BY name
    LIMIT ${CAPABILITY_NAMES_LIMIT}`;

  const signal = (name: string, source: string, within: string) => `
    SELECT 'signal' AS kind, '${name}' AS name
    FROM ${source} WHERE ${within} LIMIT 1`;

  // `DISTINCT` inside each branch, not only on the union: `MetricName` is
  // LowCardinality over a handful of values, so deduplicating per table merges
  // three small sets instead of piping every metric row through the union.
  const metricSources = ["metrics_gauge", "metrics_sum", "metrics_histogram"]
    .map(
      (table) =>
        `SELECT DISTINCT MetricName FROM ${table} WHERE ${withinMetrics}`,
    )
    .join(" UNION ALL ");

  return `SELECT kind, name FROM (${[
    signal("traces", "traces", withinTraces),
    signal("logs", "logs", withinLogs),
    signal("metrics", "metrics_gauge", withinMetrics),
    signal("metrics", "metrics_sum", withinMetrics),
    signal("metrics", "metrics_histogram", withinMetrics),
    names(
      "span-attribute",
      "arrayJoin(mapKeys(SpanAttributes))",
      `(SELECT SpanAttributes FROM traces WHERE ${withinTraces})`,
    ),
    names(
      "log-attribute",
      "arrayJoin(mapKeys(LogAttributes))",
      `(SELECT LogAttributes FROM logs WHERE ${withinLogs})`,
    ),
    names("metric", "MetricName", `(${metricSources})`),
  ].join("\n  UNION ALL\n")}\n)`;
}

export function decodeCapabilityRows(
  rows: CapabilityRow[],
): TelemetryCapabilities {
  return byKind((kind) =>
    [...new Set(rows.filter((r) => r.kind === kind).map((r) => r.name))].sort(),
  );
}

/**
 * Prefix match, not substring: `"redis."` matches `redis.commands` but never
 * `myredis.x`, and a match written without a trailing dot ("http.route") also
 * accepts the namespace below it. Substring matching would let `db.` claim
 * credit for `everr.db_nothing`.
 */
function matches(name: string, prefix: string): boolean {
  if (name === prefix) return true;
  if (prefix.endsWith(".")) return name.startsWith(prefix);
  return name.startsWith(`${prefix}.`);
}

export type TemplateReadiness =
  | { status: "ready" }
  | { status: "needs-setup"; missing: string[] };

/**
 * Grade one template against the probe. Ready means every requirement is met,
 * which is a claim about the same time range the preview renders — so a ready
 * template whose preview is empty is a contradiction the UI never has to
 * explain away.
 */
export function evaluateTemplate(
  template: DashboardTemplate,
  capabilities: TelemetryCapabilities,
): TemplateReadiness {
  const missing: string[] = [];
  for (const requirement of template.requires) {
    const available = capabilities[requirement.kind] ?? [];
    if (!available.some((name) => matches(name, requirement.match))) {
      missing.push(requirement.label);
    }
  }
  // Deduplicated: two requirements can share a label ("traces") when they probe
  // different buckets, and the gallery shows the reason once.
  return missing.length === 0
    ? { status: "ready" }
    : { status: "needs-setup", missing: [...new Set(missing)] };
}
