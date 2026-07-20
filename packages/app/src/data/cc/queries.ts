// packages/app/src/data/cc/queries.ts
//
// The one owner of TanStack Query definitions for the clickety-clack
// surfaces: per-resource query keys and queryOptions, used by the alerts
// routes and builder drawers for both querying and invalidation (a
// resource's `queryKey` is also its invalidation prefix — e.g.
// `qc.invalidateQueries({ queryKey: ccQueries.silences().queryKey })`).
// Client-consumed code calling server fns.
//
// Poll cadence: the live surfaces — active instances (alerts), rule listings
// (rollups and health change as rules evaluate), and the stored event
// history — refetch on CC_POLL_INTERVAL_MS wherever they are shown. Config
// resources (routes, receivers, channels, inhibitions, silences,
// subscriptions) change only through user actions and are invalidated by
// their mutations instead.
import type { TimeRange } from "@everr/ui/lib/time-range";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import {
  getCcRule,
  getCcSlo,
  getCcSloBudgetSeries,
  getCcSloStatus,
  listCcAlerts,
  listCcChannels,
  listCcEventHistory,
  listCcInhibitions,
  listCcReceivers,
  listCcRoutes,
  listCcRules,
  listCcRulesPage,
  listCcSilences,
  listCcSlos,
  listCcSubscriptions,
} from "./server";
import type { CcRuleHealthStatus } from "./types";

export const CC_POLL_INTERVAL_MS = 15_000;

const RULES_PAGE_LIMIT = 100;
/** Default row cap for the event-history feeds. */
const EVENT_HISTORY_LIMIT = 200;

export const ccQueries = {
  alerts: () =>
    queryOptions({
      queryKey: ["cc", "alerts"] as const,
      queryFn: () => listCcAlerts(),
      refetchInterval: CC_POLL_INTERVAL_MS,
    }),

  // The full rule set in one shot, for surfaces that resolve every rule at
  // once (triage grouping, history handle resolution). The key is a prefix of
  // rulesPage's, so invalidating `rules` refreshes both listings.
  rules: () =>
    queryOptions({
      queryKey: ["cc", "rules"] as const,
      queryFn: () => listCcRules(),
      refetchInterval: CC_POLL_INTERVAL_MS,
    }),

  // Keyset-paginated listing for the rules table: each page is CC's
  // {items, next_cursor} envelope, null cursor = last page, with an optional
  // server-side health filter.
  rulesPage: (health?: CcRuleHealthStatus) =>
    infiniteQueryOptions({
      queryKey: ["cc", "rules", "page", health ?? "all"] as const,
      queryFn: ({ pageParam }) =>
        listCcRulesPage({
          data: {
            limit: RULES_PAGE_LIMIT,
            ...(pageParam ? { cursor: pageParam } : {}),
            ...(health ? { health } : {}),
          },
        }),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.next_cursor,
      // Polling an infinite query refetches EVERY loaded page serially each
      // cycle, so the poll runs only while a single page is loaded (the
      // common case). Once "Load more" has stacked further pages, the poll
      // pauses and the listing refreshes via mutation invalidation instead —
      // this keeps every loaded row on screen (unlike `maxPages`, which
      // drops the earliest pages as later ones load).
      refetchInterval: (query) =>
        (query.state.data?.pages.length ?? 0) > 1 ? false : CC_POLL_INTERVAL_MS,
    }),

  rule: (ruleId: string) =>
    queryOptions({
      queryKey: ["cc", "rule", ruleId] as const,
      queryFn: () => getCcRule({ data: { ruleId } }),
    }),

  // The tenant's SLOs (bare configs — no status). A config listing like
  // routes/receivers: it changes through user actions (pause/resume/delete,
  // as-code apply), so mutations invalidate it rather than polling.
  slos: () =>
    queryOptions({
      queryKey: ["cc", "slos"] as const,
      queryFn: () => listCcSlos(),
    }),

  slo: (sloId: string) =>
    queryOptions({
      queryKey: ["cc", "slo", sloId] as const,
      queryFn: () => getCcSlo({ data: { sloId } }),
    }),

  // The evaluator's latest status snapshot for one SLO (null until the first
  // evaluation tick writes one). The live surface of the SLO detail page, so
  // it polls like alerts/rules do.
  sloStatus: (sloId: string) =>
    queryOptions({
      queryKey: ["cc", "slo-status", sloId] as const,
      queryFn: () => getCcSloStatus({ data: { sloId } }),
      refetchInterval: CC_POLL_INTERVAL_MS,
    }),

  // The SLO's error-budget-over-time series (raw good/valid gauges, budget
  // derived server-side). Keyed on the window + target so a spec change refetches
  // a fresh series; polls like the status snapshot since new sample points land
  // as the evaluator ticks.
  sloBudgetSeries: (
    sloId: string,
    timeRange: TimeRange,
    window: string,
    targetPercent: number,
  ) =>
    queryOptions({
      queryKey: [
        "cc",
        "slo-budget-series",
        sloId,
        { timeRange, window, targetPercent },
      ] as const,
      queryFn: () =>
        getCcSloBudgetSeries({
          data: { sloId, window, targetPercent, timeRange },
        }),
      refetchInterval: CC_POLL_INTERVAL_MS,
    }),

  routes: () =>
    queryOptions({
      queryKey: ["cc", "routes"] as const,
      queryFn: () => listCcRoutes(),
    }),

  receivers: () =>
    queryOptions({
      queryKey: ["cc", "receivers"] as const,
      queryFn: () => listCcReceivers(),
    }),

  channels: () =>
    queryOptions({
      queryKey: ["cc", "channels"] as const,
      queryFn: () => listCcChannels(),
    }),

  inhibitions: () =>
    queryOptions({
      queryKey: ["cc", "inhibitions"] as const,
      queryFn: () => listCcInhibitions(),
    }),

  silences: () =>
    queryOptions({
      queryKey: ["cc", "silences"] as const,
      queryFn: () => listCcSilences(),
    }),

  subscriptions: () =>
    queryOptions({
      queryKey: ["cc", "subscriptions"] as const,
      queryFn: () => listCcSubscriptions(),
    }),

  // Stored CC event history from ClickHouse. `fingerprint` scopes to one
  // alert instance's events (server-side WHERE); `limit` caps rows (1 = the
  // newest event only, for freshness readouts).
  eventHistory: (
    timeRange: TimeRange,
    opts: { limit?: number; fingerprint?: string } = {},
  ) => {
    const limit = opts.limit ?? EVENT_HISTORY_LIMIT;
    return queryOptions({
      queryKey: [
        "cc",
        "event-history",
        { timeRange, limit, fingerprint: opts.fingerprint ?? null },
      ] as const,
      queryFn: () =>
        listCcEventHistory({
          data: {
            limit,
            timeRange,
            ...(opts.fingerprint !== undefined
              ? { fingerprint: opts.fingerprint }
              : {}),
          },
        }),
      refetchInterval: CC_POLL_INTERVAL_MS,
    });
  },
};
