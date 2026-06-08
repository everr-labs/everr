import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { dashboardOptions } from "@/data/dashboards/options";
import type { Dashboard } from "@/data/dashboards/schema";

const route = getRouteApi(
  "/_authenticated/_dashboard/dashboards/$source/$slug",
);

/**
 * The dashboard for the current route, read from the react-query cache. The
 * dashboard is immutable (gitops, read-only), so the query cache is the single
 * source of truth — no separate store. Multiple callers share one cache entry.
 */
export function useDashboard(): Dashboard {
  const { source, slug } = route.useParams();
  return useSuspenseQuery(dashboardOptions(source, slug)).data;
}
