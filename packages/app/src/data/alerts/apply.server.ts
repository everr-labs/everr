import { createHash } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { ApplyValidationError } from "@/data/as-code/errors";
import type { Reconciler } from "@/data/as-code/registry";
import type { ApplyResourceEntry, ApplySource } from "@/data/as-code/schema";
import { db } from "@/db/client";
import { alertDefinitions } from "@/db/schema";
import { querySqlApiWithMeta, type SqlApiResult } from "@/lib/clickhouse";
import { errorMessage } from "@/telemetry/logger";
import {
  type AlertRuleYaml,
  AlertRuleYamlSchema,
  identityKey,
  parseNotebookRef,
} from "./schema";
import {
  validateMessageColumns,
  validateMessageTemplate,
  validateQueryTemplate,
} from "./template";
import { parseEvaluationInterval } from "./window";

interface DesiredAlert {
  slug: string;
  project: string;
  notebookProject: string;
  notebookSlug: string;
  evaluationIntervalSeconds: number;
  document: AlertRuleYaml;
  parsedQuery: string;
  notificationTitleTemplate: string;
  notificationDescriptionTemplate: string;
  instanceLabelColumns: string[];
  scheduleJitterSeconds: number;
  configFilePath: string;
  sourceLink: string;
}

interface ExistingAlert extends DesiredAlert {
  active: boolean;
}

interface ApplyAlertsResult {
  created: string[];
  updated: string[];
  deleted: string[];
}

