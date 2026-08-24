import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { OrgUsage, OrgUsageSeriesPoint } from "@/data/usage";
import { BYTES_PER_GB } from "@/lib/usage-limits";
import { UsageSection } from "./usage-section";

vi.mock("@everr/ui/components/chart", () => ({
  ChartContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="chart-container">{children}</div>
  ),
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
  ChartLegend: () => null,
  ChartLegendContent: () => null,
}));

vi.mock("recharts", () => {
  return {
    BarChart: ({
      children,
      data,
    }: {
      children: ReactNode;
      data: unknown[];
    }) => (
      <div data-testid="usage-bar-chart" data-points={JSON.stringify(data)}>
        {children}
      </div>
    ),
    Bar: ({ dataKey }: { dataKey: string }) => (
      <span data-testid={`usage-bar-${dataKey}`} />
    ),
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

const period = {
  from: new Date("2026-08-01T00:00:00.000Z"),
  to: new Date("2026-09-01T00:00:00.000Z"),
};

describe("UsageSection", () => {
  it("renders partial Free usage with zero cards for missing signals", () => {
    const totals: OrgUsage[] = [
      { meter: "logs", bytes: BYTES_PER_GB, items: 1_200 },
    ];
    const series: OrgUsageSeriesPoint[] = [
      {
        date: "2026-08-12",
        meter: "logs",
        bytes: BYTES_PER_GB,
        items: 1_200,
      },
    ];

    render(
      <UsageSection
        tier="free"
        period={period}
        totals={totals}
        series={series}
      />,
    );

    expect(screen.getByText("Aug 1 to Aug 31, 2026 (UTC)")).toBeVisible();
    const logs = within(screen.getByTestId("usage-card-logs"));
    expect(logs.getByText("1 GB")).toBeVisible();
    expect(logs.getByText("of 5 GB included")).toBeVisible();
    expect(logs.getByText("1,200 items ingested")).toBeVisible();

    const traces = within(screen.getByTestId("usage-card-traces"));
    expect(traces.getByText("0 B")).toBeVisible();
    expect(traces.getByText("0 items ingested")).toBeVisible();
    expect(screen.queryByText(/estimated overage/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("usage-bar-chart")).toBeInTheDocument();
  });

  it("shows Pro overage independently for each signal", () => {
    render(
      <UsageSection
        tier="pro"
        period={period}
        totals={[
          {
            meter: "traces",
            bytes: 105.5 * BYTES_PER_GB,
            items: 42,
          },
        ]}
        series={[
          {
            date: "2026-08-03",
            meter: "traces",
            bytes: 105.5 * BYTES_PER_GB,
            items: 42,
          },
        ]}
      />,
    );

    const traces = within(screen.getByTestId("usage-card-traces"));
    expect(traces.getByText("105.5 GB")).toBeVisible();
    expect(traces.getByText(/5.5 GB overage/)).toHaveTextContent(
      "5.5 GB overage, $2.20 estimated",
    );

    const logs = within(screen.getByTestId("usage-card-logs"));
    expect(logs.getByText("No estimated overage")).toBeVisible();
  });

  it("renders an explicit empty state while preserving zero summaries", () => {
    render(<UsageSection tier="free" period={period} />);

    expect(screen.getByText("No metered usage in this period")).toBeVisible();
    expect(screen.getAllByText("0 B")).toHaveLength(3);
  });

  it("renders loading and error states", () => {
    const { rerender } = render(
      <UsageSection
        tier="free"
        period={period}
        totalsStatus="pending"
        seriesStatus="pending"
      />,
    );

    expect(screen.getByRole("status", { name: "Loading usage" })).toBeVisible();
    expect(screen.queryByTestId("usage-card-logs")).not.toBeInTheDocument();

    rerender(
      <UsageSection
        tier="free"
        period={period}
        totalsStatus="error"
        seriesStatus="error"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Usage is temporarily unavailable",
    );
  });

  it("keeps successful totals when only the daily series fails", () => {
    render(
      <UsageSection
        tier="free"
        period={period}
        totals={[{ meter: "logs", bytes: BYTES_PER_GB, items: 12 }]}
        series={[
          {
            date: "2026-08-12",
            meter: "logs",
            bytes: 99 * BYTES_PER_GB,
            items: 999,
          },
        ]}
        totalsStatus="success"
        seriesStatus="error"
      />,
    );

    expect(
      within(screen.getByTestId("usage-card-logs")).getByText("1 GB"),
    ).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Daily usage is temporarily unavailable",
    );
    expect(screen.queryByTestId("usage-bar-chart")).not.toBeInTheDocument();
  });

  it("keeps a successful chart while hiding stale failed totals", () => {
    render(
      <UsageSection
        tier="free"
        period={period}
        totals={[{ meter: "logs", bytes: 99 * BYTES_PER_GB, items: 999 }]}
        series={[
          {
            date: "2026-08-12",
            meter: "logs",
            bytes: BYTES_PER_GB,
            items: 12,
          },
        ]}
        totalsStatus="error"
        seriesStatus="success"
      />,
    );

    expect(screen.queryByTestId("usage-card-logs")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Usage summary is temporarily unavailable",
    );
    expect(screen.getByTestId("usage-bar-chart")).toBeInTheDocument();
  });
});
