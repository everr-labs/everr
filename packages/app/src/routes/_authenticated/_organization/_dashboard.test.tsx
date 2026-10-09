import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeStatus } from "@/common/onboarding";
import { homeStatusQueryOptions } from "@/data/onboarding/options";

const mocks = vi.hoisted(() => ({
  activeOrganizationId: "test_org",
  matches: [] as {
    routeId: string;
    search: { setup?: number };
    staticData: { showDataControls?: boolean };
  }[],
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();

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
    useSearch: () => ({}),
    Outlet: () => <div>Route content</div>,
    useMatches: () => mocks.matches,
  };
});

vi.mock("@/data/onboarding/server", () => ({
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

vi.mock("@/components/app-sidebar", () => ({
  AppSidebar: () => <aside>Organization navigation</aside>,
}));

vi.mock("@/components/analytics/refresh-picker", () => ({
  RefreshPicker: () => <div>Refresh picker</div>,
}));

vi.mock("@/components/analytics/time-range-picker", () => ({
  TimeRangePicker: () => <div>Time range picker</div>,
}));

vi.mock("@/components/command-bar", () => ({
  CommandBar: () => <div>Command bar</div>,
}));

vi.mock("@/components/dashboard-breadcrumb", () => ({
  DashboardBreadcrumb: () => <div>Dashboard breadcrumb</div>,
}));

vi.mock("@/components/preview-indicator", () => ({
  PreviewIndicator: () => <div>Preview indicator</div>,
}));

import { Route } from "./_dashboard";

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
  if (status)
    client.setQueryData(
      homeStatusQueryOptions("test_user", "test_org").queryKey,
      status,
    );
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

  it.each([
    "onboarding",
    "dashboard",
    "reopened",
  ])("keeps navigation and shows time controls only for the ordinary Home (%s)", (view) => {
    mocks.matches = [
      {
        routeId:
          "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_padded/",
        staticData: { showDataControls: true },
        search: view === "reopened" ? { setup: 1 } : {},
      },
    ];
    const status: HomeStatus = {
      organizationName: "Test org",
      canCreateKeys: false,
      onboardingCompleted: ["dashboard", "reopened"].includes(view),
    };
    renderLayout(status);
    expect(screen.getByText("Organization navigation")).toBeInTheDocument();
    expect(Boolean(screen.queryByText("Time range picker"))).toBe(
      view === "dashboard",
    );
    expect(Boolean(screen.queryByText("Refresh picker"))).toBe(
      view === "dashboard",
    );
  });
});
