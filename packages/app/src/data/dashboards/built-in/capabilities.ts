import type { BuiltinDashboard, Signal } from "./types";
import { SIGNALS } from "./types";

/**
 * Per-signal cap on the discovery scan. Attribute and metric names are
 * low-cardinality in practice, so this shows effectively all of them while
 * keeping one runaway map from crowding out the other signals.
 */
const CAPABILITY_NAMES_LIMIT = 500;

/**
 * Every metric table the tenant can read, not the three the probe used to scan.
 * An Organization whose metrics are Summary- or ExponentialHistogram-typed was
 * told it had no metrics at all while its previews drew fine, which inverts the
 * one promise the probe makes. The `awscloudwatch` receiver emits Summary by
 * default, so this was reachable, not hypothetical.
 *
 * All five share `MetricName` and `TimeUnix`, and each added branch costs one
 * `DISTINCT` over a LowCardinality column on a table that is empty for every
 * Organization not sending that type.
 *
 * Written out rather than filtered from `SQL_API_TENANT_TABLES`: this module is
 * imported by the dashboards list component, and `lib/clickhouse` would drag
 * the server env and `node:crypto` into the client bundle.
 * `capabilities.test.ts` pins the same five names (it cannot import the real
 * list either, for the same reason), so a drift shows up as a failing probe
 * assertion rather than silently.
 */
const METRIC_TABLES = [
  "metrics_gauge",
  "metrics_sum",
  "metrics_histogram",
  "metrics_exponential_histogram",
  "metrics_summary",
] as const;

/**
 * What one signal offers in the probed time range: whether it exists at all,
 * and the names a `match` can select within it — attribute keys for traces and
 * logs, metric names for metrics.
 */
export interface SignalCapability {
  present: boolean;
  names: string[];
}

/**
 * What the Organization is actually sending in the probed time range, keyed by
 * the signal a requirement states, so a new signal is one entry in `SIGNALS`
 * and nothing else.
 */
export type TelemetryCapabilities = Record<Signal, SignalCapability>;

const bySignal = (
  capability: (signal: Signal) => SignalCapability,
): TelemetryCapabilities =>
  Object.fromEntries(
    SIGNALS.map((signal) => [signal, capability(signal)]),
  ) as TelemetryCapabilities;

export const EMPTY_CAPABILITIES: TelemetryCapabilities = bySignal(() => ({
  present: false,
  names: [],
}));

export interface CapabilityRow {
  signal: string;
  name: string;
}

/**
 * One scan per signal, unioned into `(signal, name)` rows. A row with an empty
 * name marks bare existence; a row with a name is one selectable name within
 * the signal.
 *
 * `traces` and `logs` are probed for existence with `LIMIT 1` rather than a
 * count: existence is the whole question, and the limit lets ClickHouse stop at
 * the first matching granule instead of reading the range. `metrics` has no
 * existence probe of its own; a stored data point always has a name, so the
 * metric-name scan already answers the question. The name scans follow the
 * shape of the explorer's attribute discovery (`buildAttributeKeysQuery`),
 * including its per-source cap and its per-column time-bound parsing.
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
  // Map(LowCardinality(String), …) while metric names and the literals are
  // plain String, and the union rejects the mix with a TYPE_MISMATCH.
  const names = (signal: Signal, distinctNames: string) => `
    SELECT '${signal}' AS signal, name FROM (${distinctNames})
    WHERE name != ''
    ORDER BY name
    LIMIT ${CAPABILITY_NAMES_LIMIT}`;

  const exists = (signal: Signal, source: string, within: string) => `
    SELECT '${signal}' AS signal, '' AS name
    FROM ${source} WHERE ${within} LIMIT 1`;

  // `DISTINCT` inside each branch, not only on the union: `MetricName` is
  // LowCardinality over a handful of values, so deduplicating per table merges
  // small sets instead of piping every metric row through the union.
  const metricNames = METRIC_TABLES.map(
    (table) =>
      `SELECT DISTINCT toString(MetricName) AS name FROM ${table} WHERE ${withinMetrics}`,
  ).join(" UNION ALL ");

  return `SELECT signal, name FROM (${[
    exists("traces", "traces", withinTraces),
    exists("logs", "logs", withinLogs),
    names(
      "traces",
      `SELECT DISTINCT toString(arrayJoin(mapKeys(SpanAttributes))) AS name
       FROM traces WHERE ${withinTraces}`,
    ),
    names(
      "logs",
      `SELECT DISTINCT toString(arrayJoin(mapKeys(LogAttributes))) AS name
       FROM logs WHERE ${withinLogs}`,
    ),
    names("metrics", metricNames),
  ].join("\n  UNION ALL\n")}\n)`;
}

export function decodeCapabilityRows(
  rows: CapabilityRow[],
): TelemetryCapabilities {
  return bySignal((signal) => {
    const mine = rows.filter((row) => row.signal === signal);
    const names = [
      ...new Set(mine.map((row) => row.name).filter((name) => name !== "")),
    ].sort();
    // Any row proves existence: a named row can only come from stored data, so
    // the empty-name existence marker is not the only evidence.
    return { present: mine.length > 0, names };
  });
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

export type BuiltinReadiness =
  | { status: "ready" }
  | { status: "needs-setup"; missing: string[] };

/**
 * Grade one builtin against the probe. Ready means every requirement is met,
 * which is a claim about the same time range the preview renders — so a ready
 * builtin whose preview is empty is a contradiction the UI never has to
 * explain away.
 */
export function evaluateBuiltin(
  builtin: BuiltinDashboard,
  capabilities: TelemetryCapabilities,
): BuiltinReadiness {
  const missing: string[] = [];
  for (const { signal, match, label } of builtin.requires) {
    const capability = capabilities[signal];
    const met = match
      ? capability.names.some((name) => matches(name, match))
      : capability.present;
    if (!met) {
      missing.push(label);
    }
  }
  // Deduplicated: two requirements can share a label ("metrics") when they
  // probe existence and a name, and the gallery shows the reason once.
  return missing.length === 0
    ? { status: "ready" }
    : { status: "needs-setup", missing: [...new Set(missing)] };
}
