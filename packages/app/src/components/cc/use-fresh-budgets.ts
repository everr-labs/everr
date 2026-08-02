import { useQueries } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { ccQueries } from "@/data/cc/queries";
import {
  type CcFreshBudgetGroup,
  ccApplyFreshBudget,
  ccSloTiers,
  ccSloWindowSecs,
} from "@/data/cc/slo";
import type { CcSlo, CcSloGroupStatus } from "@/data/cc/types";

/**
 * Read-time budget scans for a bounded set of SLOs, plus the overlay that
 * merges each scan onto that SLO's stored status snapshot (ccApplyFreshBudget).
 * The one implementation behind the triage board, the SLO listing, and the SLO
 * detail page, so they can never disagree about what "current budget" means.
 * The snapshot stays the instant fallback until a scan lands: `apply` returns
 * the groups unchanged for an SLO whose scan is in flight, failed, or was
 * never requested.
 */
export function useCcFreshBudgets(sloIds: readonly string[]): {
  apply: (
    slo: Pick<CcSlo, "id" | "spec">,
    groups: readonly CcSloGroupStatus[],
  ) => CcSloGroupStatus[];
  isPending: (sloId: string) => boolean;
} {
  const scans = useQueries({
    queries: sloIds.map((id) => ccQueries.sloBudgetNow(id)),
    // Memoized because TanStack caches the combined value per combine-function
    // identity: an inline arrow would hand out a fresh Map every render and
    // churn every memo keyed on the result.
    combine: useCallback(
      (results: { data?: CcFreshBudgetGroup[]; isPending: boolean }[]) =>
        new Map(sloIds.map((id, i) => [id, results[i]])),
      [sloIds],
    ),
  });
  return useMemo(
    () => ({
      apply: (slo, groups) =>
        ccApplyFreshBudget(
          ccSloTiers(slo.spec),
          groups,
          scans.get(slo.id)?.data,
          ccSloWindowSecs(slo.spec),
        ),
      isPending: (sloId) => scans.get(sloId)?.isPending ?? false,
    }),
    [scans],
  );
}
