import type { TimeRange } from "@everr/ui/lib/time-range";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import {
  getAlertDetail,
  getAlertRuleOptions,
  getAlertSilences,
  getAlertTriage,
  getRuleStateHistory,
} from "./server";
import type { AlertRuleOption } from "./view";

const alertingQueryKey = ["alerting", "triage"] as const;

/** Outside the triage key on purpose. Rules change by an apply, never by a
 *  silence write, and this list is now mounted for as long as the Silences page
 *  is open: under the triage key, every cancel and every new silence refetched
 *  every rule in the organization to get back what it already had. */
const alertRulesQueryKey = ["alerting", "rules"] as const;

/** Path to display name, built once per fetch rather than once per render.
 *  Module scope so react-query can memoize on the function's identity. */
const toRuleNames = (rules: AlertRuleOption[]) =>
  new Map(rules.map((rule) => [rule.path, rule.name]));

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

export const alertRuleOptionsOptions = () =>
  queryOptions({
    queryKey: [...alertRulesQueryKey, "options"],
    queryFn: () => getAlertRuleOptions(),
    // Rules change by an apply, not by the minute.
    staleTime: 5 * 60_000,
  });

/** The same read, as the lookup a list of silences needs. `select` runs on the
 *  cached payload, so the map is rebuilt when the rules change rather than on
 *  every render of whoever is reading it. */
export const alertRuleNamesOptions = () =>
  queryOptions({ ...alertRuleOptionsOptions(), select: toRuleNames });
