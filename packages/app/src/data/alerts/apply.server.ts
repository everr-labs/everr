import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ApplyValidationError } from "@/data/as-code/errors";
import type { Reconciler } from "@/data/as-code/registry";
import type { ApplySource } from "@/data/as-code/schema";
import { db } from "@/db/client";
import { alertDefinitions } from "@/db/schema";
import { querySqlApiWithMeta, type SqlApiResult } from "@/lib/clickhouse";
import { type AlertRuleYaml, AlertRuleYamlSchema } from "./schema";
import {
  renderQuery,
  validateMessageTemplate,
  validateQueryTemplate,
  validateTopColumns,
} from "./template";
import {
  type ParsedWindow,
  parseEvaluationInterval,
  parseWindow,
} from "./window";

interface DesiredAlert {
  slug: string;
  evaluationIntervalSeconds: number;
  window: string;
  rawYaml: string;
  parsedQuery: string;
  summaryTemplate: string;
  descriptionTemplate: string;
  scheduleJitterSeconds: number;
  configFilePath: string;
  sourceLink: string;
}

interface ParsedAlert {
  slug: string;
  path: string;
  rule: AlertRuleYaml;
  evaluationIntervalSeconds: number;
  parsedQuery: string;
}

interface ExistingAlert {
  slug: string;
  evaluationIntervalSeconds: number;
  window: string;
  rawYaml: string;
  parsedQuery: string;
  summaryTemplate: string;
  descriptionTemplate: string;
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

function firstIssueMessage(error: {
  issues: readonly { message: string }[];
}): string {
  return error.issues[0]?.message ?? "invalid alert rule";
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

function validationError(path: string, message: string): ApplyValidationError {
  return new ApplyValidationError(`${path}: ${message}`);
}

async function buildDesiredAlerts(opts: {
  orgId: string;
  repoid: string;
  resources: Parameters<Reconciler>[0]["resources"];
  source?: ApplySource;
}): Promise<DesiredAlert[]> {
  const parsedAlerts: ParsedAlert[] = [];
  const seen = new Map<string, string>();

  for (const { path, resource } of opts.resources) {
    const parsed = AlertRuleYamlSchema.safeParse(resource);
    if (!parsed.success) {
      throw validationError(
        path,
        `invalid alert rule: ${firstIssueMessage(parsed.error)}`,
      );
    }

    const rule = parsed.data;
    const slug = rule.metadata.name;
    const prior = seen.get(slug);
    if (prior) {
      throw new ApplyValidationError(
        `duplicate alert "${slug}" (${prior} and ${path})`,
      );
    }
    seen.set(slug, path);

    let evaluationInterval: ParsedWindow;
    let window: ParsedWindow;
    try {
      evaluationInterval = parseEvaluationInterval(
        rule.spec.evaluationInterval,
      );
    } catch (error) {
      throw validationError(
        path,
        error instanceof Error ? error.message : String(error),
      );
    }
    try {
      window = parseWindow(rule.spec.window);
    } catch (error) {
      throw validationError(
        path,
        error instanceof Error ? error.message : String(error),
      );
    }

    try {
      validateQueryTemplate(rule.spec.query);
      validateMessageTemplate(rule.spec.summary);
      if (rule.spec.description) validateMessageTemplate(rule.spec.description);
    } catch (error) {
      throw validationError(
        path,
        error instanceof Error ? error.message : String(error),
      );
    }

    const parsedQuery = renderQuery(rule.spec.query, window.interval);
    parsedAlerts.push({
      slug,
      path,
      rule,
      evaluationIntervalSeconds: evaluationInterval.seconds,
      parsedQuery,
    });
  }

  const out: DesiredAlert[] = [];
  for (const parsed of parsedAlerts) {
    let result: SqlApiResult<Record<string, unknown>>;
    try {
      result = await querySqlApiWithMeta<Record<string, unknown>>(
        parsed.parsedQuery,
        opts.orgId,
      );
    } catch (error) {
      throw validationError(
        parsed.path,
        `query failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      validateTopColumns(parsed.rule.spec.summary, result.columns);
      if (parsed.rule.spec.description) {
        validateTopColumns(parsed.rule.spec.description, result.columns);
      }
    } catch (error) {
      throw validationError(
        parsed.path,
        error instanceof Error ? error.message : String(error),
      );
    }

    out.push({
      slug: parsed.slug,
      evaluationIntervalSeconds: parsed.evaluationIntervalSeconds,
      window: parsed.rule.spec.window,
      rawYaml: rawSnapshot(parsed.rule),
      parsedQuery: parsed.parsedQuery,
      summaryTemplate: parsed.rule.spec.summary,
      descriptionTemplate: parsed.rule.spec.description ?? "",
      scheduleJitterSeconds: scheduleJitterSeconds(
        opts.orgId,
        opts.repoid,
        parsed.slug,
        parsed.evaluationIntervalSeconds,
      ),
      configFilePath: parsed.path,
      sourceLink: sourceLink(opts.source, parsed.path),
    });
  }

  return out;
}

function needsUpdate(existing: ExistingAlert, desired: DesiredAlert): boolean {
  return (
    !existing.active ||
    existing.validationStatus !== "valid" ||
    existing.evaluationIntervalSeconds !== desired.evaluationIntervalSeconds ||
    existing.window !== desired.window ||
    existing.rawYaml !== desired.rawYaml ||
    existing.parsedQuery !== desired.parsedQuery ||
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
    window: desired.window,
    rawYaml: desired.rawYaml,
    parsedQuery: desired.parsedQuery,
    summaryTemplate: desired.summaryTemplate,
    descriptionTemplate: desired.descriptionTemplate,
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
      window: alertDefinitions.window,
      rawYaml: alertDefinitions.rawYaml,
      parsedQuery: alertDefinitions.parsedQuery,
      summaryTemplate: alertDefinitions.summaryTemplate,
      descriptionTemplate: alertDefinitions.descriptionTemplate,
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
    for (const row of creates) {
      await tx.insert(alertDefinitions).values({
        organizationId: orgId,
        repoid,
        slug: row.slug,
        ...activeValues(row, now),
        createdAt: now,
      });
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
