import { applyAlertSpecs } from "@/data/alerts/apply.server";
import { validateAlertRunbookLinks } from "@/data/alerts/runbook-links.server";
import { applyDashboardSpecs } from "@/data/dashboards/apply.server";
import { upsertPreview } from "@/data/previews/apply.server";
import { applyRunbookSpecs } from "@/data/runbooks/apply.server";
import { ApplyValidationError } from "./errors";
import type { ApplyInput, ApplyResourceEntry, ApplySource } from "./schema";

export interface KindResult {
  kind: string;
  created: string[];
  updated: string[];
  deleted: string[];
}

export interface ApplyResourcesResult {
  dryRun: boolean;
  results: KindResult[];
}

/** A reconciler makes the repo's resources of one kind match the given entries. */
export type Reconciler = (opts: {
  orgId: string;
  repoid: string;
  /** Preview namespace to reconcile within; '' is the live state. */
  preview: string;
  resources: ApplyResourceEntry[];
  source?: ApplySource;
  dryRun?: boolean;
}) => Promise<{ created: string[]; updated: string[]; deleted: string[] }>;

/**
 * State key → (kind label, reconciler). Every registered kind reconciles on
 * each apply, including an empty array, so the submitted state is the complete
 * desired state for the repo — an absent kind prunes within the repoid.
 *
 * Keep the kinds in sync with classify_documents in
 * crates/everr-core/src/apply.rs, which routes documents by kind CLI-side.
 */
const REGISTRY: {
  key: keyof ApplyInput["state"];
  kind: string;
  reconcile: Reconciler;
}[] = [
  { key: "dashboards", kind: "Dashboard", reconcile: applyDashboardSpecs },
  { key: "runbooks", kind: "Runbook", reconcile: applyRunbookSpecs },
  { key: "alerts", kind: "AlertRule", reconcile: applyAlertSpecs },
];

function validateResourceKind(
  resources: ApplyResourceEntry[],
  expectedKind: string,
): void {
  for (const resource of resources) {
    const value = resource.resource as { kind?: unknown } | null | undefined;
    const ok =
      value?.kind === expectedKind ||
      // `Notebook` is the legacy alias for `Runbook` (ADR 0002).
      (expectedKind === "Runbook" && value?.kind === "Notebook");
    if (!ok) {
      throw new ApplyValidationError(
        `${resource.path}: expected kind "${expectedKind}"`,
      );
    }
  }
}

/**
 * Apply grouped resources for one repo. Every registered kind is reconciled,
 * including empty arrays, so the submitted state is the full repo state.
 *
 * Reconcilers run sequentially and each one writes on its own, so a later kind
 * that fails validation must not be able to let an earlier kind write first. We
 * therefore reconcile in two passes: a dry-run pass that validates every kind
 * (each reconciler runs its full document validation but performs no writes),
 * then — only if all kinds validated — the real apply pass. Without this, an
 * apply carrying a single invalid Runbook would let the Dashboard reconciler
 * prune the repo before Runbook validation threw.
 */
export async function applyResources(opts: {
  orgId: string;
  repoid: string;
  preview?: string;
  state: ApplyInput["state"];
  source?: ApplySource;
  dryRun?: boolean;
}): Promise<ApplyResourcesResult> {
  const { orgId, repoid, state, source, dryRun } = opts;
  const preview = opts.preview ?? "";

  const summarize = (
    kind: string,
    r: { created: string[]; updated: string[]; deleted: string[] },
  ): KindResult => ({
    kind,
    created: r.created,
    updated: r.updated,
    deleted: r.deleted,
  });

  // Validation pass: every kind reconciles in dryRun mode, which runs the full
  // document validation but writes nothing. Any invalid document throws here,
  // before any kind has written. When the caller asked for a dry run, this pass
  // is also the result.
  const validated: KindResult[] = [];
  for (const { key, kind, reconcile } of REGISTRY) {
    validateResourceKind(state[key], kind);
    const r = await reconcile({
      orgId,
      repoid,
      preview,
      resources: state[key],
      source,
      dryRun: true,
    });
    validated.push(summarize(kind, r));
  }

  // Cross-kind: a linked runbook must exist in this batch or already in the
  // DB. Runs after every kind validated, before any kind writes.
  await validateAlertRunbookLinks({
    orgId,
    repoid,
    preview,
    alerts: state.alerts,
    runbooks: state.runbooks,
  });

  if (dryRun) return { dryRun: true, results: validated };

  // All kinds validated above; now apply for real.
  const results: KindResult[] = [];
  for (const { key, kind, reconcile } of REGISTRY) {
    const r = await reconcile({
      orgId,
      repoid,
      preview,
      resources: state[key],
      source,
      dryRun: false,
    });
    results.push(summarize(kind, r));
  }

  // Register the preview only after every kind applied, so the switcher never
  // lists a preview whose rows failed to write. Live applies ('') are not
  // registered — the registry is the preview lifecycle, not an apply log.
  if (preview !== "") {
    await upsertPreview({ orgId, repoid, name: preview });
  }

  return { dryRun: false, results };
}
