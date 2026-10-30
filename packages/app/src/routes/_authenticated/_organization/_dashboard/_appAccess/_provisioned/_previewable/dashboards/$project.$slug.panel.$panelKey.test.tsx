import { productClient } from "@composition/client";
import { TimeRangeSearchSchema } from "@everr/ui/lib/time-range";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, onTestFinished, vi } from "vite-plus/test";
import { z } from "zod";
import { DashboardBreadcrumb } from "#app/components/dashboard-breadcrumb.tsx";
import { DashboardsList } from "#app/components/dashboards/dashboards-list.tsx";
import { DashboardHome } from "#app/components/home/dashboard-home.tsx";
import { getBuiltinDashboard } from "#app/data/dashboards/built-in/catalog/index.ts";
import { lastViewedDashboard } from "#app/data/dashboards/last-viewed.ts";
import { listDashboards } from "#app/data/dashboards/server.ts";
import { writeBuiltinsCollapsed } from "#app/data/dashboards/ui-prefs.ts";
import type { Dashboard, Panel } from "#app/data/dashboards/schema.ts";
import { Route as DashboardIndexFileRoute } from "./$project.$slug.index";
import { Route as DashboardPanelFileRoute } from "./$project.$slug.panel.$panelKey";
import { Route as BuiltinIndexFileRoute } from "./built-in.$slug.index";
import { Route as BuiltinPanelFileRoute } from "./built-in.$slug.panel.$panelKey";

// A plain factory (no importOriginal): the real server module statically
// imports the db client, which reads server-only env vars in jsdom. Replacing
// the module wholesale keeps `dashboardOptions`' queryFn working (the mock is
// what it calls) without ever loading it.
vi.mock("#app/data/dashboards/server.ts", () => {
  return {
    getDashboard: vi.fn(async () => ({
      document: testDashboard(),
      previewStatus: "live" as const,
    })),
    listDashboards: vi.fn(async () => []),
    getTelemetryCapabilities: vi.fn(async () => []),
    runPanelQuery: vi.fn(async () => ({ rows: [] })),
    runVariableOptionsQuery: vi.fn(async () => ({ options: [] })),
  };
});

// jsdom has no IntersectionObserver; the panel uses it to gate its queries.
// A no-op stub keeps the hook mounted with `inView` staying false.
beforeAll(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      root = null;
      rootMargin = "";
      thresholds: number[] = [];
      disconnect() {}
      observe() {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
      unobserve() {}
    },
  );
});

// A one-panel dashboard: enough spec for the page and the panel machinery,
// with one layout item pointing at the panel.
function testDashboard(): Dashboard {
  const panel: Panel = {
    kind: "Panel",
    spec: {
      display: { name: "Requests per second", description: "Panel spec test" },
      plugin: { kind: "TimeSeriesChart", spec: {} },
      queries: [
        {
          kind: "TimeSeriesQuery",
          spec: { plugin: { kind: "none", spec: {} } },
        },
      ],
    },
  };
  return {
    kind: "Dashboard",
    metadata: { name: "traffic", project: "demo" },
    spec: {
      display: { name: "Traffic" },
      panels: { rps: panel },
      layouts: [
        {
          kind: "Grid",
          spec: {
            items: [
              {
                x: 0,
                y: 0,
                width: 12,
                height: 8,
                content: { $ref: "#/spec/panels/rps" },
              },
            ],
          },
        },
      ],
    },
  } as unknown as Dashboard;
}

// The search shape the panel page reads at the `_dashboard` level, rebuilt
// here instead of importing the shell route file: that file renders the app
// sidebar, whose chain imports server-only modules that read env vars in
// jsdom. Only the schema matters for the route reads (`from`/`to`/`preview`/
// `vars`), so this is the same schema with the sidebar left out.
const testSearchSchema = TimeRangeSearchSchema.extend({
  preview: z.string().max(200).optional().catch(undefined),
  vars: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .optional()
    .catch(undefined),
});

