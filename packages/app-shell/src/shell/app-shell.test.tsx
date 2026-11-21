import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScrollText } from "lucide-react";
import { describe, expect, it } from "vite-plus/test";
import { AppShell } from "./app-shell";
import type { NavGroup } from "./nav";
import { shellRouteOptions } from "./route";
import { useTimeRange } from "./time-range";

const nav: NavGroup[] = [
  { label: "Explore", accent: "", items: [{ title: "Logs", url: "/logs", icon: ScrollText }] },
];

function PageRange() {
  const { timeRange } = useTimeRange();
  return <p>{`page range ${timeRange.from} to ${timeRange.to}`}</p>;
}

/** A shell layout over three pages: one with data controls, one that hides the
 *  time range, one without data controls. `/logs` validates search of its own,
 *  as a real page does. */
function renderShell(initialEntry: string, hideTimeRangePicker?: boolean) {
  const rootRoute = createRootRoute();
  const shellRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "_shell",
    ...shellRouteOptions(),
    component: () => (
      <AppShell
        nav={nav}
        sidebarFooter={<p>Footer</p>}
        dataActions={<p>Data actions</p>}
        hideTimeRangePicker={hideTimeRangePicker}
      >
        <Outlet />
      </AppShell>
    ),
  });
  const dataRoute = createRoute({
    getParentRoute: () => shellRoute,
    id: "_data",
    staticData: { showDataControls: true },
  });
  const logsRoute = createRoute({
    getParentRoute: () => dataRoute,
    path: "/logs",
    validateSearch: (search: Record<string, unknown>) => ({
      q: typeof search.q === "string" ? search.q : undefined,
    }),
    staticData: { breadcrumb: "Logs" },
    component: PageRange,
  });
  const detailRoute = createRoute({
    getParentRoute: () => dataRoute,
    path: "/detail",
    staticData: { breadcrumb: "Detail", hideTimeRangePicker: true },
    component: () => <p>Detail page</p>,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => shellRoute,
    path: "/settings",
    staticData: { breadcrumb: "Settings" },
    component: () => <p>Settings page</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      shellRoute.addChildren([dataRoute.addChildren([logsRoute, detailRoute]), settingsRoute]),
    ]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const timeRangeButton = (name: RegExp) => screen.queryByRole("button", { name });

describe("AppShell", () => {
  it("frames the page with the sidebar, the breadcrumb and the footer", async () => {
    renderShell("/logs");

    expect(await screen.findByText(/^page range/)).toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveTextContent("Logs");
    const sidebarLinks = screen
      .getAllByRole("link", { name: "Logs" })
      .filter((link) => link.getAttribute("href") === "/logs");
    expect(sidebarLinks).toHaveLength(1);
    expect(sidebarLinks[0]).toHaveAttribute("data-active", "true");
    expect(screen.getByText("Footer")).toBeInTheDocument();
  });

  it("shows the data controls only on the pages that ask for them", async () => {
    renderShell("/settings");

    expect(await screen.findByText("Settings page")).toBeInTheDocument();
    expect(screen.queryByText("Data actions")).toBeNull();
    expect(timeRangeButton(/last 7 days/i)).toBeNull();
  });

  it("keeps the data actions and drops the time range where a route hides it", async () => {
    renderShell("/detail");

    expect(await screen.findByText("Detail page")).toBeInTheDocument();
    expect(screen.getByText("Data actions")).toBeInTheDocument();
    expect(timeRangeButton(/last 7 days/i)).toBeNull();
  });

  it("lets the app overrule what the routes declare", async () => {
    renderShell("/logs", true);

    expect(await screen.findByText(/^page range/)).toBeInTheDocument();
    expect(timeRangeButton(/last 7 days/i)).toBeNull();
  });
});

describe("time range", () => {
  it("is the same in the header and in a page that validates search of its own", async () => {
    renderShell("/logs?from=now-1h&to=now&q=error");

    expect(await screen.findByText("page range now-1h to now")).toBeInTheDocument();
    expect(timeRangeButton(/last 1 hour/i)).toBeInTheDocument();
  });

  it("falls back to the last 7 days", async () => {
    renderShell("/logs");

    expect(await screen.findByText("page range now-7d to now")).toBeInTheDocument();
    expect(timeRangeButton(/last 7 days/i)).toBeInTheDocument();
  });

  it("changes in the URL of the open page, keeps its search and adds a history entry", async () => {
    const router = renderShell("/logs?q=error");
    const user = userEvent.setup({ skipHover: true });

    await user.click(await screen.findByRole("button", { name: /last 7 days/i }));
    await user.click(screen.getByRole("option", { name: "Last 24 hours" }));

    expect(await screen.findByText("page range now-24h to now")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/logs");
    expect(router.state.location.search).toEqual({ q: "error", from: "now-24h", to: "now" });

    router.history.back();
    await waitFor(() => expect(router.state.location.search).toEqual({ q: "error" }));
  });
});
