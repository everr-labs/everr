import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TracesRepositoryLike } from "../../data/repository";
import type { Span } from "../../data/types";
import type { TraceNode } from "./trace-model";
import { TraceExplorer, type TraceExplorerProps } from "./trace-viewer";

vi.mock("./waterfall", () => ({
  TraceWaterfall: ({
    rows,
    selectedSpanId,
    onSelect,
  }: {
    rows: TraceNode[];
    selectedSpanId?: string;
    onSelect: (id: string) => void;
  }) => (
    <div>
      {rows.map((row) => (
        <button
          key={row.spanId}
          type="button"
          aria-pressed={selectedSpanId === row.spanId}
          onClick={() => onSelect(row.spanId)}
        >
          Select {row.name}
        </button>
      ))}
    </div>
  ),
}));

function span(id: string, parentSpanId = ""): Span {
  return {
    traceId: "trace-1",
    spanId: id,
    parentSpanId,
    spanName: id,
    serviceName: "local-api",
    serviceNamespace: "",
    timestamp: "2026-10-06 12:00:00.000",
    timestampNs: "1791288000000000000",
    duration: "1000000",
    statusCode: "Ok",
    spanKind: "Internal",
    spanAttributes: {},
    resourceAttributes: {},
    events: [],
    links: [],
  };
}

function renderExplorer(search: TraceExplorerProps["search"] = {}) {
  const repo: TracesRepositoryLike = {
    getTrace: vi.fn(async () => [span("root"), span("child", "root")]),
    search: vi.fn(async () => []),
    listServiceIdentities: vi.fn(async () => []),
    attributeKeys: vi.fn(async () => []),
    attributeValues: vi.fn(async () => []),
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const props: TraceExplorerProps = {
    repo,
    traceId: "trace-1",
    search: {
      start: "2026-10-06 12:00:00.000",
      end: "2026-10-06 12:00:01.000",
      ...search,
    },
    onSpanChange: vi.fn(),
    onBack: vi.fn(),
  };
  const ui = (spanId?: string) => (
    <QueryClientProvider client={client}>
      <TraceExplorer {...props} search={{ ...props.search, span: spanId }} />
    </QueryClientProvider>
  );
  const result = render(ui(search.span));
  return {
    repo,
    props,
    rerender: (spanId?: string) => result.rerender(ui(spanId)),
  };
}

describe("shared trace explorer", () => {
  it("returns to the trace list through the host's back callback", async () => {
    const { props } = renderExplorer();
    await screen.findByRole("heading", { name: "root" });
    fireEvent.click(screen.getByRole("button", { name: "Back to traces" }));
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it("loads from the supplied repository and preserves the bounded detail window", async () => {
    const { repo } = renderExplorer();
    expect(
      await screen.findByRole("heading", { name: "root" }),
    ).toBeInTheDocument();
    expect(repo.getTrace).toHaveBeenCalledWith({
      traceId: "trace-1",
      fromTs: "2026-10-06 11:00:00.000",
      toTs: "2026-10-06 13:00:01.000",
    });
    expect(screen.getByRole("button", { name: "Select root" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      screen.queryByRole("complementary", { name: "Span details" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Flamegraph/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("uses URL-controlled selection across both hosts and clears it on close", async () => {
    const { props, rerender } = renderExplorer({ span: "child" });
    const details = await screen.findByRole("complementary", {
      name: "Span details",
    });
    expect(
      within(details).getByRole("heading", { name: "child" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close span details" }));
    expect(props.onSpanChange).toHaveBeenLastCalledWith(undefined);
    rerender();
    expect(
      screen.queryByRole("complementary", { name: "Span details" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select root" }));
    expect(props.onSpanChange).toHaveBeenLastCalledWith("root");
    rerender("root");
    expect(screen.getByRole("button", { name: "Select root" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("complementary", { name: "Span details" }),
    ).toBeInTheDocument();
  });
});