// The real file-route singletons are re-parented into a minimal tree (the
// same `.update()` technique as the _previewable test): `Route.id` resolves
// only once the route is parented, and the panel page's `useDashboard()` /
// `useTimeRange()` reads need the dashboard search schema in the chain.
function renderDashboardRoutes(
  initialEntry: string,
  { breadcrumb = false, rail = false }: { breadcrumb?: boolean; rail?: boolean } = {},
) {
  const rootRoute = createRootRoute({ component: Outlet });
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "_authenticated/_organization",
    component: Outlet,
  });
  const dashboardRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    id: "_dashboard",
    // Opt-in: the shell's breadcrumb (DashboardLayout renders it), so the
    // way back from the panel page is exercised as a real link. Off by
    // default because its last crumb repeats the panel's name.
    // Opt-in too: the dashboards rail, to check which row a panel page keeps
    // selected.
    component: () => (
      <>
        {rail && <DashboardsList />}
        {breadcrumb && <DashboardBreadcrumb />}
        <Outlet />
      </>
    ),
    validateSearch: testSearchSchema,
  });
  // `id`/`getParentRoute` aren't in `.update()`'s public type: only the
  // generator is meant to set them, and routeTree.gen.ts casts for the same
  // reason.
  DashboardIndexFileRoute.update({
    id: "/dashboards/$project/$slug/",
    // The real parent chain contributes this prefix in production; this tree
    // stops at `_dashboard`, so the path has to carry it here.
    path: "dashboards/$project/$slug/",
    getParentRoute: () => dashboardRoute,
  } as Parameters<typeof DashboardIndexFileRoute.update>[0]);
  DashboardPanelFileRoute.update({
    id: "/dashboards/$project/$slug/panel/$panelKey",
    path: "dashboards/$project/$slug/panel/$panelKey",
    getParentRoute: () => dashboardRoute,
  } as Parameters<typeof DashboardPanelFileRoute.update>[0]);
  // Static `built-in` segments outrank `$project`, as in the generated tree.
  BuiltinIndexFileRoute.update({
    id: "/dashboards/built-in/$slug/",
    path: "dashboards/built-in/$slug/",
    getParentRoute: () => dashboardRoute,
  } as Parameters<typeof BuiltinIndexFileRoute.update>[0]);
  BuiltinPanelFileRoute.update({
    id: "/dashboards/built-in/$slug/panel/$panelKey",
    path: "dashboards/built-in/$slug/panel/$panelKey",
    getParentRoute: () => dashboardRoute,
  } as Parameters<typeof BuiltinPanelFileRoute.update>[0]);
  // Home as the product composes it: the product's home built-in.
  const homeRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "/",
    component: () => {
      const home = getBuiltinDashboard(productClient.homeDashboardId);
      if (!home) throw new Error("missing home built-in");
      return <DashboardHome slug={home.id} document={home.document} />;
    },
  });
  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([
        homeRoute,
        DashboardIndexFileRoute,
        DashboardPanelFileRoute,
        BuiltinIndexFileRoute,
        BuiltinPanelFileRoute,
      ]),
    ]),
  ]);

  const history = createMemoryHistory({ initialEntries: [initialEntry] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history,
    context: {
      queryClient,
      session: {
        user: { id: "test_user" },
        session: { activeOrganizationId: "test_org" },
      },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("dashboard panel full-screen route", () => {
  it("renders the panel page with the panel's name", async () => {
    renderDashboardRoutes("/dashboards/demo/traffic/panel/rps");

    expect(await screen.findByText("Requests per second")).toBeInTheDocument();
  });

  it("404s an unknown panel key without recording the dashboard as viewed", async () => {
    const record = vi.spyOn(lastViewedDashboard, "record");
    renderDashboardRoutes("/dashboards/demo/traffic/panel/nope");

    expect(await screen.findByText("Dashboard not found")).toBeInTheDocument();
    expect(record).not.toHaveBeenCalled();
    record.mockRestore();
  });

  it("links the grid's maximize control to the panel page, carrying the live search", async () => {
    const router = renderDashboardRoutes(
      "/dashboards/demo/traffic?vars=%7B%22env%22%3A%22prod%22%7D",
    );

    const maximize = await screen.findByRole("link", {
      name: "Open the panel full screen",
    });
    // Click, don't just read the href: this asserts the link actually
    // navigates to the panel page (the router resolves the route, the loader
    // 404s nothing, and the panel page renders).
    await userEvent.click(maximize);

    expect(router.state.location.pathname).toBe("/dashboards/demo/traffic/panel/rps");
    // `vars` is not retained across navigation, so the maximize link must
    // carry the live values itself.
    expect(router.state.location.search.vars).toEqual({ env: "prod" });
    expect(await screen.findByText("Requests per second")).toBeInTheDocument();
  });

  it("maximizes a Home panel into the product's home built-in", async () => {
    // Built-in panels show their header (and its maximize link) once their
    // query settles, so this test lets every panel come into view.
    const NoopObserver = globalThis.IntersectionObserver;
    vi.stubGlobal(
      "IntersectionObserver",
      class extends NoopObserver {
        #callback: IntersectionObserverCallback;
        constructor(callback: IntersectionObserverCallback) {
          super(callback);
          this.#callback = callback;
        }
        override observe(target: Element) {
          this.#callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this);
        }
      },
    );
    onTestFinished(() => {
      vi.stubGlobal("IntersectionObserver", NoopObserver);
    });
    const router = renderDashboardRoutes("/");

    const [maximize] = await screen.findAllByRole("link", {
      name: "Open the panel full screen",
    });
    if (!maximize) throw new Error("no maximize link on Home");
    await userEvent.click(maximize);

    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(
        new RegExp(`^/dashboards/built-in/${productClient.homeDashboardId}/panel/[^/]+$`),
      ),
    );
    // The panel page renders that panel (not the not-found screen).
    const panelKey = router.state.location.pathname.split("/").at(-1) ?? "";
    const panel = getBuiltinDashboard(productClient.homeDashboardId)?.document.spec.panels[
      panelKey
    ];
    expect(panel).toBeDefined();
    expect(await screen.findByText(panel?.spec.display?.name ?? panelKey)).toBeInTheDocument();
    expect(screen.queryByText("Dashboard not found")).not.toBeInTheDocument();
  });

  // The breadcrumb back to the dashboard must carry the same search the
  // maximize link brought: `vars` is not retained across navigation, so a
  // bare link would reset the dashboard's variables.
  it.each([
    {
      kind: "own",
      panel: "/dashboards/demo/traffic/panel/rps",
      dashboard: "/dashboards/demo/traffic",
      name: "Traffic",
      vars: { env: "prod" },
    },
    {
      kind: "built-in",
      panel: "/dashboards/built-in/traces-overview/panel/span-count",
      dashboard: "/dashboards/built-in/traces-overview",
      name: "Traces Overview",
      vars: { service: ["checkout"] },
    },
  ])(
    "keeps vars and the time range on the $kind dashboard breadcrumb",
    async ({ panel, dashboard, name, vars }) => {
      const search = new URLSearchParams({
        from: "now-24h",
        to: "now",
        vars: JSON.stringify(vars),
      });
      const router = renderDashboardRoutes(`${panel}?${search}`, {
        breadcrumb: true,
      });

      await userEvent.click(await screen.findByRole("link", { name }));

      await waitFor(() => expect(router.state.location.pathname).toBe(dashboard));
      expect(router.state.location.search).toMatchObject({
        from: "now-24h",
        to: "now",
        vars,
      });
    },
  );

  it("keeps the parent dashboard selected in the rail on a panel page, its folder open", async () => {
    vi.mocked(listDashboards).mockResolvedValueOnce([
      {
        project: "demo",
        slug: "traffic",
        name: "Traffic",
        folderPath: "team/web",
        previewStatus: undefined,
      },
    ]);
    renderDashboardRoutes("/dashboards/demo/traffic/panel/rps", { rail: true });

    // Rendered at all only because the deep link opened its folders.
    const row = await screen.findByRole("link", { name: "Traffic" });
    expect(row).toHaveAttribute("aria-current", "page");
  });

  it("keeps a built-in's row pinned and selected in a collapsed rail on its panel page", async () => {
    writeBuiltinsCollapsed(true);
    onTestFinished(() => writeBuiltinsCollapsed(false));
    const builtin = getBuiltinDashboard("http-endpoints");
    if (!builtin) throw new Error("missing http-endpoints built-in");
    const panelKey = Object.keys(builtin.document.spec.panels)[0];
    renderDashboardRoutes(`/dashboards/built-in/http-endpoints/panel/${panelKey}`, {
      rail: true,
    });

    const section = await screen.findByRole("region", { name: "Built-in dashboards" });
    const row = await within(section).findByRole("link", { name: builtin.name });
    expect(row).toHaveAttribute("aria-current", "page");
    expect(within(section).getAllByRole("link")).toHaveLength(1);
  });
});
