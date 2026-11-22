import type * as ReactRouterTypes from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { HomeStatus } from "#app/common/onboarding.ts";
import { homeStatusQueryOptions } from "#app/data/onboarding/options.ts";

const mocks = vi.hoisted(() => ({
  activeOrganizationId: "test_org",
  matches: [] as {
    routeId: string;
    search: { setup?: number };
    staticData: { showDataControls?: boolean };
  }[],
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterTypes>();

  return {
    ...actual,
    createFileRoute: (_path: string) => (options: Record<string, unknown>) => ({
      options,
      useRouteContext: () => ({
        session: {
          user: { id: "test_user" },
          session: { activeOrganizationId: mocks.activeOrganizationId },
        },
      }),
      useSearch: () => ({}),
    }),
    useRouteContext: () => ({
      session: {
        user: { id: "test_user" },
        session: { activeOrganizationId: mocks.activeOrganizationId },
      },
    }),
    useSearch: (options?: { select?: (search: object) => unknown }) =>
      options?.select ? options.select({}) : {},
    Outlet: () => <div>Route content</div>,
    useMatches: (options?: { select?: (matches: typeof mocks.matches) => unknown }) =>
      options?.select ? options.select(mocks.matches) : mocks.matches,
  };
});

vi.mock("#app/data/onboarding/server.ts", () => ({
  getHomeStatus: vi.fn(() => new Promise(() => {})),
  completeOnboarding: vi.fn(),
}));

vi.mock("@everr/ui/components/sidebar", () => ({
  SidebarInset: ({ children }: { children: ReactNode }) => (
    <div data-testid="sidebar-inset">{children}</div>
  ),
  SidebarProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="sidebar-provider">{children}</div>
  ),
  SidebarTrigger: () => <button type="button">Toggle sidebar</button>,
}));

vi.mock("@everr/ui/components/separator", () => ({
  Separator: () => <div />,
}));

vi.mock("#app/components/app-sidebar.tsx", () => ({
  AppSidebar: () => <aside>Organization navigation</aside>,
}));

vi.mock("#app/components/analytics/refresh-picker.tsx", () => ({
  RefreshPicker: () => <div>Refresh picker</div>,
}));

vi.mock("#app/components/analytics/time-range-picker.tsx", () => ({
  TimeRangePicker: () => <div>Time range picker</div>,
}));

vi.mock("#app/components/command-bar.tsx", () => ({
  CommandBar: () => <div>Command bar</div>,
}));

vi.mock("#app/components/dashboard-breadcrumb.tsx", () => ({
  DashboardBreadcrumb: () => <div>Dashboard breadcrumb</div>,
}));

vi.mock("#app/components/preview-indicator.tsx", () => ({
  PreviewIndicator: () => <div>Preview indicator</div>,
}));

import { Route } from "./-_dashboard";

beforeEach(() => {
  mocks.activeOrganizationId = "test_org";
  mocks.matches = [];
});

const clients: QueryClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});
function renderLayout(status?: HomeStatus) {
  const client = new QueryClient();
  clients.push(client);
  if (status) client.setQueryData(homeStatusQueryOptions("test_user", "test_org").queryKey, status);
  const Component = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  );
}

describe("dashboard layout", () => {
  it("renders only route content when there is no active organization", () => {
    mocks.activeOrganizationId = "";
    renderLayout();

    expect(screen.getByText("Route content")).toBeInTheDocument();
    expect(screen.queryByText("Organization navigation")).toBeNull();
    expect(screen.queryByRole("banner")).toBeNull();
  });

  it("renders organization navigation when there is an active organization", () => {
    renderLayout();

    expect(screen.getByText("Route content")).toBeInTheDocument();
    expect(screen.getByText("Organization navigation")).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  it.each(["onboarding", "dashboard", "reopened"])(
    "keeps navigation and shows time controls only for the ordinary Home (%s)",
    (view) => {
      mocks.matches = [
        {
          routeId: "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_padded/",
          staticData: { showDataControls: true },
          search: view === "reopened" ? { setup: 1 } : {},
        },
      ];
      const status: HomeStatus = {
        appUrl: "https://app.example.test",
        canCreateKeys: false,
        onboardingCompleted: ["dashboard", "reopened"].includes(view),
      };
      renderLayout(status);
      expect(screen.getByText("Organization navigation")).toBeInTheDocument();
      expect(Boolean(screen.queryByText("Time range picker"))).toBe(view === "dashboard");
      expect(Boolean(screen.queryByText("Refresh picker"))).toBe(view === "dashboard");
    },
  );

  it.each([
    { label: "Home", search: {}, shown: true },
    { label: "a reopened setup", search: { setup: 1 }, shown: false },
  ])("time controls while $label loads its status: shown=$shown", ({ search, shown }) => {
    mocks.matches = [
      {
        routeId: "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_padded/",
        staticData: { showDataControls: true },
        search,
      },
    ];
    renderLayout();
    expect(Boolean(screen.queryByText("Time range picker"))).toBe(shown);
  });
});

describe("dashboard time range", () => {
  const beforeLoad = Route.options.beforeLoad as (ctx: { search: object }) => void;

  it("swaps two dates given in the wrong order", () => {
    let redirected: unknown;
    try {
      beforeLoad({ search: { from: "2026-01-02T00:00:00Z", to: "2026-01-01T00:00:00Z" } });
    } catch (error) {
      redirected = error;
    }
    expect(redirected).toMatchObject({
      options: { search: { from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z" } },
    });
  });

  it("keeps a relative range that ends before it starts", () => {
    expect(() => beforeLoad({ search: { from: "now", to: "now-1h" } })).not.toThrow();
  });
});
