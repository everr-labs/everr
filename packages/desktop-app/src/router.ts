import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  retainSearchParams,
  stripSearchParams,
} from "@tanstack/react-router";
import { AuthenticatedGuard } from "./features/desktop-shell/authenticated-guard";
import { DesktopWindow } from "./features/desktop-shell/desktop-window";
import { SettingsPage } from "./features/desktop-shell/settings-page";
import { DeveloperPage } from "./features/developer/developer-page";
import {
  ErrorDetailPage,
  ErrorsListSearchSchema,
  ErrorsPage,
} from "./features/errors/errors-page";
import { ExploreSearchSchema } from "./features/explore/explore-search";
import { LogsPage, LogsSearchSchema } from "./features/logs/logs-page";
import { NotificationsPage } from "./features/notifications/notifications-page";
import { OnboardingPage } from "./features/onboarding/onboarding-page";
import {
  TraceDetailPage,
  TraceDetailSearchSchema,
  TracesListSearchSchema,
  TracesPage,
} from "./features/traces/traces-page";

const rootRoute = createRootRoute({
  component: DesktopWindow,
});

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding",
  component: OnboardingPage,
});

const authenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "authenticated",
  // The Explore section's Service/Environment filters are retained HERE because
  // the sidebar lives in this layout (AppShell): only a retain declared at this
  // level engages on a sidebar click. strip-then-retain, paired with the
  // default-free ExploreSearchShape, makes the filters both persistent AND
  // clearable — a cleared `[]` is stripped to a clean URL, while an unset value
  // arrives absent so retain copies the live selection forward. The explore page
  // schemas include these keys so the destination route doesn't strip them.
  validateSearch: ExploreSearchSchema,
  search: {
    middlewares: [
      stripSearchParams({ service: [], environment: [] }),
      retainSearchParams(["service", "environment"]),
    ],
  },
  component: AuthenticatedGuard,
});

const notificationsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/",
  component: NotificationsPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/settings",
  component: SettingsPage,
});

const developerRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/developer",
  ...(!import.meta.env.DEV
    ? {
        beforeLoad: () => {
          throw redirect({ to: "/" });
        },
      }
    : {}),
  component: DeveloperPage,
});

const logsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/logs",
  validateSearch: LogsSearchSchema,
  component: LogsPage,
});

const tracesRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/traces",
  validateSearch: TracesListSearchSchema,
  component: TracesPage,
});

// Nested under the list route so desktop detail pages only render through the
// parent dialog route.
const traceDetailRoute = createRoute({
  getParentRoute: () => tracesRoute,
  path: "$traceId",
  validateSearch: TraceDetailSearchSchema,
  component: TraceDetailPage,
});

const errorsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
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
  onboardingRoute,
  authenticatedRoute.addChildren([
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
