import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { SeriesChart } from "./series-chart";

vi.mock("echarts/core", async (importOriginal) =>
  (await import("../testing/echarts")).ssrEChartsCore(importOriginal),
);

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

it("shows the hovered point with each series in its own axis format", () => {
  const { container } = render(
    <SeriesChart
      labels={["Mon", "Tue", "Wed"]}
      titles={["Monday", "Tuesday", "Wednesday"]}
      axes={{
        left: { format: (value) => `${value}%`, min: 0, max: 100 },
        right: { format: (value) => `${value} runs` },
      }}
      series={[
        {
          id: "runs",
          label: "Runs",
          color: "#36c",
          kind: "bar",
          values: [10, 20, 30],
          rightAxis: true,
        },
        { id: "rate", label: "Success", color: "#3a3", kind: "line", values: [90, 80, 70] },
      ]}
    />,
  );

  // The SSR chart is 600px wide, so the last third of it is Wednesday.
  fireEvent.pointerMove(container.firstChild!, { clientX: 520, clientY: 150 });

  expect(screen.getByText("Wednesday")).toBeInTheDocument();
  expect(screen.getByText("30 runs")).toBeInTheDocument();
  expect(screen.getByText("70%")).toBeInTheDocument();
});

it("selects the points dragged across, and nothing on a click or a vertical wobble", () => {
  Element.prototype.setPointerCapture ??= () => {};
  const onSelect = vi.fn();
  const { container } = render(
    <SeriesChart
      labels={["Mon", "Tue", "Wed"]}
      axes={{ left: { format: String } }}
      series={[{ id: "a", label: "A", color: "#36c", kind: "line", values: [1, 2, 3] }]}
      onSelect={onSelect}
    />,
  );
  const chart = container.firstChild!;
  const press = { pointerType: "mouse", button: 0, clientY: 150 };

  fireEvent.pointerDown(chart, { ...press, clientX: 300 });
  fireEvent.pointerUp(chart, { ...press, clientX: 300 });
  fireEvent.pointerDown(chart, { ...press, clientX: 300 });
  fireEvent.pointerMove(chart, { ...press, clientX: 300, clientY: 190 });
  fireEvent.pointerUp(chart, { ...press, clientX: 300, clientY: 190 });
  expect(onSelect).not.toHaveBeenCalled();

  fireEvent.pointerDown(chart, { ...press, clientX: 100 });
  fireEvent.pointerMove(chart, { ...press, clientX: 300 });
  fireEvent.pointerUp(chart, { ...press, clientX: 300 });
  expect(onSelect).toHaveBeenCalledWith(0, 1);
});
