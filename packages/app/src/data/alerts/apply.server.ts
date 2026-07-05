import { ApplyValidationError } from "@/data/as-code/errors";
import type { Reconciler } from "@/data/as-code/registry";
import * as cc from "@/data/cc/client";
import { querySqlApiWithMeta, type SqlApiResult } from "@/lib/clickhouse";
import { errorMessage } from "@/telemetry/logger";
import {
  isManagedSimple,
  OWN_MANAGED,
  OWN_NAME,
  OWN_REPO,
  toSimpleRuleSpec,
} from "./mapping";
import { type AlertRuleYaml, AlertRuleYamlSchema } from "./schema";
import {
  validateMessageColumns,
  validateMessageTemplate,
  validateQueryTemplate,
} from "./template";
import { parseEvaluationInterval } from "./window";

interface ApplyAlertsResult {
  created: string[];
  updated: string[];
  deleted: string[];
  adopted: string[];
  conflicts: never[];
}

// A simple alert is stored as a CC rule scoped by its `everr.repoid` marker, so
// it has no cross-repo (project, slug) ownership and no Postgres preview overlay
// to diff against. Returned by the reconciler for both the "nothing to adopt"
// and the "previews are a no-op" paths.
const NO_ALERT_CHANGES: ApplyAlertsResult = {
  created: [],
  updated: [],
  deleted: [],
  adopted: [],
  conflicts: [],
};

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

// Stable identity for change detection: everything except ownership/management
// annotations. Annotation key order is NOT stable across the YAML source and
// CC's response, so we sort the annotation entries before hashing — otherwise a
// rule with 2+ annotations would look "changed" on every apply and be needlessly
// deleted+recreated. Mirrors data/cc/apply.server.ts's fingerprint (intentionally
// duplicated per the no-dedupe-reconciler-boilerplate convention), additionally
// stripping the everr.managed marker.
function specFingerprint(spec: Record<string, unknown>): string {
  const ann = { ...(spec.annotations as Record<string, string> | undefined) };
  delete ann[OWN_NAME];
  delete ann[OWN_REPO];
  delete ann[OWN_MANAGED];
  const sortedAnnotations = Object.fromEntries(
    Object.entries(ann).sort(([a], [b]) => a.localeCompare(b)),
  );
  return JSON.stringify({ ...spec, annotations: sortedAnnotations });
}

/**
 * Reconcile `kind: AlertRule` (simple) alerts for one repo against CC. A simple
 * alert IS a CC rule tagged everr.managed="simple" (+ everr.name, everr.repoid).
 * We list CC rules, scope to THIS repo's managed-simple rules only — so
 * power-user `CCAlertRule` rules in the same repo are never touched — and
 * converge to the applied set. CC rules are immutable, so a changed rule is
 * delete+recreate; a managed rule absent from config is deleted.
 */
export const applyAlertSpecs: Reconciler = async ({
  namespace,
  resources,
  dryRun,
}): Promise<ApplyAlertsResult> => {
  const { orgId, repoid } = namespace;
  // Simple alerts live in CC, which has no preview concept: a preview apply must
  // never mutate the shared CC state. Reconcile CC only for the live namespace;
  // preview applies of AlertRule resources are a no-op (reported as no changes).
  if (namespace.kind === "preview") return NO_ALERT_CHANGES;

  // 1. Parse + statically validate, then run the result-dependent query
  // validation; finally map each rule to its desired CC spec.
  const seen = new Map<string, string>();
  const parsed = resources.map(({ path, resource }) => {
    const p = parseAlertRule(path, resource);
    const prior = seen.get(p.slug);
    if (prior) {
      throw new ApplyValidationError(
        `duplicate alert "${p.slug}" (${prior} and ${path})`,
      );
    }
    seen.set(p.slug, path);
    return { ...p, path };
  });

  const validations = await mapSettledWithConcurrency(
    parsed,
    VALIDATION_QUERY_CONCURRENCY,
    (p) => validateAlertRuleQuery(p.path, p.rule, orgId),
  );

  const desired = parsed.map((p, i) => {
    const v = validations[i];
    if (v.status === "rejected") throw v.reason;
    return { name: p.slug, spec: toSimpleRuleSpec(p.rule, repoid) };
  });

  // 2. Reconcile against CC, scoped to this repo's MANAGED-SIMPLE rules only.
  const existing = (await cc.listRules(orgId)).filter((r) =>
    isManagedSimple(r.spec, repoid),
  );
  const existingByName = new Map(
    existing.map((r) => [(r.spec.annotations ?? {})[OWN_NAME] ?? "", r]),
  );

  const created: string[] = [];
  const updated: string[] = [];
  const deleted: string[] = [];

  for (const d of desired) {
    const cur = existingByName.get(d.name);
    if (!cur) {
      if (!dryRun) await cc.createRule(orgId, d.spec);
      created.push(d.name);
    } else if (
      specFingerprint(cur.spec as Record<string, unknown>) !==
      specFingerprint(d.spec as unknown as Record<string, unknown>)
    ) {
      // CC rules are immutable: delete + recreate.
      if (!dryRun) {
        await cc.deleteRule(orgId, cur.id);
        await cc.createRule(orgId, d.spec);
      }
      updated.push(d.name);
    }
    existingByName.delete(d.name);
  }
  for (const [name, cur] of existingByName) {
    if (!dryRun) await cc.deleteRule(orgId, cur.id);
    deleted.push(name);
  }

  return { created, updated, deleted, adopted: [], conflicts: [] };
};
