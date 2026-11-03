import { fireEvent, render, screen } from "@testing-library/react";
import { startTransition, Suspense, useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import type { Panel } from "#app/data/dashboards/schema.ts";
import type { DashboardPanelData } from "./use-dashboard-panel-data";
import { useRetainedPanelData } from "./use-retained-panel-data";

const panel: Panel = { kind: "Panel", spec: { plugin: { kind: "StatChart", spec: {} } } };
const otherPanel: Panel = { kind: "Panel", spec: { plugin: { kind: "Table", spec: {} } } };

function result(value: number, status: "success" | "pending" = "success"): DashboardPanelData {
  return {
    status,
    data: status === "success" ? [[{ value }]] : undefined,
    timeRange: { from: new Date(value * 1000), to: new Date((value + 1) * 1000) },
  };
}

interface View {
  panel: Panel;
  data: DashboardPanelData;
  suspend?: boolean;
}

const never = new Promise<never>(() => {});

describe("useRetainedPanelData", () => {
  it("handles a recreated batch wrapper without repeatedly updating state", () => {
    const rows = [{ value: 1 }];
    function Example() {
      const data = useRetainedPanelData(panel, {
        status: "success",
        data: [rows],
        timeRange: { from: new Date(1000), to: new Date(2000) },
      });
      return <output>{data.data?.[0]?.[0]?.value}</output>;
    }
    const { rerender } = render(<Example />);
    rerender(<Example />);
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("retains a complete batch and its range while loading, but not for a different panel", () => {
    function Example({ view }: { view: View }) {
      const data = useRetainedPanelData(view.panel, view.data);
      return (
        <output>{`${data.status}:${data.data?.[0]?.[0]?.value ?? "none"}:${data.timeRange.from.getTime()}`}</output>
      );
    }
    const { rerender } = render(<Example view={{ panel, data: result(1) }} />);
    rerender(<Example view={{ panel, data: result(2, "pending") }} />);
    expect(screen.getByText("success:1:1000")).toBeInTheDocument();
    rerender(<Example view={{ panel, data: result(2) }} />);
    rerender(<Example view={{ panel, data: result(3, "pending") }} />);
    expect(screen.getByText("success:2:2000")).toBeInTheDocument();
    rerender(<Example view={{ panel: otherPanel, data: result(3, "pending") }} />);
    expect(screen.getByText("pending:none:3000")).toBeInTheDocument();
  });

  it("does not retain a successful result from a render that suspends and is abandoned", () => {
    const attempted = vi.fn();
    function PanelResult({ view }: { view: View }) {
      const data = useRetainedPanelData(view.panel, view.data);
      if (view.suspend) {
        attempted();
        throw never;
      }
      return (
        <output>{`${data.status}:${data.data?.[0]?.[0]?.value ?? "none"}:${data.timeRange.from.getTime()}`}</output>
      );
    }
    function Example() {
      const [view, setView] = useState<View>({ panel, data: result(1) });
      return (
        <>
          <button
            type="button"
            onClick={() =>
              startTransition(() => setView({ panel, data: result(2), suspend: true }))
            }
          >
            Start suspended render
          </button>
          <button type="button" onClick={() => setView({ panel, data: result(3, "pending") })}>
            Start pending render
          </button>
          <Suspense fallback="Loading">
            <PanelResult view={view} />
          </Suspense>
        </>
      );
    }
    render(<Example />);
    fireEvent.click(screen.getByRole("button", { name: "Start suspended render" }));
    expect(attempted).toHaveBeenCalled();
    expect(screen.getByText("success:1:1000")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start pending render" }));
    expect(screen.getByText("success:1:1000")).toBeInTheDocument();
  });
});
