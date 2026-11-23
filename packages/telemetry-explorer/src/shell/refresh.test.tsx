import type * as RefreshPickerModule from "@everr/ui/components/refresh-picker";
import { appQueryOptions, dataQueryOptions } from "@everr/ui/lib/query-options";
import { QueryClient, QueryClientProvider, type QueryKey, useQuery } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { AppShell } from "./app-shell";
import { shellRouteOptions } from "./route";

vi.mock("@everr/ui/components/time-range-picker", () => ({
  TimeRangePicker: () => null,
}));

vi.mock("@everr/ui/components/refresh-picker", async (importOriginal) => ({
  ...(await importOriginal<typeof RefreshPickerModule>()),
  RefreshPicker: ({ onRefresh, isFetching }: { onRefresh: () => void; isFetching: boolean }) => (
    <button type="button" aria-busy={isFetching} onClick={onRefresh}>
      Refresh
    </button>
  ),
}));

afterEach(() => {
  vi.useRealTimers();
});

type Probe = { queryKey: QueryKey; queryFn: () => Promise<string>; data: boolean };

function QueryProbe({ queryKey, queryFn, data }: Probe) {
  useQuery(data ? dataQueryOptions({ queryKey, queryFn }) : appQueryOptions({ queryKey, queryFn }));
  return null;
}

function renderShell(initialEntry: string, probes: Probe[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute();
  const shellRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "_shell",
    ...shellRouteOptions(),
    component: () => (
      <AppShell nav={[]} sidebarFooter={null}>
        <Outlet />
      </AppShell>
    ),
  });
  const pageRoute = createRoute({
    getParentRoute: () => shellRoute,
    path: "/page",
    staticData: { showDataControls: true },
    component: () => (
      <>
        {probes.map((probe) => (
          <QueryProbe key={probe.queryKey.join()} {...probe} />
        ))}
      </>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([shellRoute.addChildren([pageRoute])]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return client;
}

describe("AppShell refresh", () => {
  it("refreshes the page's data, not the app's own queries", async () => {
    let finishStatus = () => {};
    const status = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finishStatus = () => resolve("running");
        }),
    );
    const telemetry = vi.fn().mockResolvedValue("fresh telemetry");
    const client = renderShell("/page", [
      { queryKey: ["logs", "explorer"], queryFn: telemetry, data: true },
      { queryKey: ["app-own", "status"], queryFn: status, data: false },
    ]);

    const refresh = await screen.findByRole("button", { name: "Refresh" });
    await waitFor(() => expect(status).toHaveBeenCalledTimes(1));
    // The status request is still in flight, and the refresh button does not wait for it.
    await waitFor(() => expect(refresh).toHaveAttribute("aria-busy", "false"));
    fireEvent.click(refresh);
    await waitFor(() => expect(telemetry).toHaveBeenCalledTimes(2));
    expect(status).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveAttribute("aria-busy", "false");
    await act(async () => finishStatus());
    client.clear();
  });

  it("refreshes the page's data at the auto-refresh interval", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    // Neither has a refetch interval of its own.
    const series = vi.fn().mockResolvedValue("series");
    const status = vi.fn().mockResolvedValue("running");
    const client = renderShell("/page?refresh=10s", [
      { queryKey: ["metrics", "series"], queryFn: series, data: true },
      { queryKey: ["app-own", "status"], queryFn: status, data: false },
    ]);
    try {
      await screen.findByRole("button", { name: "Refresh" });
      await waitFor(() => expect(series).toHaveBeenCalledTimes(1));
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      await waitFor(() => expect(series).toHaveBeenCalledTimes(2));
      expect(status).toHaveBeenCalledTimes(1);
    } finally {
      client.clear();
    }
  });
});
