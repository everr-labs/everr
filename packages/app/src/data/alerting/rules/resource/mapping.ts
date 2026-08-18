import type {
  AlertingRule,
  AlertingRuleInput,
  AlertingSeverity,
} from "@/data/alerting/types";
import { formatResourceName, parseResourceName } from "@/data/as-code/identity";
import { formatRunbookRef, parseRunbookRef } from "../../resource/runbook-ref";
import {
  ANN_ALERTING_DESCRIPTION,
  ANN_ALERTING_LINK_ALERT,
  ANN_ALERTING_LINK_RUNBOOK,
  ANN_ALERTING_SUMMARY,
  ANN_DISPLAY_DESCRIPTION,
  ANN_DISPLAY_NAME,
  ANN_LABEL_PREFIX,
  partitionAnnotations,
} from "../../resource-annotations";
import type { AlertRuleYaml } from "./schema";
import {
  formatDurationSeconds,
  parseEvaluationInterval,
  parseForDuration,
  parseWindow,
} from "./window";

// Canonical project/slug reference used by alert details and resource exports.
const ANN_RUNBOOK = "everr.runbook";

/**
 * Maps an AlertRule document to its stored rule input. Generated annotations
 * override pass-through annotations, and previews remain stateful but suppressed.
 */
export function toRuleInput(
  rule: AlertRuleYaml,
  repoid: string,
  opts: {
    appBaseUrl?: string;
    previewId?: string;
    /** String columns inferred during validation when the spec omits them. */
    instanceLabels?: string[];
  } = {},
): AlertingRuleInput {
  const project = rule.metadata.project ?? "default";
  const slug = rule.metadata.name;

  const annotations: Record<string, string> = {
    ...rule.spec.annotations,
    [ANN_ALERTING_SUMMARY]: rule.spec.notificationMessage.title,
  };
  if (rule.spec.notificationMessage.description) {
    annotations[ANN_ALERTING_DESCRIPTION] =
      rule.spec.notificationMessage.description;
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
      annotations[ANN_ALERTING_LINK_RUNBOOK] = new URL(
        `/runbooks/${runbookProject}/${runbookSlug}`,
        opts.appBaseUrl,
      ).toString();
    }
  }
  if (opts.appBaseUrl) {
    annotations[ANN_ALERTING_LINK_ALERT] = new URL(
      `/alerts/rules/${project}/${slug}`,
      opts.appBaseUrl,
    ).toString();
  }

  const spec = {
    sql: rule.spec.query,
    interval_secs: parseEvaluationInterval(rule.spec.evaluationInterval),
    for_secs: parseForDuration(rule.spec.for),
    // Sorted, not authored order: identity is fingerprinted over sorted
    // label keys, so the stored spec must not churn (and reorder-only
    // updates must not close every open instance) when a user or an
    // inference pass merely reorders the same columns.
    label_columns: [
      ...(rule.spec.instanceLabels ?? opts.instanceLabels ?? []),
    ].sort(),
    condition: rule.spec.condition,
    severity: rule.spec.severity,
    annotations,
    resolve_after: rule.spec.resolveAfter,
    // Omitting this field applies the rule default.
    ...(rule.spec.maxInterval !== undefined
      ? { max_interval_secs: parseWindow(rule.spec.maxInterval) }
      : {}),
  };

  return {
    name: formatResourceName(project, slug),
    repoid,
    // A preview rule is a full dress rehearsal: evaluated, stateful, and
    // visible in history, but the dispatcher never notifies on it. This
    // column is the whole record of that; nothing copies it into the spec.
    previewId: opts.previewId ?? null,
    ...(rule.spec.notifications
      ? { notifications: rule.spec.notifications }
      : {}),
    ...spec,
  };
}

