import { applyAlertSpecs } from "@/data/alerts/apply.server";
import { validateAlertRunbookLinks } from "@/data/alerts/runbook-links.server";
import { applyDashboardSpecs } from "@/data/dashboards/apply.server";
import { findPreviewId, upsertPreview } from "@/data/previews/apply.server";
import type { Namespace } from "@/data/previews/scope";
import { applyRunbookSpecs } from "@/data/runbooks/apply.server";
import { type DbExecutor, db } from "@/db/client";
import { ApplyValidationError } from "./errors";
import type { OwnershipConflict } from "./ownership";
import type { ApplyInput, ApplyResourceEntry, ApplySource } from "./schema";
import { transferBoundary } from "./transfer.server";

export type { OwnershipConflict } from "./ownership";

export interface KindResult {
  kind: string;
  created: string[];
  updated: string[];
  deleted: string[];
  /** Live resources taken over from another owning repo (only with `adopt`). */
  adopted: string[];
  /** Live resources relabeled from the old repoid (only with `transferFrom`). */
  transferred: string[];
}

export interface ApplyResourcesResult {
  dryRun: boolean;
  results: KindResult[];
}

/** A reconciler makes the repo's resources of one kind match the given entries. */
export type Reconciler = (opts: {
  /** The apply target — live or a preview, carrying its (org, repoid). Scopes
   * every read and write. */
  namespace: Namespace;
  resources: ApplyResourceEntry[];
  source?: ApplySource;
  dryRun?: boolean;
  /** Take over live resources owned by another repo instead of reporting them
   * as conflicts. */
  adopt?: boolean;
  /** Runs queries: the shared apply transaction for real runs, base db for
   * dry-run reads. */
  db: DbExecutor;
}) => Promise<{
  created: string[];
  updated: string[];
  deleted: string[];
  adopted: string[];
  /** Creates colliding with another repo's live resource; empty when adopting. */
  conflicts: OwnershipConflict[];
}>;

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
  /** Take over live resources owned by another repo instead of failing. */
  adopt?: boolean;
  /** Move everything this repoid owns to `repoid` before reconciling, in the
   * same transaction (repo rename / legacy-manifest removal). Live only. */
  transferFrom?: string;
}): Promise<ApplyResourcesResult> {
  const { orgId, repoid, state, source, dryRun, adopt, transferFrom } = opts;
  // null = live. previewNameSchema is min-length, so a present name is never "".
  const previewName = opts.preview ?? null;

  // The input schema rejects these too; guard here for non-route callers.
  if (transferFrom === repoid) {
    throw new ApplyValidationError(
      "transferFrom must differ from the repo's own repoid",
    );
  }
  if (transferFrom && previewName !== null) {
    throw new ApplyValidationError(
      "transferFrom cannot be combined with a preview apply",
    );
  }

  const summarize = (
    kind: string,
    r: {
      created: string[];
      updated: string[];
      deleted: string[];
      adopted: string[];
    },
  ): KindResult => ({
    kind,
    created: r.created,
    updated: r.updated,
    deleted: r.deleted,
    adopted: r.adopted,
    transferred: [],
  });

  // Live, or the preview resolved to its registry id via the given resolver.
  // A live namespace carries the transfer source (`absorbs`) so every scope
  // diffs against the post-transfer world; see previewScope.
  const resolveNamespace = async (
    resolveId: (name: string) => Promise<string | null>,
  ): Promise<Namespace> =>
    previewName === null
      ? transferFrom
        ? { orgId, repoid, kind: "live", absorbs: transferFrom }
        : { orgId, repoid, kind: "live" }
      : { orgId, repoid, kind: "preview", id: await resolveId(previewName) };

  // The dry-run target resolves the preview to its existing registry id (without
  // creating it) so the diff scopes to the right rows. A preview with nothing
  // applied yet resolves to a null id, which matches no rows.
  const namespace = await resolveNamespace((name) =>
    findPreviewId(db, { orgId, repoid, name }),
  );

  // Validation pass: every kind reconciles in dryRun mode, which runs the full
  // document validation but writes nothing. Any invalid document throws here,
  // before any kind has written. When the caller asked for a dry run, this pass
  // is also the result.
  const validated: KindResult[] = [];
  const conflicts: (OwnershipConflict & { kind: string })[] = [];
  for (const { key, kind, reconcile } of REGISTRY) {
    validateResourceKind(state[key], kind);
    const r = await reconcile({
      namespace,
      resources: state[key],
      source,
      dryRun: true,
      adopt,
      db,
    });
    validated.push(summarize(kind, r));
    for (const c of r.conflicts) conflicts.push({ kind, ...c });
  }

  // Fail-fast on cross-repo ownership conflicts (a live create whose (project,
  // slug) another repo already owns). Aborts before any write; `--adopt`
  // transfers ownership instead. Reconcilers only report conflicts when not
  // adopting, so this never fires with `adopt`.
  if (conflicts.length > 0) {
    const lines = conflicts
      .map((c) => `  ${c.project}/${c.slug} (owned by ${c.owner})`)
      .join("\n");
    throw new ApplyValidationError(
      `${conflicts.length} resource(s) are owned by another repo:\n${lines}\n` +
        `Re-run with --adopt to take ownership.`,
    );
  }

  // Cross-kind: a linked runbook must exist in this batch or already in the
  // DB. Runs after every kind validated, before any kind writes.
  await validateAlertRunbookLinks({
    namespace,
    alerts: state.alerts,
    runbooks: state.runbooks,
  });

  if (dryRun) {
    if (transferFrom) {
      // Report what the transfer would relabel; the reconcile diff above is
      // already computed against the post-transfer world via the absorbing
      // namespace scope.
      const moved = await transferBoundary(db, {
        orgId,
        from: transferFrom,
        to: repoid,
        dryRun: true,
      });
      for (const [i, { key }] of REGISTRY.entries()) {
        validated[i].transferred = moved[key];
      }
    }
    return { dryRun: true, results: validated };
  }

  // Real apply: one transaction so registration + every kind commit or roll
  // back together. Register the preview FIRST — its row is the parent every
  // preview resource row references (FK), and a rollback removes the row along
  // with any partial writes, so the switcher never lists a half-applied
  // preview. Live is not registered.
  const results: KindResult[] = [];
  await db.transaction(async (tx) => {
    const applied = await resolveNamespace((name) =>
      upsertPreview(tx, { orgId, repoid, name }),
    );
    // The transfer relabels the old boundary FIRST, so the reconcilers see
    // its rows as their own: unchanged ones no-op, changed ones update, and
    // ones missing from the tree prune, all in this same transaction.
    const moved = transferFrom
      ? await transferBoundary(tx, {
          orgId,
          from: transferFrom,
          to: repoid,
          dryRun: false,
        })
      : null;
    for (const { key, kind, reconcile } of REGISTRY) {
      const r = await reconcile({
        namespace: applied,
        resources: state[key],
        source,
        dryRun: false,
        adopt,
        db: tx,
      });
      const summary = summarize(kind, r);
      if (moved) summary.transferred = moved[key];
      results.push(summary);
    }
  });

  return { dryRun: false, results };
}
