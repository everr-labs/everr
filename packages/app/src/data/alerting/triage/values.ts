/**
 * The evaluated values behind the verdict: what every instance a rule watches
 * measured over the window, bucketed into the lanes the charts draw.
 *
 * The read is one more read of `app.alert_events`, and it keeps the discipline
 * `history.ts` states in full at the top of that file: a floor on `event_time`,
 * because the table partitions on the month of it; a bare `event_type`
 * predicate, which 26.4 prunes on, never the sole predicate of a bare
 * `count()`; and no aggregate aliased to the column it reads, which shadows
 * that column and is rejected or silently empty depending on the types.
 */
import { parseTimestampAsUTC } from "@everr/ui/lib/timestamp";
import { alertingConditionMatches } from "@/data/alerting/rules/condition";
import type {
  AlertingEvaluationSample,
  AlertingRuleSpec,
} from "@/data/alerting/types";
import type { ClickhouseQuery } from "@/lib/clickhouse";
import { formatLabels } from "./format";
import type { InstanceValuePoint, InstanceValueSeries } from "./view";

/**
 * The evaluated values behind the verdict, bucketed.
 *
 * A week of one-minute evaluations is ten thousand readings per instance, and
 * a lane a few hundred pixels wide cannot draw them. The bucket keeps its
 * extremes as well as its last reading, so a spike inside one still reaches
 * the chart instead of being averaged away.
 */
type ValueBucket = {
  at: number;
  last: number;
  min: number;
  max: number;
};

/** About this many buckets across the window, never finer than the rule's own
 *  evaluation interval. Sized against the panel, which is a column a few
 *  hundred pixels wide: a hundred bars in it is a barcode, and a bar that
 *  cannot be pointed at cannot be read either. */
const VALUE_BUCKETS = 60;

// A chart cannot make dozens of simultaneous lanes legible, and the panel is a
// column, not a page. Ten Alert instances, then a count of the rest.
const INSTANCE_LANE_LIMIT = 10;

/** What the value read needs to know about a rule: where its rows are, how
 *  to judge them, and how often it writes them. */
export type ValueRule = {
  path: string;
  condition: AlertingRuleSpec["condition"];
  /** `spec.interval_secs`. */
  intervalSecs: number;
};

export type InstanceLanes = {
  /** One lane per Alert instance, breaching first, capped. */
  lanes: InstanceValueSeries[];
  /** Instances the cap left out. */
  hidden: number;
};

export type InstanceValues = {
  /** By rule path. A rule that evaluated nothing in the window has no entry. */
  byPath: Map<string, InstanceLanes>;
  bucketMs: number;
};

/**
 * What every instance of the given rules measured over the window, as the
 * lanes the charts draw: one read for the row sparklines, the state chart's
 * tooltip and the detail's lanes alike, so no two of them can disagree about
 * what a rule measured.
 *
 * The bucket is the smallest evaluation interval among the rules, or coarser
 * when the window is long enough that `VALUE_BUCKETS` of them would be finer
 * than that.
 */
