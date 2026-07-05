import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  retainSearchParams,
  stripSearchParams,
} from "@tanstack/react-router";
import { CiPage, CiSearchSchema } from "./features/ci/ci-page";
import { AppShell } from "./features/desktop-shell/app-shell";
import { DesktopWindow } from "./features/desktop-shell/desktop-window";
import { SettingsPage } from "./features/desktop-shell/settings-page";
import { DeveloperPage } from "./features/developer/developer-page";
import { ErrorDetailPage, ErrorsListSearchSchema, ErrorsPage } from "./features/errors/errors-page";
import { ExploreSearchSchema } from "./features/explore/explore-search";
import { LogsPage, LogsSearchSchema } from "./features/logs/logs-page";
import {
  TraceDetailPage,
  TraceDetailSearchSchema,
  TracesListSearchSchema,
  TracesPage,
} from "./features/traces/traces-page";

const rootRoute = createRootRoute({
  component: DesktopWindow,
});

// Pathless layout: renders the app shell for every route regardless of auth.
// Carries the explore search-param schema/middlewares that logs/traces/errors
// rely on (previously on the now-removed authenticated route).
const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  validateSearch: ExploreSearchSchema,
  search: {
    middlewares: [
      stripSearchParams({ service: [], environment: [] }),
      retainSearchParams(["service", "environment"]),
    ],
  },
  component: AppShell,
});

const indexRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/logs" });
  },
});

const notificationsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/ci",
  validateSearch: CiSearchSchema,
  component: CiPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/settings",
  component: SettingsPage,
});

const developerRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/developer",
  ...(!import.meta.env.DEV
    ? {
        beforeLoad: () => {
          throw redirect({ to: "/logs" });
        },
      }
    : {}),
  component: DeveloperPage,
});

const logsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/logs",
  validateSearch: LogsSearchSchema,
  component: LogsPage,
});

const tracesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/traces",
  validateSearch: TracesListSearchSchema,
  component: TracesPage,
});

const traceDetailRoute = createRoute({
  getParentRoute: () => tracesRoute,
  path: "$traceId",
  validateSearch: TraceDetailSearchSchema,
  component: TraceDetailPage,
});

const errorsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/errors",
  validateSearch: ErrorsListSearchSchema,
  component: ErrorsPage,
});

const errorDetailRoute = createRoute({
  getParentRoute: () => errorsRoute,
  path: "$fingerprint",
  validateSearch: ErrorsListSearchSchema,
  component: ErrorDetailPage,
});

const routeTree = rootRoute.addChildren([
  shellRoute.addChildren([
    indexRoute,
    notificationsRoute,
    settingsRoute,
    developerRoute,
    logsRoute,
    tracesRoute.addChildren([traceDetailRoute]),
    errorsRoute.addChildren([errorDetailRoute]),
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