export type SimpleAlertView = {
  project: string;
  slug: string;
  repoid: string;
  severity: AlertingSeverity;
  notificationTitleTemplate: string;
  notificationDescriptionTemplate: string;
  notificationChannels: string[];
  displayName: string | null;
  displayDescription: string | null;
  instanceLabelColumns: string[];
  forSeconds: number;
  resolveAfter: number;
  condition: AlertingRule["spec"]["condition"];
  runbookProject: string | null;
  runbookSlug: string | null;
  // The owning preview registry id, or null for a live rule. A preview rule
  // never notifies, so this is also the answer to "does this rule page".
  previewId: string | null;
};

/** Reads the resource identity and display fields from a stored rule. */
export function fromAlertingRule(
  rule: Pick<
    AlertingRule,
    "previewId" | "repoid" | "name" | "notifications" | "spec"
  >,
): SimpleAlertView {
  const { project, slug } = parseResourceName(rule.name);
  const ann = rule.spec.annotations ?? {};
  // formatRunbookRef always qualifies now, so a stored ref is always
  // "project/slug". A bare ref here can only be a pre-fix legacy row, and
  // the old bug only ever dropped the "default" project, so that is the
  // fallback (never the alert's own project, which may differ).
  const runbook = ann[ANN_RUNBOOK]
    ? parseRunbookRef(ann[ANN_RUNBOOK], "default")
    : null;
  return {
    project,
    slug,
    repoid: rule.repoid,
    severity: rule.spec.severity,
    notificationTitleTemplate: ann[ANN_ALERTING_SUMMARY] ?? "",
    notificationDescriptionTemplate: ann[ANN_ALERTING_DESCRIPTION] ?? "",
    notificationChannels: rule.notifications?.channels ?? [],
    displayName: ann[ANN_DISPLAY_NAME] ?? null,
    displayDescription: ann[ANN_DISPLAY_DESCRIPTION] ?? null,
    instanceLabelColumns: rule.spec.label_columns ?? [],
    forSeconds: rule.spec.for_secs,
    resolveAfter: rule.spec.resolve_after,
    condition: rule.spec.condition,
    runbookProject: runbook?.project ?? null,
    runbookSlug: runbook?.slug ?? null,
    previewId: rule.previewId,
  };
}

/** Reconstructs the canonical as-code document from a stored rule. */
export function toAlertRuleDocument(
  rule: Pick<AlertingRule, "name" | "notifications" | "spec">,
): AlertRuleYaml {
  const { project, slug } = parseResourceName(rule.name);
  const ann = rule.spec.annotations ?? {};

  const { labels, custom: passthrough } = partitionAnnotations(ann);

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
      // The stored ref is already qualified ("project/slug"), which the
      // schema accepts as-is; re-applying this document must resolve the
      // same runbook regardless of which project the alert itself lives in.
      // `undefined` values drop out when the document is serialized to
      // JSON/YAML.
      runbook: ann[ANN_RUNBOOK] ?? undefined,
      evaluationInterval: formatDurationSeconds(rule.spec.interval_secs),
      for: formatDurationSeconds(rule.spec.for_secs),
      resolveAfter: rule.spec.resolve_after,
      severity: rule.spec.severity,
      ...(rule.notifications ? { notifications: rule.notifications } : {}),
      notificationMessage: {
        title: ann[ANN_ALERTING_SUMMARY] ?? "",
        ...(ann[ANN_ALERTING_DESCRIPTION]
          ? { description: ann[ANN_ALERTING_DESCRIPTION] }
          : {}),
      },
      query: rule.spec.sql,
      // Always emitted, empty list included: the stored columns are the
      // identity the rule evaluates on, and omitting the field here would
      // re-infer a different one on the next apply.
      instanceLabels: rule.spec.label_columns ?? [],
      condition: rule.spec.condition,
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

/** True when a rule is owned by the given repo. */
export function isOwnedRule(
  rule: Pick<AlertingRule, "repoid">,
  repoid?: string,
): boolean {
  return repoid === undefined || rule.repoid === repoid;
}
