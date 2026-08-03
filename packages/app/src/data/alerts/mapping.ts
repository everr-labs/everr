import { formatResourceName, parseResourceName } from "@/data/as-code/identity";
import type { CcRule, CcRuleInput, CcSeverity } from "@/data/cc/types";
import {
  ANN_CC_DESCRIPTION,
  ANN_CC_LINK_ALERT,
  ANN_CC_LINK_RUNBOOK,
  ANN_CC_SUMMARY,
  ANN_DISPLAY_DESCRIPTION,
  ANN_DISPLAY_NAME,
  ANN_LABEL_PREFIX,
  OWN_REPO,
} from "./annotations";
import {
  type AlertRuleYaml,
  formatRunbookRef,
  isReservedAnnotationKey,
  parseRunbookRef,
} from "./schema";
import {
  formatDurationSeconds,
  parseEvaluationInterval,
  parseForDuration,
  parseWindow,
} from "./window";

// The ownership annotation (everr.repoid) and the everr.label. prefix live in
// ./annotations, shared with the SLO mapping; re-exported here so the many
// existing rule-side imports keep one path. Identity (project/slug,
// live-vs-preview namespace) is carried on the CC rule's own first-class
// `name`/`namespace` fields now, not an annotation: see toRuleInput/fromCcRule
// below.
export { OWN_REPO } from "./annotations";

// ANN_DISPLAY_NAME/ANN_DISPLAY_DESCRIPTION live in ./annotations, shared with
// the SLO mapping. The notification templates live ONLY under CC's own
// `summary`/`description` keys (annotations.ts): CC renders them, and we read
// the same keys back, so one key per template is both the write and the read
// path.
// A linked runbook (project/slug), stored canonically so the alert detail can
// deep-link to it. Replaces the old Postgres runbook_project/runbook_slug
// columns now that a simple alert IS a CC rule.
const ANN_RUNBOOK = "everr.runbook";

/**
 * AlertRule YAML → CC rule create/update input: the spec fields flattened
 * beside the rule's first-class `name`/`namespace` (CcRuleInput's wire
 * shape, mirroring what CC's own CreateRuleBody accepts and what a GET
 * response returns). Shared by the as-code reconciler and tests.
 *
 * `appBaseUrl` (the everr app origin) enables the notification `link.runbook`
 * annotation and the `link.alert` annotation; both are computed upfront here
 * since the rule's identity (project/slug) is known before create, unlike
 * the old CC-generated rule id `link.alert` needed.
 *
 * A `previewId` builds the rule for that preview namespace: suppressed (CC
 * evaluates it fully but never notifies) so live and preview reconciles
 * never touch each other's rules; namespace alone discriminates live vs
 * preview now, so no identity annotation is written for it.
 *
 * `rule.spec.annotations` (user-supplied pass-through) is merged in BEFORE
 * the generated keys below, so the generated `everr.*`/`summary`/
 * `description`/link keys always win (the schema already rejects reserved
 * keys, so this merge order never actually needs to resolve a collision).
 */
