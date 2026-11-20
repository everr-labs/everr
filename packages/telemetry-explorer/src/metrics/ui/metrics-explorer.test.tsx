import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import type { MetricsRepositoryLike } from "../data/repository";
import { MetricsExplorer, type MetricsExplorerSearch } from "./metrics-explorer";

vi.mock("@everr/ui/components/series-chart", () => ({ SeriesChart: () => null }));

const repo = {
  metadata: async () => ({
    type: "gauge",
    unit: "",
    description: "",
    isMonotonic: false,
    temporality: 0,
  }),
  exportInterval: async () => 60,
  series: async () => ({
    stepSeconds: 60,
    buckets: [new Date(0).toISOString()],
    series: [{ labels: [], values: [1] }],
    totalSeries: 1,
  }),
  exemplars: async () => [],
  names: async () => [],
  summaryQuantiles: async () => [],
  attributeKeys: async () => [],
  attributeValues: async () => [],
} as unknown as MetricsRepositoryLike;

// Applies search changes a moment later, as the router does.
function Page({
  initial,
  metrics = repo,
}: {
  initial: MetricsExplorerSearch;
  metrics?: MetricsRepositoryLike;
}) {
  const [search, setSearch] = useState(initial);
  return (
    <MetricsExplorer
      repo={metrics}
      timeRange={{ from: "now-1h", to: "now" }}
      refresh="off"
      search={search}
      service={[]}
      environment={[]}
      onSearchChange={(patch) => setTimeout(() => setSearch((s) => ({ ...s, ...patch })), 5)}
      onTimeRangeSelect={() => {}}
      renderMetricLink={() => null}
      renderCatalogLink={() => null}
      renderTraceLink={() => null}
      renderLogsLink={() => null}
    />
  );
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

const oneQuery: MetricsExplorerSearch = {
  q: "",
  types: [],
  metric: "cpu",
  metricType: "gauge",
  by: [],
  attributes: [],
  queries: [],
  hidden: [],
};

describe("MetricsExplorer", () => {
  it("keeps focus on the query left after removing the other", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Page
          initial={{
            q: "",
            types: [],
            metric: "cpu",
            metricType: "gauge",
            by: [],
            attributes: [],
            queries: [{ id: "B", metric: "cpu", type: "gauge" }],
            hidden: [],
          }}
        />
      </QueryClientProvider>,
    );
    await settle();
    fireEvent.click(screen.getByLabelText("Filter query B in the sidebar"));
    const remove = screen.getByLabelText("Remove query B");
    remove.focus();
    fireEvent.click(remove);
    await settle();

    expect(document.activeElement).toBe(screen.getByLabelText("cpu: change metric"));
  });

  it("moves focus to the next group-by key after removing one", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Page
          initial={{
            ...oneQuery,
            by: [
              { source: "metric", key: "host" },
              { source: "metric", key: "pod" },
            ],
          }}
        />
      </QueryClientProvider>,
    );
    await settle();
    const remove = screen.getByLabelText("Stop grouping by host");
    remove.focus();
    fireEvent.click(remove);
    await settle();

    expect(document.activeElement).toBe(screen.getByLabelText("Stop grouping by pod"));
  });

  it("moves focus to the last group-by key after adding the last one allowed", async () => {
    const keyed = {
      ...repo,
      names: async () => [{ name: "cpu", type: "gauge", isMonotonic: false }],
      attributeKeys: async () => [{ source: "metric", key: "zone" }],
    } as unknown as MetricsRepositoryLike;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Page
          initial={{
            ...oneQuery,
            by: [
              { source: "metric", key: "host" },
              { source: "metric", key: "pod" },
            ],
          }}
          metrics={keyed}
        />
      </QueryClientProvider>,
    );
    await settle();
    // Another popover used first, whose trigger the menu would return focus to.
    await userEvent.click(screen.getByLabelText("cpu: change metric"));
    await settle();
    await userEvent.keyboard("{Escape}");
    await settle();
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await settle();
    await userEvent.click(await screen.findByText("zone"));
    await settle();
    await settle();

    expect(document.activeElement).toBe(screen.getByLabelText("Stop grouping by zone"));
  });

  it("says when each of several queries shows only its top series", async () => {
    const many = {
      ...repo,
      series: async () => ({
        stepSeconds: 60,
        buckets: [new Date(0).toISOString()],
        series: [{ labels: ["a"], values: [1] }],
        totalSeries: 12,
      }),
    } as unknown as MetricsRepositoryLike;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Page
          initial={{ ...oneQuery, queries: [{ id: "B", metric: "cpu", type: "gauge" }] }}
          metrics={many}
        />
      </QueryClientProvider>,
    );
    await settle();

    expect(screen.getByText(/Query A: the 1 series with the highest values of 12\./)).toBeTruthy();
    expect(screen.getByText(/Query B: the 1 series with the highest values of 12\./)).toBeTruthy();
  });

  it("retries the metric switcher's list from the keyboard after it fails", async () => {
    let calls = 0;
    const flaky = {
      ...repo,
      names: async () => {
        calls += 1;
        if (calls === 1) throw new Error("timed out");
        return [{ name: "memory", type: "gauge", isMonotonic: false }];
      },
    } as MetricsRepositoryLike;
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <Page initial={oneQuery} metrics={flaky} />
      </QueryClientProvider>,
    );
    await settle();
    fireEvent.click(screen.getByLabelText("cpu: change metric"));
    await settle();
    screen.getByRole("button", { name: "Retry" }).focus();
    await userEvent.keyboard("{Enter}");
    await settle();

    expect(screen.getByText("memory")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByPlaceholderText("Search metrics…"));
  });

  it("closes the metric switcher with Escape from its Retry", async () => {
    const failing = {
      ...repo,
      names: () => Promise.reject(new Error("timed out")),
    } as MetricsRepositoryLike;
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <Page initial={oneQuery} metrics={failing} />
      </QueryClientProvider>,
    );
    await settle();
    fireEvent.click(screen.getByLabelText("cpu: change metric"));
    await settle();
    screen.getByRole("button", { name: "Retry" }).focus();
    await userEvent.keyboard("{Escape}");
    await settle();

    expect(screen.queryByText(/Couldn't load metrics/)).toBeNull();
  });
});
