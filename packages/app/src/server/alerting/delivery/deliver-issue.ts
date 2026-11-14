import { and, desc, eq, sql } from "drizzle-orm";
import type { IssueChannelConfig } from "#app/data/alerting/delivery/issue-channels.ts";
import { ChannelSendError } from "#app/data/alerting/delivery/providers/outbound.ts";
import {
  ANN_ALERTING_LINK_ALERT,
  ANN_ALERTING_LINK_RUNBOOK,
  ANN_ISSUES_QUIET,
} from "#app/data/alerting/resource-annotations.ts";
import { rulePath, ruleTitle } from "#app/data/alerting/rules/read.ts";
import { db } from "#app/db/client.ts";
import {
  alertDefinitions,
  alertDeliveryEvents,
  alertEvents,
  alertHeldIssueDeliveries,
  alertInstances,
  alertTrackerIssues,
} from "#app/db/schema/index.ts";
import { githubTracker } from "./github-tracker";
import { IssueHoldError } from "./issue-holds";
import { linearTracker } from "./linear-tracker";
import {
  type TrackerIssueInput,
  trackerIssueBody,
  trackerIssueTitle,
  trackerRefiredComment,
  trackerResolvedComment,
} from "./tracker-issue";

/** Where an issue stands, in the terms the lifecycle below decides by. */
export type TrackedIssueState = "open" | "done" | "not_planned";

/** An issue tracker as an alert instance's lifecycle needs it. */
export interface IssueTracker {
  provider: (typeof alertTrackerIssues.$inferSelect)["provider"];
  /** Where a new issue goes, checked as writable. `repoid` is the rule's,
   *  `evidence` the instance's row, which can name the code it comes from. */
  locate(source: { repoid: string; evidence: Record<string, unknown> }): Promise<string>;
  /** Throws a permanent "withheld" error when the channel's cap is reached.
   *  `tracked` is the channel's most recent issue ids, newest first. */
  checkCapacity(location: string, tracked: string[]): Promise<void>;
  create(
    location: string,
    issue: { title: string; body: string },
  ): Promise<{ id: string; url: string }>;
  state(location: string, id: string): Promise<TrackedIssueState>;
  reopen(location: string, id: string): Promise<void>;
  comment(location: string, id: string, body: string): Promise<void>;
}

function trackerFor(organizationId: string, config: IssueChannelConfig): IssueTracker {
  switch (config.type) {
    case "github_issues":
      return githubTracker(organizationId, config);
    case "linear":
      return linearTracker(config);
  }
}

// Enough history to count what is still open: the cap is at most 50.
const CAPACITY_LOOKBACK = 250;

/** The one event an issue delivery carries, with what the issue text needs. */
async function loadDeliveryEvent(dedupKey: string) {
  const [row] = await db
    .select({
      event: alertEvents,
      definition: {
        id: alertDefinitions.id,
        repoid: alertDefinitions.repoid,
        project: alertDefinitions.project,
        slug: alertDefinitions.slug,
        spec: alertDefinitions.spec,
      },
      evidence: alertInstances.evidence,
    })
    .from(alertDeliveryEvents)
    .innerJoin(
      alertEvents,
      and(
        eq(alertDeliveryEvents.organizationId, alertEvents.organizationId),
        eq(alertDeliveryEvents.eventId, alertEvents.id),
      ),
    )
    .innerJoin(
      alertDefinitions,
      and(
        eq(alertEvents.organizationId, alertDefinitions.organizationId),
        eq(alertEvents.sourceDefinitionId, alertDefinitions.id),
      ),
    )
    .leftJoin(
      alertInstances,
      and(
        eq(alertInstances.alertDefinitionId, alertEvents.sourceDefinitionId),
        eq(alertInstances.fingerprint, alertEvents.instanceFingerprint),
      ),
    )
    .where(eq(alertDeliveryEvents.deliveryDedupKey, dedupKey))
    .limit(1);
  return row;
}

async function loadTrackedIssue(channelId: string, definitionId: string, fingerprint: string) {
  const [issue] = await db
    .select()
    .from(alertTrackerIssues)
    .where(
      and(
        eq(alertTrackerIssues.channelId, channelId),
        eq(alertTrackerIssues.alertDefinitionId, definitionId),
        eq(alertTrackerIssues.instanceFingerprint, fingerprint),
      ),
    )
    .limit(1);
  return issue;
}

async function recentTrackedIds(channelId: string): Promise<string[]> {
  const rows = await db
    .select({ externalId: alertTrackerIssues.externalId })
    .from(alertTrackerIssues)
    .where(eq(alertTrackerIssues.channelId, channelId))
    .orderBy(desc(alertTrackerIssues.updatedAt))
    .limit(CAPACITY_LOOKBACK);
  return rows.map((row) => row.externalId);
}

function holdKey(input: { organizationId: string; dedupKey: string }) {
  return and(
    eq(alertHeldIssueDeliveries.organizationId, input.organizationId),
    eq(alertHeldIssueDeliveries.deliveryDedupKey, input.dedupKey),
  );
}

