/**
 * Reads of `app.alert_events`, the ClickHouse history the engine writes, and
 * the shaping that turns its rows into what the charts draw.
 *
 * Every read here carries a lower bound on `event_time`. The table partitions
 * on the month of it, so the floor is what keeps a read off every month the
 * tenant has, and the tenant-wide reads, which name no slug, have nothing else
 * to bound them.
 *
 * `event_type` is filtered directly. ClickHouse 26.1 threw `NOT_IMPLEMENTED:
 * Cannot insert element into Set` while pruning any predicate on it, and the
 * readers dodged that with `toString(event_type)`. 26.4, the version pinned in
 * clickhouse/Dockerfile, prunes on the bare column; the wrapped form read the
 * same parts through the min-max index, so the wrapper bought nothing there
 * either. One shape still misreads on 26.4: a bare `count()` whose only
 * predicate is `event_type IN (...)` is answered from the minmax projection,
 * which takes it for the partition expression, and returns 0. Every read here
 * also names `is_live` and a time floor, and the app's ClickHouse user carries
 * a tenant row policy, so none of them can take that shape.
 */
import { parseTimestampAsUTC } from "@everr/ui/lib/timestamp";
import { ALERT_HISTORY_EVENT_TYPES } from "@/data/alerting/history/event-types";
import { alertingConditionMatches } from "@/data/alerting/rules/condition";
import type {
  AlertingEvaluationSample,
  AlertingRuleSpec,
} from "@/data/alerting/types";
import { ALERTING_EVENT_TYPES } from "@/data/alerting/vocabulary";
import type { ClickhouseQuery } from "@/lib/clickhouse";
import { formatLabels } from "./format";
import type { LifecycleEventType } from "./segments";
import type { SilenceImpactCounts } from "./silences";
import type { InstanceValuePoint, InstanceValueSeries } from "./view";

const DAY_MS = 24 * 60 * 60_000;

/** How far back the detail's recent-events list looks. The list is "recent",
 *  not window-scoped, and shows twelve rows; a rule quiet for a month has
 *  nothing recent to show. */
const TIMELINE_LOOKBACK_MS = 30 * DAY_MS;

/** How far before the chart window the state chart looks for the last
 *  transition each instance made. An instance that entered its state earlier
 *  than this charts as inactive until it transitions again. The read is
 *  tenant-wide, so the floor is what keeps it off the whole history. */
const PRIOR_STATE_LOOKBACK_MS = 90 * DAY_MS;

/** The floor of the detail's last-evaluation read, as a number of evaluation
 *  intervals before the window end. A healthy rule evaluated within one
 *  interval; a rule that has not evaluated in this many is Paused or Degraded,
 *  and the detail shows its instances without sample values. */
const LAST_EVALUATION_LOOKBACK_INTERVALS = 6;
const LAST_EVALUATION_LOOKBACK_MIN_MS = DAY_MS;

/** Everything the detail timeline lists: every row but the evaluation
 *  successes, which arrive every interval and would bury the transitions. */
const TIMELINE_EVENT_TYPES = ALERT_HISTORY_EVENT_TYPES.filter(
  (type) => type !== "evaluation_succeeded",
);

export type LifecycleEventRow = {
  slug: string;
  instance_fingerprint: string;
  event_type: LifecycleEventType;
  event_time: string;
};

/** Every live rule's lifecycle events inside the window, in the order the
 *  state chart consumes them. */
export function loadLifecycleEvents(
  query: ClickhouseQuery,
  window: { fromISO: string; toISO: string },
): Promise<LifecycleEventRow[]> {
  return query<LifecycleEventRow>(
    `SELECT slug, instance_fingerprint, event_type, event_time
       FROM app.alert_events
      WHERE is_live
        AND event_type IN ({types:Array(String)})
        AND event_time >= parseDateTimeBestEffort({from:String})
        AND event_time <= parseDateTimeBestEffort({to:String})
      ORDER BY slug, event_time`,
    { types: ALERTING_EVENT_TYPES, from: window.fromISO, to: window.toISO },
  );
}

