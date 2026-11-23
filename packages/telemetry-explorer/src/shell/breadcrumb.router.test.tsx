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
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { ShellBreadcrumb } from "./breadcrumb";

// The routes these tests link to are not in the package's registered route
// tree, so the authored links name their paths as plain strings.
const FixtureLink = Link as ComponentType<{
  to: string;
  params?: Record<string, string>;
  search?: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>);
}>;

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
        <ShellBreadcrumb nav={[]} />
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
          link: <FixtureLink to="/dashboards" search={{ preview: "draft" }} />,
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
  const slowRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/slow",
    staticData: {
      breadcrumb: (match) => {
        const name = (match.loaderData as { name: string } | undefined)?.name;
        return [{ label: name ?? "Slow page", unresolved: name === undefined }];
      },
    },
    loader: async () => {
      await loaderGate.promise;
      return { name: "Checkout latency" };
    },
    component: () => <p>Slow page content</p>,
  });
  const routeTree = rootRoute.addChildren([
    dashboardsRoute,
    slowRoute,
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

describe("ShellBreadcrumb with a real router", () => {
  it("follows the page being loaded, with a skeleton for a name not known yet", async () => {
    loaderGate = gate();
    const router = createTestRouter();
    const { container } = renderRouter(router);
    await screen.findByText("Runbook page");

    router.history.push("/slow");

    await vi.waitFor(() =>
      expect(container.querySelector("[data-slot='skeleton']")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Slow page")).not.toBeInTheDocument();
    expect(screen.getByText("Runbook page")).toBeInTheDocument();

    loaderGate.resolve();
    expect(await screen.findByText("Slow page content")).toBeInTheDocument();
    expect(screen.getByText("Checkout latency")).toBeInTheDocument();
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
