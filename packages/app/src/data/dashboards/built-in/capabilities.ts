import { BUILTIN_DASHBOARDS } from "./catalog";
import type { BuiltinDashboard, Signal } from "./types";

/**
 * Every metric table the tenant can read, not just the common three. An
 * Organization whose metrics are Summary- or ExponentialHistogram-typed would
 * otherwise be told it had no metrics at all while its previews drew fine,
 * which inverts the one promise the probe makes. The `awscloudwatch` receiver
 * emits Summary by default, so this is reachable, not hypothetical.
 *
 * Written out rather than filtered from `SQL_API_TENANT_TABLES`: this module is
 * imported by the dashboards list component, and `lib/clickhouse` would drag
 * the server env and `node:crypto` into the client bundle. That makes this a
 * hand-synced copy, so a table added to the real list has to be added here too;
 * nothing detects the drift for you.
 */
const METRIC_TABLES = [
  "metrics_gauge",
  "metrics_sum",
  "metrics_histogram",
  "metrics_exponential_histogram",
  "metrics_summary",
] as const;

/**
 * The bounds arrive as one ClickHouse datetime string with milliseconds, but
 * the columns differ: `Timestamp`/`TimeUnix` are DateTime64(9) and accept it,
 * while `logs.TimestampTime` is a plain DateTime and rejects the fraction
 * outright. Each bound is parsed to its own column's type rather than leaning
 * on implicit comparison.
 *
 * `{from}`/`{to}` are the same bound parameters every panel query gets, so the
 * probe and the previews it grades always look at one identical window.
 */
const TRACES_WINDOW = `Timestamp >= parseDateTime64BestEffort({from:String}, 9) AND Timestamp <= parseDateTime64BestEffort({to:String}, 9)`;
const LOGS_WINDOW = `TimestampTime >= parseDateTimeBestEffort({from:String}) AND TimestampTime <= parseDateTimeBestEffort({to:String})`;
const METRICS_WINDOW = `TimeUnix >= parseDateTime64BestEffort({from:String}, 9) AND TimeUnix <= parseDateTime64BestEffort({to:String}, 9)`;

/**
 * One yes/no question the probe asks ClickHouse, in the same shape a built-in
 * states its requirements. The catalog's requirements are the only questions
 * worth asking, so the probe is derived from them rather than discovering
 * everything the Organization sends and grading the names in JS.
 */
export interface CapabilityProbe {
  signal: Signal;
  match?: string;
}

/**
 * The stable identity of a probe, and the wire value one met probe returns.
 * A bare signal is its own key so `traces` and `traces:faas` never collide.
 */
export function probeKey({ signal, match }: CapabilityProbe): string {
  return match ? `${signal}:${match}` : signal;
}

/**
 * Deduplicated across the catalog: sixteen built-ins state forty-odd
 * requirements, but most repeat `signal: metrics` with no match, so the probe
 * asks each distinct question once.
 */
export const CATALOG_PROBES: CapabilityProbe[] = [
  ...new Map(
    BUILTIN_DASHBOARDS.flatMap((builtin) => builtin.requires).map(
      ({ signal, match }) => [probeKey({ signal, match }), { signal, match }],
    ),
  ).values(),
];

/**
 * The probes a tenant met in the window, by `probeKey`. A plain array rather
 * than an inventory of every name the Organization sends: nothing downstream of
 * `evaluateBuiltin` ever wanted the names.
 */
export type TelemetryCapabilities = string[];

export const EMPTY_CAPABILITIES: TelemetryCapabilities = [];

export interface CapabilityRow {
  key: string;
}

/**
 * Matches reach ClickHouse as inlined string literals. The catalog is
 * developer-authored YAML, but nothing else validates it on the way, so a match
 * that could break out of its quotes is rejected rather than escaped.
 */
const SAFE_MATCH = /^[a-zA-Z0-9._-]+$/;

/**
 * Prefix match, not substring, mirroring what the requirement documents:
 * `"redis."` matches `redis.commands` but never `myredis.x`, and a match
 * written without a trailing dot ("http.route") also accepts the namespace
 * below it. Substring matching would let `db.` claim credit for
 * `everr.db_nothing`.
 */
function prefixTest(column: string, match: string): string {
  if (match.endsWith(".")) return `startsWith(${column}, '${match}')`;
  return `(${column} = '${match}' OR startsWith(${column}, '${match}.'))`;
}

/**
 * One `LIMIT 1` branch per catalog requirement, unioned into the set of met
 * probe keys. Existence is the whole question every branch asks, and the limit
 * lets ClickHouse stop at the first matching granule instead of reading the
 * range.
 */
export function buildCapabilitiesQuery(
  probes: CapabilityProbe[] = CATALOG_PROBES,
): string {
  const branches: string[] = [];

  for (const probe of probes) {
    const { signal, match } = probe;
    if (match && !SAFE_MATCH.test(match)) {
      throw new Error(`Unsupported capability match: ${match}`);
    }
    const key = `'${probeKey(probe)}'`;

    // Metrics live in five tables, so one requirement is five short-circuited
    // reads that the outer DISTINCT folds back into a single key. `MetricName`
    // is the third ORDER BY column, so keeping the prefix in the WHERE lets
    // KeyCondition turn it into a key range: an absent prefix reads a handful
    // of granules instead of the window. Testing the prefixes in one shared
    // pass reads fewer columns but hides them from the index, which measured
    // 65x worse.
    if (signal === "metrics") {
      for (const table of METRIC_TABLES) {
        const where = match
          ? `${METRICS_WINDOW} AND ${prefixTest("MetricName", match)}`
          : METRICS_WINDOW;
        branches.push(
          `SELECT ${key} AS key FROM ${table} WHERE ${where} LIMIT 1`,
        );
      }
      continue;
    }

    // Attribute keys are not in either table's ORDER BY, so nothing prunes an
    // absent one and the branch reads the window. `arrayExists` over `mapKeys`
    // at least stops at the first row that carries the key, and never expands a
    // row per attribute the way discovery had to.
    const window = signal === "traces" ? TRACES_WINDOW : LOGS_WINDOW;
    const attributes = signal === "traces" ? "SpanAttributes" : "LogAttributes";
    const where = match
      ? `${window} AND arrayExists(k -> ${prefixTest("k", match)}, mapKeys(${attributes}))`
      : window;
    branches.push(`SELECT ${key} AS key FROM ${signal} WHERE ${where} LIMIT 1`);
  }

  return `SELECT DISTINCT key FROM (\n  ${branches.join("\n  UNION ALL\n  ")}\n)`;
}

export function decodeCapabilityRows(
  rows: CapabilityRow[],
): TelemetryCapabilities {
  return [...new Set(rows.map((row) => row.key))].sort();
}

export type BuiltinReadiness =
  | { status: "ready" }
  | { status: "needs-setup"; missing: string[] };

/**
 * Grade one builtin against the probe. Ready means every requirement is met,
 * which is a claim about the same time range the preview renders, so a ready
 * builtin whose preview is empty is a contradiction the UI never has to
 * explain away.
 */
export function evaluateBuiltin(
  builtin: BuiltinDashboard,
  capabilities: TelemetryCapabilities,
): BuiltinReadiness {
  const met = new Set(capabilities);
  const missing = builtin.requires
    .filter(({ signal, match }) => !met.has(probeKey({ signal, match })))
    .map(({ label }) => label);
  // Deduplicated: two requirements can share a label ("metrics") when they
  // probe existence and a name, and the gallery shows the reason once.
  return missing.length === 0
    ? { status: "ready" }
    : { status: "needs-setup", missing: [...new Set(missing)] };
}
