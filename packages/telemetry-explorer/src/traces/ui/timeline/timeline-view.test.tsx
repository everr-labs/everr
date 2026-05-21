import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { assert, describe, expect, it, vi } from "vitest";
import type { Span } from "../../data/types";

vi.mock("react-virtuoso", () => ({
  Virtuoso: <T,>({
    data,
    itemContent,
    computeItemKey,
  }: {
    data: T[];
    itemContent: (index: number, item: T) => React.ReactNode;
    computeItemKey?: (index: number, item: T) => string;
  }) => (
    <div data-testid="virtuoso-mock">
      {data.map((item, i) => (
        <div key={computeItemKey ? computeItemKey(i, item) : i}>
          {itemContent(i, item)}
        </div>
      ))}
    </div>
  ),
}));

import { TimelineView } from "./timeline-view";

function span(overrides: Partial<Span> & { spanId: string }): Span {
  return {
    traceId: "t1",
    parentSpanId: "",
    spanName: overrides.spanId,
    serviceName: "svc",
    serviceNamespace: "",
    timestamp: "2026-05-20 12:00:00.000",
    timestampNs: "1000",
    duration: "100",
    statusCode: "Ok",
    spanKind: "",
    spanAttributes: {},
    resourceAttributes: {},
    events: [],
    links: [],
    ...overrides,
  };
}

const hierarchicalSpans: Span[] = [
  span({ spanId: "root", spanName: "Root Span", timestampNs: "1000" }),
  span({
    spanId: "child1",
    spanName: "Child One",
    parentSpanId: "root",
    timestampNs: "1100",
  }),
  span({
    spanId: "child2",
    spanName: "Child Two",
    parentSpanId: "root",
    timestampNs: "1200",
  }),
];

function Harness({ spans }: { spans: Span[] }) {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  return (
    <TimelineView
      spans={spans}
      focusedSpan={selected}
      onSelectSpan={(id) => setSelected(id || undefined)}
    />
  );
}

describe("TimelineView", () => {
  it("renders rows for every span in the fixture", () => {
    render(<Harness spans={hierarchicalSpans} />);
    expect(screen.getByText("Root Span")).toBeInTheDocument();
    expect(screen.getByText("Child One")).toBeInTheDocument();
    expect(screen.getByText("Child Two")).toBeInTheDocument();
  });

  it("collapses and re-expands a subtree", async () => {
    const user = userEvent.setup();
    render(<Harness spans={hierarchicalSpans} />);

    const rootRow = screen.getByText("Root Span").closest("div.grid");
    assert(rootRow instanceof HTMLElement, "expected root row element");
    await user.click(within(rootRow).getByRole("button", { name: "Collapse" }));

    expect(screen.queryByText("Child One")).not.toBeInTheDocument();
    expect(screen.queryByText("Child Two")).not.toBeInTheDocument();
    expect(screen.getByText("Root Span")).toBeInTheDocument();

    await user.click(within(rootRow).getByRole("button", { name: "Expand" }));
    expect(screen.getByText("Child One")).toBeInTheDocument();
    expect(screen.getByText("Child Two")).toBeInTheDocument();
  });

  it("opens SpanDetailPanel with span attributes when a row is selected", async () => {
    const user = userEvent.setup();
    const spans: Span[] = [
      span({
        spanId: "s1",
        spanName: "GET /home",
        spanAttributes: { "http.method": "GET" },
        resourceAttributes: { "service.name": "web" },
      }),
    ];
    render(<Harness spans={spans} />);

    expect(screen.queryByText("http.method")).not.toBeInTheDocument();

    await user.click(screen.getByText("GET /home"));

    expect(screen.getByText("http.method")).toBeInTheDocument();
    expect(screen.getByText("GET")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});
