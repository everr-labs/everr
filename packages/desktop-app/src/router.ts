import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { DesktopWindow } from "./features/desktop-shell/desktop-window";
import { SettingsPage } from "./features/desktop-shell/settings-page";
import { DeveloperPage } from "./features/developer/developer-page";
import { NotificationsPage } from "./features/notifications/notifications-page";

const rootRoute = createRootRoute({
  component: DesktopWindow,
});

const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: NotificationsPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const developerRoute = createRoute({
  getParentRoute: () => rootRoute,
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
  notificationsRoute,
  settingsRoute,
  developerRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
