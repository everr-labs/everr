import type { CcRuleSpec } from "@/data/cc/types";
import {
  type AlertRuleYaml,
  formatRunbookRef,
  parseRunbookRef,
} from "./schema";
import { parseEvaluationInterval } from "./window";

// Ownership + management annotations on a CC rule.
export const OWN_NAME = "everr.name";
export const OWN_REPO = "everr.repoid";
export const OWN_MANAGED = "everr.managed";
export const MANAGED_SIMPLE = "simple";

// Annotation keys we pack the simple-alert UI fields into.
const ANN_TITLE = "everr.notification.title";
const ANN_DESCRIPTION = "everr.notification.description";
const ANN_DISPLAY_NAME = "everr.display.name";
const ANN_DISPLAY_DESCRIPTION = "everr.display.description";
const ANN_LABEL_PREFIX = "everr.label."; // metadata.labels.<k> → everr.label.<k>
// A linked runbook (project/slug), stored canonically so the alert detail can
// deep-link to it. Replaces the old Postgres runbook_project/runbook_slug
// columns now that a simple alert IS a CC rule.
const ANN_RUNBOOK = "everr.runbook";

/** AlertRule YAML → CC RuleSpec. Shared by the UI create path and the as-code reconciler. */
export function toSimpleRuleSpec(
  rule: AlertRuleYaml,
  repoid: string,
): CcRuleSpec {
  const annotations: Record<string, string> = {
    [OWN_NAME]: rule.metadata.name,
    [OWN_REPO]: repoid,
    [OWN_MANAGED]: MANAGED_SIMPLE,
    [ANN_TITLE]: rule.spec.notificationMessage.title,
  };
  if (rule.spec.notificationMessage.description) {
    annotations[ANN_DESCRIPTION] = rule.spec.notificationMessage.description;
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
  }
  return {
    sql: rule.spec.query,
    interval_secs: parseEvaluationInterval(rule.spec.evaluationInterval),
    for_secs: 0,
    label_columns: rule.spec.instanceLabels ?? [],
    value_column: null,
    severity: rule.spec.severity,
    annotations,
    resolve_after: 1,
  };
}

export type SimpleAlertView = {
  slug: string;
  repoid: string;
  severity: "info" | "warning" | "critical";
  notificationTitleTemplate: string;
  notificationDescriptionTemplate: string;
  displayName: string | null;
  displayDescription: string | null;
  instanceLabelColumns: string[];
  runbookProject: string | null;
  runbookSlug: string | null;
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
    notificationTitleTemplate: ann[ANN_TITLE] ?? "",
    notificationDescriptionTemplate: ann[ANN_DESCRIPTION] ?? "",
    displayName: ann[ANN_DISPLAY_NAME] ?? null,
    displayDescription: ann[ANN_DISPLAY_DESCRIPTION] ?? null,
    instanceLabelColumns: spec.label_columns ?? [],
    runbookProject: runbook?.project ?? null,
    runbookSlug: runbook?.slug ?? null,
  };
}

/** True if a CC rule is a simple (everr-managed) alert owned by this repo (or any repo). */
export function isManagedSimple(spec: CcRuleSpec, repoid?: string): boolean {
  const ann = spec.annotations ?? {};
  if (ann[OWN_MANAGED] !== MANAGED_SIMPLE) return false;
  return repoid === undefined || ann[OWN_REPO] === repoid;
}
