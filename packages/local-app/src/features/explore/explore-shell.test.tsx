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
  it("refreshes telemetry without including background account polling", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const accountKey = ["local-app", "auth-status"];
    client.setQueryData(accountKey, "signed out");
    let finishAccount = () => {};
    const pendingAccount = new Promise<string>((resolve) => {
      finishAccount = () => resolve("signed out");
    });
    const account = vi.fn(() => pendingAccount);
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
          <QueryProbe queryKey={accountKey} queryFn={account} />
        </ExploreShell>
      </QueryClientProvider>,
    );
    const refresh = screen.getByRole("button", { name: "Refresh" });
    await waitFor(() => expect(account).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refresh).toHaveAttribute("aria-busy", "false"));
    fireEvent.click(refresh);
    await waitFor(() => expect(telemetry).toHaveBeenCalledTimes(2));
    expect(account).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveAttribute("aria-busy", "false");
    await act(async () => finishAccount());
    view.unmount();
    client.clear();
  });
});
