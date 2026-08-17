import type { TimeRange } from "@everr/ui/lib/time-range";
import { queryOptions } from "@tanstack/react-query";
import { ALERTING_POLL_INTERVAL_MS } from "../polling";
import {
  getAlertingRule,
  getAlertingRuleByName,
  getAlertingRuleEvaluationSeries,
  listAlertingRules,
} from "./server";

export const ruleQueries = {
  /**
   * Every scope of the rules list, live and preview alike. Pausing a rule
   * changes it in whichever scope shows it, so invalidation targets the whole
   * family: a `rules()` key ends in its own scope, and a filter carrying one
   * scope matches only that scope, never its siblings.
   */
  rulesFamily: ["alerting", "rules"] as const,

  rules: (preview?: string) => {
    const previewName = preview?.trim() || null;
    return queryOptions({
      queryKey: ["alerting", "rules", previewName] as const,
      queryFn: () =>
        listAlertingRules(
          previewName === null ? undefined : { data: { preview: previewName } },
        ),
      refetchInterval: ALERTING_POLL_INTERVAL_MS,
    });
  },

  rule: (ruleId: string) =>
    queryOptions({
      queryKey: ["alerting", "rule", ruleId] as const,
      queryFn: () => getAlertingRule({ data: { ruleId } }),
    }),

  ruleByName: (project: string, slug: string, preview?: string) => {
    const previewName = preview?.trim() || null;
    return queryOptions({
      queryKey: [
        "alerting",
        "rule-by-name",
        project,
        slug,
        previewName,
      ] as const,
      queryFn: () =>
        getAlertingRuleByName({
          data: {
            project,
            slug,
            ...(previewName === null ? {} : { preview: previewName }),
          },
        }),
    });
  },

  evaluationSeries: (
    ruleId: string,
    timeRange: TimeRange,
    getPoints: () => number,
  ) =>
    queryOptions({
      queryKey: [
        "alerting",
        "rule-evaluation-series",
        ruleId,
        { timeRange },
      ] as const,
      queryFn: () =>
        getAlertingRuleEvaluationSeries({
          data: { ruleId, timeRange, points: getPoints() },
        }),
    }),
};
