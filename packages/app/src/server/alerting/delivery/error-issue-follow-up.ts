import { ERROR_FINGERPRINT_SQL, EXCEPTION_LOG_FILTER_SQL } from "@everr/telemetry-explorer/errors";
import { and, eq, isNull } from "drizzle-orm";
import { decryptChannelConfig } from "#app/data/alerting/delivery/channel-secrets.server.ts";
import { isIssueChannel } from "#app/data/alerting/delivery/issue-channels.ts";
import {
  ENVIRONMENT_SQL,
  ERROR_ISSUES_CHANNEL_NAME,
  ERROR_ISSUES_REPOID,
  optionsOfRule,
} from "#app/data/error-issues/detection.ts";
import { db } from "#app/db/client.ts";
import {
  alertChannels,
  alertDefinitions,
  alertTrackerIssueFixes,
  alertTrackerIssues,
} from "#app/db/schema/index.ts";
import { query } from "#app/lib/clickhouse.ts";
import { serverLogger } from "#app/telemetry/logger.ts";
import { type IssueTracker, type TrackedIssueStatus, trackerFor } from "./deliver-issue";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// How long after a close Everr keeps watching for the error.
const WATCH_MS = 30 * DAY_MS;
// Issues whose state is read per organization and run, oldest read first.
const CHECK_MAX = 50;
// Wider than the run interval, so a late run misses nothing.
const RECENT_MINUTES = 70;
// A release runs this long without the error before Everr calls it fixed.
const CONFIRM_AFTER_MS = DAY_MS;
// With no `service.version`, Everr cannot tell when the fix ships. It gives
// the deploy an hour before an occurrence counts, and three quiet days before
// it calls the error fixed.
const UNVERSIONED_GRACE_MS = HOUR_MS;
const UNVERSIONED_CONFIRM_AFTER_MS = 3 * DAY_MS;

const VERSION_SQL = "toString(ResourceAttributes.`service.version`)";

type Fix = typeof alertTrackerIssueFixes.$inferSelect;
type Issue = typeof alertTrackerIssues.$inferSelect & { fix: Fix | null };

