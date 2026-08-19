import { BUILTIN_DASHBOARDS } from "./catalog";
import type { BuiltinDashboard, Signal } from "./types";

/**
 * Every metric table the tenant can read, not the three the probe used to scan.
 * An Organization whose metrics are Summary- or ExponentialHistogram-typed was
 * told it had no metrics at all while its previews drew fine, which inverts the
 * one promise the probe makes. The `awscloudwatch` receiver emits Summary by
 * default, so this was reachable, not hypothetical.
 *
 * All five share `MetricName` and `TimeUnix`, and each added branch costs one
 * short-circuited read on a table that is empty for every Organization not
 * sending that type.
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
 * One yes/no question the probe asks ClickHouse, in the same shape a built-in
 * states its requirements. The catalog's requirements are the only questions
 * worth asking, so the probe is derived from them rather than discovering
 * everything the Organization sends and grading in JS.
 *
 * Discovering everything was the earlier design and it was both slower and
 * wrong: a per-signal `LIMIT 500` over an alphabetically ordered name list
 * silently dropped `redis.*` and `rpc.system.name` for any Organization with
 * more than 500 distinct keys, marking a built-in needs-setup while its panels
 * would have drawn fine. A truncated scan and a missing attribute are
 * indistinguishable from the outside, so the bug was invisible.
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
 * than a name inventory: nothing downstream of `evaluateBuiltin` ever wanted
 * the names, and this keeps the payload sixteen short strings instead of every
 * attribute key the Organization sends.
 */
export type TelemetryCapabilities = string[];

export const EMPTY_CAPABILITIES: TelemetryCapabilities = [];

export interface CapabilityRow {
  key: string;
}

/**
 * Matches must be safe to inline: the catalog is YAML inlined at build time,
 * so a match is developer-authored, but it reaches ClickHouse as a string
 * literal and nothing else validates it on the way.
 */
const SAFE_MATCH = /^[a-zA-Z0-9._-]+$/;

function literal(value: string): string {
  if (!SAFE_MATCH.test(value)) {
    throw new Error(`Unsupported capability match: ${value}`);
  }
  return `'${value}'`;
}

/** Same rule as `literal`, plus the `:` that `probeKey` joins on. */
function keyLiteral(key: string): string {
  for (const part of key.split(":")) literal(part);
  return `'${key}'`;
}

/**
 * Prefix match, not substring, mirroring what the requirement documents:
 * `"redis."` matches `redis.commands` but never `myredis.x`, and a match
 * written without a trailing dot ("http.route") also accepts the namespace
 * below it. Substring matching would let `db.` claim credit for
 * `everr.db_nothing`.
 */
function prefixTest(expr: string, match: string): string {
  if (match.endsWith(".")) return `startsWith(${expr}, ${literal(match)})`;
  return `(${expr} = ${literal(match)} OR startsWith(${expr}, ${literal(`${match}.`)}))`;
}

/**
 * One `LIMIT 1` branch per catalog requirement, unioned into a set of met
 * probe keys. Existence is the whole question every branch asks, and the limit
 * lets ClickHouse stop at the first matching granule instead of reading the
 * range.
 *
 * `{from}`/`{to}` are the same bound parameters every panel query gets, so the
 * probe and the previews it grades always look at one identical window.
 */
export function buildCapabilitiesQuery(
  probes: CapabilityProbe[] = CATALOG_PROBES,
): string {
  // The bounds arrive as one ClickHouse datetime string with milliseconds, but
  // the columns differ: `Timestamp`/`TimeUnix` are DateTime64(9) and accept it,
  // while `logs.TimestampTime` is a plain DateTime and rejects the fraction
  // outright. Parse each bound to the column's own type rather than leaning on
  // implicit comparison, which is what the explorer's discovery does too.
  const dt64 = (bound: string) =>
    `parseDateTime64BestEffort({${bound}:String}, 9)`;
  const dt = (bound: string) => `parseDateTimeBestEffort({${bound}:String})`;

  const within: Record<Signal, string> = {
    traces: `Timestamp >= ${dt64("from")} AND Timestamp <= ${dt64("to")}`,
    logs: `TimestampTime >= ${dt("from")} AND TimestampTime <= ${dt("to")}`,
    metrics: `TimeUnix >= ${dt64("from")} AND TimeUnix <= ${dt64("to")}`,
  };
  const attributes: Record<"traces" | "logs", string> = {
    traces: "SpanAttributes",
    logs: "LogAttributes",
  };

  const exists = (key: string, source: string, where: string) =>
    `SELECT ${keyLiteral(key)} AS key FROM ${source} WHERE ${where} LIMIT 1`;

  // Metric prefixes are answered by one pass per table instead of one probe
  // per prefix. A prefix probe cannot short-circuit when the prefix is absent,
  // which is the common case, so eight prefixes across five tables meant up to
  // forty full reads of `MetricName` per list load. `arrayFilter` tests every
  // prefix against the name in the same pass, and `MetricName` is
  // LowCardinality, so the pass is cheap and the output is bounded by the
  // number of prefixes rather than the number of metrics.
  const metricPrefixes = probes.flatMap(({ signal, match }) =>
    signal === "metrics" && match ? [match] : [],
  );
  const prefixList = `[${metricPrefixes.map(literal).join(", ")}]`;
  // `endsWith` reproduces `prefixTest` for a prefix only known at query time:
  // a match already ending in a dot is a namespace and nothing else.
  const matchedPrefixes = `arrayFilter(p -> MetricName = p OR startsWith(MetricName, if(endsWith(p, '.'), p, concat(p, '.'))), ${prefixList})`;

  const metricPrefixBranches = metricPrefixes.length
    ? METRIC_TABLES.map(
        (table) =>
          `SELECT DISTINCT concat('metrics:', prefix) AS key FROM (SELECT MetricName FROM ${table} WHERE ${within.metrics}) ARRAY JOIN ${matchedPrefixes} AS prefix`,
      )
    : [];

  const branches = probes.flatMap((probe) => {
    const key = probeKey(probe);
    const { signal, match } = probe;

    // Metrics live in five tables, so bare existence is five short-circuited
    // reads that the outer DISTINCT folds back into a single key. Prefixes are
    // handled above, in one pass rather than one probe each.
    if (signal === "metrics") {
      if (match) return [];
      return METRIC_TABLES.map((table) => exists(key, table, within.metrics));
    }

    // `arrayExists` over `mapKeys`, not the old `DISTINCT arrayJoin(mapKeys(…))`
    // — the scan no longer expands every span into one row per attribute key
    // just to throw all but a handful away, and it can stop at the first row
    // that carries the key.
    return [
      exists(
        key,
        signal,
        match
          ? `${within[signal]} AND arrayExists(k -> ${prefixTest("k", match)}, mapKeys(${attributes[signal]}))`
          : within[signal],
      ),
    ];
  });

  return `SELECT DISTINCT key FROM (\n  ${[...branches, ...metricPrefixBranches].join("\n  UNION ALL\n  ")}\n)`;
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
 * which is a claim about the same time range the preview renders — so a ready
 * builtin whose preview is empty is a contradiction the UI never has to
 * explain away.
 *
 * Prefix matching happens in ClickHouse now, so this is a set lookup: a
 * requirement is met when the probe it names came back.
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
