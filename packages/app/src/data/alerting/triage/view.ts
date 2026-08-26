/**
 * The shapes the alerting triage screen renders.
 *
 * Everything here is already formatted for display. Durations, values and
 * condition text are resolved on the server, where the spec and the raw
 * timestamps are, so a component never has to re-derive alerting semantics it
 * cannot see the inputs for.
 */
import type { AlertingSeverity } from "@/data/alerting/types";

/** How a rule presents in triage. `degraded` is health, not instance status:
 *  a rule we cannot evaluate has no trustworthy status to show. */
export type TriageStatus = "degraded" | "firing" | "pending";

/** The inventory widens triage with the states that never need attention:
 *  quiet, silenced, and switched off. */
export type RuleInventoryState =
  | TriageStatus
  | "inactive"
  | "silenced"
  | "paused";

/** What a state chart can paint. Spelled out rather than derived from
 *  `RuleInventoryState`: `inactive` is the empty track, and `paused` is a
 *  property of the rule now, not of any stretch of its history. */
export type RuleSegmentState = "firing" | "pending" | "silenced" | "degraded";

export type AlertSilenceView = {
  id: string;
  /** A silence with no matchers beyond the rule name covers the whole rule;
   *  one with instance matchers leaves the rule its own status. */
  wholeRule: boolean;
  expiresIn: string;
  /** Notifications this silence has already held or suppressed for the rule. */
  suppressed: number;
};

export type TriageAlert = {
  /** `project/slug`, the as-code identity of the rule. */
  path: string;
  name: string;
  severity: AlertingSeverity;
  status: TriageStatus;
  /** Human summary of the evaluated rows behind `value`. */
  measured: string;
  /** What delivery did with the last verdict. */
  notification: string;
  /** Last evaluated value of the worst instance; `null` when nothing evaluated. */
  value: string | null;
  /** The rule's condition, rendered the way the YAML reads it. */
  condition: string;
  /** How long the current state has held. `null` when nothing dates it. */
  since: string | null;
  /** Present only while `status` is `pending`: progress against `spec.for`. */
  pending?: { total: string; percent: number };
  /** Present only while health is `degraded`: the last evaluation failure. */
  error?: string;
  silence?: AlertSilenceView;
  /** Instances the rule currently tracks, for the silence matcher preview. */
  instances: number;
  /** The row's sparkline: what each instance measured over the selected window.
   *  The line draws the worst of them, and the hover names all of them, the
   *  same way the two charts on this screen do. */
  spark: AlertSparkData;
};

/**
 * The window a chart's data is measured against. Every window-relative number
 * on this screen (`at`, `from`, `to`) is minutes before `endsAt`, and `endsAt`
 * is the server's own end of window at the moment it read the data.
 *
 * It travels with the data rather than being re-resolved in the browser: a
 * relative range ("last hour") resolves to a different instant on every fetch,
 * and a chart that pinned its right edge at mount time would draw a refetch's
 * points minutes to the left of where they happened.
 */
export type ChartWindow = {
  minutes: number;
  /** Epoch ms at the right edge. */
  endsAt: number;
};

export type AlertSparkData = {
  instances: InstanceValueSeries[];
  window: ChartWindow;
};

export type AlertTriageData = {
  /** In triage order: worst band first (degraded, then firing, then pending),
   *  the higher severity first within a band, and silenced rules after the
   *  rest of their band rather than exiled to the bottom, because the thing
   *  that was silenced is still happening. Ties keep the inventory's order,
   *  so a row and its inventory entry never disagree about which of two
   *  same-named rules comes first. The list renders this order as is. */
  alerts: TriageAlert[];
  rules: RuleInventoryRow[];
};

export type RuleInventoryRow = {
  path: string;
  name: string;
  severity: AlertingSeverity;
  state: RuleInventoryState;
  /** `spec.evaluationInterval`, formatted. */
  every: string;
  /** Remaining silence. `null` for a rule that is not silenced, or is paused:
   *  a paused rule is off, not muted. */
  silence: string | null;
};

/**
 * One stretch of time a rule spent in a single state, in minutes before the
 * end of the queried window. `from` is the older edge, so `{ from: 14, to: 0 }`
 * means "the last 14 minutes, still going". Only non-`inactive` stretches are
 * recorded: inactive is the ground state, and the chart's empty track is what
 * it looks like.
 */
export type RuleStateSegment = {
  state: RuleSegmentState;
  from: number;
  to: number;
};

export type LifecycleEvent = {
  /** Clock time. `null` for a row whose stamp did not parse. */
  time: string | null;
  text: string;
  current?: boolean;
};

/**
 * One Alert instance's evaluated values over the queried window.
 *
 * The lane is the instance, and the panel stacks one per instance so the
 * reader compares series against each other and against the Condition on a
 * single axis, which is the comparison a rule with more than one instance
 * exists to make.
 */
/**
 * One rule's row in the state chart: the states it was in, and the values its
 * instances measured while it was in them.
 *
 * The two travel together because the tooltip shows both at one instant, and a
 * reader who has to open the detail panel to learn what the red stretch was
 * measuring has been asked to leave the list to read the list.
 */
export type RuleStateHistory = {
  segments: RuleStateSegment[];
  instances: InstanceValueSeries[];
};

