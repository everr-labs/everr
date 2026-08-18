import { listChannels } from "@/data/alerting/delivery/repository";
import { AlertingError } from "@/data/alerting/errors";
import * as alerting from "@/data/alerting/rules/repository";
import type { AlertingRuleView } from "@/data/alerting/types";
import { ApplyValidationError } from "@/data/as-code/errors";
import { formatResourceName, parseResourceName } from "@/data/as-code/identity";
import type { OwnershipConflict } from "@/data/as-code/ownership";
import { stableStringify } from "@/data/as-code/reconcile";
import type { Reconciler } from "@/data/as-code/registry";
import { authEnv } from "@/env/auth";
import { querySqlApiWithMeta, type SqlApiResult } from "@/lib/clickhouse";
import { createLimiter } from "@/lib/limiter";
import { errorMessage } from "@/telemetry/logger";
import {
  extractVariables,
  validateMessageRefs,
  validateQueryTemplate,
} from "../../delivery/template";
import { fromAlertingRule, isOwnedRule, toRuleInput } from "./mapping";
import { type AlertRuleYaml, AlertRuleYamlSchema } from "./schema";
import { parseEvaluationInterval, parseForDuration } from "./window";

interface ApplyAlertsResult {
  created: string[];
  updated: string[];
  deleted: string[];
  adopted: string[];
  conflicts: OwnershipConflict[];
  note?: string;
}

// Preview evaluations are real; only the notification is withheld.
const PREVIEW_NOTE =
  "preview alert rules are fully evaluated by the alert worker: " +
  "instances and history are real, but no notifications are sent.";

function validationError(path: string, error: unknown): ApplyValidationError {
  const message = errorMessage(error);
  return new ApplyValidationError(`${path}: ${message}`);
}

function parseAlertRule(path: string, resource: unknown) {
  const parsed = AlertRuleYamlSchema.safeParse(resource);
  if (!parsed.success) {
    throw new ApplyValidationError(
      `${path}: invalid alert rule: ${parsed.error.issues[0]?.message ?? "invalid alert rule"}`,
    );
  }

  const rule = parsed.data;
  try {
    parseEvaluationInterval(rule.spec.evaluationInterval);
    parseForDuration(rule.spec.for);
    validateQueryTemplate(rule.spec.query);
    // Template references require the query result schema.
  } catch (error) {
    throw validationError(path, error);
  }

  return { rule, slug: rule.metadata.name };
}

// Events retain at most 16 non-label evidence columns within 4096 bytes.
const EVIDENCE_COLUMN_CAP = 16;

// String result columns form the instance identity when instanceLabels is
// omitted. Temporal types are deliberately excluded: a `toStartOfMinute(ts)
// AS bucket` column is a String-adjacent shape but changes every evaluation,
// so inferring it as identity would open a new episode per bucket forever.
// Both predicates below classify the type inside the wrappers, so a third one
// cannot forget to unwrap first.
function unwrapChType(chType: string): string {
  let t = chType.trim();
  for (;;) {
    const wrapped = /^(?:Nullable|LowCardinality)\((.*)\)$/.exec(t);
    if (!wrapped) return t;
    t = wrapped[1];
  }
}

