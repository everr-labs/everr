import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { assert, describe, expect, it, vi } from "vitest";
import type { Span } from "@/data/runs";
import { TraceWaterfall } from "./trace-waterfall";

// Mock resizable panels — react-resizable-panels needs browser layout APIs
vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResizablePanel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResizableHandle: () => <div />,
}));

function makeSpan(overrides: Partial<Span> & { spanId: string }): Span {
  return {
    parentSpanId: "",
    name: "test",
    startTime: 0,
    endTime: 1000,
    duration: 1000,
    conclusion: "success",
    ...overrides,
  };
}

const flatSpans: Span[] = [
  makeSpan({
    spanId: "a",
    name: "Job A",
    startTime: 0,
    endTime: 500,
    duration: 500,
  }),
  makeSpan({
    spanId: "b",
    name: "Job B",
    startTime: 200,
    endTime: 800,
    duration: 600,
  }),
];

const hierarchicalSpans: Span[] = [
  makeSpan({
    spanId: "root",
    name: "Root Span",
    startTime: 0,
    endTime: 2000,
    duration: 2000,
  }),
  makeSpan({
    spanId: "child1",
    parentSpanId: "root",
    name: "Child One",
    startTime: 0,
    endTime: 500,
    duration: 500,
  }),
  makeSpan({
    spanId: "child2",
    parentSpanId: "root",
    name: "Child Two",
    startTime: 500,
    endTime: 2000,
    duration: 1500,
  }),
];

