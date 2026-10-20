import {
  QueryClient,
  QueryClientProvider,
  type QueryKey,
  useQuery,
} from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ExploreShell } from "./explore-shell";

vi.mock("../app-shell/title-bar", () => ({
  PageTitleBar: ({ actions }: { actions: ReactNode }) => actions,
}));

vi.mock("@everr/ui/components/time-range-picker", () => ({
  TimeRangePicker: () => null,
}));

vi.mock("@everr/ui/components/refresh-picker", () => ({
  RefreshPicker: ({
    onRefresh,
    isFetching,
  }: {
    onRefresh: () => void;
    isFetching: boolean;
  }) => (
    <button type="button" aria-busy={isFetching} onClick={onRefresh}>
      Refresh
    </button>
  ),
}));

function QueryProbe({
  queryKey,
  queryFn,
}: {
  queryKey: QueryKey;
  queryFn: () => Promise<string>;
}) {
  useQuery({ queryKey, queryFn });
  return null;
}

describe("Explore refresh", () => {
  it("refreshes telemetry without including background collector status polling", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const statusKey = ["local-app", "collector-status"];
    client.setQueryData(statusKey, "running");
    let finishStatus = () => {};
    const pendingStatus = new Promise<string>((resolve) => {
      finishStatus = () => resolve("running");
    });
    const status = vi.fn(() => pendingStatus);
    const telemetry = vi.fn().mockResolvedValue("fresh telemetry");
    const view = render(
      <QueryClientProvider client={client}>
        <ExploreShell
          title="Logs"
          timeRange={{ from: "now-7d", to: "now" }}
          refresh="off"
          onTimeRangeChange={vi.fn()}
          onRefreshChange={vi.fn()}
        >
          <QueryProbe queryKey={["logs", "explorer"]} queryFn={telemetry} />
          <QueryProbe queryKey={statusKey} queryFn={status} />
        </ExploreShell>
      </QueryClientProvider>,
    );
    const refresh = screen.getByRole("button", { name: "Refresh" });
    await waitFor(() => expect(status).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refresh).toHaveAttribute("aria-busy", "false"));
    fireEvent.click(refresh);
    await waitFor(() => expect(telemetry).toHaveBeenCalledTimes(2));
    expect(status).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveAttribute("aria-busy", "false");
    await act(async () => finishStatus());
    view.unmount();
    client.clear();
  });
});
