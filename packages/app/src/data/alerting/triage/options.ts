import type { TimeRange } from "@everr/ui/lib/time-range";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import {
  getAlertDetail,
  getAlertRulePaths,
  getAlertSilences,
  getAlertTriage,
  getRuleStateHistory,
} from "./server";

const alertingQueryKey = ["alerting", "triage"] as const;

/** Every triage query at once, for the mutations that change what all three
 *  are reading. The shape of the key stays in this module: a caller that spelt
 *  it out again would keep compiling after the key was re-scoped, and quietly
 *  stop refreshing. */
export const invalidateAlertTriage = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: alertingQueryKey });

export const alertTriageOptions = (range: TimeRange) =>
  queryOptions({
    // The range is part of the key: the row sparklines are scoped to it, so a
    // range change has to refetch rather than serve the old window.
    queryKey: [...alertingQueryKey, "list", range.from, range.to],
    queryFn: () => getAlertTriage({ data: range }),
    // Triage is a live board: a stale firing list is the one thing it must
    // never show.
    refetchInterval: 15_000,
  });

export const ruleStateHistoryOptions = (range: TimeRange) =>
  queryOptions({
    queryKey: [...alertingQueryKey, "history", range.from, range.to],
    queryFn: () => getRuleStateHistory({ data: range }),
  });

export const alertDetailOptions = (
  path: string | undefined,
  range: TimeRange,
) =>
  queryOptions({
    // The range is part of the key: the detail's silence list is scoped to it,
    // so a range change has to refetch rather than serve the old window.
    queryKey: [...alertingQueryKey, "detail", path ?? "", range.from, range.to],
    queryFn: () =>
      getAlertDetail({
        data: { path: path ?? "", from: range.from, to: range.to },
      }),
    enabled: Boolean(path),
  });

export const alertSilencesOptions = (range: TimeRange) =>
  queryOptions({
    // Under the triage key on purpose: silencing and cancelling from either
    // screen change what both list, and one invalidation has to reach both.
    queryKey: [...alertingQueryKey, "silences", range.from, range.to],
    queryFn: () => getAlertSilences({ data: range }),
    // "Ends in 4m" and a silence that has just lapsed are the two facts the
    // page is read for, and both go stale on their own.
    refetchInterval: 30_000,
  });

export const alertRulePathsOptions = () =>
  queryOptions({
    queryKey: [...alertingQueryKey, "rule-paths"],
    queryFn: () => getAlertRulePaths(),
    // Rules change by an apply, not by the minute; the silence writes that
    // invalidate the triage key refetch this too, which is harmless and rare.
    staleTime: 5 * 60_000,
  });
