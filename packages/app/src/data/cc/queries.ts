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
  getCcRuleByName,
  getCcSlo,
  getCcSloBudgetNow,
  getCcSloBudgetSeries,
  getCcSloByName,
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
  // The instance feed, scoped like the SLO listing: live-only by default, the
  // selected preview's overlay when one is chosen (preview instances are real
  // suppressed-rule evaluations and must never leak into the live feed).
  alerts: (preview?: string) => {
    const previewName = preview?.trim() || null;
    return queryOptions({
      queryKey: ["cc", "alerts", previewName] as const,
      queryFn: () =>
        previewName === null
          ? listCcAlerts()
          : listCcAlerts({ data: { preview: previewName } }),
      refetchInterval: CC_POLL_INTERVAL_MS,
    });
  },

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

  // The slug-addressed rule route's lookup: resolves by first-class name
  // (project/slug) via an exact-match rules-page query, live namespace only.
  // Keyed by address (not id) so list -> detail navigation and invalidation
  // both key off the same identity the route URL carries.
  ruleByName: (project: string, slug: string) =>
    queryOptions({
      queryKey: ["cc", "rule-by-name", project, slug] as const,
      queryFn: () => getCcRuleByName({ data: { project, slug } }),
    }),

  // The tenant's SLOs (bare configs — no status). A config listing like
  // routes/receivers: it changes through user actions (pause/resume/delete,
  // as-code apply), so mutations invalidate it rather than polling.
  slos: (preview?: string) => {
    const previewName = preview?.trim() || null;
    return queryOptions({
      queryKey: ["cc", "slos", previewName] as const,
      queryFn: () =>
        previewName === null
          ? listCcSlos()
          : listCcSlos({ data: { preview: previewName } }),
    });
  },

  slo: (sloId: string) =>
    queryOptions({
      queryKey: ["cc", "slo", sloId] as const,
      queryFn: () => getCcSlo({ data: { sloId } }),
    }),

  // The slug-addressed SLO route's lookup, the SLO analogue of ruleByName:
  // resolves by first-class name via an exact-match listSlos query, live
  // namespace only.
  sloByName: (project: string, slug: string) =>
    queryOptions({
      queryKey: ["cc", "slo-by-name", project, slug] as const,
      queryFn: () => getCcSloByName({ data: { project, slug } }),
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

  // The SLO's error-budget-over-time series, computed at read time by replaying
  // the SLI over trailing windows (no stored samples). The server fetches the
  // SLO for the authoritative SLI/target/window, so the key is just the SLO +
  // range. Expensive (N full-window scans per load), so it does NOT poll: the
  // budget trend moves slowly and refetches on navigation/range change instead.
  sloBudgetSeries: (sloId: string, timeRange: TimeRange) =>
    queryOptions({
      queryKey: ["cc", "slo-budget-series", sloId, { timeRange }] as const,
      queryFn: () => getCcSloBudgetSeries({ data: { sloId, timeRange } }),
    }),

  // One SLO's CURRENT error budget per group, computed at read time (a single
  // trailing-window SLI scan) so the hero and each listing row show budget as of
  // page view rather than the engine's throttled last evaluation. Keyed per SLO
  // so list -> detail navigation reuses the cache; the paginated listing only
  // subscribes for its visible rows. Expensive (a ClickHouse scan), and the
  // budget moves slowly, so it does NOT poll and stays fresh for a few minutes —
  // the snapshot query keeps burn/firing live in the meantime.
  sloBudgetNow: (sloId: string) =>
    queryOptions({
      queryKey: ["cc", "slo-budget-now", sloId] as const,
      queryFn: () => getCcSloBudgetNow({ data: { sloId } }),
      staleTime: 5 * 60_000,
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
