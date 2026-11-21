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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { DashboardBreadcrumb } from "#app/components/dashboard-breadcrumb.tsx";

const runbookStaticData: StaticDataRouteOption = { breadcrumb: "Runbooks" };

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, resolve: release };
}

let loaderGate = gate();
loaderGate.resolve();

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
  const unnamedRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/unnamed",
    staticData: {
      breadcrumb: (match) => {
        const name = (match.loaderData as { name: string } | undefined)?.name;
        return [{ label: name ?? "Thing", unresolved: name === undefined }];
      },
    },
    loader: async () => {
      await loaderGate.promise;
      return { name: "Checkout latency" };
    },
    component: () => <p>Unnamed page content</p>,
  });
  const slowRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/slow",
    staticData: { breadcrumb: "Slow page" },
    loader: () => loaderGate.promise,
    component: () => <p>Slow page content</p>,
  });
  const routeTree = rootRoute.addChildren([
    dashboardsRoute,
    slowRoute,
    unnamedRoute,
    runbookRoute.addChildren([runbookIndexRoute, runbookPageRoute]),
  ]);
  return createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: ["/runbooks/acme%20team/build%231/guide"],
    }),
  });
}

function renderRouter(router: ReturnType<typeof createTestRouter>) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("DashboardBreadcrumb with a real router", () => {
  it("names the page being loaded while the previous page stays on screen", async () => {
    loaderGate = gate();
    const router = createTestRouter();
    renderRouter(router);
    await screen.findByText("Runbook page");

    router.history.push("/slow");

    expect(await screen.findByText("Slow page")).toBeInTheDocument();
    expect(screen.getByText("Runbook page")).toBeInTheDocument();

    loaderGate.resolve();
    expect(await screen.findByText("Slow page content")).toBeInTheDocument();
    expect(screen.getByText("Slow page")).toBeInTheDocument();
  });

  it("draws a skeleton, not the stand-in label, for a name still loading", async () => {
    loaderGate = gate();
    const router = createTestRouter();
    const { container } = renderRouter(router);
    await screen.findByText("Runbook page");

    router.history.push("/unnamed");

    await vi.waitFor(() =>
      expect(container.querySelector("[data-slot='skeleton']")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Thing")).not.toBeInTheDocument();

    loaderGate.resolve();
    expect(await screen.findByText("Checkout latency")).toBeInTheDocument();
    expect(container.querySelector("[data-slot='skeleton']")).not.toBeInTheDocument();
  });

  it("resolves a dynamic parent link and preserves an authored Link search", async () => {
    const router = createTestRouter();
    renderRouter(router);

    await screen.findByText("Runbook page");

    const parentHref = screen.getByText("Runbooks").closest("a")?.getAttribute("href");
    expect(parentHref).toBe("/runbooks/acme%20team/build%231");
    expect(parentHref).not.toContain("$");
    expect(screen.getByText("Dashboards").closest("a")).toHaveAttribute(
      "href",
      "/dashboards?preview=draft",
    );
    expect(screen.getByText("Page").closest("[data-slot='breadcrumb-page']")).toBeInTheDocument();
  });
});
