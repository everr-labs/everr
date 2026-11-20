import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { TimeRangePicker } from "./time-range-picker";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// Today until five hours ago: nothing before 05:00.
const range = { from: "now/d", to: "now-5h" };

function showAt(time: string) {
  vi.stubEnv("TZ", "UTC");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(time));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TimeRangePicker value={range} onChange={() => {}} />
    </QueryClientProvider>,
  );
}

describe("TimeRangePicker", () => {
  it("says when the range ends before it starts", () => {
    showAt("2026-11-19T02:00:00Z");
    expect(screen.getByRole("button", { name: /ends before it starts/ })).toBeTruthy();
  });

  it("says nothing once the range holds time", () => {
    showAt("2026-11-19T15:00:00Z");
    expect(screen.queryByRole("button", { name: /ends before it starts/ })).toBeNull();
  });

  it("checks again when the page refreshes, without updating mid-render", async () => {
    const errors = vi.spyOn(console, "error");
    vi.stubEnv("TZ", "UTC");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-19T04:59:00Z"));
    const client = new QueryClient();
    const page = (refresh: number) => (
      <QueryClientProvider client={client}>
        <TimeRangePicker value={range} onChange={() => {}} />
        <Chart refresh={refresh} />
      </QueryClientProvider>
    );
    const { rerender } = render(page(0));
    vi.setSystemTime(new Date("2026-11-19T05:01:00Z"));
    rerender(page(1));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /ends before it starts/ })).toBeNull(),
    );
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("TimeRangePicker's tooltip", () => {
  it("shows the endpoints it checked, after a refresh past midnight", async () => {
    vi.stubEnv("TZ", "UTC");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-19T23:59:00Z"));
    const client = new QueryClient();
    const page = (refresh: number) => (
      <QueryClientProvider client={client}>
        <TimeRangePicker value={range} onChange={() => {}} />
        <Chart refresh={refresh} />
      </QueryClientProvider>
    );
    const { rerender } = render(page(0));
    vi.setSystemTime(new Date("2026-11-20T00:01:00Z"));
    rerender(page(1));
    const button = await screen.findByRole("button", { name: /ends before it starts/ });
    fireEvent.mouseEnter(button);
    fireEvent.focus(button);

    expect((await screen.findByText(/Ends before it starts:/)).textContent).toContain("Nov 20");
  });
});

// A page's query, fetched again under a new key on each refresh.
function Chart({ refresh }: { refresh: number }) {
  useQuery({ queryKey: ["chart", refresh], queryFn: async () => refresh });
  return null;
}
