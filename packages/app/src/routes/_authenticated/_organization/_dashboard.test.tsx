import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { type HomeStatus, HomeSearchSchema } from "#app/common/onboarding.ts";
import { homeStatusQueryOptions } from "#app/data/onboarding/options.ts";

vi.mock("#app/data/onboarding/server.ts", () => ({
  getHomeStatus: vi.fn(() => new Promise(() => {})),
  completeOnboarding: vi.fn(),
}));

vi.mock("@composition/layouts", () => ({
  layouts: { UserMenu: () => <div>User menu</div> },
}));

vi.mock("#app/components/command-bar.tsx", () => ({
  CommandBar: () => <div>Command bar</div>,
}));

vi.mock("#app/components/preview-indicator.tsx", () => ({
  PreviewIndicator: () => <div>Preview indicator</div>,
}));

import { Route as AccountDashboardRoute } from "../-_dashboard";
import { Route as OrganizationDashboardRoute } from "./-_dashboard";

const clients: QueryClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

function renderLayout({
  path = "/",
  status,
  activeOrganizationId = "test_org",
}: {
  path?: string;
  status?: HomeStatus;
  activeOrganizationId?: string;
} = {}) {
  const rootRoute = createRootRoute();
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "_authenticated",
    beforeLoad: () => ({
      session: { user: { id: "test_user" }, session: { activeOrganizationId } },
    }),
  });
  const organizationRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    id: "_organization",
  });
  const dashboardRoute = createRoute({
    ...(OrganizationDashboardRoute.options as object),
    getParentRoute: () => organizationRoute,
    id: "_dashboard",
  });
  const appAccessRoute = createRoute({ getParentRoute: () => dashboardRoute, id: "_appAccess" });
  const provisionedRoute = createRoute({
    getParentRoute: () => appAccessRoute,
    id: "_provisioned",
    staticData: { showDataControls: true },
  });
  const paddedRoute = createRoute({ getParentRoute: () => provisionedRoute, id: "_padded" });
  const homeRoute = createRoute({
    getParentRoute: () => paddedRoute,
    path: "/",
    validateSearch: HomeSearchSchema,
    component: () => <div>Route content</div>,
  });
  const accountDashboardRoute = createRoute({
    ...(AccountDashboardRoute.options as object),
    getParentRoute: () => authenticatedRoute,
    id: "_dashboard",
  });
  const accountRoute = createRoute({
    getParentRoute: () => accountDashboardRoute,
    path: "/account",
    staticData: { breadcrumb: "Account" },
    component: () => <div>Account content</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      authenticatedRoute.addChildren([
        organizationRoute.addChildren([
          dashboardRoute.addChildren([
            appAccessRoute.addChildren([
              provisionedRoute.addChildren([paddedRoute.addChildren([homeRoute])]),
            ]),
          ]),
        ]),
        accountDashboardRoute.addChildren([accountRoute]),
      ]),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const client = new QueryClient();
  clients.push(client);
  if (status) client.setQueryData(homeStatusQueryOptions("test_user", "test_org").queryKey, status);
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, ...view };
}

const timeRangePicker = () => screen.queryByRole("button", { name: /last 7 days/i });
const refreshPicker = (container: HTMLElement) =>
  container.querySelector("[data-app-header] .lucide-refresh-cw");

describe("dashboard layout", () => {
  it("renders only route content when there is no active organization", async () => {
    renderLayout({ activeOrganizationId: "" });

    expect(await screen.findByText("Route content")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Dashboards" })).toBeNull();
    expect(screen.queryByRole("banner")).toBeNull();
  });

  it("renders organization navigation when there is an active organization", async () => {
    renderLayout();

    expect(await screen.findByText("Route content")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboards" })).toBeInTheDocument();
    expect(screen.getByText("User menu")).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  it.each(["onboarding", "dashboard", "reopened"])(
    "keeps navigation and shows time controls only for the ordinary Home (%s)",
    async (view) => {
      const status: HomeStatus = {
        appUrl: "https://app.example.test",
        canCreateKeys: false,
        onboardingCompleted: ["dashboard", "reopened"].includes(view),
      };
      const { container } = renderLayout({ path: view === "reopened" ? "/?setup=1" : "/", status });

      expect(await screen.findByText("Route content")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Dashboards" })).toBeInTheDocument();
      expect(screen.getByText("Command bar")).toBeInTheDocument();
      expect(Boolean(timeRangePicker())).toBe(view === "dashboard");
      expect(Boolean(refreshPicker(container))).toBe(view === "dashboard");
    },
  );

  it.each([
    { label: "Home", path: "/", shown: true },
    { label: "a reopened setup", path: "/?setup=1", shown: false },
  ])("time controls while $label loads its status: shown=$shown", async ({ path, shown }) => {
    renderLayout({ path });

    expect(await screen.findByText("Route content")).toBeInTheDocument();
    expect(Boolean(timeRangePicker())).toBe(shown);
  });

  it("frames the account pages without the organization's time range", async () => {
    const { container } = renderLayout({ path: "/account" });

    expect(await screen.findByText("Account content")).toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveTextContent("Account");
    expect(screen.queryByText("Command bar")).toBeNull();
    expect(timeRangePicker()).toBeNull();
    expect(refreshPicker(container)).toBeNull();
  });
});

describe("dashboard time range", () => {
  it("swaps two dates given in the wrong order", async () => {
    const { router } = renderLayout({
      path: "/?from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z",
    });

    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        from: "2026-01-01T00:00:00Z",
        to: "2026-01-02T00:00:00Z",
      }),
    );
  });

  it("keeps a relative range that ends before it starts", async () => {
    const { router } = renderLayout({ path: "/?from=now&to=now-1h" });

    expect(await screen.findByText("Route content")).toBeInTheDocument();
    expect(router.state.location.search).toMatchObject({ from: "now", to: "now-1h" });
  });
});
