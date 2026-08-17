import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { assert, describe, expect, it, vi } from "vitest";
import type { Span } from "@/data/runs/schemas";
import { TraceWaterfall } from "./trace-waterfall";

// Mock resizable panels — react-resizable-panels needs browser layout APIs
vi.mock("@everr/ui/components/resizable", () => ({
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

function renderWaterfall(spans: Span[]) {
  const user = userEvent.setup();
  render(<TraceWaterfall spans={spans} traceId="t1" />);
  return user;
}

function getFocusButtons() {
  return screen.getAllByRole("button", { name: "Focus on this span" });
}

function getFocusBadge(): HTMLElement {
  const clearButton = screen.getByRole("button", { name: "Clear focus" });
  const badge = clearButton.closest("[data-slot='badge']");
  assert(badge instanceof HTMLElement, "expected badge element");
  return badge;
}

async function typeMinimumDuration(
  user: ReturnType<typeof userEvent.setup>,
  value: string,
) {
  const input = screen.getByLabelText("Minimum duration");
  await user.type(input, value);
  return input;
}

function expectSpansVisible(...names: string[]) {
  for (const name of names) {
    expect(
      screen.getByRole("button", { name: new RegExp(name) }),
    ).toBeInTheDocument();
  }
}

function expectSpansHidden(...names: string[]) {
  for (const name of names) {
    expect(
      screen.queryByRole("button", { name: new RegExp(name) }),
    ).not.toBeInTheDocument();
  }
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

describe("TraceWaterfall", () => {
  it("renders each span with its duration label", () => {
    renderWaterfall(flatSpans);

    expectSpansVisible("Job A", "Job B");
    expect(screen.getByText("500ms")).toBeInTheDocument();
    expect(screen.getByText("600ms")).toBeInTheDocument();
  });

  it("renders spans when totalDuration is 0", () => {
    renderWaterfall([
      makeSpan({
        spanId: "z",
        name: "Zero",
        startTime: 100,
        endTime: 100,
        duration: 0,
      }),
    ]);

    expect(screen.getByRole("button", { name: /Zero/ })).toBeInTheDocument();
  });

  it("collapses and re-expands every parent span", async () => {
    const user = renderWaterfall(hierarchicalSpans);

    expectSpansVisible("Child One", "Child Two");

    await user.click(screen.getByRole("button", { name: /Collapse All/ }));

    expectSpansHidden("Child One", "Child Two");
    expectSpansVisible("Root Span");

    await user.click(screen.getByRole("button", { name: /Expand All/ }));

    expectSpansVisible("Child One", "Child Two");
  });

  it("focuses a span, replaces the focus, then clears it", async () => {
    const user = renderWaterfall(flatSpans);

    expect(
      screen.queryByRole("button", { name: "Clear focus" }),
    ).not.toBeInTheDocument();

    const focusButtons = getFocusButtons();
    await user.click(focusButtons[0]);

    const badge = getFocusBadge();
    expect(within(badge).getByText("Job A")).toBeInTheDocument();

    await user.click(focusButtons[1]);

    expect(within(badge).queryByText("Job A")).not.toBeInTheDocument();
    expect(within(badge).getByText("Job B")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear focus" }));

    expect(
      screen.queryByRole("button", { name: "Clear focus" }),
    ).not.toBeInTheDocument();
  });

  it("rescales the time markers to the focused span", async () => {
    // Total range = 700ms. Markers at: 0, 140, 280, 420, 560, 700ms
    // Span X duration = 400ms is NOT a marker value, so no collision
    // After focusing Span X: markers at: 0, 80, 160, 240, 320, 400ms
    const user = renderWaterfall([
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
    ]);

    expect(screen.getByText("700ms")).toBeInTheDocument();

    await user.click(getFocusButtons()[0]);

    expect(screen.queryByText("700ms")).not.toBeInTheDocument();
    expect(screen.getAllByText("400ms").length).toBeGreaterThanOrEqual(1);
  });

  it("hides spans below the minimum duration until the filter is cleared", async () => {
    const user = renderWaterfall(mixedSpans);
    const input = await typeMinimumDuration(user, "500ms");

    expectSpansHidden("Fast Span");
    expectSpansVisible("Medium Span", "Slow Span");
    expect(screen.getByText("2 of 3 spans")).toBeInTheDocument();

    await user.clear(input);

    expectSpansVisible("Fast Span", "Medium Span", "Slow Span");
    expect(screen.queryByText("2 of 3 spans")).not.toBeInTheDocument();
  });

  it("toggles the span detail panel when a span is clicked", async () => {
    const user = renderWaterfall(flatSpans);

    await user.click(screen.getByRole("button", { name: /Job A/ }));
    expect(screen.getByRole("heading", { name: "Job A" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Job A/ }));
    expect(
      screen.queryByRole("heading", { name: "Job A" }),
    ).not.toBeInTheDocument();
  });
});