export function toRuleInput(
  rule: AlertRuleYaml,
  repoid: string,
  opts: {
    appBaseUrl?: string;
    previewId?: string;
    /**
     * Effective instance-label columns resolved by apply-time validation:
     * the spec's own `instanceLabels`, or the implicit string-column
     * identity inferred from the query's result schema when omitted (the
     * pre-CC evaluator's behavior). `spec.instanceLabels` still wins so
     * callers without a dry-run (tests) keep the explicit semantics.
     */
    instanceLabels?: string[];
  } = {},
): CcRuleInput {
  const project = rule.metadata.project ?? "default";
  const slug = rule.metadata.name;

  const annotations: Record<string, string> = {
    ...rule.spec.annotations,
    [OWN_REPO]: repoid,
    // The notification templates, under the keys CC's dispatcher renders.
    [ANN_CC_SUMMARY]: rule.spec.notificationMessage.title,
  };
  if (rule.spec.notificationMessage.description) {
    annotations[ANN_CC_DESCRIPTION] = rule.spec.notificationMessage.description;
  }
  if (rule.spec.display?.name)
    annotations[ANN_DISPLAY_NAME] = rule.spec.display.name;
  if (rule.spec.display?.description) {
    annotations[ANN_DISPLAY_DESCRIPTION] = rule.spec.display.description;
  }
  for (const [k, v] of Object.entries(rule.metadata.labels ?? {})) {
    annotations[`${ANN_LABEL_PREFIX}${k}`] = v;
  }
  if (rule.spec.runbook) {
    const { project: runbookProject, slug: runbookSlug } = parseRunbookRef(
      rule.spec.runbook,
      project,
    );
    annotations[ANN_RUNBOOK] = formatRunbookRef(runbookProject, runbookSlug);
    if (opts.appBaseUrl) {
      annotations[ANN_CC_LINK_RUNBOOK] = new URL(
        `/runbooks/${runbookProject}/${runbookSlug}`,
        opts.appBaseUrl,
      ).toString();
    }
  }
  if (opts.appBaseUrl) {
    annotations[ANN_CC_LINK_ALERT] = new URL(
      `/alerts/rules/${project}/${slug}`,
      opts.appBaseUrl,
    ).toString();
  }

  const spec = {
    sql: rule.spec.query,
    interval_secs: parseEvaluationInterval(rule.spec.evaluationInterval),
    for_secs: parseForDuration(rule.spec.for),
    label_columns: rule.spec.instanceLabels ?? opts.instanceLabels ?? [],
    value_column: rule.spec.valueColumn ?? null,
    severity: rule.spec.severity,
    annotations,
    resolve_after: rule.spec.resolveAfter,
    // Absent unless the rule sets maxInterval: CC applies its own default
    // when the key is missing from the spec.
    ...(rule.spec.maxInterval !== undefined
      ? { max_interval_secs: parseWindow(rule.spec.maxInterval) }
      : {}),
    // Preview rules are a full dress rehearsal: evaluated, stateful, and
    // visible in history, but the dispatcher never notifies on them.
    suppressed: opts.previewId !== undefined,
  };

  return {
    name: formatResourceName(project, slug),
    namespace: opts.previewId ?? "",
    ...spec,
  };
}

export type SimpleAlertView = {
  project: string;
  slug: string;
  repoid: string;
  severity: CcSeverity;
  notificationTitleTemplate: string;
  notificationDescriptionTemplate: string;
  displayName: string | null;
  displayDescription: string | null;
  instanceLabelColumns: string[];
  forSeconds: number;
  resolveAfter: number;
  valueColumn: string | null;
  runbookProject: string | null;
  runbookSlug: string | null;
  // The owning preview registry id, or null for a live rule.
  previewId: string | null;
  suppressed: boolean;
};

/**
 * Read the simple-alert fields back out of a CC rule: project/slug from the
 * first-class `name`, the preview id from `namespace`, and the rest
 * (display/runbook/templates) from `spec.annotations` + columns.
 */
export function fromCcRule(
  rule: Pick<CcRule, "namespace" | "name" | "spec">,
): SimpleAlertView {
  const { project, slug } = parseResourceName(rule.name);
  const ann = rule.spec.annotations ?? {};
  // The stored ref is already canonical (project/slug or a bare slug for the
  // default project), so any alertProject fallback works to split it back out.
  const runbook = ann[ANN_RUNBOOK]
    ? parseRunbookRef(ann[ANN_RUNBOOK], "default")
    : null;
  return {
    project,
    slug,
    repoid: ann[OWN_REPO] ?? "",
    severity: rule.spec.severity,
    notificationTitleTemplate: ann[ANN_CC_SUMMARY] ?? "",
    notificationDescriptionTemplate: ann[ANN_CC_DESCRIPTION] ?? "",
    displayName: ann[ANN_DISPLAY_NAME] ?? null,
    displayDescription: ann[ANN_DISPLAY_DESCRIPTION] ?? null,
    instanceLabelColumns: rule.spec.label_columns ?? [],
    forSeconds: rule.spec.for_secs,
    resolveAfter: rule.spec.resolve_after,
    valueColumn: rule.spec.value_column ?? null,
    runbookProject: runbook?.project ?? null,
    runbookSlug: runbook?.slug ?? null,
    previewId: rule.namespace === "" ? null : rule.namespace,
    // `?? false`: hand-built specs (tests, pre-suppression payloads that
    // bypassed the schema default) may omit the field.
    suppressed: rule.spec.suppressed ?? false,
  };
}

