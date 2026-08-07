import type {
  AlertingRule,
  AlertingRuleInput,
  AlertingSeverity,
} from "@/data/alerting/types";
import { formatResourceName, parseResourceName } from "@/data/as-code/identity";
import {
  ANN_ALERTING_DESCRIPTION,
  ANN_ALERTING_LINK_ALERT,
  ANN_ALERTING_LINK_RUNBOOK,
  ANN_ALERTING_SUMMARY,
  ANN_DISPLAY_DESCRIPTION,
  ANN_DISPLAY_NAME,
  ANN_LABEL_PREFIX,
} from "../annotations";
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
    label_columns: rule.spec.instanceLabels ?? opts.instanceLabels ?? [],
    condition: rule.spec.condition,
    severity: rule.spec.severity,
    annotations,
    resolve_after: rule.spec.resolveAfter,
    // Omitting this field applies the rule default.
    ...(rule.spec.maxInterval !== undefined
      ? { max_interval_secs: parseWindow(rule.spec.maxInterval) }
      : {}),
    // Preview rules are a full dress rehearsal: evaluated, stateful, and
    // visible in history, but the dispatcher never notifies on them.
    suppressed: opts.previewId !== undefined,
  };

  return {
    name: formatResourceName(project, slug),
    repoid,
    previewId: opts.previewId ?? null,
    notification_channels: rule.spec.notification?.channels ?? [],
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
  // The owning preview registry id, or null for a live rule.
  previewId: string | null;
  suppressed: boolean;
};

/** Reads the resource identity and display fields from a stored rule. */
export function fromAlertingRule(
  rule: Pick<
    AlertingRule,
    "previewId" | "repoid" | "name" | "notification_channels" | "spec"
  >,
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
    repoid: rule.repoid,
    severity: rule.spec.severity,
    notificationTitleTemplate: ann[ANN_ALERTING_SUMMARY] ?? "",
    notificationDescriptionTemplate: ann[ANN_ALERTING_DESCRIPTION] ?? "",
    notificationChannels: rule.notification_channels,
    displayName: ann[ANN_DISPLAY_NAME] ?? null,
    displayDescription: ann[ANN_DISPLAY_DESCRIPTION] ?? null,
    instanceLabelColumns: rule.spec.label_columns ?? [],
    forSeconds: rule.spec.for_secs,
    resolveAfter: rule.spec.resolve_after,
    condition: rule.spec.condition,
    runbookProject: runbook?.project ?? null,
    runbookSlug: runbook?.slug ?? null,
    previewId: rule.previewId,
    // Inputs that bypass schema parsing may omit this default.
    suppressed: rule.spec.suppressed ?? false,
  };
}

/** Reconstructs the canonical as-code document from a stored rule. */
export function toAlertRuleDocument(
  rule: Pick<AlertingRule, "name" | "notification_channels" | "spec">,
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
      ...(rule.notification_channels.length > 0
        ? { notification: { channels: rule.notification_channels } }
        : {}),
      notificationMessage: {
        title: ann[ANN_ALERTING_SUMMARY] ?? "",
        ...(ann[ANN_ALERTING_DESCRIPTION]
          ? { description: ann[ANN_ALERTING_DESCRIPTION] }
          : {}),
      },
      query: rule.spec.sql,
      instanceLabels:
        rule.spec.label_columns && rule.spec.label_columns.length > 0
          ? rule.spec.label_columns
          : undefined,
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
