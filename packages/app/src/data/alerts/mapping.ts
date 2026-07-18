import type { CcRuleSpec, CcSeverity } from "@/data/cc/types";
import {
  ANN_CC_DESCRIPTION,
  ANN_CC_LINK_ALERT,
  ANN_CC_LINK_RUNBOOK,
  ANN_CC_SUMMARY,
  ANN_LABEL_PREFIX,
  OWN_NAME,
  OWN_PREVIEW,
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

// Ownership annotations (everr.name / everr.repoid / everr.preview) and the
// everr.label. prefix live in ./annotations, shared with the SLO mapping;
// re-exported here so the many existing rule-side imports keep one path.
export { OWN_NAME, OWN_PREVIEW, OWN_REPO } from "./annotations";

// Annotation keys we pack the simple-alert UI fields into. The notification
// templates live ONLY under CC's own `summary`/`description` keys
// (annotations.ts): CC renders them, and we read the same keys back, so one
// key per template is both the write and the read path.
const ANN_DISPLAY_NAME = "everr.display.name";
const ANN_DISPLAY_DESCRIPTION = "everr.display.description";
// A linked runbook (project/slug), stored canonically so the alert detail can
// deep-link to it. Replaces the old Postgres runbook_project/runbook_slug
// columns now that a simple alert IS a CC rule.
const ANN_RUNBOOK = "everr.runbook";

/** Absolute URL of the everr rule detail page for a CC rule id. */
function alertDetailUrl(appBaseUrl: string, ruleId: string): string {
  return new URL(`/alerts/rules/${ruleId}`, appBaseUrl).toString();
}

/**
 * Return `spec` with its `link.alert` annotation pointing at the everr alert
 * detail page. The CC rule id only exists once CC has stored the rule, so the
 * reconciler stamps this after create (and before diffing/updating an existing
 * rule, where the id is already known).
 */
export function withAlertLink(
  spec: CcRuleSpec,
  appBaseUrl: string,
  ruleId: string,
): CcRuleSpec {
  return {
    ...spec,
    annotations: {
      ...spec.annotations,
      [ANN_CC_LINK_ALERT]: alertDetailUrl(appBaseUrl, ruleId),
    },
  };
}

/**
 * AlertRule YAML → CC RuleSpec. Shared by the as-code reconciler and tests.
 * `appBaseUrl` (the everr app origin) enables the notification `link.runbook`
 * annotation; `link.alert` needs the CC rule id, see {@link withAlertLink}.
 * A `previewId` builds the rule for that preview namespace: suppressed (CC
 * evaluates it fully but never notifies) and tagged with the everr.preview
 * annotation so live and preview reconciles never touch each other's rules.
 * `rule.spec.annotations` (user-supplied pass-through) is merged in BEFORE the
 * generated keys below, so the generated `everr.*`/`summary`/`description`/
 * link keys always win (the schema already rejects reserved keys, so this
 * merge order never actually needs to resolve a collision).
 */
export function toRuleSpec(
  rule: AlertRuleYaml,
  repoid: string,
  opts: { appBaseUrl?: string; previewId?: string } = {},
): CcRuleSpec {
  const annotations: Record<string, string> = {
    ...rule.spec.annotations,
    [OWN_NAME]: rule.metadata.name,
    [OWN_REPO]: repoid,
    // The notification templates, under the keys CC's dispatcher renders.
    [ANN_CC_SUMMARY]: rule.spec.notificationMessage.title,
  };
  if (opts.previewId) annotations[OWN_PREVIEW] = opts.previewId;
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
    const { project, slug } = parseRunbookRef(
      rule.spec.runbook,
      rule.metadata.project ?? "default",
    );
    annotations[ANN_RUNBOOK] = formatRunbookRef(project, slug);
    if (opts.appBaseUrl) {
      annotations[ANN_CC_LINK_RUNBOOK] = new URL(
        `/runbooks/${project}/${slug}`,
        opts.appBaseUrl,
      ).toString();
    }
  }
  return {
    sql: rule.spec.query,
    interval_secs: parseEvaluationInterval(rule.spec.evaluationInterval),
    for_secs: parseForDuration(rule.spec.for),
    label_columns: rule.spec.instanceLabels ?? [],
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
    // visible in history/SSE, but the dispatcher never notifies on them.
    suppressed: opts.previewId !== undefined,
  };
}