export type PriorStateRow = {
  slug: string;
  instance_fingerprint: string;
  // Not `event_type`: an aggregate aliased to the column it reads shadows
  // that column in the WHERE clause, and ClickHouse rejects the whole query
  // rather than resolving it. It does not always reject. Where the alias and
  // the column have different types the predicate simply matches nothing, so
  // no read in this file aliases an expression to the name it reads.
  last_event_type: LifecycleEventType;
};

/**
 * The last transition each instance made before the window opened. A rule
 * that fired hours ago and has been firing quietly ever since emits nothing
 * inside a one-hour window, and without this its chart would say inactive
 * while the rule is on fire.
 *
 * Read from history, not from PostgreSQL alert_instances: that table holds
 * each instance's state now, and the window does not have to end now. Its
 * inactive rows are also swept by retention, so a Resolved instance would
 * simply be missing. The floor bounds the read instead.
 */
export function loadPriorStates(
  query: ClickhouseQuery,
  window: { fromDate: Date; fromISO: string },
): Promise<PriorStateRow[]> {
  return query<PriorStateRow>(
    `SELECT slug,
            instance_fingerprint,
            argMax(event_type, event_time) AS last_event_type
       FROM app.alert_events
      WHERE is_live
        AND event_type IN ({types:Array(String)})
        AND instance_fingerprint != ''
        AND event_time >= parseDateTimeBestEffort({floor:String})
        AND event_time < parseDateTimeBestEffort({from:String})
      GROUP BY slug, instance_fingerprint`,
    {
      types: ALERTING_EVENT_TYPES,
      floor: new Date(
        window.fromDate.getTime() - PRIOR_STATE_LOOKBACK_MS,
      ).toISOString(),
      from: window.fromISO,
    },
  );
}

export type TimelineRow = {
  event_type: string;
  event_time: string;
  instance_labels: Record<string, string>;
  reason: string;
  silenced: boolean;
  error: string;
};

/** The dozen most recent lifecycle rows of one rule before the window end. */
export function loadRecentTimeline(
  query: ClickhouseQuery,
  opts: { path: string; windowTo: Date },
): Promise<TimelineRow[]> {
  return query<TimelineRow>(
    `SELECT event_type, event_time, instance_labels, reason, silenced, error
       FROM app.alert_events
      WHERE slug = {slug:String}
        AND is_live
        AND event_type IN ({types:Array(String)})
        AND event_time >= parseDateTimeBestEffort({since:String})
      ORDER BY event_time DESC
      LIMIT 12`,
    {
      slug: opts.path,
      types: TIMELINE_EVENT_TYPES,
      since: new Date(
        opts.windowTo.getTime() - TIMELINE_LOOKBACK_MS,
      ).toISOString(),
    },
  );
}

/**
 * The last evaluation's sample set, for the instance list's values.
 *
 * This is the one detail read that must open the evaluation partition, the
 * largest one, so its floor matters most: the earlier of the window start and
 * a few intervals before the window end. Empty for a rule that stopped
 * evaluating before that, and the list then names its instances from the
 * window's own rows.
 */
export function loadLastEvaluation(
  query: ClickhouseQuery,
  opts: {
    path: string;
    windowFrom: Date;
    windowTo: Date;
    intervalSecs: number;
  },
): Promise<{ event_time: string; samples_json: string }[]> {
  return query<{ event_time: string; samples_json: string }>(
    `SELECT event_time, samples_json
       FROM app.alert_events
      WHERE slug = {slug:String}
        AND is_live
        AND event_type = 'evaluation_succeeded'
        AND event_time >= parseDateTimeBestEffort({since:String})
      ORDER BY event_time DESC
      LIMIT 1`,
    {
      slug: opts.path,
      since: new Date(
        Math.min(
          opts.windowFrom.getTime(),
          opts.windowTo.getTime() -
            Math.max(
              LAST_EVALUATION_LOOKBACK_MIN_MS,
              LAST_EVALUATION_LOOKBACK_INTERVALS * opts.intervalSecs * 1000,
            ),
        ),
      ).toISOString(),
    },
  );
}

