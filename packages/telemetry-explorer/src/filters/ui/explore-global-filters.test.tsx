import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import type { LogsRepositoryLike } from "../../logs/data/repository";
import { memoryFilterOptionsCache } from "../../testing/filter-options-cache";
import type { TracesRepositoryLike } from "../../traces/data/repository";
import { FilterOptionsCacheProvider } from "../data/filter-options-cache";
import { ExploreGlobalFilters } from "./explore-global-filters";

const hourAgo = { from: "now-1h", to: "now" };
const dayAgo = { from: "now-1d", to: "now" };

function deferred<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: settle };
}

function reposFor(services: Promise<string[]>) {
  return {
    logsRepo: {
      filterOptions: () => services.then((list) => ({ services: list })),
    } as unknown as LogsRepositoryLike,
    tracesRepo: { listServiceIdentities: async () => [] } as unknown as TracesRepositoryLike,
    metricsRepo: { services: async () => [], environments: async () => [] },
    profilesRepo: { listServices: async () => [], attributeValues: async () => [] },
  };
}

function Filters({
  services,
  timeRange,
}: {
  services: Promise<string[]>;
  timeRange: typeof hourAgo;
}) {
  return (
    <ExploreGlobalFilters
      {...reposFor(services)}
      timeRange={timeRange}
      service={[]}
      environment={[]}
      onServiceChange={vi.fn()}
      onEnvironmentChange={vi.fn()}
    />
  );
}

function renderFilters(
  queryClient: QueryClient,
  cache: ReturnType<typeof memoryFilterOptionsCache>,
  props: Parameters<typeof Filters>[0],
) {
  const tree = (next: Parameters<typeof Filters>[0]) => (
    <QueryClientProvider client={queryClient}>
      <FilterOptionsCacheProvider value={cache}>
        <Filters {...next} />
      </FilterOptionsCacheProvider>
    </QueryClientProvider>
  );
  const view = render(tree(props));
  return { rerender: (next: Parameters<typeof Filters>[0]) => view.rerender(tree(next)) };
}

describe("ExploreGlobalFilters last known options", () => {
  it("opens with the last known services after a reload, then shows the fresh list", async () => {
    const cache = memoryFilterOptionsCache([
      [
        ["explore", "union-service-options"],
        ["checkout", "web"],
      ],
    ]);
    const fresh = deferred<string[]>();
    renderFilters(new QueryClient(), cache, { services: fresh.promise, timeRange: hourAgo });

    await userEvent.click(screen.getByRole("combobox", { name: /Service/ }));

    expect(await screen.findByText("checkout")).toBeInTheDocument();
    expect(screen.getByText("web")).toBeInTheDocument();

    fresh.resolve(["api", "web"]);

    expect(await screen.findByText("api")).toBeInTheDocument();
    expect(screen.queryByText("checkout")).not.toBeInTheDocument();
  });

  it("keeps the previous list while a new time range loads", async () => {
    const cache = memoryFilterOptionsCache();
    const queryClient = new QueryClient();
    const view = renderFilters(queryClient, cache, {
      services: Promise.resolve(["api"]),
      timeRange: hourAgo,
    });
    await userEvent.click(screen.getByRole("combobox", { name: /Service/ }));
    expect(await screen.findByText("api")).toBeInTheDocument();

    const wider = deferred<string[]>();
    view.rerender({ services: wider.promise, timeRange: dayAgo });

    expect(screen.getByText("api")).toBeInTheDocument();

    wider.resolve(["api", "batch"]);
    expect(await screen.findByText("batch")).toBeInTheDocument();
  });
});
