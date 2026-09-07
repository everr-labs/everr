/**
 * What delivery did with a rule's last verdict, read from the notification
 * journal rather than from the rule's own state.
 */
import { and, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  type AlertingDefaultTier,
  defaultTierFor,
} from "@/data/alerting/delivery/defaults";
import type { AlertRuleRead } from "@/data/alerting/rules/read";
import { formatDurationSeconds } from "@/data/alerting/rules/resource/window";
import type { SilenceRow } from "@/data/alerting/silences/repository";
import { db } from "@/db/client";
import { alertDefaultChannels, alertEvents } from "@/db/schema";
import { formatClock, formatElapsed } from "./format";

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
  // One row per rule, as one index walk per rule.
  //
  // Written as a LATERAL over the ids rather than as DISTINCT ON over the
  // journal. The two return the same rows, but DISTINCT ON has to order the
  // whole matching set to pick its firsts, and no index offers that order, so
  // it reads every notifying row in the organization and sorts them on disk to
  // keep one per rule. PostgreSQL has no loose index scan to turn that back
  // into a walk, so the walk is spelled out: one ordered probe of
  // alert_events_org_definition_kind_idx per id, which costs the rule count
  // rather than the journal size.
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
    SELECT
      latest.source_definition_id, latest.event_type, latest.occurred_at,
      latest.processed_at, latest.suppressed, latest.silence_id,
      latest.notification_title,
      -- A processed event that never joined a group was ended by a terminal:
      -- the stamp alone says the pipeline let go of it, not that it sent
      -- anything.
      m.event_id IS NOT NULL AS grouped,
      m.flushed_at IS NOT NULL AS flushed
    -- sql.param, not a bare interpolation: the template spreads a plain array
    -- into one placeholder per element, which unnest cannot take.
    FROM unnest(${sql.param(definitionIds)}::uuid[]) AS definition_id
    CROSS JOIN LATERAL (
      SELECT e.id, e.source_definition_id, e.event_type, e.occurred_at,
             e.processed_at, e.suppressed, e.silence_id, e.notification_title
        FROM alert_events e
       WHERE e.organization_id = ${organizationId}
         AND e.source_definition_id = definition_id
         AND e.kind = 'notifying'
       -- Transitions from one evaluation share a timestamp. The id settles
       -- those ties without changing which timestamp wins.
       ORDER BY e.occurred_at DESC, e.id DESC
       LIMIT 1
    ) AS latest
    LEFT JOIN alert_notification_group_events m
      ON m.organization_id = ${organizationId} AND m.event_id = latest.id
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
): Promise<Set<AlertingDefaultTier>> {
  const rows = await db
    .selectDistinct({ tier: alertDefaultChannels.tier })
    .from(alertDefaultChannels)
    .where(eq(alertDefaultChannels.organizationId, organizationId));
  return new Set(rows.map((r) => r.tier));
}

/** Whether anything at all would carry this rule's notifications: its own
 *  declared channels, or a default tier that covers its severity. */
export function hasDeliveryTarget(
  row: AlertRuleRead,
  tiers: Set<AlertingDefaultTier>,
): boolean {
  if ((row.spec.notifications?.channels ?? []).length > 0) return true;
  return defaultTierFor(tiers, row.spec.severity) !== null;
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
  row: AlertRuleRead,
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