describe("TraceWaterfall", () => {
  it("renders span names", () => {
    render(<TraceWaterfall spans={flatSpans} traceId="t1" />);
    expect(screen.getByRole("button", { name: /Job A/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Job B/ })).toBeInTheDocument();
  });

  it("renders duration labels", () => {
    render(<TraceWaterfall spans={flatSpans} traceId="t1" />);
    expect(screen.getByText("500ms")).toBeInTheDocument();
    expect(screen.getByText("600ms")).toBeInTheDocument();
  });

  it("shows zero-duration markers when totalDuration is 0", () => {
    const zeroSpans = [
      makeSpan({
        spanId: "z",
        name: "Zero",
        startTime: 100,
        endTime: 100,
        duration: 0,
      }),
    ];
    render(<TraceWaterfall spans={zeroSpans} traceId="t1" />);
    expect(screen.getByRole("button", { name: /Zero/ })).toBeInTheDocument();
  });

  describe("Expand / Collapse", () => {
    it("Collapse All hides children", async () => {
      const user = userEvent.setup();
      render(<TraceWaterfall spans={hierarchicalSpans} traceId="t1" />);

      // Children visible initially
      expect(
        screen.getByRole("button", { name: /Child One/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Child Two/ }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /Collapse All/ }));

      expect(
        screen.queryByRole("button", { name: /Child One/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Child Two/ }),
      ).not.toBeInTheDocument();
      // Root is still visible
      expect(
        screen.getByRole("button", { name: /Root Span/ }),
      ).toBeInTheDocument();
    });

    it("Expand All restores children after collapse", async () => {
      const user = userEvent.setup();
      render(<TraceWaterfall spans={hierarchicalSpans} traceId="t1" />);

      await user.click(screen.getByRole("button", { name: /Collapse All/ }));
      expect(
        screen.queryByRole("button", { name: /Child One/ }),
      ).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /Expand All/ }));
      expect(
        screen.getByRole("button", { name: /Child One/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Child Two/ }),
      ).toBeInTheDocument();
    });
  });

  describe("Focus feature", () => {
    it("each span row has a focus button", () => {
      render(<TraceWaterfall spans={flatSpans} traceId="t1" />);
      expect(
        screen.getAllByRole("button", { name: "Focus on this span" }),
      ).toHaveLength(2);
    });

    it("clicking focus shows the span name in a toolbar badge", async () => {
      const user = userEvent.setup();
      render(<TraceWaterfall spans={flatSpans} traceId="t1" />);

      // No badge initially
      expect(
        screen.queryByRole("button", { name: "Clear focus" }),
      ).not.toBeInTheDocument();

      const focusButtons = screen.getAllByRole("button", {
        name: "Focus on this span",
      });
      await user.click(focusButtons[0]);

      // Badge appears with the focused span's name
      const clearButton = screen.getByRole("button", {
        name: "Clear focus",
      });
      const badge = clearButton.closest("[data-slot='badge']");
      assert(badge instanceof HTMLElement, "expected badge element");
      expect(within(badge).getByText("Job A")).toBeInTheDocument();
    });

    it("clicking Clear focus removes the badge", async () => {
      const user = userEvent.setup();
      render(<TraceWaterfall spans={flatSpans} traceId="t1" />);

      const focusButtons = screen.getAllByRole("button", {
        name: "Focus on this span",
      });
      await user.click(focusButtons[0]);

      await user.click(screen.getByRole("button", { name: "Clear focus" }));
      expect(
        screen.queryByRole("button", { name: "Clear focus" }),
      ).not.toBeInTheDocument();
    });

    it("time markers update to reflect focused span duration", async () => {
      const user = userEvent.setup();
      // Total range = 700ms. Markers at: 0, 140, 280, 420, 560, 700ms
      // Span X duration = 400ms is NOT a marker value, so no collision
      // After focusing Span X: markers at: 0, 80, 160, 240, 320, 400ms
      const spans: Span[] = [
        makeSpan({
          spanId: "x",
          name: "Span X",
          startTime: 0,
          endTime: 400,
          duration: 400,
        }),
        makeSpan({
          spanId: "y",
          name: "Span Y",
          startTime: 100,
          endTime: 700,
          duration: 600,
        }),
      ];
      render(<TraceWaterfall spans={spans} traceId="t1" />);

      // Before focus: the last marker is "700ms"
      expect(screen.getByText("700ms")).toBeInTheDocument();

      // Focus on Span X (400ms)
      const focusButtons = screen.getAllByRole("button", {
        name: "Focus on this span",
      });
      await user.click(focusButtons[0]);

      // After focus: markers should reflect 400ms range, not 700ms
      expect(screen.queryByText("700ms")).not.toBeInTheDocument();
      expect(screen.getAllByText("400ms").length).toBeGreaterThanOrEqual(1);
    });

    it("focusing a different span replaces the badge", async () => {
      const user = userEvent.setup();
      render(<TraceWaterfall spans={flatSpans} traceId="t1" />);

      const focusButtons = screen.getAllByRole("button", {
        name: "Focus on this span",
      });

      // Focus on Job A
      await user.click(focusButtons[0]);
      const clearButton = screen.getByRole("button", {
        name: "Clear focus",
      });
      const badge = clearButton.closest("[data-slot='badge']");
      assert(badge instanceof HTMLElement, "expected badge element");
      expect(within(badge).getByText("Job A")).toBeInTheDocument();

      // Focus on Job B instead
      await user.click(focusButtons[1]);
      expect(within(badge).queryByText("Job A")).not.toBeInTheDocument();
      expect(within(badge).getByText("Job B")).toBeInTheDocument();
    });
  });

  describe("Duration filter", () => {
    const mixedSpans: Span[] = [
      makeSpan({
        spanId: "fast",
        name: "Fast Span",
        startTime: 0,
        endTime: 100,
        duration: 100,
      }),
      makeSpan({
        spanId: "medium",
        name: "Medium Span",
        startTime: 0,
        endTime: 500,
        duration: 500,
      }),
      makeSpan({
        spanId: "slow",
        name: "Slow Span",
        startTime: 0,
        endTime: 1000,
        duration: 1000,
      }),
    ];

    it("hides spans below the minimum duration", async () => {
      const user = userEvent.setup();
      render(<TraceWaterfall spans={mixedSpans} traceId="t1" />);

      const input = screen.getByLabelText("Minimum duration");
      await user.type(input, "500ms");

      expect(
        screen.queryByRole("button", { name: /Fast Span/ }),
      ).not.toBeInTheDocument();
    });

    it("keeps spans at or above the threshold visible", async () => {
      const user = userEvent.setup();
      render(<TraceWaterfall spans={mixedSpans} traceId="t1" />);

      const input = screen.getByLabelText("Minimum duration");
      await user.type(input, "500ms");

      expect(
        screen.getByRole("button", { name: /Medium Span/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Slow Span/ }),
      ).toBeInTheDocument();
    });

    it("filters using seconds notation", async () => {
      const user = userEvent.setup();
      render(<TraceWaterfall spans={mixedSpans} traceId="t1" />);

      const input = screen.getByLabelText("Minimum duration");
      await user.type(input, "1s");

      expect(
        screen.queryByRole("button", { name: /Fast Span/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Medium Span/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Slow Span/ }),
      ).toBeInTheDocument();
    });

    it("clearing the filter restores all spans", async () => {
      const user = userEvent.setup();
      render(<TraceWaterfall spans={mixedSpans} traceId="t1" />);

      const input = screen.getByLabelText("Minimum duration");
      await user.type(input, "500ms");

      expect(
        screen.queryByRole("button", { name: /Fast Span/ }),
      ).not.toBeInTheDocument();

      await user.clear(input);

      expect(
        screen.getByRole("button", { name: /Fast Span/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Medium Span/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Slow Span/ }),
      ).toBeInTheDocument();
    });

    it("shows filtered span count when filter is active", async () => {
      const user = userEvent.setup();
      render(<TraceWaterfall spans={mixedSpans} traceId="t1" />);

      const input = screen.getByLabelText("Minimum duration");
      await user.type(input, "500ms");

      expect(screen.getByText("2 of 3 spans")).toBeInTheDocument();
    });

    it("treats plain numbers as milliseconds", async () => {
      const user = userEvent.setup();
      render(<TraceWaterfall spans={mixedSpans} traceId="t1" />);

      const input = screen.getByLabelText("Minimum duration");
      await user.type(input, "500");

      expect(
        screen.queryByRole("button", { name: /Fast Span/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Medium Span/ }),
      ).toBeInTheDocument();
    });
  });

  describe("Framework icons", () => {
    it("renders a framework icon for spans with testFramework", () => {
      const spans: Span[] = [
        makeSpan({
          spanId: "t1",
          name: "TestAdd",
          testFramework: "vitest",
        }),
        makeSpan({
          spanId: "t2",
          name: "Job A",
        }),
      ];
      render(<TraceWaterfall spans={spans} traceId="t1" />);

      const icons = screen.getAllByRole("img");
      expect(icons).toHaveLength(1);
    });
  });

  describe("Selection", () => {
    it("clicking a span opens the detail panel", async () => {
      const user = userEvent.setup();
      render(<TraceWaterfall spans={flatSpans} traceId="t1" />);

      expect(
        screen.queryByRole("heading", { name: "Job A" }),
      ).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /Job A/ }));
      expect(
        screen.getByRole("heading", { name: "Job A" }),
      ).toBeInTheDocument();
    });

    it("clicking the same span again closes the detail panel", async () => {
      const user = userEvent.setup();
      render(<TraceWaterfall spans={flatSpans} traceId="t1" />);

      await user.click(screen.getByRole("button", { name: /Job A/ }));
      expect(
        screen.getByRole("heading", { name: "Job A" }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /Job A/ }));
      expect(
        screen.queryByRole("heading", { name: "Job A" }),
      ).not.toBeInTheDocument();
    });

    it("shows suite and subtest types independently in the detail panel", async () => {
      const user = userEvent.setup();
      const spans: Span[] = [
        makeSpan({
          spanId: "suite-subtest",
          name: "Nested Suite",
          testName: "src/test.ts > outer > inner",
          testResult: "pass",
          testFramework: "vitest",
          isSuite: true,
          isSubtest: true,
        }),
      ];

      render(<TraceWaterfall spans={spans} traceId="t1" />);

      await user.click(screen.getByRole("button", { name: /Nested Suite/ }));

      expect(screen.getByText("Suite, Subtest")).toBeInTheDocument();
    });
  });
});
