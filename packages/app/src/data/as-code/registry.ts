import { applyAlertSpecs } from "@/data/alerts/apply.server";
import { applyDashboardSpecs } from "@/data/dashboards/apply.server";
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
  resources: ApplyResourceEntry[];
  source?: ApplySource;
  dryRun?: boolean;
}) => Promise<{ created: string[]; updated: string[]; deleted: string[] }>;

/**
 * State key → (kind label, reconciler). Every registered kind reconciles on
 * each apply, so an empty array prunes that kind within the repoid — the
 * submitted state is the complete desired state for the repo.
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
  { key: "alerts", kind: "AlertRule", reconcile: applyAlertSpecs },
];

function validateResourceKind(
  resources: ApplyResourceEntry[],
  expectedKind: string,
): void {
  for (const resource of resources) {
    const value = resource.resource as { kind?: unknown } | null | undefined;
    if (value?.kind !== expectedKind) {
      throw new ApplyValidationError(
        `${resource.path}: expected kind "${expectedKind}"`,
      );
    }
  }
}

/**
 * Apply grouped resources for one repo. Every registered kind is reconciled,
 * including empty arrays, so the submitted state is the full repo state.
 */
export async function applyResources(opts: {
  orgId: string;
  repoid: string;
  state: ApplyInput["state"];
  source?: ApplySource;
  dryRun?: boolean;
}): Promise<ApplyResourcesResult> {
  const { orgId, repoid, state, source, dryRun } = opts;

  const results: KindResult[] = [];
  for (const { key, kind, reconcile } of REGISTRY) {
    validateResourceKind(state[key], kind);
    const r = await reconcile({
      orgId,
      repoid,
      resources: state[key],
      source,
      dryRun,
    });
    results.push({
      kind,
      created: r.created,
      updated: r.updated,
      deleted: r.deleted,
    });
  }

  return { dryRun: dryRun ?? false, results };
}