export type RuleStateHistoryData = {
  window: ChartWindow;
  /** By rule path. Every live rule has an entry, quiet ones included. */
  rules: Record<string, RuleStateHistory>;
};

export type InstanceValueSeries = {
  fingerprint: string;
  /** The Alert instance's label set, formatted. */
  labels: string;
  points: InstanceValuePoint[];
};

/**
 * One bucket of an instance's evaluated values.
 *
 * Bucketed rather than raw: a week of one-minute evaluations is ten thousand
 * points per instance, and a lane a few hundred pixels wide cannot draw them.
 * The bucket keeps its extremes as well as its last value, so a spike inside a
 * bucket stays on the chart instead of being averaged away.
 */
export type InstanceValuePoint = {
  /** Minutes before the end of the window. */
  at: number;
  /** Last value in the bucket: the reading the bar stands at. */
  value: number;
  low: number;
  high: number;
  /** The engine's own Condition verdict, not a re-run of it in the browser. */
  breaching: boolean;
};

/** What a rule is, as written. Structured rather than a `{key, value}[]` so the
 *  renderer can link the runbook and set the query in a code block instead of
 *  printing every field as the same kind of string. */
export type AlertDefinitionView = {
  repository: string;
  project: string;
  /** Absolute or in-app href from `link.runbook`, with the name to show. */
  runbook: { href: string; label: string } | null;
  evaluationInterval: string;
  notificationTitle: string;
  notificationDescription: string;
  /** ISO; null before the rule has ever been evaluated. */
  lastEvaluatedAt: string | null;
  query: string;
};

/** A silence that overlapped the queried window. Not only the active one: the
 *  question "why did nobody hear about this" is usually asked after the
 *  silence that caused it has already expired. */
export type AlertSilenceRecord = {
  id: string;
  startsAt: string;
  endsAt: string;
  /** `scheduled` has not started, `cancelled` was ended by a person. */
  state: "active" | "scheduled" | "expired" | "cancelled";
  /** Every matcher, formatted and space-separated, the rule among them: on
   *  a screen that spans rules it is the fact that tells two rows apart, and
   *  it is one matcher like the others rather than a title the rest narrow.
   *  Empty when the silence has none. */
  matchers: string;
  /** The rule the silence names, when it names exactly one; what "Silence
   *  again" opens the dialog on. `null` for a silence written outside these
   *  screens that names no rule, or more than one. */
  rule: string | null;
  /** The matchers beyond the rule, formatted. Empty means the whole rule,
   *  and the difference between muting a rule and muting one instance of it
   *  is the single most consequential thing a row says. */
  scope: string;
  /** When a person closed the window early; `null` if nobody did. `endsAt`
   *  was collapsed to the same instant by the write that cancelled it, give
   *  or take the transaction, so the row prints this stamp instead: the two
   *  disagree at the second the row is printed to. */
  canceledAt: string | null;
  /** What the silence did to delivery, in the history's own vocabulary: a
   *  hold may still go out, a suppression never will. "held 3 · dropped 1",
   *  or `null` when it withheld nothing, which is the usual case. */
  impact: string | null;
  comment: string;
  author: string;
};

export type AlertDetail = {
  path: string;
  name: string;
  severity: AlertingSeverity;
  status: RuleInventoryState;
  /** How long `status` has held: the silence for a silenced rule, the fire
   *  for a firing one, the failure for a degraded one. `null` for a rule that
   *  is quiet or paused, which have no clock running. */
  since: string | null;
  condition: string;
  description: string;
  /** What delivery is doing about `status`, ready to print beside it: what
   *  the journal did with the last verdict, or, for a silenced or paused
   *  rule, what the state stops and whether evaluation goes on. */
  notification: string;
  /** Numeric threshold, for placing the guide line on the signal chart. */
  threshold: number;
  window: ChartWindow;
  /** One lane per Alert instance, breaching first. */
  instanceValues: InstanceValueSeries[];
  /** Instances the lane cap left out, so the chart can say so. */
  hiddenInstanceValues: number;
  /** Minutes one bucket covers, so the lanes keep a constant mark width
   *  whether or not the rule evaluated in every one of them. */
  bucketMinutes: number;
  /** `spec.interval_secs` in minutes: how far apart two readings are when the
   *  rule is healthy, which is what tells a lane's line from a lane's gap. */
  intervalMinutes: number;
  instanceSummary: string;
  timeline: LifecycleEvent[];
  definition: AlertDefinitionView;
  /** Silences overlapping the queried window, newest first. */
  silences: AlertSilenceRecord[];
  /** The silence the `silenced` status is attributed to, which is not always
   *  the most recent active one: a whole-rule silence outranks an
   *  instance-scoped one. Naming it keeps the header's duration and its
   *  "Expire silence" button pointed at the same row, and lets the list mark
   *  which of several overlapping silences is the one doing the muting. */
  activeSilenceId: string | null;
  /** `spec.for`, formatted, for the evaluation-state chain. */
  forClause: string;
};

/** The durations the silence dialog offers. The label and what it means travel
 *  together, so the two cannot drift apart and nothing has to parse a label
 *  back into a number: the dialog holds one of these and hands on its
 *  `minutes`. */
export const SILENCE_DURATIONS = [
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "2h", minutes: 120 },
  { label: "4h", minutes: 240 },
  { label: "12h", minutes: 720 },
  { label: "24h", minutes: 1440 },
] as const;
