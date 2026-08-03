// A resource's `queryKey` is also its invalidation prefix.
// Poll cadence: live surfaces (alerts, rule listings, event history) refetch on
// CC_POLL_INTERVAL_MS; config resources change only through user actions and
// are invalidated by their mutations instead.
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

const CC_POLL_INTERVAL_MS = 15_000;

const RULES_PAGE_LIMIT = 100;
const EVENT_HISTORY_LIMIT = 200;

export const ccQueries = {
  // Live-only by default: preview instances are real suppressed-rule
  // evaluations and must never leak into the live feed.
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

  // Key is a prefix of rulesPage's, so invalidating `rules` refreshes both.
  rules: () =>
    queryOptions({
      queryKey: ["cc", "rules"] as const,
      queryFn: () => listCcRules(),
      refetchInterval: CC_POLL_INTERVAL_MS,
    }),

  // Each page is CC's {items, next_cursor} envelope, null cursor = last page.
  // With a preview selected the server returns the overlay as a single page.
  rulesPage: (preview?: string) =>
    infiniteQueryOptions({
      queryKey: ["cc", "rules", "page", preview?.trim() || null] as const,
      queryFn: ({ pageParam }) =>
        listCcRulesPage({
          data: {
            limit: RULES_PAGE_LIMIT,
            ...(pageParam ? { cursor: pageParam } : {}),
            ...(preview?.trim() ? { preview: preview.trim() } : {}),
          },
        }),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.next_cursor,
      // Polling an infinite query refetches EVERY loaded page serially each
      // cycle, so the poll runs only while a single page is loaded; with more
      // pages the listing refreshes via mutation invalidation instead (unlike
      // `maxPages`, this keeps every loaded row on screen).
      refetchInterval: (query) =>
        (query.state.data?.pages.length ?? 0) > 1 ? false : CC_POLL_INTERVAL_MS,
    }),

  rule: (ruleId: string) =>
    queryOptions({
      queryKey: ["cc", "rule", ruleId] as const,
      queryFn: () => getCcRule({ data: { ruleId } }),
    }),

  // Keyed by address (not id) so list -> detail navigation and invalidation
  // both key off the same identity the route URL carries.
  ruleByName: (project: string, slug: string, preview?: string) => {
    const previewName = preview?.trim() || null;
    return queryOptions({
      queryKey: ["cc", "rule-by-name", project, slug, previewName] as const,
      queryFn: () =>
        getCcRuleByName({
          data: {
            project,
            slug,
            ...(previewName === null ? {} : { preview: previewName }),
          },
        }),
    });
  },

  // Config listing: changes only through user actions, so mutations invalidate
  // it rather than polling.
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

  // SLO analogue of ruleByName: keyed by address, not id.
  sloByName: (project: string, slug: string, preview?: string) => {
    const previewName = preview?.trim() || null;
    return queryOptions({
      queryKey: ["cc", "slo-by-name", project, slug, previewName] as const,
      queryFn: () =>
        getCcSloByName({
          data: {
            project,
            slug,
            ...(previewName === null ? {} : { preview: previewName }),
          },
        }),
    });
  },

  // Null until the first evaluation tick writes a snapshot. Live surface, so
  // it polls.
  sloStatus: (sloId: string) =>
    queryOptions({
      queryKey: ["cc", "slo-status", sloId] as const,
      queryFn: () => getCcSloStatus({ data: { sloId } }),
      refetchInterval: CC_POLL_INTERVAL_MS,
    }),

  // The server fetches the SLO for the authoritative SLI/target/window, so the
  // key is just SLO + range. Expensive (N full-window scans per load), so it
  // does NOT poll; refetches on navigation/range change instead.
  sloBudgetSeries: (sloId: string, timeRange: TimeRange) =>
    queryOptions({
      queryKey: ["cc", "slo-budget-series", sloId, { timeRange }] as const,
      queryFn: () => getCcSloBudgetSeries({ data: { sloId, timeRange } }),
    }),

  // Keyed per SLO so list -> detail navigation reuses the cache. Expensive
  // (a ClickHouse scan) and the budget moves slowly, so no poll and a few
  // minutes of staleTime; the snapshot query keeps burn/firing live meanwhile.
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

  // `fingerprint`/`slugs` are server-side WHEREs, so the row cap applies after
  // scoping; `limit: 1` = the newest event only (freshness readouts).
  eventHistory: (
    timeRange: TimeRange,
    opts: {
      limit?: number;
      fingerprint?: string;
      slugs?: readonly string[];
      // Preview-rule records are filtered out server-side so another
      // engineer's open preview cannot pollute the live audit trail.
      preview?: string;
    } = {},
  ) => {
    const limit = opts.limit ?? EVENT_HISTORY_LIMIT;
    const slugs = opts.slugs === undefined ? null : [...opts.slugs].sort();
    const preview = opts.preview?.trim() || null;
    return queryOptions({
      queryKey: [
        "cc",
        "event-history",
        {
          timeRange,
          limit,
          fingerprint: opts.fingerprint ?? null,
          slugs,
          preview,
        },
      ] as const,
      queryFn: () =>
        listCcEventHistory({
          data: {
            limit,
            timeRange,
            ...(opts.fingerprint !== undefined
              ? { fingerprint: opts.fingerprint }
              : {}),
            ...(slugs === null ? {} : { slugs }),
            ...(preview === null ? {} : { preview }),
          },
        }),
      refetchInterval: CC_POLL_INTERVAL_MS,
    });
  },
};
