import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  createChannel,
  listChannels,
  updateChannel,
} from "#app/data/alerting/delivery/repository.ts";
import {
  createRule,
  pauseRule,
  resumeRule,
  updateRule,
} from "#app/data/alerting/rules/repository.ts";
import { capacityHeldCount } from "#app/data/alerting/delivery/held-issues.server.ts";
import { AlertingChannelConfigInputSchema } from "#app/data/alerting/schema.ts";
import type { AlertingMutationScope } from "#app/data/alerting/session.ts";
import type { AlertingChannelConfig } from "#app/data/alerting/types.ts";
import { db } from "#app/db/client.ts";
import { alertDefinitions, alertTrackerIssues } from "#app/db/schema/index.ts";
import { authEnv } from "#app/env/auth.ts";
import { query } from "#app/lib/clickhouse.ts";
import {
  ERROR_ISSUES_CHANNEL_NAME,
  ERROR_ISSUES_REPOID,
  ERROR_ISSUES_RULE_NAME,
  ENVIRONMENT_SQL,
  ErrorIssuesEnvironmentSchema,
  environmentOfRule,
  newErrorsRuleSpec,
} from "./detection";

// Everr's defaults for a managed channel: the label an agent workflow or a
// Linear rule starts on, and a cap that keeps a first switch-on from filing
// every new error at once.
const MANAGED_LABELS = ["everr-fix"];
const MANAGED_MAX_OPEN = 5;

export const ErrorIssuesSettingsSchema = z.object({
  environment: ErrorIssuesEnvironmentSchema,
  target: z.discriminatedUnion("type", [
    // Each error goes to its service's repository (see `repositoryForService`).
    z.object({
      type: z.literal("github_issues"),
      // GitHub logins to assign each issue to. An agent that works from
      // assigned issues starts on its own.
      assignees: z
        .array(
          z
            .string()
            .trim()
            .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/, {
              error: "assignees must be GitHub logins",
            }),
        )
        .max(10)
        .optional(),
    }),
    z.object({
      type: z.literal("linear"),
      // Omitted to keep the key saved on the managed channel.
      api_key: z.string().min(1).optional(),
      team: z.string(),
      assignee: z.string().trim().optional(),
    }),
  ]),
});
export type ErrorIssuesSettings = z.infer<typeof ErrorIssuesSettingsSchema>;

export type ErrorIssuesState = {
  enabled: boolean;
  environment: string | null;
  /** The managed channel's config, with its secret redacted. */
  target: AlertingChannelConfig | null;
  /** New errors waiting for one of the open issues to close. */
  waiting: number;
};

async function managedRule(organizationId: string) {
  const [rule] = await db
    .select({
      id: alertDefinitions.id,
      active: alertDefinitions.active,
      spec: alertDefinitions.spec,
    })
    .from(alertDefinitions)
    .where(
      and(
        eq(alertDefinitions.organizationId, organizationId),
        eq(alertDefinitions.repoid, ERROR_ISSUES_REPOID),
        eq(alertDefinitions.project, "everr"),
        eq(alertDefinitions.slug, "new-errors"),
        isNull(alertDefinitions.previewId),
      ),
    )
    .limit(1);
  return rule;
}

export type TrackedErrorIssue = {
  provider: "github" | "linear";
  /** `#12` on GitHub, the issue key such as `ENG-12` on Linear. */
  label: string;
  /** Where it lives: `owner/name` on GitHub. */
  location: string;
  url: string;
};

// More than the Errors list shows at once: issues open at most a few a day.
const TRACKED_LIMIT = 500;