function pathForLink(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function normalizeRemote(remote: string): string {
  const ssh = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(remote);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  return remote.replace(/\/$/, "").replace(/\.git$/, "");
}

function sourceLink(source: ApplySource | undefined, path: string): string {
  if (!source?.remote || !source.commitSha) return "";
  return `${normalizeRemote(source.remote)}/blob/${source.commitSha}/${pathForLink(
    path,
  )}`;
}

function scheduleJitterSeconds(
  orgId: string,
  repoid: string,
  project: string,
  slug: string,
  evaluationIntervalSeconds: number,
): number {
  const spread = Math.min(evaluationIntervalSeconds, 5);
  const hash = createHash("sha256")
    .update(`${orgId}\0${repoid}\0${project}\0${slug}`)
    .digest();
  return hash.readUInt32BE(0) % spread;
}

function validationError(path: string, error: unknown): ApplyValidationError {
  const message = errorMessage(error);
  return new ApplyValidationError(`${path}: ${message}`);
}

// Static validation: schema, evaluation interval, template syntax. No I/O.
function parseAlertRule(path: string, resource: unknown) {
  const parsed = AlertRuleYamlSchema.safeParse(resource);
  if (!parsed.success) {
    throw new ApplyValidationError(
      `${path}: invalid alert rule: ${parsed.error.issues[0]?.message ?? "invalid alert rule"}`,
    );
  }

  const rule = parsed.data;
  let evaluationIntervalSeconds: number;
  try {
    evaluationIntervalSeconds = parseEvaluationInterval(
      rule.spec.evaluationInterval,
    );
    validateQueryTemplate(rule.spec.query);
    validateMessageTemplate(rule.spec.notificationMessage.title);
    if (rule.spec.notificationMessage.description) {
      validateMessageTemplate(rule.spec.notificationMessage.description);
    }
  } catch (error) {
    throw validationError(path, error);
  }

  return {
    rule,
    slug: rule.metadata.name,
    project: rule.metadata.project ?? "default",
    evaluationIntervalSeconds,
  };
}

// Result-dependent validation: run the rule's query against the org's data and
// check template/instance-label columns against the result schema.
async function validateAlertRuleQuery(
  path: string,
  rule: AlertRuleYaml,
  organizationId: string,
): Promise<{ instanceLabelColumns: string[] }> {
  let queryResult: SqlApiResult<Record<string, unknown>>;
  try {
    queryResult = await querySqlApiWithMeta<Record<string, unknown>>(
      rule.spec.query,
      organizationId,
    );
  } catch (error) {
    throw new ApplyValidationError(
      `${path}: query failed: ${errorMessage(error)}`,
    );
  }

  try {
    validateMessageColumns(
      rule.spec.notificationMessage.title,
      queryResult.columns,
    );
    if (rule.spec.notificationMessage.description) {
      validateMessageColumns(
        rule.spec.notificationMessage.description,
        queryResult.columns,
      );
    }
  } catch (error) {
    throw validationError(path, error);
  }

  const instanceLabelColumns = rule.spec.instanceLabels ?? [];
  const columnNames = new Set(queryResult.columns);
  for (const column of instanceLabelColumns) {
    if (!columnNames.has(column)) {
      throw new ApplyValidationError(
        `${path}: instanceLabels references column "${column}" which the query does not return`,
      );
    }
  }

  return { instanceLabelColumns };
}

// One repo can declare many alerts; firing every validation query at ClickHouse
// at once would risk exhausting the connection pool. Cap the in-flight queries.
const VALIDATION_QUERY_CONCURRENCY = 8;

// allSettled with a bounded worker pool: every item runs to completion and
// results stay in input order, so callers can still report the first failure
// deterministically.
async function mapSettledWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

async function buildDesiredAlerts(opts: {
  orgId: string;
  repoid: string;
  resources: ApplyResourceEntry[];
  source?: ApplySource;
}): Promise<DesiredAlert[]> {
  const seen = new Map<string, string>();
  const parsedAlerts = opts.resources.map(({ path, resource }) => {
    const parsed = parseAlertRule(path, resource);

    const key = identityKey(parsed.project, parsed.slug);
    const prior = seen.get(key);
    if (prior) {
      throw new ApplyValidationError(
        `duplicate alert "${parsed.slug}" in project "${parsed.project}" (${prior} and ${path})`,
      );
    }
    seen.set(key, path);
    return { ...parsed, path };
  });

  // The validation queries are independent; run them with bounded concurrency
  // but report failures in file order so the surfaced error is deterministic.
  const validations = await mapSettledWithConcurrency(
    parsedAlerts,
    VALIDATION_QUERY_CONCURRENCY,
    (parsed) => validateAlertRuleQuery(parsed.path, parsed.rule, opts.orgId),
  );

  return parsedAlerts.map((parsed, index) => {
    const validation = validations[index];
    if (validation.status === "rejected") throw validation.reason;

    const ref = parsed.rule.spec.notebook
      ? parseNotebookRef(parsed.rule.spec.notebook, parsed.project)
      : { project: "", slug: "" };

    return {
      slug: parsed.slug,
      project: parsed.project,
      notebookProject: ref.project,
      notebookSlug: ref.slug,
      evaluationIntervalSeconds: parsed.evaluationIntervalSeconds,
      document: parsed.rule,
      parsedQuery: parsed.rule.spec.query,
      notificationTitleTemplate: parsed.rule.spec.notificationMessage.title,
      notificationDescriptionTemplate:
        parsed.rule.spec.notificationMessage.description ?? "",
      instanceLabelColumns: validation.value.instanceLabelColumns,
      scheduleJitterSeconds: scheduleJitterSeconds(
        opts.orgId,
        opts.repoid,
        parsed.project,
        parsed.slug,
        parsed.evaluationIntervalSeconds,
      ),
      configFilePath: parsed.path,
      sourceLink: sourceLink(opts.source, parsed.path),
    };
  });
}

function instanceLabelsChanged(a: string[], b: string[]): boolean {
  return a.length !== b.length || a.some((value, index) => value !== b[index]);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

// The query and instance-label columns define the runtime state's shape; when
// either changes the previous firing set no longer applies and must be reset.
function queryOrLabelsChanged(a: DesiredAlert, b: DesiredAlert): boolean {
  return (
    a.parsedQuery !== b.parsedQuery ||
    instanceLabelsChanged(a.instanceLabelColumns, b.instanceLabelColumns)
  );
}

function needsUpdate(existing: ExistingAlert, desired: DesiredAlert): boolean {
  return (
    !existing.active ||
    existing.evaluationIntervalSeconds !== desired.evaluationIntervalSeconds ||
    stableStringify(existing.document) !== stableStringify(desired.document) ||
    queryOrLabelsChanged(existing, desired) ||
    existing.notificationTitleTemplate !== desired.notificationTitleTemplate ||
    existing.notificationDescriptionTemplate !==
      desired.notificationDescriptionTemplate ||
    existing.scheduleJitterSeconds !== desired.scheduleJitterSeconds ||
    existing.configFilePath !== desired.configFilePath ||
    existing.sourceLink !== desired.sourceLink ||
    existing.notebookProject !== desired.notebookProject ||
    existing.notebookSlug !== desired.notebookSlug
  );
}

function nextEvaluationAt(now: Date, desired: DesiredAlert): Date {
  return new Date(
    now.getTime() +
      (desired.evaluationIntervalSeconds + desired.scheduleJitterSeconds) *
        1000,
  );
}

function activeValues(
  desired: DesiredAlert,
  now: Date,
  opts: { resetRuntimeState?: boolean } = {},
) {
  const values = {
    evaluationIntervalSeconds: desired.evaluationIntervalSeconds,
    document: desired.document,
    parsedQuery: desired.parsedQuery,
    notificationTitleTemplate: desired.notificationTitleTemplate,
    notificationDescriptionTemplate: desired.notificationDescriptionTemplate,
    instanceLabelColumns: desired.instanceLabelColumns,
    nextEvaluationAt: nextEvaluationAt(now, desired),
    scheduleJitterSeconds: desired.scheduleJitterSeconds,
    configFilePath: desired.configFilePath,
    sourceLink: desired.sourceLink,
    notebookProject: desired.notebookProject,
    notebookSlug: desired.notebookSlug,
    active: true,
    updatedAt: now,
  };

  if (!opts.resetRuntimeState) return values;

  return {
    ...values,
    lastEvaluationStatus: "",
    lastEvaluationError: "",
    currentState: "unknown" as const,
    lastEvaluatedAt: null,
    lastFiredAt: null,
    lastResolvedAt: null,
    lastSeenAt: null,
    lastRowCount: 0,
    lastEvidenceSnapshot: [],
    firingInstanceCount: 0,
  };
}

function shouldResetRuntimeState(
  existing: ExistingAlert | undefined,
  desired: DesiredAlert,
): boolean {
  if (!existing?.active) return true;
  return queryOrLabelsChanged(existing, desired);
}

/**
 * Reconcile alert definitions for one repo. Alerts missing from the config are
 * deleted; the FK from alert_silences cascades, so their silences go too.
 * Re-adding a rule later creates a fresh definition row.
 */
export const applyAlertSpecs: Reconciler = async ({
  orgId,
  repoid,
  resources,
  source,
  dryRun,
}): Promise<ApplyAlertsResult> => {
  const desired = await buildDesiredAlerts({
    orgId,
    repoid,
    resources,
    source,
  });

  const existing = (await db
    .select({
      slug: alertDefinitions.slug,
      project: alertDefinitions.project,
      notebookProject: alertDefinitions.notebookProject,
      notebookSlug: alertDefinitions.notebookSlug,
      evaluationIntervalSeconds: alertDefinitions.evaluationIntervalSeconds,
      document: alertDefinitions.document,
      parsedQuery: alertDefinitions.parsedQuery,
      notificationTitleTemplate: alertDefinitions.notificationTitleTemplate,
      notificationDescriptionTemplate:
        alertDefinitions.notificationDescriptionTemplate,
      instanceLabelColumns: alertDefinitions.instanceLabelColumns,
      scheduleJitterSeconds: alertDefinitions.scheduleJitterSeconds,
      configFilePath: alertDefinitions.configFilePath,
      sourceLink: alertDefinitions.sourceLink,
      active: alertDefinitions.active,
    })
    .from(alertDefinitions)
    .where(
      and(
        eq(alertDefinitions.organizationId, orgId),
        eq(alertDefinitions.repoid, repoid),
      ),
    )) as ExistingAlert[];

  const existingByKey = new Map(
    existing.map((row) => [identityKey(row.project, row.slug), row]),
  );
  const desiredByKey = new Map(
    desired.map((row) => [identityKey(row.project, row.slug), row]),
  );

  const creates = desired.filter(
    (row) => !existingByKey.has(identityKey(row.project, row.slug)),
  );
  const updates = desired.filter((row) => {
    const current = existingByKey.get(identityKey(row.project, row.slug));
    return current ? needsUpdate(current, row) : false;
  });
  const deletes = existing.filter(
    (row) => !desiredByKey.has(identityKey(row.project, row.slug)),
  );

  const summary: ApplyAlertsResult = {
    created: creates.map((row) => row.slug),
    updated: updates.map((row) => row.slug),
    deleted: deletes.map((row) => row.slug),
  };

  if (dryRun) return summary;

  const now = new Date();
  await db.transaction(async (tx) => {
    if (creates.length > 0) {
      await tx.insert(alertDefinitions).values(
        creates.map((row) => ({
          organizationId: orgId,
          repoid,
          slug: row.slug,
          project: row.project,
          ...activeValues(row, now),
          createdAt: now,
        })),
      );
    }

    for (const row of updates) {
      const current = existingByKey.get(identityKey(row.project, row.slug));
      await tx
        .update(alertDefinitions)
        .set(
          activeValues(row, now, {
            resetRuntimeState: shouldResetRuntimeState(current, row),
          }),
        )
        .where(
          and(
            eq(alertDefinitions.organizationId, orgId),
            eq(alertDefinitions.repoid, repoid),
            eq(alertDefinitions.project, row.project),
            eq(alertDefinitions.slug, row.slug),
          ),
        );
    }

    if (deletes.length > 0) {
      await tx
        .delete(alertDefinitions)
        .where(
          and(
            eq(alertDefinitions.organizationId, orgId),
            eq(alertDefinitions.repoid, repoid),
            or(
              ...deletes.map((row) =>
                and(
                  eq(alertDefinitions.project, row.project),
                  eq(alertDefinitions.slug, row.slug),
                ),
              ),
            ),
          ),
        );
    }
  });

  return summary;
};
