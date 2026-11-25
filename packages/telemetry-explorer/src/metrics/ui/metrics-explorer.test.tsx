import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import type { MetricsRepositoryLike } from "../data/repository";
import type { MetricAggregation } from "../data/schemas";
import { MetricsExplorer, type MetricsExplorerSearch } from "./metrics-explorer";

vi.mock("@everr/ui/components/series-chart", () => ({
  // Draws only the first exemplar, as a button that picks it.
  SeriesChart: ({
    markers,
    onMarkerClick,
  }: {
    markers?: { id: string }[];
    onMarkerClick?: (marker: { id: string }, at: { x: number; y: number }) => void;
  }) =>
    markers?.[0] ? (
      <button type="button" onClick={() => onMarkerClick?.(markers[0]!, { x: 0, y: 0 })}>
        exemplar
      </button>
    ) : null,
}));

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
  // The catalog stays mounted under an open metric, so it loads too.
  catalog: async () => [],
  kinds: async () => [],
  names: async () => [],
  summaryQuantiles: async () => [],
  attributeKeys: async () => [],
  attributeValues: async () => [],
} as unknown as MetricsRepositoryLike;

// Applies search changes a moment later, as the router does.
function Page({
  initial,
  metrics = repo,
  agg,
  service = [],
}: {
  initial: MetricsExplorerSearch;
  metrics?: MetricsRepositoryLike;
  /** Changes the aggregation without a click, which would close a popover. */
  agg?: MetricAggregation;
  service?: string[];
}) {
  const [search, setSearch] = useState(initial);
  return (
    <MetricsExplorer
      repo={metrics}
      timeRange={{ from: "now-1h", to: "now" }}
      search={agg ? { ...search, agg } : search}
      service={service}
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
    fireEvent.click(screen.getByRole("button", { name: /filter query B in the sidebar/ }));
    const remove = screen.getByLabelText("Remove query B");
    remove.focus();
    fireEvent.click(remove);
    await settle();

    expect(document.activeElement).toBe(screen.getByLabelText("cpu: change metric"));
  });

  it("names each query's controls after the query, with its filter count, and the button that adds one", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Page
          initial={{
            ...oneQuery,
            by: [{ source: "metric", key: "host" }],
            queries: [
              {
                id: "B",
                metric: "cpu",
                type: "gauge",
                by: [{ source: "metric", key: "host" }],
                attributes: [{ source: "metric", key: "zone", op: "in", values: ["a"] }],
              },
            ],
          }}
        />
      </QueryClientProvider>,
    );
    await settle();
    const queryB = within(screen.getByRole("group", { name: "Query B" }));

    expect(queryB.getByRole("button", { name: /^B 1 filter/ })).toBeTruthy();
    expect(queryB.getAllByLabelText("Stop grouping by host")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Add metric query" })).toBeTruthy();
  });

  it("shows no resolution for a range with no intervals", async () => {
    const empty = {
      ...repo,
      series: async () => ({ stepSeconds: 60, buckets: [], series: [], totalSeries: 0 }),
    } as unknown as MetricsRepositoryLike;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Page initial={oneQuery} metrics={empty} />
      </QueryClientProvider>,
    );
    await settle();

    expect(screen.queryByText("Resolution")).toBeNull();
  });

  it("closes an exemplar's card once the chart no longer has that exemplar", async () => {
    let exemplars = [
      { ts: 0, time: "1970-01-01 00:00:10", value: 1, traceId: "t1", spanId: "s1", labels: [] },
    ];
    const withExemplar = {
      ...repo,
      exemplars: async () => exemplars,
    } as unknown as MetricsRepositoryLike;
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <Page initial={oneQuery} metrics={withExemplar} />
      </QueryClientProvider>,
    );
    await settle();
    fireEvent.click(screen.getByText("exemplar"));
    expect(screen.queryByText("Trace")).not.toBeNull();

    exemplars = [];
    await act(() => client.invalidateQueries());
    await settle();

    expect(screen.queryByText("Trace")).toBeNull();
  });

  it("shows an exemplar's interval value for the aggregation charted now", async () => {
    const withExemplar = {
      ...repo,
      series: async ({ aggregation }: { aggregation: MetricAggregation }) => ({
        stepSeconds: 60,
        buckets: [new Date(0).toISOString()],
        series: [{ labels: [], values: [aggregation === "max" ? 7 : 3] }],
        totalSeries: 1,
      }),
      exemplars: async () => [
        { ts: 0, time: "1970-01-01 00:00:10", value: 9, traceId: "t1", spanId: "s1", labels: [] },
      ],
    } as unknown as MetricsRepositoryLike;
    const client = new QueryClient();
    const page = (agg: MetricAggregation) => (
      <QueryClientProvider client={client}>
        <Page initial={oneQuery} metrics={withExemplar} agg={agg} />
      </QueryClientProvider>
    );
    // Both aggregations loaded once, so switching back is instant.
    const { rerender } = render(page("avg"));
    await settle();
    rerender(page("max"));
    await settle();
    rerender(page("avg"));
    await settle();
    fireEvent.click(screen.getByText("exemplar"));
    rerender(page("max"));
    await settle();

    expect(screen.getByText("max this interval").nextElementSibling?.textContent).toBe("7");
  });

  it("ties an exemplar to its own group when another group is named after the metric", async () => {
    const grouped = {
      ...repo,
      // One host has no name; another is called like the metric.
      series: async () => ({
        stepSeconds: 60,
        buckets: [new Date(0).toISOString()],
        series: [
          { labels: [""], values: [3] },
          { labels: ["cpu"], values: [7] },
        ],
        totalSeries: 2,
      }),
      exemplars: async () => [
        { ts: 0, time: "1970-01-01 00:00:10", value: 9, traceId: "t1", spanId: "s1", labels: [""] },
      ],
    } as unknown as MetricsRepositoryLike;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Page
          initial={{ ...oneQuery, by: [{ source: "metric", key: "host" }] }}
          metrics={grouped}
          agg="max"
        />
      </QueryClientProvider>,
    );
    await settle();
    fireEvent.click(screen.getByText("exemplar"));

    expect(screen.getByText("max this interval").nextElementSibling?.textContent).toBe("3");
  });

  it("asks for the heatmap without grouping", async () => {
    const series = vi.fn(repo.series);
    const histogram = {
      ...repo,
      metadata: async () => ({
        type: "histogram",
        unit: "s",
        description: "",
        isMonotonic: false,
        temporality: 1,
      }),
      series,
    } as unknown as MetricsRepositoryLike;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Page
          initial={{
            ...oneQuery,
            metricType: "histogram",
            view: "heatmap",
            by: [{ source: "metric", key: "host" }],
          }}
          metrics={histogram}
        />
      </QueryClientProvider>,
    );
    await settle();

    expect(series).toHaveBeenCalledWith(expect.objectContaining({ heatmap: true, groupBy: [] }));
  });

  it("heads the series table with the group-by its rows were read with", async () => {
    const grouped = {
      ...repo,
      // The data for a new group-by is still loading.
      series: ({ groupBy }: { groupBy: unknown[] }) =>
        groupBy.length === 2
          ? Promise.resolve({
              stepSeconds: 60,
              buckets: [new Date(0).toISOString()],
              series: [{ labels: ["h1", "p1"], values: [1] }],
              totalSeries: 1,
            })
          : new Promise(() => {}),
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
          metrics={grouped}
        />
      </QueryClientProvider>,
    );
    await settle();
    fireEvent.click(screen.getByLabelText("Stop grouping by pod"));
    await settle();

    expect(screen.getByRole("columnheader", { name: "host · pod" })).toBeTruthy();
  });

  it("heads the series table without a group-by after leaving the heatmap", async () => {
    const histogram = {
      ...repo,
      metadata: async () => ({
        type: "histogram",
        unit: "s",
        description: "",
        isMonotonic: false,
        temporality: 1,
      }),
      // The grouped lines are still loading.
      series: ({ groupBy }: { groupBy: unknown[] }) =>
        groupBy.length === 0 ? repo.series({} as never) : new Promise(() => {}),
    } as unknown as MetricsRepositoryLike;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Page
          initial={{
            ...oneQuery,
            metricType: "histogram",
            view: "heatmap",
            by: [{ source: "metric", key: "host" }],
          }}
          metrics={histogram}
        />
      </QueryClientProvider>,
    );
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Lines" }));
    await settle();

    expect(screen.queryByRole("columnheader", { name: "host" })).toBeNull();
  });

  it("waits for a new service's quantiles before charting a summary", async () => {
    const series = vi.fn(repo.series);
    const summary = {
      ...repo,
      metadata: async () => ({
        type: "summary",
        unit: "s",
        description: "",
        isMonotonic: false,
        temporality: 0,
      }),
      // Only the worker service reports p90, and not p95. Its list arrives
      // after the rest of what the chart waits for.
      summaryQuantiles: ({ service }: { service: string[] }) =>
        service.includes("worker")
          ? new Promise((resolve) => setTimeout(() => resolve([0.5, 0.9]), 20))
          : Promise.resolve([0.5, 0.95]),
      series,
    } as unknown as MetricsRepositoryLike;
    const client = new QueryClient();
    const page = (service: string[]) => (
      <QueryClientProvider client={client}>
        <Page
          initial={{ ...oneQuery, metricType: "summary" }}
          metrics={summary}
          service={service}
        />
      </QueryClientProvider>
    );
    const { rerender } = render(page([]));
    await settle();
    rerender(page(["worker"]));
    await settle();

    const forWorker = series.mock.calls
      .map(([input]) => input)
      .filter((input) => input.service?.includes("worker"));
    expect(forWorker.map((input) => input.aggregation)).toEqual(["p90"]);
  });

  it("groups each query's series under its own heading", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Page
          initial={{
            ...oneQuery,
            metric: "cpu",
            queries: [{ id: "B", metric: "memory", type: "gauge" }],
          }}
        />
      </QueryClientProvider>,
    );
    await settle();
    // The header row's group, then one per query.
    const [, queryA, queryB] = screen.getAllByRole("rowgroup");

    expect(within(queryA!).getAllByRole("row")).toHaveLength(2);
    expect(within(queryB!).getByTitle("memory")).toBeTruthy();
    expect(within(queryB!).queryByTitle("cpu")).toBeNull();
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
    await userEvent.click(screen.getByRole("button", { name: "Add group-by key" }));
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

  it("retries or closes the metric switcher from the keyboard after its list fails", async () => {
    let calls = 0;
    const flaky = {
      ...repo,
      names: async () => {
        calls += 1;
        if (calls < 3) throw new Error("timed out");
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
    const openWithRetryFocused = async () => {
      fireEvent.click(screen.getByLabelText("cpu: change metric"));
      await settle();
      screen.getByRole("button", { name: "Retry" }).focus();
    };

    await openWithRetryFocused();
    await userEvent.keyboard("{Escape}");
    await settle();
    expect(screen.queryByText(/Couldn't load metrics/)).toBeNull();

    await openWithRetryFocused();
    await userEvent.keyboard("{Enter}");
    await settle();
    expect(screen.getByText("memory")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByPlaceholderText("Search metrics…"));
  });

  it("keeps the last chart and description, marked as loading, while another metric loads", async () => {
    const switching = {
      ...repo,
      names: async () => [{ name: "memory", type: "gauge", isMonotonic: false }],
      metadata: ({ metric }: { metric: string }) =>
        metric === "memory"
          ? new Promise(() => {})
          : repo.metadata({} as never).then((entry) => ({ ...entry, description: "CPU time" })),
      series: (input: { metric: string }) =>
        input.metric === "memory" ? new Promise(() => {}) : repo.series(input as never),
    } as unknown as MetricsRepositoryLike;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Page initial={oneQuery} metrics={switching} />
      </QueryClientProvider>,
    );
    await settle();
    fireEvent.click(screen.getByLabelText("cpu: change metric"));
    await settle();
    fireEvent.click(screen.getByRole("option", { name: /memory/ }));
    await settle();

    const row = screen.getByRole("rowheader", { name: "cpu" });
    expect(row.closest("[aria-busy='true']")).toBeTruthy();
    expect(screen.getByText("Resolution")).toBeTruthy();
    expect(screen.getByText("CPU time")).toBeTruthy();
  });

  it("drops a removed query's lines while the chart reloads", async () => {
    let loading = false;
    const reloading = {
      ...repo,
      // Exported every 5 minutes, so removing it gives the chart a finer step.
      exportInterval: async ({ metric }: { metric: string }) => (metric === "memory" ? 300 : 60),
      series: (input: unknown) => (loading ? new Promise(() => {}) : repo.series(input as never)),
    } as unknown as MetricsRepositoryLike;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Page
          initial={{ ...oneQuery, queries: [{ id: "B", metric: "memory", type: "gauge" }] }}
          metrics={reloading}
        />
      </QueryClientProvider>,
    );
    await settle();
    loading = true;
    fireEvent.click(screen.getByLabelText("Remove query B"));
    await settle();

    expect(screen.getByRole("rowheader", { name: "A · cpu" })).toBeTruthy();
    expect(screen.queryByRole("rowheader", { name: "B · memory" })).toBeNull();
  });

  it("drops the removed query's lines, not the next one's, when A is removed", async () => {
    let loading = false;
    const reloading = {
      ...repo,
      // Removing the 5-minute cpu gives the chart a finer step, so it reloads.
      exportInterval: async ({ metric }: { metric: string }) => (metric === "cpu" ? 300 : 60),
      series: (input: unknown) => (loading ? new Promise(() => {}) : repo.series(input as never)),
    } as unknown as MetricsRepositoryLike;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Page
          initial={{ ...oneQuery, queries: [{ id: "B", metric: "memory", type: "gauge" }] }}
          metrics={reloading}
        />
      </QueryClientProvider>,
    );
    await settle();
    loading = true;
    fireEvent.click(screen.getByLabelText("Remove query A"));
    await settle();

    expect(screen.queryByRole("rowheader", { name: "A · cpu" })).toBeNull();
    expect(screen.getByRole("rowheader", { name: "B · memory" })).toBeTruthy();
  });

  it("charts a copy of a query without fetching its data again", async () => {
    const series = vi.fn(repo.series);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Page initial={oneQuery} metrics={{ ...repo, series } as MetricsRepositoryLike} />
      </QueryClientProvider>,
    );
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Add metric query" }));
    await settle();

    expect(screen.getByRole("rowheader", { name: "B · cpu" })).toBeTruthy();
    expect(series).toHaveBeenCalledTimes(1);
  });
});