/** The issue each error opened, by error fingerprint, most recent first. */
export async function trackedErrorIssues(
  organizationId: string,
): Promise<Record<string, TrackedErrorIssue>> {
  const rule = await managedRule(organizationId);
  if (!rule) return {};
  const rows = await db
    .select({
      labels: alertTrackerIssues.instanceLabels,
      provider: alertTrackerIssues.provider,
      location: alertTrackerIssues.location,
      externalId: alertTrackerIssues.externalId,
      url: alertTrackerIssues.url,
    })
    .from(alertTrackerIssues)
    .where(
      and(
        eq(alertTrackerIssues.organizationId, organizationId),
        eq(alertTrackerIssues.alertDefinitionId, rule.id),
      ),
    )
    .orderBy(desc(alertTrackerIssues.updatedAt))
    .limit(TRACKED_LIMIT);
  const tracked: Record<string, TrackedErrorIssue> = {};
  for (const row of rows) {
    const fingerprint = row.labels.fingerprint;
    if (!fingerprint || fingerprint in tracked) continue;
    tracked[fingerprint] = {
      provider: row.provider,
      label:
        row.provider === "github"
          ? `#${row.externalId}`
          : (/\/issue\/([A-Za-z0-9]+-\d+)/.exec(row.url)?.[1] ?? "Linear issue"),
      location: row.location,
      url: row.url,
    };
  }
  return tracked;
}

/** The environments services reported in the last week, for the setup's picker. */
export async function listEnvironments(organizationId: string): Promise<string[]> {
  const rows = await query<{ environment: string }>(
    `SELECT DISTINCT ${ENVIRONMENT_SQL} AS environment
FROM logs
WHERE Timestamp >= now() - INTERVAL 7 DAY
  AND environment != ''
ORDER BY environment
LIMIT 50`,
    organizationId,
  );
  return rows.map((row) => row.environment);
}

export async function getErrorIssues(organizationId: string): Promise<ErrorIssuesState> {
  const [rule, channels, waiting] = await Promise.all([
    managedRule(organizationId),
    listChannels(organizationId),
    capacityHeldCount(organizationId, ERROR_ISSUES_CHANNEL_NAME),
  ]);
  const channel = channels.find((candidate) => candidate.name === ERROR_ISSUES_CHANNEL_NAME);
  return {
    enabled: rule?.active ?? false,
    environment: rule ? environmentOfRule(rule.spec) : null,
    target: channel?.config ?? null,
    waiting,
  };
}

/**
 * Turn issues for new errors on, or change where they go. Everr keeps one
 * channel and one rule for this, and both are ordinary resources: they show
 * on the Notifications page and in Triage like any other.
 */
export async function enableErrorIssues(
  scope: AlertingMutationScope,
  rawSettings: unknown,
): Promise<ErrorIssuesState> {
  const settings = ErrorIssuesSettingsSchema.parse(rawSettings);
  const target = settings.target;
  const config = AlertingChannelConfigInputSchema.parse(
    target.type === "github_issues"
      ? {
          type: "github_issues",
          labels: MANAGED_LABELS,
          assignees: target.assignees ?? [],
          max_open: MANAGED_MAX_OPEN,
        }
      : {
          type: "linear",
          ...(target.api_key ? { api_key: target.api_key } : {}),
          team: target.team,
          labels: MANAGED_LABELS,
          ...(target.assignee ? { assignee: target.assignee } : {}),
          max_open: MANAGED_MAX_OPEN,
        },
  );
  const channels = await listChannels(scope.organizationId);
  if (channels.some((channel) => channel.name === ERROR_ISSUES_CHANNEL_NAME)) {
    await updateChannel(scope, ERROR_ISSUES_CHANNEL_NAME, { config });
  } else {
    await createChannel(scope, { name: ERROR_ISSUES_CHANNEL_NAME, config });
  }

  const spec = newErrorsRuleSpec(settings.environment, authEnv.BETTER_AUTH_URL);
  const rule = await managedRule(scope.organizationId);
  if (!rule) {
    await createRule(
      scope.organizationId,
      { ...spec, name: ERROR_ISSUES_RULE_NAME, repoid: ERROR_ISSUES_REPOID, previewId: null },
      db,
    );
  } else {
    await updateRule(scope.organizationId, rule.id, spec, undefined, db);
    if (!rule.active) await resumeRule(scope, rule.id);
  }
  return getErrorIssues(scope.organizationId);
}

/** Stop filing issues. The rule is paused, not deleted, so issues already
 *  filed stay linked to their errors if it is turned on again. */
export async function disableErrorIssues(scope: AlertingMutationScope): Promise<ErrorIssuesState> {
  const rule = await managedRule(scope.organizationId);
  if (rule?.active) await pauseRule(scope, rule.id);
  return getErrorIssues(scope.organizationId);
}
