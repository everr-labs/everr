import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ApplyValidationError } from "@/data/as-code/errors";
import type { Reconciler } from "@/data/as-code/registry";
import type { ApplyResourceEntry, ApplySource } from "@/data/as-code/schema";
import { db } from "@/db/client";
import { alertDefinitions } from "@/db/schema";
import type { AlertRuleYaml } from "./schema";
import {
  AlertRuleValidationError,
  parseAlertRule,
  validateAlertRuleQuery,
} from "./validate.server";

interface DesiredAlert {
  slug: string;
  evaluationIntervalSeconds: number;
  rawYaml: string;
  parsedQuery: string;
  summaryTemplate: string;
  descriptionTemplate: string;
  instanceLabelColumns: string[];
  scheduleJitterSeconds: number;
  configFilePath: string;
  sourceLink: string;
}

interface ExistingAlert {
  slug: string;
  evaluationIntervalSeconds: number;
  rawYaml: string;
  parsedQuery: string;
  summaryTemplate: string;
  descriptionTemplate: string;
  instanceLabelColumns: string[];
  scheduleJitterSeconds: number;
  configFilePath: string;
  sourceLink: string;
  active: boolean;
  validationStatus: string;
}

interface ApplyAlertsResult {
  created: string[];
  updated: string[];
  deleted: string[];
}

function rawSnapshot(rule: AlertRuleYaml): string {
  return JSON.stringify(rule, null, 2);
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

function toApplyError(error: unknown): never {
  if (error instanceof AlertRuleValidationError) {
    throw new ApplyValidationError(error.message);
  }
  throw error;
}

async function buildDesiredAlerts(opts: {
  orgId: string;
  repoid: string;
  resources: ApplyResourceEntry[];
  source?: ApplySource;
}): Promise<DesiredAlert[]> {
  const seen = new Map<string, string>();
  const parsedAlerts = opts.resources.map(({ path, resource }) => {
    let parsed: ReturnType<typeof parseAlertRule>;
    try {
      parsed = parseAlertRule(path, resource);
    } catch (error) {
      toApplyError(error);
    }

    const prior = seen.get(parsed.slug);
    if (prior) {
      throw new ApplyValidationError(
        `duplicate alert "${parsed.slug}" (${prior} and ${path})`,
      );
    }
    seen.set(parsed.slug, path);
    return { ...parsed, path };
  });

  // The validation queries are independent; run them concurrently but report
  // failures in file order so the surfaced error is deterministic.
  const validations = await Promise.allSettled(
    parsedAlerts.map((parsed) =>
      validateAlertRuleQuery(parsed.path, parsed.rule, opts.orgId),
    ),
  );

  return parsedAlerts.map((parsed, index) => {
    const validation = validations[index];
    if (validation.status === "rejected") toApplyError(validation.reason);

    return {
      slug: parsed.slug,
      evaluationIntervalSeconds: parsed.evaluationIntervalSeconds,
      rawYaml: rawSnapshot(parsed.rule),
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

function needsUpdate(existing: ExistingAlert, desired: DesiredAlert): boolean {
  return (
    !existing.active ||
    existing.validationStatus !== "valid" ||
    existing.evaluationIntervalSeconds !== desired.evaluationIntervalSeconds ||
    existing.rawYaml !== desired.rawYaml ||
    existing.parsedQuery !== desired.parsedQuery ||
    existing.summaryTemplate !== desired.summaryTemplate ||
    existing.descriptionTemplate !== desired.descriptionTemplate ||
    JSON.stringify(existing.instanceLabelColumns) !==
      JSON.stringify(desired.instanceLabelColumns) ||
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
    rawYaml: desired.rawYaml,
    parsedQuery: desired.parsedQuery,
    summaryTemplate: desired.summaryTemplate,
    descriptionTemplate: desired.descriptionTemplate,
    instanceLabelColumns: desired.instanceLabelColumns,
    nextEvaluationAt: nextEvaluationAt(now, desired),
    scheduleJitterSeconds: desired.scheduleJitterSeconds,
    configFilePath: desired.configFilePath,
    sourceLink: desired.sourceLink,
    active: true,
    validationStatus: "valid",
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
  };
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
      rawYaml: alertDefinitions.rawYaml,
      parsedQuery: alertDefinitions.parsedQuery,
      summaryTemplate: alertDefinitions.summaryTemplate,
      descriptionTemplate: alertDefinitions.descriptionTemplate,
      instanceLabelColumns: alertDefinitions.instanceLabelColumns,
      scheduleJitterSeconds: alertDefinitions.scheduleJitterSeconds,
      configFilePath: alertDefinitions.configFilePath,
      sourceLink: alertDefinitions.sourceLink,
      active: alertDefinitions.active,
      validationStatus: alertDefinitions.validationStatus,
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
          // The window column is NOT NULL without a default; the concept is
          // unused (rules only have evaluationInterval) but the column stays
          // until a migration drops it.
          window: "",
          ...activeValues(row, now),
          createdAt: now,
        })),
      );
    }

    for (const row of updates) {
      const current = existingBySlug.get(row.slug);
      await tx
        .update(alertDefinitions)
        .set(activeValues(row, now, { resetRuntimeState: !current?.active }))
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
