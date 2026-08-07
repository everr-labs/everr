import { useQueries } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { alertingQueries } from "@/data/alerting/queries";
import {
  type AlertingFreshBudget,
  alertingApplyFreshBudget,
  alertingSloTiers,
  alertingSloWindowSecs,
} from "@/data/alerting/slos/model";
import type {
  AlertingSlo,
  AlertingSloStatusPayload,
} from "@/data/alerting/types";

/**
 * The one read-time-budget overlay behind triage, the SLO listing, and the
 * SLO detail page, so they can never disagree about "current budget". `apply`
 * returns the status unchanged while an SLO's scan is in flight, failed, or
 * was never requested — the snapshot is the instant fallback.
 */
export function useAlertingFreshBudgets(sloIds: readonly string[]): {
  apply: (
    slo: Pick<AlertingSlo, "id" | "spec">,
    status: AlertingSloStatusPayload,
  ) => AlertingSloStatusPayload;
  isPending: (sloId: string) => boolean;
} {
  const scans = useQueries({
    queries: sloIds.map((id) => alertingQueries.sloBudgetNow(id)),
    // TanStack caches the combined value per combine-function identity; an
    // inline arrow would hand out a fresh Map every render.
    combine: useCallback(
      (results: { data?: AlertingFreshBudget | null; isPending: boolean }[]) =>
        new Map(sloIds.map((id, i) => [id, results[i]])),
      [sloIds],
    ),
  });
  return useMemo(
    () => ({
      apply: (slo, status) =>
        alertingApplyFreshBudget(
          alertingSloTiers(slo.spec),
          status,
          scans.get(slo.id)?.data ?? undefined,
          alertingSloWindowSecs(slo.spec),
        ),
      isPending: (sloId) => scans.get(sloId)?.isPending ?? false,
    }),
    [scans],
  );
}