/** Label sets for every instance the window saw, including ones that have
 *  since closed: the chart names its lanes, and a fingerprint is not a name. */
export function loadInstanceLabels(
  query: ClickhouseQuery,
  opts: { path: string; windowFrom: Date; windowTo: Date },
): Promise<{ instance_fingerprint: string; labels: Record<string, string> }[]> {
  return query<{
    instance_fingerprint: string;
    // Not `instance_labels`: an aggregate aliased to the column it reads
    // shadows that column, and the two other reads in this file that did it
    // were a rejected query and a silently empty one.
    labels: Record<string, string>;
  }>(
    `SELECT instance_fingerprint, any(instance_labels) AS labels
       FROM app.alert_events
      WHERE slug = {slug:String}
        AND is_live
        AND instance_fingerprint != ''
        AND event_time >= parseDateTimeBestEffort({from:String})
        AND event_time <= parseDateTimeBestEffort({to:String})
      GROUP BY instance_fingerprint`,
    {
      slug: opts.path,
      from: opts.windowFrom.toISOString(),
      to: opts.windowTo.toISOString(),
    },
  );
}

/**
 * Per-silence hold and suppression counts, read from alert history rather
 * than from the queue.
 *
 * The queue only knows what is held *now*, so it answers nothing about the
 * expired silence that ate last night's page, which is the silence anybody
 * actually comes here asking about. History keeps the `silence_id` on both
 * the hold and the suppression rows for good, so it answers for every state.
 */
export async function loadSilenceImpact(
  query: ClickhouseQuery,
  silences: { id: string; startsAt: Date }[],
): Promise<Map<string, SilenceImpactCounts>> {
  if (silences.length === 0) return new Map();
  // Bounded at the oldest silence's start: no hold can predate the window
  // that caused it, and the bound is what prunes partitions.
  const from = new Date(
    Math.min(...silences.map((s) => s.startsAt.getTime())),
  ).toISOString();
  const rows = await query<{
    // Not `silence_id`: an expression aliased to the column it reads shadows
    // that column in the WHERE clause. Here the shadow is silent rather than
    // rejected, because the alias is a String and the predicate compares it to
    // an Array(UUID): nothing matches, no error is raised, and every silence
    // reports having withheld nothing.
    sid: string;
    held: string;
    dropped: string;
  }>(
    `SELECT toString(silence_id) AS sid,
            toString(uniqExactIf(notification_event_id, event_type = 'notification_deferred')) AS held,
            toString(uniqExactIf(notification_event_id, event_type = 'notification_suppressed')) AS dropped
       FROM app.alert_events
      WHERE is_live
        AND silence_id IN ({ids:Array(UUID)})
        AND event_time >= parseDateTimeBestEffort({from:String})
        AND event_type IN ('notification_deferred', 'notification_suppressed')
      GROUP BY silence_id
      LIMIT 200`,
    { ids: silences.map((s) => s.id), from },
  );
  return new Map(
    rows.map((r) => [
      r.sid,
      { held: Number(r.held), dropped: Number(r.dropped) },
    ]),
  );
}

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
    // Not `labels_json`: the same self-shadowing alias as the two reads above.
    // Harmless here, since no predicate names it, and renamed anyway so the
    // pattern is not left in the file for the next reader to copy.
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

/**
 * One history line: "instance_fired · worker · reason threshold_crossed".
 *
 * The event type is the engine's own word for what happened, kept verbatim
 * rather than prettified: this list is read next to the logs, and a line that
 * cannot be grepped for is worth less than one that reads nicely.
 */
export function lifecycleLine(row: TimelineRow): string {
  const parts = [row.event_type];
  const labels = Object.values(row.instance_labels ?? {}).join(" ");
  if (labels) parts.push(labels);
  if (row.reason) parts.push(`reason ${row.reason}`);
  if (row.silenced) parts.push("held by silence");
  if (row.error) parts.push(row.error);
  return parts.join(" · ");
}
