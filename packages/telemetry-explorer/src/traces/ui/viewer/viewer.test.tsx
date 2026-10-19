import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { type Ref, useImperativeHandle } from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TracesRepositoryLike } from "../../data/repository";
import { TraceDetailParamsSchema } from "../../data/schemas";
import type { Span } from "../../data/types";
import type { TraceNode } from "./model";
import * as processor from "./processor";
import { TraceExplorer, type TraceExplorerProps } from "./viewer";

const mocks = vi.hoisted(() => ({
  scrollToIndex: vi.fn(),
  scrollToSpan: vi.fn(),
}));

vi.mock("./flamegraph", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./flamegraph")>()),
  TraceFlamegraph: ({
    onSelect,
    ref,
  }: {
    onSelect: (id: string) => void;
    ref?: Ref<{ scrollToSpan: (id: string) => void }>;
  }) => {
    useImperativeHandle(ref, () => ({ scrollToSpan: mocks.scrollToSpan }));
    return (
      <div data-testid="flamegraph">
        <button type="button" onClick={() => onSelect("child")}>
          Select flamegraph child
        </button>
      </div>
    );
  },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

vi.mock("./waterfall", () => ({
  TraceWaterfall: ({
    rows,
    selectedSpanId,
    onSelect,
    openNodes,
    onToggle,
    virtuosoRef,
  }: {
    rows: TraceNode[];
    selectedSpanId?: string;
    onSelect: (id: string) => void;
    openNodes: Set<string>;
    onToggle: (id: string) => void;
    virtuosoRef?: Ref<Pick<VirtuosoHandle, "scrollToIndex">>;
  }) => {
    useImperativeHandle(virtuosoRef, () => ({
      scrollToIndex: mocks.scrollToIndex,
    }));
    return (
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
    );
  },
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
  it.each([
    {},
    { from: "now-1h", to: "now" },
  ])("finishes loading a direct trace link with search %j", async (search) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T14:00:00Z"));
    const getTrace = vi.fn(async () => {
      vi.setSystemTime(new Date(Date.now() + 100));
      return [];
    });
    const repo: TracesRepositoryLike = {
      getTrace,
      search: vi.fn(async () => []),
      listServiceIdentities: vi.fn(async () => []),
      attributeKeys: vi.fn(async () => []),
      attributeValues: vi.fn(async () => []),
    };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const result = render(
      <QueryClientProvider client={client}>
        <TraceExplorer
          repo={repo}
          traceId="a73013fe4538179d2bb3c13234b37de4"
          search={TraceDetailParamsSchema.parse(search)}
          onBack={vi.fn()}
          onSpanChange={vi.fn()}
        />
      </QueryClientProvider>,
    );
    try {
      expect(
        await screen.findByRole("heading", { name: "Trace not found" }),
      ).toBeInTheDocument();
      expect(getTrace).toHaveBeenCalledTimes(1);
    } finally {
      result.unmount();
      client.clear();
    }
  });

  it("keeps the waterfall in place when a visible row is selected", async () => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(
      (callback) => {
        callback(0);
        return 0;
      },
    );
    const { props } = renderExplorer();
    await screen.findByRole("button", { name: "Select child" });
    fireEvent.click(screen.getByRole("button", { name: /Flamegraph/ }));
    await screen.findByTestId("flamegraph");
    fireEvent.click(screen.getByRole("button", { name: "Select child" }));
    expect(props.onSpanChange).toHaveBeenCalledWith("child");
    expect(mocks.scrollToIndex).not.toHaveBeenCalled();
    expect(mocks.scrollToSpan).toHaveBeenCalledWith("child");
  });

  it("reveals the waterfall row when a span is selected in the flamegraph", async () => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(
      (callback) => {
        callback(0);
        return 0;
      },
    );
    const { props } = renderExplorer();
    await screen.findByRole("button", { name: "Select child" });
    fireEvent.click(screen.getByRole("button", { name: /Flamegraph/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Select flamegraph child" }),
    );
    expect(props.onSpanChange).toHaveBeenCalledWith("child");
    expect(mocks.scrollToIndex).toHaveBeenCalledWith({
      index: 1,
      align: "center",
    });
    expect(mocks.scrollToSpan).not.toHaveBeenCalled();
  });

  it("reveals search matches in both views", async () => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(
      (callback) => {
        callback(0);
        return 0;
      },
    );
    renderExplorer();
    await screen.findByRole("button", { name: "Select child" });
    fireEvent.click(screen.getByRole("button", { name: /Flamegraph/ }));
    await screen.findByTestId("flamegraph");
    fireEvent.change(screen.getByRole("textbox", { name: "Search spans" }), {
      target: { value: "child" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next matching span" }));
    expect(mocks.scrollToSpan).toHaveBeenCalledWith("child");
    expect(mocks.scrollToIndex).toHaveBeenCalledWith({
      index: 1,
      align: "center",
    });
  });

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

  it("loads by trace ID even when the URL includes a time window", async () => {
    const { repo } = renderExplorer(
      TraceDetailParamsSchema.parse({
        start: "2026-10-06 12:00:00.000",
        end: "2026-10-06 12:00:01.000",
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "root" }),
    ).toBeInTheDocument();
    expect(repo.getTrace).toHaveBeenCalledWith({
      traceId: "trace-1",
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
