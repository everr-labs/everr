import type { TimeRange } from "@everr/ui/lib/time-range";
import { queryOptions } from "@tanstack/react-query";
import { ALERTING_POLL_INTERVAL_MS } from "../polling";
import { listAlertingEventHistory } from "./server";

const EVENT_HISTORY_LIMIT = 200;

export const alertHistoryQueries = {
  events: (
    timeRange: TimeRange,
    opts: {
      limit?: number;
      fingerprint?: string;
      sourceId?: string;
      slugs?: readonly string[];
      /** The rule's own repoid; only a genuinely per-rule caller should set this. */
      repoid?: string;
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
          sourceId: opts.sourceId ?? null,
          slugs,
          repoid: opts.repoid ?? null,
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
            ...(opts.sourceId !== undefined ? { sourceId: opts.sourceId } : {}),
            ...(slugs === null ? {} : { slugs }),
            ...(opts.repoid !== undefined ? { repoid: opts.repoid } : {}),
            ...(preview === null ? {} : { preview }),
          },
        }),
      refetchInterval: ALERTING_POLL_INTERVAL_MS,
    });
  },
};
