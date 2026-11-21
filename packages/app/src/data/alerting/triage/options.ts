import { type TimeRange, toViewerTimeRange } from "@everr/ui/lib/time-range";
import { keepPreviousData, type QueryClient, queryOptions } from "@tanstack/react-query";
import { keepAcrossTimeRange } from "#app/lib/keep-across-time-range.ts";
import {
  getAlertDetail,
  getAlertRuleOptions,
  getAlertSilences,
  getAlertTriage,
  getRuleStateHistory,
} from "./server";

const alertingQueryKey = ["alerting", "triage"] as const;

/** Outside the triage key on purpose. Rules change by an apply, never by a
 *  silence write, so a cancel or a new silence must not refetch every rule in
 *  the organization to get back what it already had. */
const alertRulesQueryKey = ["alerting", "rules"] as const;

/** Every triage query at once, for the mutations that change what all three
 *  are reading. The shape of the key stays in this module: a caller that spelt
 *  it out again would keep compiling after the key was re-scoped, and quietly
 *  stop refreshing. */
export const invalidateAlertTriage = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: alertingQueryKey });

export const alertTriageOptions = (range: TimeRange) =>
  // oxlint-disable-next-line query/exhaustive-deps -- The key already includes each from/to field of the range object.
  queryOptions({
    // The range is part of the key: the row sparklines are scoped to it, so a
    // range change has to refetch rather than serve the old window.
    queryKey: [...alertingQueryKey, "list", range.from, range.to],
    queryFn: () => getAlertTriage({ data: toViewerTimeRange(range) }),
    // A range change keeps the previous range's answer on screen, dimmed,
    // until the new one lands, instead of dropping the page to placeholders.
    placeholderData: keepPreviousData,
    // Triage is a live board: a stale firing list is the one thing it must
    // never show.
    refetchInterval: 15_000,
  });

export const ruleStateHistoryOptions = (range: TimeRange) =>
  // oxlint-disable-next-line query/exhaustive-deps -- The key already includes each from/to field of the range object.
  queryOptions({
    queryKey: [...alertingQueryKey, "history", range.from, range.to],
    queryFn: () => getRuleStateHistory({ data: toViewerTimeRange(range) }),
    placeholderData: keepPreviousData,
  });

export const alertDetailOptions = (path: string | undefined, range: TimeRange) => {
  // The range is part of the key: the detail's silence list is scoped to it,
  // so a range change has to refetch rather than serve the old window.
  const queryKey = [
    ...alertingQueryKey,
    "detail",
    path ?? "",
    { from: range.from, to: range.to },
  ] as const;
  // oxlint-disable-next-line query/exhaustive-deps -- The key already includes each from/to field of the range object.
  return queryOptions({
    queryKey,
    queryFn: () =>
      getAlertDetail({
        data: { path: path ?? "", ...toViewerTimeRange(range) },
      }),
    // Kept across a range change only. Another rule's detail standing in for
    // the one just opened would put the wrong name over the wrong numbers.
    placeholderData: keepAcrossTimeRange(queryKey),
    enabled: Boolean(path),
  });
};

export const alertSilencesOptions = (range: TimeRange) =>
  // oxlint-disable-next-line query/exhaustive-deps -- The key already includes each from/to field of the range object.
  queryOptions({
    // Under the triage key on purpose: silencing and cancelling from either
    // screen change what both list, and one invalidation has to reach both.
    queryKey: [...alertingQueryKey, "silences", range.from, range.to],
    queryFn: () => getAlertSilences({ data: toViewerTimeRange(range) }),
    placeholderData: keepPreviousData,
    // "Ends in 4m" and a silence that has just lapsed are the two facts the
    // page is read for, and both go stale on their own.
    refetchInterval: 30_000,
  });

/** The rules the Silence dialog offers when it opens with none to assume. The
 *  one reader left: a listed silence carries its rule's name from the read that
 *  fetched it, so no screen loads this list only to print a row. */
export const alertRuleOptionsOptions = () =>
  queryOptions({
    queryKey: [...alertRulesQueryKey, "options"],
    queryFn: () => getAlertRuleOptions(),
    // Rules change by an apply, not by the minute.
    staleTime: 5 * 60_000,
  });