function isStringTypedColumn(chType: string): boolean {
  return /^(?:String|FixedString|Enum8|Enum16|UUID|IPv4|IPv6)(?:\(|$)/.test(
    unwrapChType(chType),
  );
}

function isNumericTypedColumn(chType: string): boolean {
  return /^(?:U?Int(?:8|16|32|64|128|256)|Float(?:32|64)|BFloat16|Decimal(?:32|64|128|256)?)(?:\(|$)/.test(
    unwrapChType(chType),
  );
}

// Validates result-dependent labels and template references, and returns the
// explicit or inferred instance identity.
async function validateAlertRuleQuery(
  path: string,
  rule: AlertRuleYaml,
  organizationId: string,
): Promise<{ warning?: string; instanceLabelColumns: string[] }> {
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

  const instanceLabelColumns =
    rule.spec.instanceLabels ??
    queryResult.columns.filter(
      (column, i) =>
        isStringTypedColumn(queryResult.columnTypes[i] ?? "") &&
        column !== "value",
    );
  const columnNames = new Set(queryResult.columns);
  for (const column of instanceLabelColumns) {
    if (!columnNames.has(column)) {
      throw new ApplyValidationError(
        `${path}: instanceLabels references column "${column}" which the query does not return`,
      );
    }
  }
  const valueColumnIndex = queryResult.columns.indexOf("value");
  if (valueColumnIndex === -1) {
    throw new ApplyValidationError(
      `${path}: alert query must return a numeric column named "value"`,
    );
  }
  const valueColumnType = queryResult.columnTypes[valueColumnIndex] ?? "";
  if (!isNumericTypedColumn(valueColumnType)) {
    throw new ApplyValidationError(
      `${path}: alert query column "value" must be numeric, got ${valueColumnType || "an unknown type"}`,
    );
  }

  try {
    validateMessageRefs(
      rule.spec.notificationMessage.title,
      queryResult.columns,
    );
    if (rule.spec.notificationMessage.description) {
      validateMessageRefs(
        rule.spec.notificationMessage.description,
        queryResult.columns,
      );
    }
  } catch (error) {
    throw validationError(path, error);
  }

  // Evidence references beyond the stored column cap are not guaranteed.
  const labelSet = new Set(instanceLabelColumns);
  const nonLabelColumns = queryResult.columns.filter((c) => !labelSet.has(c));
  const evidenceRefs = [
    rule.spec.notificationMessage.title,
    rule.spec.notificationMessage.description ?? "",
  ]
    .flatMap(extractVariables)
    .filter((name) => !labelSet.has(name) && name !== "value");
  const warning =
    evidenceRefs.length > 0 && nonLabelColumns.length > EVIDENCE_COLUMN_CAP
      ? `${path}: the query returns ${nonLabelColumns.length} non-label columns but alert events keep at most ${EVIDENCE_COLUMN_CAP} as evidence, so \${${evidenceRefs[0]}} may render empty in notifications`
      : undefined;

  return { instanceLabelColumns, ...(warning ? { warning } : {}) };
}

const VALIDATION_QUERY_CONCURRENCY = 8;

function specFingerprint(spec: Record<string, unknown>): string {
  return stableStringify(spec);
}

function isAlertingVersionConflict(error: unknown): boolean {
  return error instanceof AlertingError && error.status === 409;
}

/** Reconciles one repo's live or preview rules without crossing ownership scopes. */
export const applyAlertSpecs: Reconciler = async ({
  namespace,
  resources,
  dryRun,
  adopt,
  db: executor,
}): Promise<ApplyAlertsResult> => {
  const { orgId, repoid } = namespace;
  // A missing first-apply preview id scopes to no existing rules.
  const previewId = namespace.kind === "preview" ? namespace.id : null;

  const seen = new Map<string, string>();
  const parsed = resources.map(({ path, resource }) => {
    const p = parseAlertRule(path, resource);
    // Project is part of resource identity.
    const qualified = formatResourceName(
      p.rule.metadata.project ?? "default",
      p.slug,
    );
    const prior = seen.get(qualified);
    if (prior) {
      throw new ApplyValidationError(
        `duplicate alert "${qualified}" (${prior} and ${path})`,
      );
    }
    seen.set(qualified, path);
    return { ...p, path };
  });

  // allSettled preserves input order for deterministic error reporting.
  const runValidation = createLimiter(VALIDATION_QUERY_CONCURRENCY);
  const validationsPromise = Promise.allSettled(
    parsed.map((p) =>
      runValidation(undefined, () =>
        validateAlertRuleQuery(p.path, p.rule, orgId),
      ),
    ),
  );
  // The ClickHouse validations above fan out concurrently; these PostgreSQL
  // reads run serially on the registry executor. They must not touch the bare
  // pool: this code already holds the registry transaction's connection, and
  // acquiring a second one here is a hold-and-acquire, so enough concurrent
  // applies exhaust the pool and every one waits forever for a connection
  // none will release. A new preview has nothing to list yet.
  const listed: AlertingRuleView[] =
    namespace.kind === "preview" && namespace.id === null
      ? []
      : await alerting.listAllRules(orgId, {}, executor);
  const channels = parsed.some((p) => p.rule.spec.notifications)
    ? await listChannels(orgId, executor)
    : [];
  const validations = await validationsPromise;

  const availableChannelNames = new Set(
    channels.map((channel) => channel.name),
  );
  // A missing channel is a warning, not a refusal: the spec stores the
  // reference as authored and the rule applies without it, so a spec is
  // never blocked on delivery config that lives outside the repo. Creating
  // the channel later links every spec that names it.
  const channelWarnings: string[] = [];
  for (const item of parsed) {
    const declared = item.rule.spec.notifications?.channels ?? [];
    const missing = declared.filter(
      (channel) => !availableChannelNames.has(channel),
    );
    if (missing.length === 0) continue;
    channelWarnings.push(
      `${item.path}: unknown notification channels skipped: ${missing.join(", ")}`,
    );
  }

  // Surface non-fatal validation findings in the apply note.
  const warnings = [
    ...channelWarnings,
    ...validations.flatMap((v) =>
      v.status === "fulfilled" && v.value.warning ? [v.value.warning] : [],
    ),
  ];

  // Notification links must be absolute.
  const appBaseUrl = authEnv.BETTER_AUTH_URL;

  const desired = parsed.map((p, i) => {
    const v = validations[i];
    if (v.status === "rejected") throw v.reason;
    return {
      name: p.slug,
      path: p.path,
      input: toRuleInput(p.rule, repoid, {
        appBaseUrl,
        previewId: previewId ?? undefined,
        instanceLabels: v.value.instanceLabelColumns,
      }),
    };
  });

  const existing = listed.filter(
    (r) => isOwnedRule(r, repoid) && r.previewId === previewId,
  );
  const existingByName = new Map(existing.map((r) => [r.name, r]));

  const updates: { d: (typeof desired)[number]; cur: AlertingRuleView }[] = [];
  const creates: (typeof desired)[number][] = [];
  for (const d of desired) {
    const cur = existingByName.get(d.input.name);
    if (!cur) {
      creates.push(d);
      continue;
    }
    const {
      name: _name,
      repoid: _repoid,
      previewId: _previewId,
      ...spec
    } = d.input;
    if (
      specFingerprint(cur.spec as Record<string, unknown>) !==
      specFingerprint(spec as unknown as Record<string, unknown>)
    ) {
      updates.push({ d, cur });
    }
  }

  const foreignByName =
    namespace.kind === "live"
      ? new Map(
          listed
            .filter((r) => r.previewId === null && !isOwnedRule(r, repoid))
            .map((r) => [r.name, r]),
        )
      : new Map<string, AlertingRuleView>();
  const taken = creates.flatMap((d) => {
    const foreign = foreignByName.get(d.input.name);
    return foreign ? [{ d, foreign }] : [];
  });
  const fresh = creates.filter((d) => !foreignByName.has(d.input.name));
  const conflicts: OwnershipConflict[] = adopt
    ? []
    : taken.map(({ d, foreign }) => {
        const { project, slug } = parseResourceName(d.input.name);
        return { project, slug, owner: fromAlertingRule(foreign).repoid };
      });
  const adopted = adopt ? taken.map(({ d }) => d.input.name) : [];

  // Mutations run directly on the shared transaction, not inside savepoints:
  // every writing savepoint burns a subtransaction id, and past 64 in one
  // apply every snapshot in the cluster degrades to pg_subtrans lookups. The first
  // failure aborts the shared transaction, which loses nothing: the registry
  // rolls the entire apply back on any mutation failure, so work after the
  // first failure was always discarded.
  if (!dryRun) {
    for (const d of fresh) {
      // Translate a create race into the same ownership error as the plan.
      try {
        await alerting.createRule(orgId, d.input, executor);
      } catch (error) {
        if (isAlertingVersionConflict(error)) {
          throw new ApplyValidationError(
            `${d.path}: alert "${d.input.name}" was created by another repo since the last listing; re-run apply`,
          );
        }
        throw error;
      }
    }
    if (adopt) {
      for (const { d, foreign } of taken) {
        const { name: _name, repoid, previewId: _previewId, ...spec } = d.input;
        await alerting.adoptRule(
          orgId,
          foreign.id,
          repoid,
          foreign.version,
          spec,
          executor,
        );
      }
    }
    for (const { d, cur } of updates) {
      // Versioned updates preserve instance state unless label columns change.
      const {
        name: _name,
        repoid: _repoid,
        previewId: _previewId,
        ...spec
      } = d.input;
      try {
        await alerting.updateRule(orgId, cur.id, spec, cur.version, executor);
      } catch (error) {
        if (isAlertingVersionConflict(error)) {
          throw new ApplyValidationError(
            `${d.path}: alert "${d.input.name}" was modified concurrently (version conflict); re-run apply`,
          );
        }
        throw error;
      }
    }
  }

  const desiredNames = new Set(desired.map((d) => d.input.name));
  const stale = [...existingByName].filter(([name]) => !desiredNames.has(name));
  const deleted: string[] = [];
  for (const [, cur] of stale) {
    if (!dryRun) await alerting.deleteRule(orgId, cur.id, executor);
    deleted.push(cur.name);
  }

  const notes = [
    ...(namespace.kind === "preview" ? [PREVIEW_NOTE] : []),
    ...warnings,
  ];
  return {
    created: fresh.map((d) => d.input.name),
    updated: updates.map(({ d }) => d.input.name),
    deleted,
    adopted,
    conflicts,
    ...(notes.length > 0 ? { note: notes.join("; ") } : {}),
  };
};
