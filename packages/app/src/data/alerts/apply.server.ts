import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ApplyValidationError } from "@/data/as-code/errors";
import type { Reconciler } from "@/data/as-code/registry";
import type { ApplyResourceEntry, ApplySource } from "@/data/as-code/schema";
import { db } from "@/db/client";
import { alertDefinitions } from "@/db/schema";
import { querySqlApiWithMeta, type SqlApiResult } from "@/lib/clickhouse";
import { errorMessage } from "@/telemetry/logger";
import { type AlertRuleYaml, AlertRuleYamlSchema } from "./schema";
import {
  validateMessageTemplate,
  validateQueryTemplate,
  validateTopColumns,
} from "./template";
import { parseEvaluationInterval } from "./window";

interface DesiredAlert {
  slug: string;
  evaluationIntervalSeconds: number;
  document: string;
  parsedQuery: string;
  summaryTemplate: string;
  descriptionTemplate: string;
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
  slug: string,
  evaluationIntervalSeconds: number,
): number {
  const spread = Math.min(evaluationIntervalSeconds, 300);
  const hash = createHash("sha256")
    .update(`${orgId}\0${repoid}\0${slug}`)
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
    validateMessageTemplate(rule.spec.summary);
    if (rule.spec.description) validateMessageTemplate(rule.spec.description);
  } catch (error) {
    throw validationError(path, error);
  }

  return { rule, slug: rule.metadata.name, evaluationIntervalSeconds };
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
    validateTopColumns(rule.spec.summary, queryResult.columns);
    if (rule.spec.description) {
      validateTopColumns(rule.spec.description, queryResult.columns);
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

    const prior = seen.get(parsed.slug);
    if (prior) {
      throw new ApplyValidationError(
        `duplicate alert "${parsed.slug}" (${prior} and ${path})`,
      );
    }
    seen.set(parsed.slug, path);
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

    return {
      slug: parsed.slug,
      evaluationIntervalSeconds: parsed.evaluationIntervalSeconds,
      document: JSON.stringify(parsed.rule, null, 2),
      parsedQuery: parsed.rule.spec.query,
      summaryTemplate: parsed.rule.spec.summary,
      descriptionTemplate: parsed.rule.spec.description ?? "",
      instanceLabelColumns: validation.value.instanceLabelColumns,
      scheduleJitterSeconds: scheduleJitterSeconds(
        opts.orgId,
        opts.repoid,
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
    existing.document !== desired.document ||
    queryOrLabelsChanged(existing, desired) ||
    existing.summaryTemplate !== desired.summaryTemplate ||
    existing.descriptionTemplate !== desired.descriptionTemplate ||
    existing.scheduleJitterSeconds !== desired.scheduleJitterSeconds ||
    existing.configFilePath !== desired.configFilePath ||
    existing.sourceLink !== desired.sourceLink
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
    summaryTemplate: desired.summaryTemplate,
    descriptionTemplate: desired.descriptionTemplate,
    instanceLabelColumns: desired.instanceLabelColumns,
    nextEvaluationAt: nextEvaluationAt(now, desired),
    scheduleJitterSeconds: desired.scheduleJitterSeconds,
    configFilePath: desired.configFilePath,
    sourceLink: desired.sourceLink,
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
 * Reconcile alert definitions for one repo. Missing active alerts are
 * deactivated, not removed, so historical state and events can keep pointing at
 * the same definition row.
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
      evaluationIntervalSeconds: alertDefinitions.evaluationIntervalSeconds,
      document: alertDefinitions.document,
      parsedQuery: alertDefinitions.parsedQuery,
      summaryTemplate: alertDefinitions.summaryTemplate,
      descriptionTemplate: alertDefinitions.descriptionTemplate,
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

  const existingBySlug = new Map(existing.map((row) => [row.slug, row]));
  const desiredBySlug = new Map(desired.map((row) => [row.slug, row]));

  const creates = desired.filter((row) => !existingBySlug.has(row.slug));
  const updates = desired.filter((row) => {
    const current = existingBySlug.get(row.slug);
    return current ? needsUpdate(current, row) : false;
  });
  const deletes = existing.filter(
    (row) => row.active && !desiredBySlug.has(row.slug),
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
          ...activeValues(row, now),
          createdAt: now,
        })),
      );
    }

    for (const row of updates) {
      const current = existingBySlug.get(row.slug);
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
            eq(alertDefinitions.slug, row.slug),
          ),
        );
    }

    for (const row of deletes) {
      await tx
        .update(alertDefinitions)
        .set({
          active: false,
          nextEvaluationAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(alertDefinitions.organizationId, orgId),
            eq(alertDefinitions.repoid, repoid),
            eq(alertDefinitions.slug, row.slug),
          ),
        );
    }
  });

  return summary;
};
