import { AlertingError } from "@/data/alerting/errors";
import * as alerting from "@/data/alerting/repository";
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
import { fromAlertingRule, isOwnedRule, toRuleInput } from "./mapping";
import { type AlertRuleYaml, AlertRuleYamlSchema } from "./schema";
import {
  extractVariables,
  validateMessageRefs,
  validateQueryTemplate,
} from "./template";
import { parseEvaluationInterval, parseForDuration } from "./window";

interface ApplyAlertsResult {
  created: string[];
  updated: string[];
  deleted: string[];
  adopted: string[];
  conflicts: OwnershipConflict[];
  note?: string;
}

// Surfaced on every preview apply: the rules ARE registered and evaluated in
// alerting engine (instances, state, history) as suppressed rules, so a reviewer can watch
// what they would have done — but the dispatcher never notifies on them.
const PREVIEW_NOTE =
  "preview alert rules are fully evaluated by the alert worker (suppressed): " +
  "instances and history are real, but no notifications are sent.";

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
  try {
    parseEvaluationInterval(rule.spec.evaluationInterval);
    parseForDuration(rule.spec.for);
    validateQueryTemplate(rule.spec.query);
    // Message templates are validated result-dependently (any query result
    // column is a legal ref) in validateAlertRuleQuery, once the columns are
    // known.
  } catch (error) {
    throw validationError(path, error);
  }

  return { rule, slug: rule.metadata.name };
}

// The alert worker's evidence caps: events
// carry at most 16 non-label columns, and only when their compact JSON fits in
// 4096 bytes. Message refs beyond the column cap may render empty.
const EVIDENCE_COLUMN_CAP = 16;

