import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TracesRepositoryLike } from "../../data/repository";
import type { Span } from "../../data/types";
import type { TraceNode } from "./model";
import * as processor from "./processor";
import { TraceExplorer, type TraceExplorerProps } from "./viewer";

vi.mock("./flamegraph", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./flamegraph")>()),
  TraceFlamegraph: () => <div data-testid="flamegraph" />,
}));

afterEach(() => vi.restoreAllMocks());

vi.mock("./waterfall", () => ({
  TraceWaterfall: ({
    rows,
    selectedSpanId,
    onSelect,
    openNodes,
    onToggle,
  }: {
    rows: TraceNode[];
    selectedSpanId?: string;
    onSelect: (id: string) => void;
    openNodes: Set<string>;
    onToggle: (id: string) => void;
  }) => (
    <div>
      {rows.map((row) => (
        <div key={row.spanId}>
          {row.hasChildren && (
            <button
              type="button"
              aria-expanded={openNodes.has(row.spanId)}
              onClick={() => onToggle(row.spanId)}
            >
              Toggle {row.name}
            </button>
          )}
          <button
            type="button"
            aria-pressed={selectedSpanId === row.spanId}
            onClick={() => onSelect(row.spanId)}
          >
            Select {row.name}
          </button>
        </div>
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

function renderExplorer(
  search: TraceExplorerProps["search"] = {},
  spans = [span("root"), span("child", "root")],
) {
  const repo: TracesRepositoryLike = {
    getTrace: vi.fn(async () => spans),
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
    client,
    rerender: (spanId?: string) => result.rerender(ui(spanId)),
  };
}

describe("shared trace explorer", () => {
  it("expands new parents after a refresh while preserving existing choices", async () => {
    const initial = [
      span("root"),
      span("child", "root"),
      span("open"),
      span("open-child", "open"),
      span("leaf"),
    ];
    const { client } = renderExplorer({}, initial);
    await screen.findByRole("button", { name: "Select child" });
    fireEvent.click(screen.getByRole("button", { name: "Toggle root" }));
    expect(
      screen.queryByRole("button", { name: "Select child" }),
    ).not.toBeInTheDocument();

    const traceQuery = client
      .getQueryCache()
      .find({ queryKey: ["traces", "get"], exact: false });
    expect(traceQuery).toBeDefined();
    if (!traceQuery) throw new Error("Trace query was not cached");
    await act(async () => {
      client.setQueryData(
        traceQuery.queryKey,
        [
          ...initial,
          span("new"),
          span("new-child", "new"),
          span("leaf-child", "leaf"),
        ],
        { updatedAt: traceQuery.state.dataUpdatedAt + 1 },
      );
    });

    expect(
      await screen.findByRole("button", { name: "Select new-child" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Select leaf-child" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle root" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      screen.queryByRole("button", { name: "Select child" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle open" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "Select open-child" }),
    ).toBeInTheDocument();
  });

  it("prepares flamegraph layout on demand and reuses it across toggles and selection", async () => {
    const prepareLayout = vi.spyOn(processor, "prepareTraceLayout");
    const { rerender } = renderExplorer();
    await screen.findByRole("heading", { name: "root" });
    expect(prepareLayout).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Flamegraph/ }));
    await screen.findByTestId("flamegraph");
    expect(prepareLayout).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Flamegraph/ }));
    expect(screen.queryByTestId("flamegraph")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Flamegraph/ }));
    await screen.findByTestId("flamegraph");
    rerender("child");
    await screen.findByRole("complementary", { name: "Span details" });
    expect(prepareLayout).toHaveBeenCalledTimes(1);
  });

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