export type SimpleAlertView = {
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

/** Read the simple-alert fields back out of a CC rule's spec (annotations + columns). */
export function fromCcRuleSpec(spec: CcRuleSpec): SimpleAlertView {
  const ann = spec.annotations ?? {};
  // The stored ref is already canonical (project/slug or a bare slug for the
  // default project), so any alertProject fallback works to split it back out.
  const runbook = ann[ANN_RUNBOOK]
    ? parseRunbookRef(ann[ANN_RUNBOOK], "default")
    : null;
  return {
    slug: ann[OWN_NAME] ?? "",
    repoid: ann[OWN_REPO] ?? "",
    severity: spec.severity,
    notificationTitleTemplate: ann[ANN_CC_SUMMARY] ?? "",
    notificationDescriptionTemplate: ann[ANN_CC_DESCRIPTION] ?? "",
    displayName: ann[ANN_DISPLAY_NAME] ?? null,
    displayDescription: ann[ANN_DISPLAY_DESCRIPTION] ?? null,
    instanceLabelColumns: spec.label_columns ?? [],
    forSeconds: spec.for_secs,
    resolveAfter: spec.resolve_after,
    valueColumn: spec.value_column ?? null,
    runbookProject: runbook?.project ?? null,
    runbookSlug: runbook?.slug ?? null,
    previewId: ann[OWN_PREVIEW] ?? null,
    // `?? false`: hand-built specs (tests, pre-suppression payloads that
    // bypassed the schema default) may omit the field.
    suppressed: spec.suppressed ?? false,
  };
}

/**
 * CC RuleSpec → the canonical `kind: AlertRule` as-code document, the inverse
 * of {@link toRuleSpec} for everr-owned rules. Used by the resources CLI
 * (`everr resources show`) where dashboards/runbooks return their stored YAML
 * document; alerts have no stored document (the CC rule IS the resource), so
 * one is reconstructed from the spec. Generated annotations (`everr.*`,
 * `summary`, `description`, `link.*`) fold back into their source fields;
 * everything else is the user's pass-through `spec.annotations`.
 */
export function toAlertRuleDocument(spec: CcRuleSpec): AlertRuleYaml {
  const ann = spec.annotations ?? {};

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
      name: ann[OWN_NAME] ?? "",
      ...(Object.keys(labels).length > 0 ? { labels } : {}),
    },
    spec: {
      ...(display ? { display } : {}),
      // The stored ref is already canonical (project/slug, or a bare slug for
      // the default project), which the schema accepts as-is. `undefined`
      // values drop out when the document is serialized to JSON/YAML.
      runbook: ann[ANN_RUNBOOK] ?? undefined,
      evaluationInterval: formatDurationSeconds(spec.interval_secs),
      for: formatDurationSeconds(spec.for_secs),
      resolveAfter: spec.resolve_after,
      severity: spec.severity,
      notificationMessage: {
        title: ann[ANN_CC_SUMMARY] ?? "",
        ...(ann[ANN_CC_DESCRIPTION]
          ? { description: ann[ANN_CC_DESCRIPTION] }
          : {}),
      },
      query: spec.sql,
      instanceLabels:
        spec.label_columns && spec.label_columns.length > 0
          ? spec.label_columns
          : undefined,
      ...(spec.value_column ? { valueColumn: spec.value_column } : {}),
      ...(spec.max_interval_secs !== undefined &&
      spec.max_interval_secs !== null
        ? { maxInterval: formatDurationSeconds(spec.max_interval_secs) }
        : {}),
      ...(Object.keys(passthrough).length > 0
        ? { annotations: passthrough }
        : {}),
    },
  };
}

/** True if a CC rule is everr-owned (carries `everr.name`), owned by this repo (or any repo). */
export function isOwnedRule(spec: CcRuleSpec, repoid?: string): boolean {
  const ann = spec.annotations ?? {};
  if (ann[OWN_NAME] === undefined) return false;
  return repoid === undefined || ann[OWN_REPO] === repoid;
}

/** The preview registry id a CC rule belongs to, or null for a live rule. */
export function previewIdOf(spec: CcRuleSpec): string | null {
  return spec.annotations?.[OWN_PREVIEW] ?? null;
}