export async function loadInstanceValues(
  query: ClickhouseQuery,
  opts: {
    rules: ValueRule[];
    from: Date;
    to: Date;
    /** Fingerprint to label set, for instances whose labels the value rows do
     *  not carry (ones that have closed, or that only the last evaluation's
     *  samples name). Wins over the labels read here. */
    labels?: Map<string, string>;
  },
): Promise<InstanceValues> {
  const windowMs = opts.to.getTime() - opts.from.getTime();
  const intervalSecs = Math.min(...opts.rules.map((rule) => rule.intervalSecs));
  const bucketSeconds = Math.max(
    Number.isFinite(intervalSecs) ? intervalSecs : 1,
    Math.ceil(windowMs / VALUE_BUCKETS / 1000),
  );
  const bucketMs = bucketSeconds * 1000;
  if (opts.rules.length === 0) return { byPath: new Map(), bucketMs };
  const rows = await query<{
    slug: string;
    fingerprint: string;
    // Not `labels_json`: the same self-shadowing alias the reads in
    // `history.ts` name. Harmless here, since no predicate names it, and
    // renamed anyway so the pattern is not left in the file for the next
    // reader to copy.
    sample_labels: string;
    bucket: string;
    last: number;
    low: number;
    high: number;
  }>(
    `SELECT slug,
            fingerprint,
            any(labels_json) AS sample_labels,
            toStartOfInterval(event_time, INTERVAL {bucket:UInt32} SECOND) AS bucket,
            argMax(v, event_time) AS last,
            min(v) AS low,
            max(v) AS high
       FROM (
         SELECT slug,
                event_time,
                JSONExtractString(sample, 'fingerprint') AS fingerprint,
                JSONExtractRaw(sample, 'labels') AS labels_json,
                JSONExtractFloat(sample, 'value') AS v
           FROM app.alert_events
           ARRAY JOIN JSONExtractArrayRaw(samples_json) AS sample
          WHERE slug IN ({slugs:Array(String)})
            AND is_live
            AND event_type = 'evaluation_succeeded'
            AND event_time >= parseDateTimeBestEffort({from:String})
            AND event_time <= parseDateTimeBestEffort({to:String})
       )
      WHERE isFinite(v)
      GROUP BY slug, fingerprint, bucket
      ORDER BY slug, fingerprint, bucket`,
    {
      slugs: opts.rules.map((rule) => rule.path),
      bucket: bucketSeconds,
      from: opts.from.toISOString(),
      to: opts.to.toISOString(),
    },
  );

  const buckets = new Map<string, Map<string, ValueBucket[]>>();
  const labels = new Map<string, string>();
  for (const row of rows) {
    const byInstance =
      buckets.get(row.slug) ?? new Map<string, ValueBucket[]>();
    const at = parseTimestampAsUTC(row.bucket);
    if (!at) continue;
    const list = byInstance.get(row.fingerprint) ?? [];
    list.push({
      at: at.getTime(),
      last: Number(row.last),
      min: Number(row.low),
      max: Number(row.high),
    });
    byInstance.set(row.fingerprint, list);
    buckets.set(row.slug, byInstance);
    if (!labels.has(row.fingerprint)) {
      labels.set(row.fingerprint, formatLabels(parseLabels(row.sample_labels)));
    }
  }
  for (const [fingerprint, label] of opts.labels ?? []) {
    labels.set(fingerprint, label);
  }

  const byPath = new Map<string, InstanceLanes>();
  for (const rule of opts.rules) {
    const own = buckets.get(rule.path);
    if (!own) continue;
    byPath.set(
      rule.path,
      instanceLanes(own, labels, opts.to.getTime(), rule.condition),
    );
  }
  return { byPath, bucketMs };
}

/** Written by this app, but read back from a String column: a row that
 *  predates a shape change must not take the whole panel down. */
function parseJson<T>(
  json: string,
  fallback: T,
  holds: (v: unknown) => boolean,
): T {
  try {
    const parsed = JSON.parse(json);
    return holds(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

/** The label object as written into `samples_json`. */
function parseLabels(json: string): Record<string, string> {
  return parseJson<Record<string, string>>(
    json || "{}",
    {},
    (v) => v !== null && typeof v === "object",
  );
}

export function parseSamples(json: string): AlertingEvaluationSample[] {
  return parseJson<AlertingEvaluationSample[]>(json || "[]", [], Array.isArray);
}

/**
 * One sparkline lane per Alert instance.
 *
 * The lanes are drawn from the evaluated samples rather than from the tracked
 * instances, so a healthy series gets a lane too: "1 of 3 breaching" is only
 * readable when the other two are on the chart.
 */
function instanceLanes(
  buckets: Map<string, ValueBucket[]>,
  labels: Map<string, string>,
  windowTo: number,
  condition: AlertingRuleSpec["condition"],
): InstanceLanes {
  const lanes: InstanceValueSeries[] = [];
  for (const [fingerprint, own] of buckets) {
    const points: InstanceValuePoint[] = own.map((bucket) => ({
      at: (windowTo - bucket.at) / 60_000,
      value: bucket.last,
      low: bucket.min,
      high: bucket.max,
      // Either extreme crossing means the bucket held a breaching evaluation:
      // the lane's mark covers the whole bucket, and hiding a breach inside it
      // would be the one thing the chart must not do.
      breaching:
        alertingConditionMatches({ value: bucket.max }, condition) ||
        alertingConditionMatches({ value: bucket.min }, condition),
    }));
    lanes.push({
      fingerprint,
      labels: labels.get(fingerprint) ?? fingerprint.slice(0, 12),
      points,
    });
  }

  // Breaching first, then by peak: the instance that woke somebody up is the
  // one the reader opened the panel for.
  const peak = (lane: InstanceValueSeries) =>
    lane.points.reduce((max, point) => Math.max(max, point.high), -Infinity);
  lanes.sort((a, b) => {
    const breaching = (lane: InstanceValueSeries) =>
      Number(lane.points.some((point) => point.breaching));
    return (
      breaching(b) - breaching(a) ||
      peak(b) - peak(a) ||
      a.labels.localeCompare(b.labels)
    );
  });

  return {
    lanes: lanes.slice(0, INSTANCE_LANE_LIMIT),
    hidden: Math.max(0, lanes.length - INSTANCE_LANE_LIMIT),
  };
}
