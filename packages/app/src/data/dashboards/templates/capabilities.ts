import type { DashboardTemplate, RequirementKind } from "./types";

/**
 * Per-bucket cap on the discovery scan. Attribute and metric names are
 * low-cardinality in practice, so this shows effectively all of them while
 * keeping one runaway map from crowding out the other buckets.
 */
const CAPABILITY_NAMES_LIMIT = 500;

/** What the Organization is actually sending in the probed time range. */
export interface TelemetryCapabilities {
  signals: string[];
  spanAttributeKeys: string[];
  resourceAttributeKeys: string[];
  logAttributeKeys: string[];
  metricNames: string[];
}

export const EMPTY_CAPABILITIES: TelemetryCapabilities = {
  signals: [],
  spanAttributeKeys: [],
  resourceAttributeKeys: [],
  logAttributeKeys: [],
  metricNames: [],
};

export interface CapabilityRow {
  kind: string;
  name: string;
}

/**
 * One scan per bucket, unioned into `(kind, name)` rows.
 *
 * Signals are probed with `LIMIT 1` rather than a count: existence is the whole
 * question, and the limit lets ClickHouse stop at the first matching granule
 * instead of reading the range. The name scans mirror the explorer's attribute
 * discovery (`buildAttributeKeysQuery`) so the two never disagree about what an
 * Organization has.
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

  const metricSources = ["metrics_gauge", "metrics_sum", "metrics_histogram"]
    .map((table) => `SELECT MetricName FROM ${table} WHERE ${withinMetrics}`)
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
      "resource-attribute",
      "arrayJoin(mapKeys(ResourceAttributes))",
      `(SELECT ResourceAttributes FROM traces WHERE ${withinTraces})`,
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
  const bucket: Record<string, Set<string>> = {
    signal: new Set(),
    "span-attribute": new Set(),
    "resource-attribute": new Set(),
    "log-attribute": new Set(),
    metric: new Set(),
  };
  for (const row of rows) bucket[row.kind]?.add(row.name);
  const list = (kind: string) => [...(bucket[kind] ?? [])].sort();
  return {
    signals: list("signal"),
    spanAttributeKeys: list("span-attribute"),
    resourceAttributeKeys: list("resource-attribute"),
    logAttributeKeys: list("log-attribute"),
    metricNames: list("metric"),
  };
}

function namesFor(
  capabilities: TelemetryCapabilities,
  kind: RequirementKind,
): string[] {
  switch (kind) {
    case "signal":
      return capabilities.signals;
    case "span-attribute":
      return capabilities.spanAttributeKeys;
    case "resource-attribute":
      return capabilities.resourceAttributeKeys;
    case "log-attribute":
      return capabilities.logAttributeKeys;
    case "metric":
      return capabilities.metricNames;
  }
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
    const available = namesFor(capabilities, requirement.kind);
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
