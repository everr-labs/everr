import { createHash } from "node:crypto";
import { and, eq, isNull, or } from "drizzle-orm";
import { ApplyValidationError } from "@/data/as-code/errors";
import type { OwnershipConflict, Reconciler } from "@/data/as-code/registry";
import type { ApplyResourceEntry, ApplySource } from "@/data/as-code/schema";
import {
  foreignLiveScope,
  previewOwner,
  previewScope,
} from "@/data/previews/scope";
import { alertDefinitions } from "@/db/schema";
import { querySqlApiWithMeta, type SqlApiResult } from "@/lib/clickhouse";
import { errorMessage } from "@/telemetry/logger";
import {
  type AlertRuleYaml,
  AlertRuleYamlSchema,
  identityKey,
  parseRunbookRef,
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
  runbookProject: string;
  runbookSlug: string;
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
  adopted: string[];
  conflicts: OwnershipConflict[];
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

    const ref = parsed.rule.spec.runbook
      ? parseRunbookRef(parsed.rule.spec.runbook, parsed.project)
      : { project: "", slug: "" };

    return {
      slug: parsed.slug,
      project: parsed.project,
      runbookProject: ref.project,
      runbookSlug: ref.slug,
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
    existing.runbookProject !== desired.runbookProject ||
    existing.runbookSlug !== desired.runbookSlug
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
    runbookProject: desired.runbookProject,
    runbookSlug: desired.runbookSlug,
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
  namespace,
  resources,
  source,
  dryRun,
  adopt,
  db: exec,
}): Promise<ApplyAlertsResult> => {
  const desired = await buildDesiredAlerts({
    orgId: namespace.orgId,
    repoid: namespace.repoid,
    resources,
    source,
  });

  const scope = previewScope(alertDefinitions, namespace);

  const existing: ExistingAlert[] = await exec
    .select({
      slug: alertDefinitions.slug,
      project: alertDefinitions.project,
      runbookProject: alertDefinitions.runbookProject,
      runbookSlug: alertDefinitions.runbookSlug,
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
    .where(scope);

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

  // A create whose (project, slug) is a live alert owned by another repo is a
  // cross-repo conflict: reported (fail-fast upstream) unless adopting, which
  // transfers ownership. Only live applies can collide.
  const foreign =
    namespace.kind === "live" && creates.length > 0
      ? await exec
          .select({
            project: alertDefinitions.project,
            slug: alertDefinitions.slug,
            owner: alertDefinitions.repoid,
          })
          .from(alertDefinitions)
          .where(foreignLiveScope(alertDefinitions, namespace, creates))
      : [];
  const foreignOwner = new Map(
    foreign.map((r) => [identityKey(r.project, r.slug), r.owner ?? ""]),
  );
  const takenCreates = creates.filter((row) =>
    foreignOwner.has(identityKey(row.project, row.slug)),
  );
  const freshCreates = creates.filter(
    (row) => !foreignOwner.has(identityKey(row.project, row.slug)),
  );

  const summary: ApplyAlertsResult = {
    created: freshCreates.map((row) => row.slug),
    updated: updates.map((row) => row.slug),
    deleted: deletes.map((row) => row.slug),
    adopted: adopt ? takenCreates.map((row) => row.slug) : [],
    conflicts: adopt
      ? []
      : takenCreates.map((row) => ({
          project: row.project,
          slug: row.slug,
          owner: foreignOwner.get(identityKey(row.project, row.slug)) ?? "",
        })),
  };

  if (dryRun) return summary;

  const now = new Date();
  // Registry owns the transaction (`exec`); these writes join it so the whole
  // apply commits or rolls back together.
  if (freshCreates.length > 0) {
    await exec.insert(alertDefinitions).values(
      freshCreates.map((row) => ({
        organizationId: namespace.orgId,
        ...previewOwner(namespace),
        slug: row.slug,
        project: row.project,
        ...activeValues(row, now),
        createdAt: now,
      })),
    );
  }
  // Adoption: take over the other repo's live alert by its global identity,
  // transferring ownership and resetting runtime state (a re-homed alert
  // re-evaluates fresh). Only reached with `adopt`.
  for (const row of takenCreates) {
    await exec
      .update(alertDefinitions)
      .set({
        repoid: namespace.repoid,
        ...activeValues(row, now, { resetRuntimeState: true }),
      })
      .where(
        and(
          eq(alertDefinitions.organizationId, namespace.orgId),
          isNull(alertDefinitions.previewId),
          eq(alertDefinitions.project, row.project),
          eq(alertDefinitions.slug, row.slug),
        ),
      );
  }

  for (const row of updates) {
    const current = existingByKey.get(identityKey(row.project, row.slug));
    await exec
      .update(alertDefinitions)
      .set(
        activeValues(row, now, {
          resetRuntimeState: shouldResetRuntimeState(current, row),
        }),
      )
      .where(
        and(
          scope,
          eq(alertDefinitions.project, row.project),
          eq(alertDefinitions.slug, row.slug),
        ),
      );
  }

  if (deletes.length > 0) {
    await exec
      .delete(alertDefinitions)
      .where(
        and(
          scope,
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

  return summary;
};
