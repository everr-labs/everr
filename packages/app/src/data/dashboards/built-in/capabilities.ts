import { z } from "zod";
import { BUILTIN_DASHBOARDS } from "./catalog";
import { type BuiltinDashboard, SIGNALS, type Signal } from "./types";

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
 * The catalog YAML is cast, not validated, on load, so the signal reaches this
 * module as whatever the file said. Everything interpolated into a query is
 * looked up from these explicit maps behind this schema, so an unknown signal
 * fails loudly here instead of becoming a FROM clause.
 */
const SignalSchema = z.enum(SIGNALS);

const ATTRIBUTE_SOURCES = {
  traces: { window: TRACES_WINDOW, attributes: "SpanAttributes" },
  logs: { window: LOGS_WINDOW, attributes: "LogAttributes" },
} as const;

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
 *
 * The full query the current catalog generates (`<time range>` stands for the
 * table-specific window predicate above; regenerate by logging
 * `buildCapabilitiesQuery()` in a vitest run when the catalog changes):
 *
 *   SELECT DISTINCT key FROM (
 *     SELECT 'traces' AS key FROM traces WHERE <time range> LIMIT 1
 *     UNION ALL
 *     SELECT 'traces:http.request.method' AS key FROM traces WHERE <time range> AND mapContains(SpanAttributes, 'http.request.method') LIMIT 1
 *     UNION ALL
 *     SELECT 'traces:rpc.system.name' AS key FROM traces WHERE <time range> AND mapContains(SpanAttributes, 'rpc.system.name') LIMIT 1
 *     UNION ALL
 *     SELECT 'traces:everr.server_function.name' AS key FROM traces WHERE <time range> AND mapContains(SpanAttributes, 'everr.server_function.name') LIMIT 1
 *     UNION ALL
 *     SELECT 'traces:faas.trigger' AS key FROM traces WHERE <time range> AND mapContains(SpanAttributes, 'faas.trigger') LIMIT 1
 *     UNION ALL
 *     SELECT 'logs' AS key FROM logs WHERE <time range> LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics' AS key FROM metrics_gauge WHERE <time range> LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics' AS key FROM metrics_sum WHERE <time range> LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics' AS key FROM metrics_histogram WHERE <time range> LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics' AS key FROM metrics_exponential_histogram WHERE <time range> LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics' AS key FROM metrics_summary WHERE <time range> LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:jvm.' AS key FROM metrics_gauge WHERE <time range> AND startsWith(MetricName, 'jvm.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:jvm.' AS key FROM metrics_sum WHERE <time range> AND startsWith(MetricName, 'jvm.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:jvm.' AS key FROM metrics_histogram WHERE <time range> AND startsWith(MetricName, 'jvm.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:jvm.' AS key FROM metrics_exponential_histogram WHERE <time range> AND startsWith(MetricName, 'jvm.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:jvm.' AS key FROM metrics_summary WHERE <time range> AND startsWith(MetricName, 'jvm.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:nodejs.' AS key FROM metrics_gauge WHERE <time range> AND startsWith(MetricName, 'nodejs.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:nodejs.' AS key FROM metrics_sum WHERE <time range> AND startsWith(MetricName, 'nodejs.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:nodejs.' AS key FROM metrics_histogram WHERE <time range> AND startsWith(MetricName, 'nodejs.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:nodejs.' AS key FROM metrics_exponential_histogram WHERE <time range> AND startsWith(MetricName, 'nodejs.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:nodejs.' AS key FROM metrics_summary WHERE <time range> AND startsWith(MetricName, 'nodejs.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:postgresql.' AS key FROM metrics_gauge WHERE <time range> AND startsWith(MetricName, 'postgresql.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:postgresql.' AS key FROM metrics_sum WHERE <time range> AND startsWith(MetricName, 'postgresql.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:postgresql.' AS key FROM metrics_histogram WHERE <time range> AND startsWith(MetricName, 'postgresql.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:postgresql.' AS key FROM metrics_exponential_histogram WHERE <time range> AND startsWith(MetricName, 'postgresql.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:postgresql.' AS key FROM metrics_summary WHERE <time range> AND startsWith(MetricName, 'postgresql.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:mysql.' AS key FROM metrics_gauge WHERE <time range> AND startsWith(MetricName, 'mysql.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:mysql.' AS key FROM metrics_sum WHERE <time range> AND startsWith(MetricName, 'mysql.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:mysql.' AS key FROM metrics_histogram WHERE <time range> AND startsWith(MetricName, 'mysql.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:mysql.' AS key FROM metrics_exponential_histogram WHERE <time range> AND startsWith(MetricName, 'mysql.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:mysql.' AS key FROM metrics_summary WHERE <time range> AND startsWith(MetricName, 'mysql.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:redis.' AS key FROM metrics_gauge WHERE <time range> AND startsWith(MetricName, 'redis.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:redis.' AS key FROM metrics_sum WHERE <time range> AND startsWith(MetricName, 'redis.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:redis.' AS key FROM metrics_histogram WHERE <time range> AND startsWith(MetricName, 'redis.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:redis.' AS key FROM metrics_exponential_histogram WHERE <time range> AND startsWith(MetricName, 'redis.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:redis.' AS key FROM metrics_summary WHERE <time range> AND startsWith(MetricName, 'redis.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:mongodb.' AS key FROM metrics_gauge WHERE <time range> AND startsWith(MetricName, 'mongodb.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:mongodb.' AS key FROM metrics_sum WHERE <time range> AND startsWith(MetricName, 'mongodb.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:mongodb.' AS key FROM metrics_histogram WHERE <time range> AND startsWith(MetricName, 'mongodb.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:mongodb.' AS key FROM metrics_exponential_histogram WHERE <time range> AND startsWith(MetricName, 'mongodb.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:mongodb.' AS key FROM metrics_summary WHERE <time range> AND startsWith(MetricName, 'mongodb.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:k8s.' AS key FROM metrics_gauge WHERE <time range> AND startsWith(MetricName, 'k8s.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:k8s.' AS key FROM metrics_sum WHERE <time range> AND startsWith(MetricName, 'k8s.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:k8s.' AS key FROM metrics_histogram WHERE <time range> AND startsWith(MetricName, 'k8s.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:k8s.' AS key FROM metrics_exponential_histogram WHERE <time range> AND startsWith(MetricName, 'k8s.') LIMIT 1
 *     UNION ALL
 *     SELECT 'metrics:k8s.' AS key FROM metrics_summary WHERE <time range> AND startsWith(MetricName, 'k8s.') LIMIT 1
 *     UNION ALL
 *     SELECT 'logs:browser.web_vital.value' AS key FROM logs WHERE <time range> AND mapContains(LogAttributes, 'browser.web_vital.value') LIMIT 1
 *     UNION ALL
 *     SELECT 'logs:everr.page_view.id' AS key FROM logs WHERE <time range> AND mapContains(LogAttributes, 'everr.page_view.id') LIMIT 1
 *   )
 */
export function buildCapabilitiesQuery(
  probes: CapabilityProbe[] = CATALOG_PROBES,
): string {
  const branches: string[] = [];

  for (const probe of probes) {
    const { match } = probe;
    const parsed = SignalSchema.safeParse(probe.signal);
    if (!parsed.success) {
      throw new Error(`Unsupported capability signal: ${String(probe.signal)}`);
    }
    const signal = parsed.data;
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

    if (match?.endsWith(".")) {
      throw new Error(
        `Attribute matches must name an exact key, not a prefix: ${match}`,
      );
    }

    const { window, attributes } = ATTRIBUTE_SOURCES[signal];

    if (match) {
      branches.push(
        `SELECT ${key} AS key FROM ${signal} WHERE ${window} AND mapContains(${attributes}, '${match}') LIMIT 1`,
      );
    } else {
      branches.push(
        `SELECT ${key} AS key FROM ${signal} WHERE ${window} LIMIT 1`,
      );
    }
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
