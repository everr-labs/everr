import { useQueries } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { ccQueries } from "@/data/cc/queries";
import {
  type CcFreshBudget,
  ccApplyFreshBudget,
  ccSloTiers,
  ccSloWindowSecs,
} from "@/data/cc/slo";
import type { CcSlo, CcSloStatusPayload } from "@/data/cc/types";

/**
 * The one read-time-budget overlay behind triage, the SLO listing, and the
 * SLO detail page, so they can never disagree about "current budget". `apply`
 * returns the status unchanged while an SLO's scan is in flight, failed, or
 * was never requested — the snapshot is the instant fallback.
 */
export function useCcFreshBudgets(sloIds: readonly string[]): {
  apply: (
    slo: Pick<CcSlo, "id" | "spec">,
    status: CcSloStatusPayload,
  ) => CcSloStatusPayload;
  isPending: (sloId: string) => boolean;
} {
  const scans = useQueries({
    queries: sloIds.map((id) => ccQueries.sloBudgetNow(id)),
    // TanStack caches the combined value per combine-function identity; an
    // inline arrow would hand out a fresh Map every render.
    combine: useCallback(
      (results: { data?: CcFreshBudget | null; isPending: boolean }[]) =>
        new Map(sloIds.map((id, i) => [id, results[i]])),
      [sloIds],
    ),
  });
  return useMemo(
    () => ({
      apply: (slo, status) =>
        ccApplyFreshBudget(
          ccSloTiers(slo.spec),
          status,
          scans.get(slo.id)?.data ?? undefined,
          ccSloWindowSecs(slo.spec),
        ),
      isPending: (sloId) => scans.get(sloId)?.isPending ?? false,
    }),
    [scans],
  );
}