/**
 * CC rule → the canonical `kind: AlertRule` as-code document, the inverse of
 * {@link toRuleInput} for everr-owned rules. Used by the resources CLI
 * (`everr resources show`) where dashboards/runbooks return their stored YAML
 * document; alerts have no stored document (the CC rule IS the resource), so
 * one is reconstructed from the rule. `metadata.name`/`metadata.project` come
 * from splitting the first-class `name` (project omitted when "default");
 * generated annotations (`summary`, `description`, `link.*`, `everr.*`) fold
 * back into their source fields; everything else is the user's pass-through
 * `spec.annotations`.
 */
export function toAlertRuleDocument(
  rule: Pick<CcRule, "name" | "spec">,
): AlertRuleYaml {
  const { project, slug } = parseResourceName(rule.name);
  const ann = rule.spec.annotations ?? {};

  const labels: Record<string, string> = {};
  const passthrough: Record<string, string> = {};
  for (const [key, value] of Object.entries(ann)) {
    if (key.startsWith(ANN_LABEL_PREFIX)) {
      labels[key.slice(ANN_LABEL_PREFIX.length)] = value;
    } else if (!isReservedAnnotationKey(key)) {
      passthrough[key] = value;
    }
  }

  const display =
    ann[ANN_DISPLAY_NAME] || ann[ANN_DISPLAY_DESCRIPTION]
      ? {
          ...(ann[ANN_DISPLAY_NAME] ? { name: ann[ANN_DISPLAY_NAME] } : {}),
          ...(ann[ANN_DISPLAY_DESCRIPTION]
            ? { description: ann[ANN_DISPLAY_DESCRIPTION] }
            : {}),
        }
      : undefined;

  return {
    kind: "AlertRule",
    metadata: {
      name: slug,
      ...(project !== "default" ? { project } : {}),
      ...(Object.keys(labels).length > 0 ? { labels } : {}),
    },
    spec: {
      ...(display ? { display } : {}),
      // The stored ref is already canonical (project/slug, or a bare slug for
      // the default project), which the schema accepts as-is. `undefined`
      // values drop out when the document is serialized to JSON/YAML.
      runbook: ann[ANN_RUNBOOK] ?? undefined,
      evaluationInterval: formatDurationSeconds(rule.spec.interval_secs),
      for: formatDurationSeconds(rule.spec.for_secs),
      resolveAfter: rule.spec.resolve_after,
      severity: rule.spec.severity,
      notificationMessage: {
        title: ann[ANN_CC_SUMMARY] ?? "",
        ...(ann[ANN_CC_DESCRIPTION]
          ? { description: ann[ANN_CC_DESCRIPTION] }
          : {}),
      },
      query: rule.spec.sql,
      instanceLabels:
        rule.spec.label_columns && rule.spec.label_columns.length > 0
          ? rule.spec.label_columns
          : undefined,
      ...(rule.spec.value_column
        ? { valueColumn: rule.spec.value_column }
        : {}),
      ...(rule.spec.max_interval_secs !== undefined &&
      rule.spec.max_interval_secs !== null
        ? { maxInterval: formatDurationSeconds(rule.spec.max_interval_secs) }
        : {}),
      ...(Object.keys(passthrough).length > 0
        ? { annotations: passthrough }
        : {}),
    },
  };
}

/** True if a CC rule is everr-owned (carries `everr.repoid`), owned by this repo (or any repo). */
export function isOwnedRule(
  rule: Pick<CcRule, "spec">,
  repoid?: string,
): boolean {
  const ann = rule.spec.annotations ?? {};
  if (ann[OWN_REPO] === undefined) return false;
  return repoid === undefined || ann[OWN_REPO] === repoid;
}

/** The preview registry id a CC rule belongs to, or null for a live rule. */
export function previewIdOf(rule: Pick<CcRule, "namespace">): string | null {
  return rule.namespace === "" ? null : rule.namespace;
}
