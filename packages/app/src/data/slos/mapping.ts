import type { AlertingSlo, AlertingSloInput } from "@/data/alerting/types";
import {
  ANN_ALERTING_LINK_RUNBOOK,
  ANN_ALERTING_SUMMARY,
  ANN_DISPLAY_DESCRIPTION,
  ANN_DISPLAY_NAME,
  ANN_LABEL_PREFIX,
} from "@/data/alerts/annotations";
import {
  formatRunbookRef,
  isReservedAnnotationKey,
  parseRunbookRef,
} from "@/data/alerts/schema";
import { formatResourceName, parseResourceName } from "@/data/as-code/identity";
import type { SloYaml } from "./schema";

// Canonical linked runbook reference.
const ANN_RUNBOOK = "everr.runbook";

/** Maps an as-code SLO to alerting engine's create/update input. */
export function toSloInput(
  slo: SloYaml,
  repoid: string,
  opts: { appBaseUrl?: string; previewId?: string } = {},
): AlertingSloInput {
  const project = slo.metadata.project ?? "default";
  const slug = slo.metadata.name;

  const annotations: Record<string, string> = {
    ...slo.spec.annotations,
  };
  for (const [k, v] of Object.entries(slo.metadata.labels ?? {})) {
    annotations[`${ANN_LABEL_PREFIX}${k}`] = v;
  }
  if (slo.spec.display?.name) {
    annotations[ANN_DISPLAY_NAME] = slo.spec.display.name;
    // alerting engine resolves these placeholders when dispatching.
    annotations[ANN_ALERTING_SUMMARY] =
      `${slo.spec.display.name}: \${slo_tier} burn - \${burn_rate}x over budget`;
  }
  if (slo.spec.display?.description) {
    annotations[ANN_DISPLAY_DESCRIPTION] = slo.spec.display.description;
  }
  if (slo.spec.runbook) {
    const { project: runbookProject, slug: runbookSlug } = parseRunbookRef(
      slo.spec.runbook,
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

  return {
    name: formatResourceName(project, slug),
    repoid,
    previewId: opts.previewId ?? null,
    sli: {
      sql: slo.spec.sli.sql,
    },
    targetPercent: slo.spec.targetPercent,
    // v1 supports rolling windows only.
    timeWindow: { duration: slo.spec.timeWindow, isRolling: true },
    ...(slo.spec.minValidEvents !== undefined
      ? { min_valid_events: slo.spec.minValidEvents }
      : {}),
    annotations,
    // Preview SLOs evaluate without notifying.
    suppressed: opts.previewId !== undefined,
  };
}

/** The as-code identity fields read back out of a alerting engine SLO. */
export type SloOwnershipView = {
  project: string;
  slug: string;
  repoid: string;
  /** The owning preview registry id, or null for a live SLO. */
  previewId: string | null;
  suppressed: boolean;
  runbookProject: string | null;
  runbookSlug: string | null;
  displayName: string | null;
  displayDescription: string | null;
};

/**
 * Read the as-code identity back out of an SLO: project/slug from the
 * first-class `name`, preview ownership from `previewId`, and the rest from
 * `spec.annotations`.
 */
export function fromAlertingSlo(
  slo: Pick<AlertingSlo, "previewId" | "repoid" | "name" | "spec">,
): SloOwnershipView {
  const { project, slug } = parseResourceName(slo.name);
  const ann = slo.spec.annotations;
  // A bare runbook ref is canonical shorthand for the default project here.
  const runbook = ann[ANN_RUNBOOK]
    ? parseRunbookRef(ann[ANN_RUNBOOK], "default")
    : null;
  return {
    project,
    slug,
    repoid: slo.repoid,
    previewId: slo.previewId,
    suppressed: slo.spec.suppressed,
    runbookProject: runbook?.project ?? null,
    runbookSlug: runbook?.slug ?? null,
    displayName: ann[ANN_DISPLAY_NAME] ?? null,
    displayDescription: ann[ANN_DISPLAY_DESCRIPTION] ?? null,
  };
}

/** Reconstructs the canonical as-code document from a alerting engine SLO. */
export function toSloDocument(
  slo: Pick<AlertingSlo, "name" | "spec">,
): SloYaml {
  const { project, slug } = parseResourceName(slo.name);
  const ann = slo.spec.annotations;

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
    kind: "SLO",
    metadata: {
      name: slug,
      ...(project !== "default" ? { project } : {}),
      ...(Object.keys(labels).length > 0 ? { labels } : {}),
    },
    spec: {
      ...(display ? { display } : {}),
      sli: {
        sql: slo.spec.sli.sql,
      },
      targetPercent: slo.spec.targetPercent,
      // The shorthand is canonical because v1 is rolling-only.
      timeWindow: slo.spec.timeWindow.duration,
      ...(slo.spec.min_valid_events !== undefined
        ? { minValidEvents: slo.spec.min_valid_events }
        : {}),
      ...(ann[ANN_RUNBOOK] !== undefined ? { runbook: ann[ANN_RUNBOOK] } : {}),
      ...(Object.keys(passthrough).length > 0
        ? { annotations: passthrough }
        : {}),
    },
  };
}

/** Whether an SLO is owned by this repo, or by any repo when omitted. */
export function isOwnedSlo(
  slo: Pick<AlertingSlo, "repoid">,
  repoid?: string,
): boolean {
  return repoid === undefined || slo.repoid === repoid;
}
