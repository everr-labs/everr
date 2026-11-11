// Route options only, no component: an app's route file spreads one of these
// and names its component from `./pages` itself, which is the shape the router
// plugin splits into a lazy chunk.
import "../static-data";
import { ErrorIssueSearchSchema } from "../errors";
import { ExploreSearchSchema, ExploreSearchShape } from "../filters";
import { LogsSearchSchema } from "../logs";
import { MetricsSearchSchema } from "../metrics";
import { ProfilesSearchParamsSchema } from "../profiles";
import { getTraceOptions, TraceDetailParamsSchema, TraceSearchParamsSchema } from "../traces";
import type { AnyRouter } from "@tanstack/react-router";
import { Bug, ChartSpline, Cpu, ScrollText, Waypoints } from "lucide-react";
import type { NavGroup } from "../shell/nav";
import { stripDefaults } from "../shell/search-middleware";
import type { ShellRouterContext } from "./backend";

export type { ExploreBackend, ShellRouterContext } from "./backend";

type ExploreSectionPath = "/metrics" | "/logs" | "/traces" | "/errors" | "/profiles";

/** The Explore group of the sidebar. */
export const exploreNavGroup: NavGroup<ExploreSectionPath> = {
  label: "Explore",
  accent: "[--nav-accent:var(--ctp-mauve)]",
  items: [
    { title: "Metrics", url: "/metrics", icon: ChartSpline },
    { title: "Logs", url: "/logs", icon: ScrollText },
    { title: "Traces", url: "/traces", icon: Waypoints },
    { title: "Errors", url: "/errors", icon: Bug },
    { title: "Profiles", url: "/profiles", icon: Cpu },
  ],
};

/** Every path the Explore pages mount or link to. */
type ExploreFullPath = ExploreSectionPath | "/traces/$traceId" | "/errors/$fingerprint";

/**
 * `true` when the router mounts every Explore path, and `{ missing }` naming
 * the absent ones when it does not. An app pins it next to its router, so a
 * missing route file fails its type-check:
 * `true satisfies AssertExploreMounted<typeof router>;`
 */
export type AssertExploreMounted<TRouter extends AnyRouter> =
  Exclude<ExploreFullPath, keyof TRouter["routesByPath"]> extends never
    ? true
    : { missing: Exclude<ExploreFullPath, keyof TRouter["routesByPath"]> };

// service/environment retain + strip is handled on the shell layout route, not
// here. Search middlewares run leaf to root, so the shell layout's retain runs
// AFTER any strip declared on this route, which re-injects a just-cleared
// filter from the previous location. Keeping both on the shell layout (retain
// then strip) lets a cleared `[]` survive retain and then get stripped as a
// default last of all.
//
// This layout holds the search params. Each page puts the Service and
// Environment controls in its own filter rail. See ExplorePersistentFilters.
export const exploreLayoutRoute = {
  validateSearch: ExploreSearchSchema,
  staticData: { showDataControls: true },
};

export const logsRoute = {
  validateSearch: LogsSearchSchema,
  staticData: { breadcrumb: "Logs" },
  head: () => ({ meta: [{ title: "Everr - Logs" }] }),
};

export const metricsRoute = {
  validateSearch: MetricsSearchSchema,
  // Keep the URL clean: without this, every navigation would write the schema
  // defaults (empty arrays and strings) back into the query string.
  search: { middlewares: [stripDefaults(MetricsSearchSchema.parse({}))] },
  staticData: { breadcrumb: "Metrics" },
  head: () => ({ meta: [{ title: "Everr - Metrics" }] }),
};

// service/environment live on the shell layout route but must also be in the
// leaf schemas so the leaf route's validateSearch doesn't strip them.
const TracesSearchSchema = TraceSearchParamsSchema.extend(ExploreSearchShape);
const ErrorsSearchSchema = ErrorIssueSearchSchema.extend(ExploreSearchShape);
const ProfilesSearchSchema = ProfilesSearchParamsSchema.extend(ExploreSearchShape);

export const tracesRoute = {
  validateSearch: TracesSearchSchema,
  // Keep the URL clean: the schema fills in defaults (empty arrays, "all", ...)
  // during validation, so without this every navigation would serialize them
  // back into the query string.
  search: { middlewares: [stripDefaults(TracesSearchSchema.parse({}))] },
  staticData: { breadcrumb: "Traces" },
  head: () => ({ meta: [{ title: "Everr - Traces" }] }),
};

export const traceDetailRoute = {
  validateSearch: TraceDetailParamsSchema,
  loader: async ({
    context,
    params,
  }: {
    context: ShellRouterContext;
    params: { traceId: string };
  }) => {
    await context.queryClient.ensureQueryData(
      getTraceOptions({
        repo: context.explore.repos.traces,
        traceId: params.traceId,
      }),
    );
  },
  staticData: { breadcrumb: "Trace", hideTimeRangePicker: true },
  head: () => ({ meta: [{ title: "Everr - Trace" }] }),
};

export const errorsRoute = {
  validateSearch: ErrorsSearchSchema,
  search: { middlewares: [stripDefaults(ErrorsSearchSchema.parse({}))] },
  staticData: { breadcrumb: "Errors" },
  head: () => ({ meta: [{ title: "Everr - Errors" }] }),
};

export const errorDetailRoute = {
  validateSearch: ErrorIssueSearchSchema,
  search: { middlewares: [stripDefaults(ErrorIssueSearchSchema.parse({}))] },
  staticData: { breadcrumb: "Detail" },
  head: () => ({ meta: [{ title: "Everr - Error detail" }] }),
};

export const profilesRoute = {
  validateSearch: ProfilesSearchSchema,
  search: { middlewares: [stripDefaults(ProfilesSearchSchema.parse({}))] },
  staticData: { breadcrumb: "Profiles" },
  head: () => ({ meta: [{ title: "Everr - Profiles" }] }),
};
