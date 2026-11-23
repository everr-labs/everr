import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vite-plus/test";
import { appQueryOptions, dataQueryOptions, useIsFetchingData } from "./query-options";
import { REFRESH_KEYED } from "./refresh-epoch";

const never = () => new Promise<never>(() => {});

function renderWhile(useLoad: () => void) {
  function Probe() {
    useLoad();
    return <span>{useIsFetchingData() ? "loading data" : "idle"}</span>;
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Probe />
    </QueryClientProvider>,
  );
}

it("reports a data query loading", async () => {
  renderWhile(() => useQuery(dataQueryOptions({ queryKey: ["logs"], queryFn: never })));
  expect(await screen.findByText("loading data")).toBeTruthy();
});

it("keeps a data query's own meta, such as a refresh-keyed chart", async () => {
  const options = dataQueryOptions({ queryKey: ["panel"], queryFn: never, ...REFRESH_KEYED });
  expect(options.meta?.refreshKeyed).toBe(true);
  renderWhile(() => useQuery(options));
  expect(await screen.findByText("loading data")).toBeTruthy();
});

it("ignores app queries, such as session or settings reads", async () => {
  renderWhile(() => useQuery(appQueryOptions({ queryKey: ["session"], queryFn: never })));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.getByText("idle")).toBeTruthy();
});
