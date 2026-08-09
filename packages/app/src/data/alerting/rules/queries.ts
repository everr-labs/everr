import type { TimeRange } from "@everr/ui/lib/time-range";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { ALERTING_POLL_INTERVAL_MS } from "../polling";
import {
  getAlertingRule,
  getAlertingRuleByName,
  getAlertingRuleEvaluationSeries,
  listAlertingRules,
  listAlertingRulesPage,
} from "./server";

const RULES_PAGE_LIMIT = 100;

export const ruleQueries = {
  rules: () =>
    queryOptions({
      queryKey: ["alerting", "rules"] as const,
      queryFn: () => listAlertingRules(),
      refetchInterval: ALERTING_POLL_INTERVAL_MS,
    }),

  rulesPage: (preview?: string) =>
    infiniteQueryOptions({
      queryKey: ["alerting", "rules", "page", preview?.trim() || null] as const,
      queryFn: ({ pageParam }) =>
        listAlertingRulesPage({
          data: {
            limit: RULES_PAGE_LIMIT,
            ...(pageParam ? { cursor: pageParam } : {}),
            ...(preview?.trim() ? { preview: preview.trim() } : {}),
          },
        }),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.next_cursor,
      refetchInterval: (query) =>
        (query.state.data?.pages.length ?? 0) > 1
          ? false
          : ALERTING_POLL_INTERVAL_MS,
    }),

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
