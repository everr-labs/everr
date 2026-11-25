import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { MetricCatalog } from "./metric-catalog";

const cpu = {
  name: "cpu",
  type: "gauge",
  unit: "",
  description: "",
  isMonotonic: false,
  temporality: 0,
  points: 3,
  lastSeen: "2026-05-20 12:00:00",
} as const;

function catalog(props: Partial<ComponentProps<typeof MetricCatalog>>) {
  return (
    <MetricCatalog
      rows={[]}
      isPending={false}
      error={null}
      onRetry={() => {}}
      empty={<p>Nothing here</p>}
      renderMetricLink={({ metric, className, children }) => (
        <a href={`#${metric}`} className={className}>
          {children}
        </a>
      )}
      {...props}
    />
  );
}

describe("MetricCatalog", () => {
  it("keeps the loaded rows when a refresh fails, with a retry above them", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const failed = { error: new Error("ClickHouse is down"), onRetry };
    const { rerender } = render(catalog(failed));
    expect(screen.getByText("Couldn't load metrics")).toBeInTheDocument();

    rerender(catalog({ ...failed, rows: [cpu] }));
    expect(screen.getByRole("link", { name: "cpu" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't refresh metrics: ClickHouse is down",
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
