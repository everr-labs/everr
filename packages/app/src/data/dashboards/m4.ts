import { isTimeColumnName } from "./time-column";

/**
 * M4 downsampling (Jugel et al., VLDB 2014): per time bucket and series, keep
 * the first, last, lowest and highest row. The result is an ordered
 * subsequence of the author's rows, so column names, series order and the
 * client's column-role detection are untouched.
 */

/**
 * The browser asks for one bucket per CSS pixel column of the panel, snapped
 * up to `M4_BUCKET_SNAP` so a resize refetches only when it crosses a snap
 * point, and held inside these bounds.
 *
 * The floor keeps `{step}` panels intact. `{step}` is an integer >= range / 500
 * (see `PANEL_TARGET_POINTS` in server.ts and `bucketSeconds` in
 * `@everr/ui/lib/bucket`), so `2 * step >= ceil(range / 250)`. With 250 buckets
 * or more, a panel bucketed by `{step}` has at most two rows per series per M4
 * bucket, M4 keeps both, and the panel gets its rows back unchanged. That only
 * holds when both widths come from the same unrounded range.
 *
 * The ceiling bounds the result. A dense series keeps up to four rows per
 * bucket, so 1000 buckets is up to 4000 rows per series against the SQL API
 * cap of 25,000 rows.
 */
export const M4_MIN_BUCKETS = 250;
export const M4_MAX_BUCKETS = 1000;
const M4_BUCKET_SNAP = 100;

const RESERVED_PREFIX = "__everr_";
const ROW_COLUMN = `${RESERVED_PREFIX}row`;

export interface ColumnRoles {
  columns: string[];
  time: string;
  groups: string[];
  values: string[];
}

/** The bucket count to ask for when the chart is `widthPx` CSS pixels wide. */
export function m4BucketsForWidth(widthPx: number): number {
  const snapped = Math.ceil(widthPx / M4_BUCKET_SNAP) * M4_BUCKET_SNAP;
  return Math.min(M4_MAX_BUCKETS, Math.max(M4_MIN_BUCKETS, snapped));
}

export function m4BucketSeconds(from: Date, to: Date, buckets: number): number {
  const rangeSeconds = (to.getTime() - from.getTime()) / 1000;
  return Math.max(1, Math.ceil(rangeSeconds / buckets));
}

type TypeKind = "temporal" | "value" | "group";

const TYPE_KINDS: ReadonlyArray<readonly [RegExp, TypeKind]> = [
  [/^(Date|Date32|DateTime|DateTime64)(\(|$)/, "temporal"],
  [/^(U?Int(8|16|32|64|128|256)|Float(32|64)|BFloat16|Decimal(32|64|128|256)?)(\(|$)/, "value"],
  [/^(String|FixedString|Enum8|Enum16|UUID|Bool|IPv4|IPv6)(\(|$)/, "group"],
];

const TYPE_WRAPPER = /^(?:Nullable|LowCardinality)\((.*)\)$/s;

function classifyType(type: string): TypeKind | undefined {
  let inner = type;
  for (let match = TYPE_WRAPPER.exec(inner); match; match = TYPE_WRAPPER.exec(inner)) {
    inner = match[1] ?? "";
  }
  return TYPE_KINDS.find(([pattern]) => pattern.test(inner))?.[1];
}

/**
 * Assigns each result column the role it plays in a line chart. Null means the
 * query cannot be wrapped and must run as written.
 */
export function resolveColumnRoles(columns: { name: string; type: string }[]): ColumnRoles | null {
  const seen = new Set<string>();
  const kinds = new Map<string, TypeKind>();
  for (const { name, type } of columns) {
    if (seen.has(name) || name.startsWith(RESERVED_PREFIX)) return null;
    seen.add(name);
    const kind = classifyType(type);
    if (kind === undefined) return null;
    kinds.set(name, kind);
  }

  const time = columns.find(({ name }) => isTimeColumnName(name))?.name;
  if (time === undefined || kinds.get(time) !== "temporal") return null;

  const others = columns.map(({ name }) => name).filter((name) => name !== time);
  const values = others.filter((name) => kinds.get(name) === "value");
  if (values.length === 0) return null;
  const groups = others.filter((name) => kinds.get(name) !== "value");
  return { columns: columns.map(({ name }) => name), time, groups, values };
}

function quoteIdentifier(name: string): string {
  return `\`${name.replace(/\\/g, "\\\\").replace(/`/g, "\\`")}\``;
}

/** Drops the trailing `;` so the statement can be nested as a subquery. */
export function stripStatementTerminator(sql: string): string {
  return sql.trim().replace(/;\s*$/, "");
}

export function buildM4Query(sql: string, roles: ColumnRoles, bucketSeconds: number): string {
  const column = roles.columns.map(quoteIdentifier);
  const time = quoteIdentifier(roles.time);
  const extremes = [roles.time, ...roles.values].map(quoteIdentifier);

  const picks = extremes
    .flatMap((c) => [`argMin([${ROW_COLUMN}], ${c})`, `argMax([${ROW_COLUMN}], ${c})`])
    .join(",\n    ");
  const bucket = `intDiv(toUnixTimestamp(${time}), ${Math.trunc(bucketSeconds)})`;
  const groupBy = [...roles.groups.map(quoteIdentifier), bucket].join(", ");
  const projection = column.map((c, i) => `pt.${i + 1} AS ${c}`).join(", ");
  const rowNumberIndex = column.length + 1;

  // Each argMin/argMax wraps the row in an array: over zero non-NULL values an
  // aggregate returns its type default, and for an array that is empty, so an
  // all-NULL bucket adds no invented row. The ordinal makes arrayDistinct
  // dedupe by row identity and lets the final ORDER BY restore the author's
  // order.
  // The newline before each closing paren keeps a trailing `-- comment` in the
  // author SQL from swallowing it.
  return `SELECT ${projection}
FROM (
  SELECT arrayDistinct(arrayConcat(
    ${picks}
  )) AS pts
  FROM (
    SELECT *, (${column.join(", ")}, row_number() OVER ()) AS ${ROW_COLUMN}
    FROM (
${stripStatementTerminator(sql)}
    )
  )
  GROUP BY ${groupBy}
)
ARRAY JOIN pts AS pt
ORDER BY pt.${rowNumberIndex}`;
}
