import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activeOrganizationId: "test_org",
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
          session: { activeOrganizationId: mocks.activeOrganizationId },
        },
      }),
      useSearch: () => ({}),
    }),
    Outlet: () => <div>Route content</div>,
    useMatches: () => [],
  };
});

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
});

describe("dashboard layout", () => {
  it("renders only route content when there is no active organization", () => {
    mocks.activeOrganizationId = "";
    const Component = Route.options.component as React.ComponentType;

    render(<Component />);

    expect(screen.getByText("Route content")).toBeInTheDocument();
    expect(screen.queryByText("Organization navigation")).toBeNull();
    expect(screen.queryByRole("banner")).toBeNull();
  });

  it("renders organization navigation when there is an active organization", () => {
    const Component = Route.options.component as React.ComponentType;

    render(<Component />);

    expect(screen.getByText("Route content")).toBeInTheDocument();
    expect(screen.getByText("Organization navigation")).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });
});