// A retry that waits again keeps the time it first waited from, so a hold
// still expires a week after it began however often it is tried.
async function holdDelivery(
  input: { organizationId: string; dedupKey: string },
  hold: IssueHoldError,
  location: string | null,
): Promise<void> {
  const what = { reason: hold.reason, serviceName: hold.service, location };
  await db
    .insert(alertHeldIssueDeliveries)
    .values({ organizationId: input.organizationId, deliveryDedupKey: input.dedupKey, ...what })
    .onConflictDoUpdate({
      target: [alertHeldIssueDeliveries.organizationId, alertHeldIssueDeliveries.deliveryDedupKey],
      set: what,
    });
}

// Nothing to wait for any more: it opens now, or fails for a reason waiting
// does not change.
async function releaseHold(input: { organizationId: string; dedupKey: string }): Promise<void> {
  await db.delete(alertHeldIssueDeliveries).where(holdKey(input));
}

/**
 * Deliver one alert instance's event to an issue tracker. A fire opens the
 * instance's issue, or comments on the one it already has, reopening it
 * unless someone closed it as not planned. A resolve comments and leaves the
 * issue open, because an alert can stop firing without anything being fixed.
 */
export async function deliverIssue(input: {
  organizationId: string;
  channelId: string;
  config: IssueChannelConfig;
  dedupKey: string;
}): Promise<void> {
  const row = await loadDeliveryEvent(input.dedupKey);
  if (!row) {
    throw new ChannelSendError("the alert event behind this delivery no longer exists", {
      permanent: true,
    });
  }
  const { event, definition } = row;
  const tracker = trackerFor(input.organizationId, input.config);
  const tracked = await loadTrackedIssue(input.channelId, definition.id, event.instanceFingerprint);

  const quiet = definition.spec.annotations?.[ANN_ISSUES_QUIET] === "true";

  if (event.eventType === "instance_resolved") {
    // Nothing to say on an issue that was never opened, for example because
    // the cap withheld it.
    if (!tracked || quiet) return;
    await tracker.comment(
      tracked.location,
      tracked.externalId,
      trackerResolvedComment(event.occurredAt),
    );
    return;
  }

  const content: TrackerIssueInput = {
    rulePath: rulePath(definition),
    ruleName: ruleTitle(definition),
    severity: event.severity,
    title: event.notificationTitle,
    description: event.notificationDescription,
    labels: event.instanceLabels,
    evidence: row.evidence ?? {},
    occurredAt: event.occurredAt,
    alertLink: definition.spec.annotations?.[ANN_ALERTING_LINK_ALERT],
    runbookLink: definition.spec.annotations?.[ANN_ALERTING_LINK_RUNBOOK],
  };

  if (tracked) {
    const state = await tracker.state(tracked.location, tracked.externalId);
    // Closed as not planned is a person deciding against the work. A new
    // fire does not overrule that, and a comment there would only be noise.
    if (state === "not_planned") return;
    if (state === "open" && quiet) return;
    if (state === "done") await tracker.reopen(tracked.location, tracked.externalId);
    await tracker.comment(tracked.location, tracked.externalId, trackerRefiredComment(content));
    return;
  }

  let location: string | null = null;
  try {
    location = await tracker.locate({
      repoid: definition.repoid,
      // A rule can carry the service as a label column or as evidence.
      evidence: { ...event.instanceLabels, ...row.evidence },
    });
    await tracker.checkCapacity(location, await recentTrackedIds(input.channelId));
  } catch (cause) {
    // Kept to send again once what it waits for changes. The send job still
    // records the failure, so the trail says why nothing opened yet.
    if (cause instanceof IssueHoldError) {
      await holdDelivery(input, cause, location);
    } else {
      await releaseHold(input);
    }
    throw cause;
  }
  await releaseHold(input);
  const created = await tracker.create(location, {
    title: trackerIssueTitle(content),
    body: trackerIssueBody(content),
  });
  const record = () =>
    db
      .insert(alertTrackerIssues)
      .values({
        organizationId: input.organizationId,
        channelId: input.channelId,
        alertDefinitionId: definition.id,
        instanceFingerprint: event.instanceFingerprint,
        instanceLabels: event.instanceLabels,
        provider: tracker.provider,
        location,
        externalId: created.id,
        url: created.url,
      })
      .onConflictDoUpdate({
        target: [
          alertTrackerIssues.channelId,
          alertTrackerIssues.alertDefinitionId,
          alertTrackerIssues.instanceFingerprint,
        ],
        set: {
          provider: tracker.provider,
          location,
          externalId: created.id,
          url: created.url,
          updatedAt: sql`now()`,
        },
      });
  // The issue exists now. A failed write here makes the retry open a second
  // one, so it gets a second chance before the job gives up.
  try {
    await record();
  } catch {
    await record();
  }
}
