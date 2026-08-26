/**
 * What delivery did with a rule's last verdict, read from the notification
 * journal rather than from the rule's own state.
 */
import { and, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { formatDurationSeconds } from "@/data/alerting/rules/resource/window";
import { db } from "@/db/client";
import { alertDefaultChannels, alertEvents } from "@/db/schema";
import { formatClock, formatElapsed } from "./format";
import type { DefinitionRow } from "./rules";
import type { SilenceRow } from "./silences";

export type NotificationFact = {
  eventType: string;
  occurredAt: Date;
  processedAt: Date | null;
  suppressed: boolean;
  silenceId: string | null;
  title: string;
  /** The event joined a notification group: something was going to carry it. */
  grouped: boolean;
  /** That membership was carried into a notification by a flush. Only this
   *  means anybody was told. */
  flushed: boolean;
};

export async function loadLatestNotifications(
  organizationId: string,
  definitionIds: string[],
): Promise<Map<string, NotificationFact>> {
  if (definitionIds.length === 0) return new Map();
  // One row per rule: the journal is append-only and indexed on
  // (organization, slug, occurred_at DESC), so DISTINCT ON walks one index
  // entry per rule instead of sorting the whole journal.
  const rows = await db.execute<{
    source_definition_id: string;
    event_type: string;
    occurred_at: Date;
    processed_at: Date | null;
    suppressed: boolean;
    silence_id: string | null;
    notification_title: string;
    grouped: boolean;
    flushed: boolean;
  }>(sql`
    SELECT DISTINCT ON (e.source_definition_id)
      e.source_definition_id, e.event_type, e.occurred_at, e.processed_at,
      e.suppressed, e.silence_id, e.notification_title,
      -- A processed event that never joined a group was ended by a terminal:
      -- the stamp alone says the pipeline let go of it, not that it sent
      -- anything.
      m.event_id IS NOT NULL AS grouped,
      m.flushed_at IS NOT NULL AS flushed
    FROM alert_events e
    LEFT JOIN alert_notification_group_events m
      ON m.organization_id = e.organization_id AND m.event_id = e.id
    WHERE e.organization_id = ${organizationId}
      AND e.kind = 'notifying'
      AND ${inArray(sql`e.source_definition_id`, definitionIds)}
    ORDER BY e.source_definition_id, e.occurred_at DESC
  `);
  return new Map(
    rows.rows.map((r) => [
      r.source_definition_id,
      {
        eventType: r.event_type,
        occurredAt: new Date(r.occurred_at),
        processedAt: r.processed_at ? new Date(r.processed_at) : null,
        suppressed: r.suppressed,
        silenceId: r.silence_id,
        title: r.notification_title,
        grouped: r.grouped,
        flushed: r.flushed,
      },
    ]),
  );
}

/** How many notifications a silence is currently holding for a rule. */
export async function loadHeldCounts(
  organizationId: string,
  definitionIds: string[],
): Promise<Map<string, number>> {
  if (definitionIds.length === 0) return new Map();
  const rows = await db
    .select({
      definitionId: alertEvents.sourceDefinitionId,
      held: count(),
    })
    .from(alertEvents)
    .where(
      and(
        eq(alertEvents.organizationId, organizationId),
        isNull(alertEvents.processedAt),
        isNotNull(alertEvents.silenceId),
        inArray(alertEvents.sourceDefinitionId, definitionIds),
      ),
    )
    .groupBy(alertEvents.sourceDefinitionId);
  return new Map(rows.map((r) => [r.definitionId, r.held]));
}

/**
 * The default-destination tiers the org has channels for. A rule with no
 * channels of its own delivers through one of these, and when neither exists
 * nothing can be sent at all, whatever the pipeline stamps on the event.
 */
export async function loadDefaultTiers(
  organizationId: string,
): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ tier: alertDefaultChannels.tier })
    .from(alertDefaultChannels)
    .where(eq(alertDefaultChannels.organizationId, organizationId));
  return new Set(rows.map((r) => r.tier));
}

/** Whether anything at all would carry this rule's notifications: its own
 *  declared channels, or a default tier that covers its severity. */
export function hasDeliveryTarget(
  row: DefinitionRow,
  tiers: Set<string>,
): boolean {
  if ((row.spec.notifications?.channels ?? []).length > 0) return true;
  return tiers.has("all") || tiers.has(row.spec.severity);
}

/** Everything delivery knows about one rule right now, gathered once so the
 *  board and the detail read the same facts. */
export type DeliveryFacts = {
  /** The journal's last word on the rule; absent before it has said any. */
  latest: NotificationFact | undefined;
  /** The silence in force for the rule, if any. */
  silence: SilenceRow | null;
  /** Notifications that silence is holding. */
  held: number;
  hasTarget: boolean;
};

/**
 * The notification story for the row, from what the journal actually did with
 * the last verdict rather than from the rule's own state.
 *
 * Under a silence it says what the silence is doing to delivery and nothing
 * about the silence itself: the row's chip and the detail's header both name
 * the silence already, and this is the phrase that follows the name.
 */
export function notificationText(
  row: DefinitionRow,
  delivery: DeliveryFacts,
  now: Date,
): string {
  if (row.degradedSince !== null) {
    const since = row.lastErrorAt
      ? formatClock(row.lastErrorAt)
      : "the last attempt";
    const cap = row.spec.max_interval_secs
      ? ` · retry capped at ${formatDurationSeconds(row.spec.max_interval_secs)}`
      : "";
    return `no verdict since ${since}${cap}`;
  }
  if (delivery.silence) {
    const { held } = delivery;
    return held > 0
      ? `${held} ${held === 1 ? "notification" : "notifications"} held · none sent`
      : "nothing will be sent";
  }
  if (row.currentState === "pending") {
    return "not notified · pending never delivers";
  }
  const fact = delivery.latest;
  if (!fact) return "nothing sent yet";
  const ago = formatElapsed(now.getTime() - fact.occurredAt.getTime());
  if (fact.suppressed) return `notification suppressed · ${ago} ago`;
  if (fact.processedAt === null || (fact.grouped && !fact.flushed))
    return `queued · ${ago} ago`;
  // Processed without ever joining a group means the chain ended in a
  // terminal: `no_channels` when nothing would have carried it, otherwise the
  // instance had stopped firing before delivery ran. Reading the stamp alone
  // reported these as delivered.
  if (!fact.grouped) {
    return delivery.hasTarget
      ? `not sent · stopped firing first · ${ago} ago`
      : "not sent · no channel for this rule";
  }
  const what = fact.eventType === "instance_resolved" ? "resolved" : "notified";
  return fact.title
    ? `${what} · ${fact.title} · ${ago} ago`
    : `${what} · ${ago} ago`;
}
