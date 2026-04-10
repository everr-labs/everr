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
import { NotificationsPage } from "./features/notifications/notifications-page";
import { OnboardingPage } from "./features/onboarding/onboarding-page";

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

const routeTree = rootRoute.addChildren([
  onboardingRoute,
  authenticatedRoute.addChildren([
    notificationsRoute,
    settingsRoute,
    developerRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
