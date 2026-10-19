import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  type StaticDataRouteOption,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardBreadcrumb } from "#app/components/dashboard-breadcrumb.tsx";

const runbookStaticData: StaticDataRouteOption = { breadcrumb: "Runbooks" };

function createTestRouter() {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <DashboardBreadcrumb />
        <Outlet />
      </>
    ),
  });
  const runbookRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/runbooks/$project/$slug",
    staticData: runbookStaticData,
  });
  const runbookPageRoute = createRoute({
    getParentRoute: () => runbookRoute,
    path: "/$",
    staticData: {
      breadcrumb: () => [
        {
          label: "Dashboards",
          link: <Link to="/dashboards" search={{ preview: "draft" }} />,
        },
        { label: "Page" },
      ],
    },
    component: () => <p>Runbook page</p>,
  });
  const runbookIndexRoute = createRoute({
    getParentRoute: () => runbookRoute,
    path: "/",
    component: () => <p>Runbook index</p>,
  });
  const dashboardsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/dashboards",
    component: () => <p>Dashboards page</p>,
  });
  const routeTree = rootRoute.addChildren([
    dashboardsRoute,
    runbookRoute.addChildren([runbookIndexRoute, runbookPageRoute]),
  ]);
  return createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: ["/runbooks/acme%20team/build%231/guide"],
    }),
  });
}

describe("DashboardBreadcrumb with a real router", () => {
  it("resolves a dynamic parent link and preserves an authored Link search", async () => {
    const router = createTestRouter();
    render(<RouterProvider router={router} />);

    await screen.findByText("Runbook page");

    const parentHref = screen
      .getByText("Runbooks")
      .closest("a")
      ?.getAttribute("href");
    expect(parentHref).toBe("/runbooks/acme%20team/build%231");
    expect(parentHref).not.toContain("$");
    expect(screen.getByText("Dashboards").closest("a")).toHaveAttribute(
      "href",
      "/dashboards?preview=draft",
    );
    expect(
      screen.getByText("Page").closest("[data-slot='breadcrumb-page']"),
    ).toBeInTheDocument();
  });
});
