import {
  ANN_LABEL_PREFIX,
  ANN_PROJECT,
  isEverrAnnotationKey,
  OWN_NAME,
  OWN_PREVIEW,
  OWN_REPO,
} from "@/data/alerts/annotations";
import type { CcSloSpec } from "@/data/cc/types";
import type { SloYaml } from "./schema";

/**
 * SLO YAML → CC SloSpec. Shared by the as-code reconciler, the resource admin,
 * and tests. Ownership rides on the same annotation vocabulary as AlertRules
 * (everr.name / everr.repoid / everr.preview, see data/alerts/annotations.ts):
 * an SLO carrying everr.name is everr-managed; everr.repoid scopes which repo's
 * applies may touch it. A `previewId` builds the SLO for that preview
 * namespace: suppressed (CC evaluates it fully but never notifies) and tagged
 * with everr.preview so live and preview reconciles never touch each other's
 * SLOs. `slo.spec.annotations` (user pass-through) is merged in BEFORE the
 * generated keys, so the generated `everr.*` keys always win (the schema
 * already rejects `everr.`-prefixed keys, so the order never actually needs to
 * resolve a collision).
 */
export function toSloSpec(
  slo: SloYaml,
  repoid: string,
  opts: { previewId?: string } = {},
): CcSloSpec {
  const annotations: Record<string, string> = {
    ...slo.spec.annotations,
    [OWN_NAME]: slo.metadata.name,
    [OWN_REPO]: repoid,
  };
  if (opts.previewId) annotations[OWN_PREVIEW] = opts.previewId;
  // Recorded verbatim only when declared (even "default"), so toSloDocument
  // reconstructs exactly what was authored.
  if (slo.metadata.project !== undefined) {
    annotations[ANN_PROJECT] = slo.metadata.project;
  }
  for (const [k, v] of Object.entries(slo.metadata.labels ?? {})) {
    annotations[`${ANN_LABEL_PREFIX}${k}`] = v;
  }
  return {
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

/** The as-code identity fields read back out of a CC SLO's spec annotations. */
export type SloOwnershipView = {
  /** metadata.name (the as-code identity); "" for an unmanaged SLO. */
  slug: string;
  repoid: string;
  /** The declared metadata.project, or "default" when none was declared. */
  project: string;
  /** The owning preview registry id, or null for a live SLO. */
  previewId: string | null;
  suppressed: boolean;
};

/** Read the as-code identity back out of a CC SLO spec's annotations. */
export function fromCcSloSpec(spec: CcSloSpec): SloOwnershipView {
  const ann = spec.annotations;
  return {
    slug: ann[OWN_NAME] ?? "",
    repoid: ann[OWN_REPO] ?? "",
    project: ann[ANN_PROJECT] ?? "default",
    previewId: ann[OWN_PREVIEW] ?? null,
    suppressed: spec.suppressed,
  };
}

/**
 * CC SloSpec → the canonical `kind: SLO` as-code document, the inverse of
 * {@link toSloSpec} for everr-owned SLOs. Used by the resources CLI
 * (`everr resources show`): SLOs have no stored document (the CC SLO is the
 * resource), so one is reconstructed from the spec. Generated annotations
 * (`everr.*`) fold back into their source fields; everything else is the
 * user's pass-through `spec.annotations`.
 */
export function toSloDocument(spec: CcSloSpec): SloYaml {
  const ann = spec.annotations;

  const labels: Record<string, string> = {};
  const passthrough: Record<string, string> = {};
  for (const [key, value] of Object.entries(ann)) {
    if (key.startsWith(ANN_LABEL_PREFIX)) {
      labels[key.slice(ANN_LABEL_PREFIX.length)] = value;
    } else if (!isEverrAnnotationKey(key)) {
      passthrough[key] = value;
    }
  }

  return {
    kind: "SLO",
    metadata: {
      name: ann[OWN_NAME] ?? "",
      ...(ann[ANN_PROJECT] !== undefined ? { project: ann[ANN_PROJECT] } : {}),
      ...(Object.keys(labels).length > 0 ? { labels } : {}),
    },
    spec: {
      sli: {
        sql: spec.sli.sql,
        ...(spec.sli.label_columns.length > 0
          ? { labelColumns: spec.sli.label_columns }
          : {}),
      },
      targetPercent: spec.targetPercent,
      // The duration shorthand is the canonical as-code form (v1 is
      // rolling-only, so the flag carries no information).
      timeWindow: spec.timeWindow.duration,
      ...(spec.min_valid_events !== undefined
        ? { minValidEvents: spec.min_valid_events }
        : {}),
      ...(Object.keys(passthrough).length > 0
        ? { annotations: passthrough }
        : {}),
    },
  };
}

/** True if a CC SLO is everr-owned (carries `everr.name`), owned by this repo (or any repo). */
export function isOwnedSlo(spec: CcSloSpec, repoid?: string): boolean {
  const ann = spec.annotations;
  if (ann[OWN_NAME] === undefined) return false;
  return repoid === undefined || ann[OWN_REPO] === repoid;
}

/** The preview registry id a CC SLO belongs to, or null for a live SLO. */
export function previewIdOfSlo(spec: CcSloSpec): string | null {
  return spec.annotations[OWN_PREVIEW] ?? null;
}
