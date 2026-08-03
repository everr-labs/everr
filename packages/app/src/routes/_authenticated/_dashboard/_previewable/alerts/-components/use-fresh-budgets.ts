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
 * The one read-time-budget overlay behind triage, the SLO listing, and the
 * SLO detail page, so they can never disagree about "current budget". `apply`
 * returns the groups unchanged while an SLO's scan is in flight, failed, or
 * was never requested — the snapshot is the instant fallback.
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
    // TanStack caches the combined value per combine-function identity; an
    // inline arrow would hand out a fresh Map every render.
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
