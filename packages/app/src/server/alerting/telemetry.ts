import {
  type Attributes,
  type Link,
  metrics,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  TraceFlags,
  trace,
} from "@opentelemetry/api";

/**
 * Every alerting hop is a queue hop, so a job's span links to its enqueuer
 * rather than parenting under it. Parent-child would claim one trace spans the
 * whole chain, which is false here three times over: `evaluate` fans out one
 * event per transition, `flush-group` fans out one delivery per channel, and a
 * silence can defer an event for hours before it flushes. A link keeps every
 * job independently sized and sampled while still naming what caused it.
 *
 * Causality itself lives in `alert_events`, not in the trace. But that journal
 * is customer data behind a row policy scoping it to one organization, so
 * only the owning tenant can read it. These spans belong to Everr and are the
 * only cross-tenant view of the engine: for an operator they carry the whole
 * story, and `everr.alert.episode_id` is what groups one incident together.
 */
const tracer = trace.getTracer("everr-app.alerting");
const meter = metrics.getMeter("everr-app.alerting");

const evaluations = meter.createCounter("alerts.evaluations", {
  description: "Alert rule evaluations, by outcome",
  unit: "1",
});

const transitions = meter.createCounter("alerts.instance.transitions", {
  description: "Alert instance state transitions, by kind",
  unit: "1",
});

const notifications = meter.createCounter("alerts.notifications", {
  description: "Notification delivery attempts, by channel type and outcome",
  unit: "1",
});

// The only duration kept as a metric. A job's own elapsed time is already the
// span's Duration, measured better (percentiles, and per tenant); this one
// spans four jobs and two queue waits, so no single span holds it.
const notificationLatency = meter.createHistogram(
  "alerts.notification.latency",
  {
    description:
      "Time from the observation that opened an alert to its notification being delivered",
    unit: "s",
  },
);

/**
 * Metric attributes stay bounded on purpose: no rule id, no organization, no
 * channel name. Per-rule questions are answered by spans (which carry the rule
 * slug) and by `alert_events`; putting an id here would mint a time series per
 * rule per org.
 */
type EvaluationOutcome = "ok" | "query_failed" | "invalid_payload" | "skipped";

type NotificationOutcome =
  | "delivered"
  | "failed_transient"
  | "failed_permanent"
  | "withheld";

export function recordAlertEvaluation(outcome: EvaluationOutcome): void {
  evaluations.add(1, { "everr.alert.outcome": outcome });
}

export function recordAlertTransition(transition: string): void {
  transitions.add(1, { "everr.alert.transition": transition });
}

/**
 * One outcome, recorded once. The span and the metric carried the same label
 * from two call sites before, which is two places for them to drift apart.
 */
export function recordAlertNotification(opts: {
  channelType: string;
  outcome: NotificationOutcome;
  /** Absent when the delivery carried no event to measure from. */
  latencySeconds?: number;
}): void {
  setAlertSpanAttributes({
    channelType: opts.channelType,
    outcome: opts.outcome,
  });
  notifications.add(1, {
    "everr.alert.channel.type": opts.channelType,
    "everr.alert.outcome": opts.outcome,
  });
  if (opts.outcome === "delivered" && opts.latencySeconds !== undefined) {
    notificationLatency.record(opts.latencySeconds, {
      "everr.alert.channel.type": opts.channelType,
    });
  }
}

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

function linksFrom(traceparent: string | null | undefined): Link[] {
  if (!traceparent) return [];
  const match = TRACEPARENT.exec(traceparent);
  if (!match) return [];
  const [, traceId, spanId, flags] = match;
  return [
    {
      context: {
        traceId,
        spanId,
        traceFlags: Number.parseInt(flags, 16) & TraceFlags.SAMPLED,
        isRemote: true,
      },
    },
  ];
}

/**
 * Runs one alerting job as its own root span.
 *
 * The task list binds every handler to ROOT_CONTEXT, so there is no ambient
 * parent to inherit and none is wanted: `startActiveSpan` here always begins a
 * new trace, and the enqueuer is named by a link instead.
 */
export async function withAlertJobSpan<T>(
  name: string,
  opts: { traceparent?: string | null; attributes?: Attributes },
  run: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(
    name,
    {
      kind: SpanKind.CONSUMER,
      links: linksFrom(opts.traceparent),
      attributes: opts.attributes,
    },
    ROOT_CONTEXT,
    async (span) => {
      try {
        return await run();
      } catch (error) {
        // The message matters: a status with an empty description tells an
        // on-call nothing about which failure this was.
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * Names the work on the job's own span once the handler has read enough to
 * know what it is. `episode_id` is the correlation key: an episode is one
 * instance's open-to-close life, so grouping by it reassembles an incident
 * across the four traces that handled it.
 *
 * Absent identity is omitted rather than sent empty, so a query can tell
 * "no episode" from "an episode whose id is blank".
 */
export function setAlertSpanAttributes(opts: {
  /**
   * The owning organization. High cardinality, which is exactly why it
   * belongs here and not on a metric: operating a multitenant fleet means
   * asking whose rules are slow and who is starving whom, and that question
   * has no answer without this on the span.
   */
  tenant?: string | null;
  slug?: string | null;
  episodeId?: string | null;
  eventId?: string | null;
  channelType?: string | null;
  /** Work claimed by one run, and whether a cap is what bounded it. */
  batchSize?: number;
  /**
   * A cap that binds silently is the classic operational blind spot: the
   * scanner leaves a backlog for the next tick and a flush splits an
   * oversized group, both invisible while lag climbs for reasons the
   * dashboard cannot name.
   */
  batchCapped?: boolean;
  /** Notifications this flush actually created. */
  deliveries?: number;
  /** How late a job ran against the moment it was scheduled for. */
  scheduleLagMs?: number;
  /** Time from the event that fired to this notification going out. */
  fireToPageMs?: number;
  /** Bounded outcome label, so a span can be filtered the way a metric is. */
  outcome?: string | null;
  /** Transitions this evaluation produced, by kind. */
  fired?: number;
  resolved?: number;
}): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.setAttributes({
    ...(opts.tenant ? { "everr.alert.tenant": opts.tenant } : {}),
    ...(opts.slug ? { "everr.alert.rule": opts.slug } : {}),
    ...(opts.episodeId ? { "everr.alert.episode_id": opts.episodeId } : {}),
    ...(opts.eventId ? { "everr.alert.event_id": opts.eventId } : {}),
    ...(opts.channelType
      ? { "everr.alert.channel.type": opts.channelType }
      : {}),
    ...(opts.batchSize === undefined
      ? {}
      : { "everr.alert.batch.size": opts.batchSize }),
    ...(opts.batchCapped === undefined
      ? {}
      : { "everr.alert.batch.capped": opts.batchCapped }),
    ...(opts.deliveries === undefined
      ? {}
      : { "everr.alert.deliveries": opts.deliveries }),
    ...(opts.scheduleLagMs === undefined
      ? {}
      : { "everr.alert.schedule_lag_ms": opts.scheduleLagMs }),
    ...(opts.fireToPageMs === undefined
      ? {}
      : { "everr.alert.fire_to_page_ms": opts.fireToPageMs }),
    ...(opts.outcome ? { "everr.alert.outcome": opts.outcome } : {}),
    ...(opts.fired === undefined ? {} : { "everr.alert.fired": opts.fired }),
    ...(opts.resolved === undefined
      ? {}
      : { "everr.alert.resolved": opts.resolved }),
  });
}