// ClickHouse types whose JSON serialization is a string, unwrapped from
// Nullable/LowCardinality. This mirrors the pre-alerting engine evaluator's implicit
// instance identity, which keyed rows by every `typeof value === "string"`
// column when `instanceLabels` was omitted.
function isStringTypedColumn(chType: string): boolean {
  let t = chType.trim();
  for (;;) {
    const wrapped = /^(?:Nullable|LowCardinality)\((.*)\)$/.exec(t);
    if (!wrapped) break;
    t = wrapped[1];
  }
  return /^(?:String|FixedString|Enum8|Enum16|UUID|Date32|Date|DateTime64|DateTime|IPv4|IPv6)(?:\(|$)/.test(
    t,
  );
}

function isNumericTypedColumn(chType: string): boolean {
  let t = chType.trim();
  for (;;) {
    const wrapped = /^(?:Nullable|LowCardinality)\((.*)\)$/.exec(t);
    if (!wrapped) break;
    t = wrapped[1];
  }
  return /^(?:U?Int(?:8|16|32|64|128|256)|Float(?:32|64)|BFloat16|Decimal(?:32|64|128|256)?)(?:\(|$)/.test(
    t,
  );
}

// Result-dependent validation: run the rule's query against the org's data and
// check the instance-label, condition, and message-template columns against the
// result schema. Message refs are legal for any result column: the dispatcher resolves
// them from the event's instance labels first, then ${value}, then the
// evidence (the remaining result columns). Returns a warning when a message
// references evidence but the query has more non-label columns than the
// evidence cap keeps, plus the effective instance-label columns (explicit
// `instanceLabels`, or the identity inferred from string result columns when
// omitted).
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

  // Refs that alerting engine resolves from evidence (not a label, not the rule value) are
  // only reliable while the query's non-label columns fit the evidence cap;
  // past it, alerting engine keeps the first 16 in column-name order and a referenced
  // column may be cut. Surface that as a warning, not an error.
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

// One repo can declare many alerts; firing every validation query at ClickHouse
// at once would risk exhausting the connection pool. Cap the in-flight queries.
const VALIDATION_QUERY_CONCURRENCY = 8;

// Cap on in-flight alerting mutations during a reconcile. Per-rule operations
// are independent (rules are keyed by id and matched here by name), so
// they run in a bounded pool instead of strictly one at a time.
const ALERTING_MUTATION_CONCURRENCY = 8;

// Stable identity for change detection. Ownership is a first-class field and
// therefore is not part of the rule spec fingerprint.
function specFingerprint(spec: Record<string, unknown>): string {
  return stableStringify(spec);
}

// True for alerting engine's optimistic-concurrency failure (PUT with a stale `version`).
function isAlertingVersionConflict(error: unknown): boolean {
  return error instanceof AlertingError && error.status === 409;
}

/**
 * Reconcile `kind: AlertRule` resources for one apply target. Each stored rule
 * is owned by this repo and has `previewId: null` for live state or the parent
 * Preview id otherwise. Other repos and the opposite side of the live/preview
 * split are never touched. Rules converge by their first-class `name`.
 * A changed rule is updated in place (PUT, with the rule's `version` as an
 * optimistic-concurrency guard, so instance state survives); a scoped rule
 * absent from config is deleted. Preview rules are evaluated fully but never
 * notify.
 *
 * A live create can collide with another live rule in the same organization
 * this repo does not own. That is the cross-repo ownership conflict,
 * reported for the registry's fail-fast, or taken over in place when
 * adopting (a version-guarded update that preserves the rule's id and
 * instance state). Preview rules are never adoption targets.
 */
export const applyAlertSpecs: Reconciler = async ({
  namespace,
  resources,
  dryRun,
  adopt,
}): Promise<ApplyAlertsResult> => {
  const { orgId, repoid } = namespace;
  // The preview registry id scoping this reconcile; null = the live namespace.
  // A preview id can itself be null during the dry-run of a first apply (no
  // registry row exists yet), which correctly scopes to zero existing rules.
  const previewId = namespace.kind === "preview" ? namespace.id : null;

  // 1. Parse + statically validate, then run the result-dependent query
  // validation; finally map each rule to its desired alerting engine spec. This full
  // pipeline runs for every namespace, including previews, so a preview apply
  // catches broken queries, bad `${column}` message refs, and missing
  // instanceLabels columns before the change is merged.
  const seen = new Map<string, string>();
  const parsed = resources.map(({ path, resource }) => {
    const p = parseAlertRule(path, resource);
    // Identity is the qualified project/slug (the alerting engine first-class name), so a
    // same-slug alert in two different projects is two resources, not a dupe.
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

  // The alerting engine listing for step 2 is independent of the validation queries, so it
  // starts here and overlaps the validation pool. A first-apply dry run has no
  // preview registry row yet (previewId null on a preview namespace would
  // alias the LIVE scope), so it skips the listing: nothing tagged with a
  // not-yet-minted id can exist in alerting engine.
  const listingPromise: Promise<AlertingRuleView[]> =
    namespace.kind === "preview" && namespace.id === null
      ? Promise.resolve([])
      : alerting.listAllRules(orgId);

  // Bounded pool via the shared limiter; allSettled keeps results in input
  // order, so the first failure can still be reported deterministically.
  const runValidation = createLimiter(VALIDATION_QUERY_CONCURRENCY);
  const [validations, listed] = await Promise.all([
    Promise.allSettled(
      parsed.map((p) =>
        runValidation(undefined, () =>
          validateAlertRuleQuery(p.path, p.rule, orgId),
        ),
      ),
    ),
    listingPromise,
  ]);

  // Non-fatal validation findings (e.g. evidence-cap overruns), surfaced on
  // the apply result's note alongside the preview note.
  const warnings = validations.flatMap((v) =>
    v.status === "fulfilled" && v.value.warning ? [v.value.warning] : [],
  );

  // The everr app origin: notification links (link.alert / link.runbook) must
  // be absolute for alerting engine's dispatcher to render them.
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
        // Explicit instanceLabels, or the implicit string-column identity the
        // validation inferred for a spec that omitted them.
        instanceLabels: v.value.instanceLabelColumns,
      }),
    };
  });

  // 2. Reconcile against rules owned by this repo and the selected target.
  // `previewId` is null for live rules and the parent Preview id otherwise,
  // so live and preview applies cannot touch one another.
  const existing = listed.filter(
    (r) => isOwnedRule(r, repoid) && r.previewId === previewId,
  );
  const existingByName = new Map(existing.map((r) => [r.name, r]));

  // 3. Plan. A rule matched by name is an update when its content changed;
  // otherwise unchanged (dropped from the plan entirely). Anything unmatched
  // is a create, subject to the cross-repo ownership check below.
  const updates: { d: (typeof desired)[number]; cur: AlertingRuleView }[] = [];
  const creates: (typeof desired)[number][] = [];
  for (const d of desired) {
    const cur = existingByName.get(d.input.name);
    if (!cur) {
      creates.push(d);
      continue;
    }
    // PUT takes the bare spec (identity is immutable after create).
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

  // 4. Cross-repo ownership: a live create can collide with a live rule
  // (same tenant and live target) this repo does not own. Reported as conflicts
  // for the registry's fail-fast, or taken over in place when adopting.
  // Preview creates never collide with live rules, and preview rules are never
  // adoption targets.
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

  // 5. Converge. Mutations run in a bounded pool (skipped entirely on
  // dry-run); outcomes aggregate by input index and the first failure (in
  // input order) is rethrown, matching the sequential loop's deterministic
  // reporting.
  const runMutation = createLimiter(ALERTING_MUTATION_CONCURRENCY);
  const writes = await Promise.allSettled([
    ...fresh.map((d) =>
      runMutation(undefined, async () => {
        if (dryRun) return;
        // link.alert/link.runbook are already baked into `d.input` (identity
        // is known up front, unlike alerting engine's old rule-id-based links), so
        // creating is a single call: no follow-up PUT to stamp anything.
        // Defense in depth: a foreign rule can appear between the listing
        // above and this call (a race), which alerting engine also reports as a 409 —
        // translate it the same friendly way rather than letting the raw
        // AlertingError bubble up.
        try {
          await alerting.createRule(orgId, d.input);
        } catch (error) {
          if (isAlertingVersionConflict(error)) {
            throw new ApplyValidationError(
              `${d.path}: alert "${d.input.name}" was created by another repo since the last listing; re-run apply`,
            );
          }
          throw error;
        }
      }),
    ),
    ...(adopt
      ? taken.map(({ d, foreign }) =>
          runMutation(undefined, async () => {
            if (dryRun) return;
            const {
              name: _name,
              repoid,
              previewId: _previewId,
              ...spec
            } = d.input;
            await alerting.adoptRule(
              orgId,
              foreign.id,
              repoid,
              foreign.version,
              spec,
            );
          }),
        )
      : []),
    ...updates.map(({ d, cur }) =>
      runMutation(undefined, async () => {
        if (dryRun) return;
        // Update in place: preserves the rule id and instance state (alerting engine
        // clears instances only when the label_columns set changes). The
        // stored version guards against concurrent edits.
        const {
          name: _name,
          repoid: _repoid,
          previewId: _previewId,
          ...spec
        } = d.input;
        try {
          await alerting.updateRule(orgId, cur.id, spec, cur.version);
        } catch (error) {
          if (isAlertingVersionConflict(error)) {
            throw new ApplyValidationError(
              `${d.path}: alert "${d.input.name}" was modified concurrently in the alert engine (version conflict); re-run apply`,
            );
          }
          throw error;
        }
      }),
    ),
  ]);
  for (const outcome of writes) {
    if (outcome.status === "rejected") throw outcome.reason;
  }

  // 6. Scoped rules absent from config are pruned, same bounded pool. Runs
  // only after every create/update settled cleanly, like the sequential
  // version.
  const desiredNames = new Set(desired.map((d) => d.input.name));
  const stale = [...existingByName].filter(([name]) => !desiredNames.has(name));
  const deleted: string[] = [];
  const deletions = await Promise.allSettled(
    stale.map(([, cur]) =>
      runMutation(undefined, async () => {
        if (!dryRun) await alerting.deleteRule(orgId, cur.id);
      }),
    ),
  );
  stale.forEach(([, cur], i) => {
    const outcome = deletions[i];
    if (outcome.status === "rejected") throw outcome.reason;
    deleted.push(cur.name);
  });

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
