// A resource's `queryKey` is also its invalidation prefix.
// Poll cadence: live surfaces (alerts, rule listings, event history) refetch on
// ALERTING_POLL_INTERVAL_MS; config resources change only through user actions and
// are invalidated by their mutations instead.
import type { TimeRange } from "@everr/ui/lib/time-range";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import {
  getAlertingRule,
  getAlertingRuleByName,
  getAlertingRuleEvaluationSeries,
  getAlertingSlo,
  getAlertingSloBudgetNow,
  getAlertingSloBudgetSeries,
  getAlertingSloByName,
  getAlertingSloStatus,
  listAlertingAlerts,
  listAlertingChannels,
  listAlertingEventHistory,
  listAlertingInhibitions,
  listAlertingReceivers,
  listAlertingRoutes,
  listAlertingRules,
  listAlertingRulesPage,
  listAlertingSilences,
  listAlertingSlos,
} from "./server";

const ALERTING_POLL_INTERVAL_MS = 15_000;

const RULES_PAGE_LIMIT = 100;
const EVENT_HISTORY_LIMIT = 200;

export const alertingQueries = {
  // Live-only by default: preview instances are real suppressed-rule
  // evaluations and must never leak into the live feed.
  alerts: (preview?: string) => {
    const previewName = preview?.trim() || null;
    return queryOptions({
      queryKey: ["alerting", "alerts", previewName] as const,
      queryFn: () =>
        previewName === null
          ? listAlertingAlerts()
          : listAlertingAlerts({ data: { preview: previewName } }),
      refetchInterval: ALERTING_POLL_INTERVAL_MS,
    });
  },

  // Key is a prefix of rulesPage's, so invalidating `rules` refreshes both.
  rules: () =>
    queryOptions({
      queryKey: ["alerting", "rules"] as const,
      queryFn: () => listAlertingRules(),
      refetchInterval: ALERTING_POLL_INTERVAL_MS,
    }),

  // Each page is alerting engine's {items, next_cursor} envelope, null cursor = last page.
  // With a preview selected the server returns the overlay as a single page.
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
      // Polling an infinite query refetches EVERY loaded page serially each
      // cycle, so the poll runs only while a single page is loaded; with more
      // pages the listing refreshes via mutation invalidation instead (unlike
      // `maxPages`, this keeps every loaded row on screen).
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

  // Keyed by address (not id) so list -> detail navigation and invalidation
  // both key off the same identity the route URL carries.
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

  ruleEvaluationSeries: (ruleId: string, timeRange: TimeRange) =>
    queryOptions({
      queryKey: [
        "alerting",
        "rule-evaluation-series",
        ruleId,
        { timeRange },
      ] as const,
      queryFn: () =>
        getAlertingRuleEvaluationSeries({ data: { ruleId, timeRange } }),
      refetchInterval: ALERTING_POLL_INTERVAL_MS,
    }),

  // Config listing: changes only through user actions, so mutations invalidate
  // it rather than polling.
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

  // SLO analogue of ruleByName: keyed by address, not id.
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

  // Pending (null payload, real health) until the first evaluation tick
  // writes a snapshot. Live surface, so it polls.
  sloStatus: (sloId: string) =>
    queryOptions({
      queryKey: ["alerting", "slo-status", sloId] as const,
      queryFn: () => getAlertingSloStatus({ data: { sloId } }),
      refetchInterval: ALERTING_POLL_INTERVAL_MS,
    }),

  // The server fetches the SLO for the authoritative SLI/target/window, so the
  // key is just SLO + range. Expensive (N full-window scans per load), so it
  // does NOT poll; refetches on navigation/range change instead.
  sloBudgetSeries: (sloId: string, timeRange: TimeRange) =>
    queryOptions({
      queryKey: [
        "alerting",
        "slo-budget-series",
        sloId,
        { timeRange },
      ] as const,
      queryFn: () => getAlertingSloBudgetSeries({ data: { sloId, timeRange } }),
    }),

  // Keyed per SLO so list -> detail navigation reuses the cache. Expensive
  // (a ClickHouse scan) and the budget moves slowly, so no poll and a few
  // minutes of staleTime; the snapshot query keeps burn/firing live meanwhile.
  sloBudgetNow: (sloId: string) =>
    queryOptions({
      queryKey: ["alerting", "slo-budget-now", sloId] as const,
      queryFn: () => getAlertingSloBudgetNow({ data: { sloId } }),
      staleTime: 5 * 60_000,
    }),

  routes: () =>
    queryOptions({
      queryKey: ["alerting", "routes"] as const,
      queryFn: () => listAlertingRoutes(),
    }),

  receivers: () =>
    queryOptions({
      queryKey: ["alerting", "receivers"] as const,
      queryFn: () => listAlertingReceivers(),
    }),

  channels: () =>
    queryOptions({
      queryKey: ["alerting", "channels"] as const,
      queryFn: () => listAlertingChannels(),
    }),

  inhibitions: () =>
    queryOptions({
      queryKey: ["alerting", "inhibitions"] as const,
      queryFn: () => listAlertingInhibitions(),
    }),

  silences: () =>
    queryOptions({
      queryKey: ["alerting", "silences"] as const,
      queryFn: () => listAlertingSilences(),
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
        "alerting",
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
        listAlertingEventHistory({
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
      refetchInterval: ALERTING_POLL_INTERVAL_MS,
    });
  },
};
