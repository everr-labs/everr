import {
  ANN_CC_LINK_RUNBOOK,
  ANN_CC_SUMMARY,
  ANN_DISPLAY_DESCRIPTION,
  ANN_DISPLAY_NAME,
  ANN_LABEL_PREFIX,
  OWN_REPO,
} from "@/data/alerts/annotations";
import {
  formatRunbookRef,
  isReservedAnnotationKey,
  parseRunbookRef,
} from "@/data/alerts/schema";
import { formatResourceName, parseResourceName } from "@/data/as-code/identity";
import type { CcSlo, CcSloInput } from "@/data/cc/types";
import type { SloYaml } from "./schema";

// The ownership annotation (everr.repoid) and the everr.label. prefix live in
// data/alerts/annotations, shared with the AlertRule mapping; re-exported here
// so the many existing SLO-side imports keep one path. Identity (project/slug,
// live-vs-preview namespace) is carried on the CC SLO's own first-class
// `name`/`namespace` fields now, not an annotation: see toSloInput/fromCcSlo
// below.
export { OWN_REPO } from "@/data/alerts/annotations";

// A linked runbook (project/slug), stored canonically so the SLO detail can
// deep-link to it. Mirrors the AlertRule mapping's ANN_RUNBOOK exactly (see
// data/alerts/mapping.ts) — not exported there, so redefined here rather than
// reaching into that module's private constant.
const ANN_RUNBOOK = "everr.runbook";

/**
 * SLO YAML → CC SLO create/update input: the spec fields flattened beside the
 * SLO's first-class `name`/`namespace` (CcSloInput's wire shape, mirroring
 * what CC's own CreateSloBody accepts and what a GET response returns).
 * Shared by the as-code reconciler, the resource admin, and tests.
 *
 * `appBaseUrl` (the everr app origin) enables the `link.runbook` annotation,
 * computed upfront here since the SLO's identity (project/slug) is known
 * before create.
 *
 * A `previewId` builds the SLO for that preview namespace: suppressed (CC
 * evaluates it fully but never notifies) so live and preview reconciles never
 * touch each other's SLOs; namespace alone discriminates live vs preview now,
 * so no identity annotation is written for it.
 *
 * `slo.spec.annotations` (user-supplied pass-through) is merged in BEFORE the
 * generated keys below, so the generated `everr.*`/link keys always win (the
 * schema already rejects `everr.`-prefixed keys, so this merge order never
 * actually needs to resolve a collision).
 */
export function toSloInput(
  slo: SloYaml,
  repoid: string,
  opts: { appBaseUrl?: string; previewId?: string } = {},
): CcSloInput {
  const project = slo.metadata.project ?? "default";
  const slug = slo.metadata.name;

  const annotations: Record<string, string> = {
    ...slo.spec.annotations,
    [OWN_REPO]: repoid,
  };
  for (const [k, v] of Object.entries(slo.metadata.labels ?? {})) {
    annotations[`${ANN_LABEL_PREFIX}${k}`] = v;
  }
  if (slo.spec.display?.name) {
    annotations[ANN_DISPLAY_NAME] = slo.spec.display.name;
    // `${slo_tier}`/`${burn_rate}` stay literal placeholder text: CC's
    // notification renderer resolves them from the firing event's
    // labels/evidence at dispatch time, the same way it resolves
    // notificationMessage templates for alerts.
    annotations[ANN_CC_SUMMARY] =
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
      annotations[ANN_CC_LINK_RUNBOOK] = new URL(
        `/runbooks/${runbookProject}/${runbookSlug}`,
        opts.appBaseUrl,
      ).toString();
    }
  }

  return {
    name: formatResourceName(project, slug),
    namespace: opts.previewId ?? "",
    sli: {
      sql: slo.spec.sli.sql,
      label_columns: slo.spec.sli.labelColumns ?? [],
    },
    targetPercent: slo.spec.targetPercent,
    // The schema normalizes timeWindow to the duration shorthand; v1 is
    // rolling-only, so isRolling is always true on the wire.
    timeWindow: { duration: slo.spec.timeWindow, isRolling: true },
    ...(slo.spec.minValidEvents !== undefined
      ? { min_valid_events: slo.spec.minValidEvents }
      : {}),
    annotations,
    // Preview SLOs are a full dress rehearsal: evaluated, stateful, and
    // visible in history, but the dispatcher never notifies on them.
    suppressed: opts.previewId !== undefined,
  };
}

/** The as-code identity fields read back out of a CC SLO. */
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
 * Read the as-code identity back out of a CC SLO: project/slug from the
 * first-class `name`, the preview id from `namespace`, and the rest
 * (ownership/runbook) from `spec.annotations`.
 */
export function fromCcSlo(
  slo: Pick<CcSlo, "namespace" | "name" | "spec">,
): SloOwnershipView {
  const { project, slug } = parseResourceName(slo.name);
  const ann = slo.spec.annotations;
  // The stored ref is already canonical (project/slug or a bare slug for the
  // default project), so any fallback project works to split it back out.
  const runbook = ann[ANN_RUNBOOK]
    ? parseRunbookRef(ann[ANN_RUNBOOK], "default")
    : null;
  return {
    project,
    slug,
    repoid: ann[OWN_REPO] ?? "",
    previewId: slo.namespace === "" ? null : slo.namespace,
    suppressed: slo.spec.suppressed,
    runbookProject: runbook?.project ?? null,
    runbookSlug: runbook?.slug ?? null,
    displayName: ann[ANN_DISPLAY_NAME] ?? null,
    displayDescription: ann[ANN_DISPLAY_DESCRIPTION] ?? null,
  };
}

/**
 * CC SLO → the canonical `kind: SLO` as-code document, the inverse of
 * {@link toSloInput} for everr-owned SLOs. Used by the resources CLI (`everr
 * resources show`): SLOs have no stored document (the CC SLO is the
 * resource), so one is reconstructed. `metadata.name`/`metadata.project` come
 * from splitting the first-class `name` (project omitted when "default");
 * generated annotations (`everr.*`, `link.runbook`) fold back into their
 * source fields or are dropped; everything else is the user's pass-through
 * `spec.annotations`.
 */
export function toSloDocument(slo: Pick<CcSlo, "name" | "spec">): SloYaml {
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
        ...(slo.spec.sli.label_columns.length > 0
          ? { labelColumns: slo.spec.sli.label_columns }
          : {}),
      },
      targetPercent: slo.spec.targetPercent,
      // The duration shorthand is the canonical as-code form (v1 is
      // rolling-only, so the flag carries no information).
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

/** True if a CC SLO is everr-owned (carries `everr.repoid`), owned by this repo (or any repo). */
export function isOwnedSlo(slo: Pick<CcSlo, "spec">, repoid?: string): boolean {
  const ann = slo.spec.annotations;
  if (ann[OWN_REPO] === undefined) return false;
  return repoid === undefined || ann[OWN_REPO] === repoid;
}

/** The preview registry id a CC SLO belongs to, or null for a live SLO. */
export function previewIdOfSlo(slo: Pick<CcSlo, "namespace">): string | null {
  return slo.namespace === "" ? null : slo.namespace;
}
