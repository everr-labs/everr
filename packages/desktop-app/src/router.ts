import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { AuthenticatedGuard } from "./features/desktop-shell/authenticated-guard";
import { DesktopWindow } from "./features/desktop-shell/desktop-window";
import { SettingsPage } from "./features/desktop-shell/settings-page";
import { DeveloperPage } from "./features/developer/developer-page";
import { LogsPage, LogsSearchSchema } from "./features/logs/logs-page";
import { NotificationsPage } from "./features/notifications/notifications-page";
import { OnboardingPage } from "./features/onboarding/onboarding-page";
import {
  TraceDetailPage,
  TraceDetailParamsSchema,
  TraceSearchParamsSchema,
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
  validateSearch: TraceSearchParamsSchema,
  component: TracesPage,
});

const traceDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/traces/$traceId",
  validateSearch: TraceDetailParamsSchema,
  component: TraceDetailPage,
});

const routeTree = rootRoute.addChildren([
  onboardingRoute,
  authenticatedRoute.addChildren([
    notificationsRoute,
    settingsRoute,
    developerRoute,
    logsRoute,
    tracesRoute,
    traceDetailRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