function chTime(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

function errorFingerprint(issue: Issue): string | undefined {
  return issue.instanceLabels.fingerprint;
}

function issueKey(issue: {
  channelId: string;
  alertDefinitionId: string;
  instanceFingerprint: string;
}) {
  return and(
    eq(alertTrackerIssues.channelId, issue.channelId),
    eq(alertTrackerIssues.alertDefinitionId, issue.alertDefinitionId),
    eq(alertTrackerIssues.instanceFingerprint, issue.instanceFingerprint),
  );
}

function fixKey(issue: {
  channelId: string;
  alertDefinitionId: string;
  instanceFingerprint: string;
}) {
  return and(
    eq(alertTrackerIssueFixes.channelId, issue.channelId),
    eq(alertTrackerIssueFixes.alertDefinitionId, issue.alertDefinitionId),
    eq(alertTrackerIssueFixes.instanceFingerprint, issue.instanceFingerprint),
  );
}

/** The error's service, and the versions of it that ran in the day before the
 *  close: none of them can carry the fix. */
async function baselineAtClose(
  organizationId: string,
  environment: string,
  fingerprint: string,
  closedAt: Date,
): Promise<{ service: string; versions: string[] }> {
  const rows = await query<{ service: string; versions: string[] }>(
    `SELECT ServiceName AS service, arrayFilter(v -> v != '', groupUniqArray(${VERSION_SQL})) AS versions
FROM logs
WHERE Timestamp >= parseDateTime64BestEffort({closed:String}) - INTERVAL 1 DAY
  AND Timestamp <= parseDateTime64BestEffort({closed:String})
  AND ${ENVIRONMENT_SQL} = {env:String}
  AND ServiceName = (
    SELECT argMax(ServiceName, Timestamp)
    FROM logs
    WHERE Timestamp >= now() - INTERVAL 30 DAY
      AND ${EXCEPTION_LOG_FILTER_SQL.trim()}
      AND ${ENVIRONMENT_SQL} = {env:String}
      AND ${ERROR_FINGERPRINT_SQL} = {fingerprint:String}
  )
GROUP BY service`,
    organizationId,
    { closed: chTime(closedAt), env: environment, fingerprint },
  );
  return rows[0] ?? { service: "", versions: [] };
}

type Occurrence = { fingerprint: string; version: string; last_ms: string };

/** The watched errors' occurrences in the last hour or so, per version. */
async function recentOccurrences(
  organizationId: string,
  environment: string,
  fingerprints: string[],
): Promise<Occurrence[]> {
  return query<Occurrence>(
    `SELECT fingerprint, version, toString(toUnixTimestamp64Milli(max(Timestamp))) AS last_ms
FROM (
  SELECT Timestamp, ${ERROR_FINGERPRINT_SQL} AS fingerprint, ${VERSION_SQL} AS version
  FROM logs
  WHERE Timestamp >= now() - INTERVAL ${RECENT_MINUTES} MINUTE
    AND ${EXCEPTION_LOG_FILTER_SQL.trim()}
    AND ${ENVIRONMENT_SQL} = {env:String}
)
WHERE fingerprint IN {fingerprints:Array(String)}
GROUP BY fingerprint, version`,
    organizationId,
    { env: environment, fingerprints },
  );
}

type RunningVersion = { service: string; version: string; first_ms: string };

/** The versions the services ran in the last hour or so, with when each was
 *  first seen in that window. */
async function runningVersions(
  organizationId: string,
  environment: string,
  services: string[],
): Promise<RunningVersion[]> {
  return query<RunningVersion>(
    `SELECT ServiceName AS service, ${VERSION_SQL} AS version,
  toString(toUnixTimestamp64Milli(min(Timestamp))) AS first_ms
FROM logs
WHERE Timestamp >= now() - INTERVAL ${RECENT_MINUTES} MINUTE
  AND ${ENVIRONMENT_SQL} = {env:String}
  AND ServiceName IN {services:Array(String)}
  AND version != ''
GROUP BY service, version`,
    organizationId,
    { env: environment, services },
  );
}

/** How often the error happened since `since`, leaving out the versions that
 *  ran before the close. */
async function occurrencesSince(
  organizationId: string,
  environment: string,
  fingerprint: string,
  since: Date,
  versionsAtClose: string[],
): Promise<number> {
  const [row] = await query<{ occurrences: string }>(
    `SELECT toString(count()) AS occurrences
FROM logs
WHERE Timestamp >= parseDateTime64BestEffort({since:String})
  AND ${EXCEPTION_LOG_FILTER_SQL.trim()}
  AND ${ENVIRONMENT_SQL} = {env:String}
  AND ${VERSION_SQL} NOT IN {versions:Array(String)}
  AND ${ERROR_FINGERPRINT_SQL} = {fingerprint:String}`,
    organizationId,
    { since: chTime(since), env: environment, versions: versionsAtClose, fingerprint },
  );
  return Number(row?.occurrences ?? 0);
}

function regressionComment(at: Date, version: string): string {
  const where = version
    ? `in version \`${version}\`, which was not running when this issue closed`
    : "more than an hour after this issue closed";
  return `This error happened again at ${at.toISOString()}, ${where}. Everr reopened the issue.`;
}

function confirmedComment(fix: Fix, since: Date): string {
  if (fix.releasedVersion) {
    return `Fixed: version \`${fix.releasedVersion}\` has run since ${since.toISOString()} without this error.`;
  }
  return "No occurrence of this error in the 3 days since this issue closed. The service reports no `service.version`, so Everr cannot tell which release carries the fix.";
}

/** Read an issue's state and record what changed. A newly closed issue gets
 *  its fix row; a reopened one loses it. */
async function refreshIssue(
  organizationId: string,
  environment: string,
  tracker: IssueTracker,
  issue: Issue,
): Promise<void> {
  let status: TrackedIssueStatus;
  try {
    status = await tracker.state(issue.location, issue.externalId);
  } catch (error) {
    serverLogger.warn("error_issues.follow_up.state_failed", {
      "error_issues.provider": issue.provider,
      "error_issues.reason": error instanceof Error ? error.message : String(error),
    });
    return;
  }
  await db
    .update(alertTrackerIssues)
    .set({ state: status.state, stateCheckedAt: new Date() })
    .where(issueKey(issue));
  issue.state = status.state;

  if (status.state !== "done") {
    if (issue.fix) await db.delete(alertTrackerIssueFixes).where(fixKey(issue));
    issue.fix = null;
    return;
  }
  const closedAt = status.closedAt ?? new Date();
  if (issue.fix && issue.fix.closedAt.getTime() === closedAt.getTime()) return;
  const fingerprint = errorFingerprint(issue);
  if (!fingerprint) return;
  const baseline = await baselineAtClose(organizationId, environment, fingerprint, closedAt);
  const fix: Fix = {
    organizationId,
    channelId: issue.channelId,
    alertDefinitionId: issue.alertDefinitionId,
    instanceFingerprint: issue.instanceFingerprint,
    serviceName: baseline.service,
    closedAt,
    versionsAtClose: baseline.versions,
    releasedVersion: null,
    releasedAt: null,
    confirmedAt: null,
  };
  // Closed again after a reopen: what ran before is the new baseline.
  await db
    .insert(alertTrackerIssueFixes)
    .values(fix)
    .onConflictDoUpdate({
      target: [
        alertTrackerIssueFixes.channelId,
        alertTrackerIssueFixes.alertDefinitionId,
        alertTrackerIssueFixes.instanceFingerprint,
      ],
      set: {
        serviceName: fix.serviceName,
        closedAt,
        versionsAtClose: fix.versionsAtClose,
        releasedVersion: null,
        releasedAt: null,
        confirmedAt: null,
      },
    });
  issue.fix = fix;
}

async function reopenForRegression(
  tracker: IssueTracker,
  issue: Issue,
  at: Date,
  version: string,
): Promise<void> {
  // A person may have reopened it, or closed it as not planned, since the
  // last read.
  const { state } = await tracker.state(issue.location, issue.externalId);
  if (state === "not_planned") {
    await db.update(alertTrackerIssues).set({ state }).where(issueKey(issue));
    await db.delete(alertTrackerIssueFixes).where(fixKey(issue));
    return;
  }
  if (state === "done") await tracker.reopen(issue.location, issue.externalId);
  await tracker.comment(issue.location, issue.externalId, regressionComment(at, version));
  await db
    .update(alertTrackerIssues)
    .set({ state: "open", stateCheckedAt: new Date() })
    .where(issueKey(issue));
  await db.delete(alertTrackerIssueFixes).where(fixKey(issue));
}

async function followUpOrganization(rule: {
  organizationId: string;
  id: string;
  spec: (typeof alertDefinitions.$inferSelect)["spec"];
}): Promise<void> {
  const { organizationId } = rule;
  const environment = optionsOfRule(rule.spec)?.environment;
  if (!environment) return;
  const [channel] = await db
    .select()
    .from(alertChannels)
    .where(
      and(
        eq(alertChannels.organizationId, organizationId),
        eq(alertChannels.name, ERROR_ISSUES_CHANNEL_NAME),
      ),
    )
    .limit(1);
  if (!channel) return;
  const config = decryptChannelConfig(organizationId, channel.id, channel.encryptedConfig);
  if (!isIssueChannel(config)) return;
  const tracker = trackerFor(organizationId, config);

  const rows = await db
    .select({ issue: alertTrackerIssues, fix: alertTrackerIssueFixes })
    .from(alertTrackerIssues)
    .leftJoin(
      alertTrackerIssueFixes,
      and(
        eq(alertTrackerIssueFixes.channelId, alertTrackerIssues.channelId),
        eq(alertTrackerIssueFixes.alertDefinitionId, alertTrackerIssues.alertDefinitionId),
        eq(alertTrackerIssueFixes.instanceFingerprint, alertTrackerIssues.instanceFingerprint),
      ),
    )
    .where(
      and(
        eq(alertTrackerIssues.organizationId, organizationId),
        eq(alertTrackerIssues.channelId, channel.id),
        eq(alertTrackerIssues.alertDefinitionId, rule.id),
      ),
    );
  const now = Date.now();
  const issues: Issue[] = rows.map((row) => ({ ...row.issue, fix: row.fix }));
  const watching = (issue: Issue) =>
    issue.state === "done" && issue.fix !== null && issue.fix.closedAt.getTime() >= now - WATCH_MS;

  // Open issues, to notice a close; closed ones still watched, to notice a
  // reopen or a second close.
  const toCheck = issues
    .filter((issue) => issue.state === "open" || watching(issue))
    .sort((a, b) => (a.stateCheckedAt?.getTime() ?? 0) - (b.stateCheckedAt?.getTime() ?? 0))
    .slice(0, CHECK_MAX);
  for (const issue of toCheck) {
    await refreshIssue(organizationId, environment, tracker, issue);
  }

  const watched = issues.filter(watching);
  const fingerprints = watched.flatMap((issue) => errorFingerprint(issue) ?? []);
  if (fingerprints.length === 0) return;
  const occurrences = await recentOccurrences(organizationId, environment, fingerprints);
  const unreleased = watched.filter(
    (issue) => issue.fix?.releasedVersion === null && issue.fix.versionsAtClose.length > 0,
  );
  const services = [...new Set(unreleased.map((issue) => issue.fix?.serviceName ?? ""))].filter(
    Boolean,
  );
  const versions =
    services.length > 0 ? await runningVersions(organizationId, environment, services) : [];

  for (const issue of watched) {
    const fix = issue.fix;
    const fingerprint = errorFingerprint(issue);
    if (!fix || !fingerprint) continue;
    const versioned = fix.versionsAtClose.length > 0;
    const shipped = (version: string) => version !== "" && !fix.versionsAtClose.includes(version);
    const closedAt = fix.closedAt.getTime();

    const regression = occurrences.find((row) => {
      if (row.fingerprint !== fingerprint) return false;
      const last = Number(row.last_ms);
      return versioned
        ? last > closedAt && shipped(row.version)
        : last > closedAt + UNVERSIONED_GRACE_MS;
    });
    if (regression) {
      await reopenForRegression(
        tracker,
        issue,
        new Date(Number(regression.last_ms)),
        regression.version,
      );
      continue;
    }

    if (versioned && fix.releasedVersion === null) {
      const release = versions
        .filter((row) => row.service === fix.serviceName && shipped(row.version))
        .sort((a, b) => Number(a.first_ms) - Number(b.first_ms))[0];
      if (release) {
        fix.releasedVersion = release.version;
        fix.releasedAt = new Date(Number(release.first_ms));
        await db
          .update(alertTrackerIssueFixes)
          .set({ releasedVersion: fix.releasedVersion, releasedAt: fix.releasedAt })
          .where(fixKey(issue));
      }
    }

    if (fix.confirmedAt) continue;
    const since = versioned ? fix.releasedAt : new Date(closedAt + UNVERSIONED_GRACE_MS);
    const wait = versioned ? CONFIRM_AFTER_MS : UNVERSIONED_CONFIRM_AFTER_MS;
    if (!since || now - since.getTime() < wait) continue;
    const seen = await occurrencesSince(
      organizationId,
      environment,
      fingerprint,
      since,
      fix.versionsAtClose,
    );
    if (seen > 0) continue;
    await tracker.comment(issue.location, issue.externalId, confirmedComment(fix, since));
    await db
      .update(alertTrackerIssueFixes)
      .set({ confirmedAt: new Date() })
      .where(and(fixKey(issue), isNull(alertTrackerIssueFixes.confirmedAt)));
  }
}

/**
 * Follow each issue Everr opened for an error past its close. The issue
 * reopens when the error happens in a release that came after the close, and
 * gets one comment once such a release has run a day without it. Occurrences
 * in the versions that ran before the close do not count: a fix merged is not
 * a fix deployed.
 */
export async function followUpErrorIssues(): Promise<void> {
  const rules = await db
    .select({
      organizationId: alertDefinitions.organizationId,
      id: alertDefinitions.id,
      spec: alertDefinitions.spec,
    })
    .from(alertDefinitions)
    .where(
      and(
        eq(alertDefinitions.repoid, ERROR_ISSUES_REPOID),
        eq(alertDefinitions.project, "everr"),
        eq(alertDefinitions.slug, "new-errors"),
        eq(alertDefinitions.active, true),
        isNull(alertDefinitions.previewId),
      ),
    );
  for (const rule of rules) {
    try {
      await followUpOrganization(rule);
    } catch (error) {
      serverLogger.warn("error_issues.follow_up.failed", {
        "error_issues.organization_id": rule.organizationId,
        "error_issues.reason": error instanceof Error ? error.message : String(error),
      });
    }
  }
}
