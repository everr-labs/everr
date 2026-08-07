import type { TimeRange } from "@everr/ui/lib/time-range";
import { queryOptions } from "@tanstack/react-query";
import { ALERTING_POLL_INTERVAL_MS } from "../polling";
import {
  getAlertingSlo,
  getAlertingSloBudgetNow,
  getAlertingSloBudgetSeries,
  getAlertingSloByName,
  getAlertingSloStatus,
  listAlertingSlos,
} from "./server";

export const sloQueries = {
  slos: (preview?: string) => {
    const previewName = preview?.trim() || null;
    return queryOptions({
      queryKey: ["alerting", "slos", previewName] as const,
      queryFn: () =>
        previewName === null
          ? listAlertingSlos()
          : listAlertingSlos({ data: { preview: previewName } }),
    });
  },

  slo: (sloId: string) =>
    queryOptions({
      queryKey: ["alerting", "slo", sloId] as const,
      queryFn: () => getAlertingSlo({ data: { sloId } }),
    }),

  sloByName: (project: string, slug: string, preview?: string) => {
    const previewName = preview?.trim() || null;
    return queryOptions({
      queryKey: [
        "alerting",
        "slo-by-name",
        project,
        slug,
        previewName,
      ] as const,
      queryFn: () =>
        getAlertingSloByName({
          data: {
            project,
            slug,
            ...(previewName === null ? {} : { preview: previewName }),
          },
        }),
    });
  },

  status: (sloId: string) =>
    queryOptions({
      queryKey: ["alerting", "slo-status", sloId] as const,
      queryFn: () => getAlertingSloStatus({ data: { sloId } }),
      refetchInterval: ALERTING_POLL_INTERVAL_MS,
    }),

  budgetSeries: (sloId: string, timeRange: TimeRange) =>
    queryOptions({
      queryKey: [
        "alerting",
        "slo-budget-series",
        sloId,
        { timeRange },
      ] as const,
      queryFn: () => getAlertingSloBudgetSeries({ data: { sloId, timeRange } }),
    }),

  budgetNow: (sloId: string) =>
    queryOptions({
      queryKey: ["alerting", "slo-budget-now", sloId] as const,
      queryFn: () => getAlertingSloBudgetNow({ data: { sloId } }),
      staleTime: 5 * 60_000,
    }),
};
