import type {
  TraceExplorerProps,
  TracesSearchProps,
} from "@everr/telemetry-explorer/traces";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { getRouter } from "../../router";

const local = vi.hoisted(() => ({
  client: {},
  repositoryClient: undefined as unknown,
}));

vi.mock("../local-telemetry/collector-status", () => ({
  LocalTelemetryGate: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("../logs/local-sql-client", () => ({ localSqlClient: local.client }));

vi.mock("@everr/telemetry-explorer/traces", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@everr/telemetry-explorer/traces")>();
  return {
    ...actual,
    TracesRepository: class {
      constructor(client: unknown) {
        local.repositoryClient = client;
      }
    },
    TracesSearch: (props: TracesSearchProps) => (
      <div>
        Trace list page
        {props.renderTraceLink?.({
          traceId: "trace-1",
          className: "",
          children: "Open trace",
        })}
      </div>
    ),
    TraceExplorer: (props: TraceExplorerProps) => (
      <div>
        Trace detail page
        <span>Selected {props.search.span ?? "none"}</span>
        <button type="button" onClick={props.onBack}>
          Back to traces
        </button>
        <button type="button" onClick={() => props.onSpanChange("child")}>
          Select child
        </button>
      </div>
    ),
  };
});

describe("local traces routes", () => {
  function renderTracesRoute(initialEntries: string[]) {
    const router = getRouter();
    router.update({ history: createMemoryHistory({ initialEntries }) });
    render(<RouterProvider router={router} />);
    return router;
  }

  it("opens direct trace links as a full page using the local repository", async () => {
    renderTracesRoute(["/traces/trace-1?span=child"]);
    expect(await screen.findByText("Trace detail page")).toBeInTheDocument();
    expect(screen.getByText("Selected child")).toBeInTheDocument();
    expect(screen.queryByText("Trace list page")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(local.repositoryClient).toBe(local.client);
  });

  it("preserves list filters and span selection without adding trace timestamps", async () => {
    const router = renderTracesRoute(["/traces?from=now-1h&to=now"]);
    fireEvent.click(await screen.findByRole("link", { name: "Open trace" }));
    expect(await screen.findByText("Trace detail page")).toBeInTheDocument();
    expect(screen.getByText("Selected none")).toBeInTheDocument();
    expect(router.state.location.search).toMatchObject({
      from: "now-1h",
      to: "now",
    });
    expect(router.state.location.search).not.toHaveProperty("start");
    expect(router.state.location.search).not.toHaveProperty("end");
    fireEvent.click(screen.getByRole("button", { name: "Select child" }));
    expect(await screen.findByText("Selected child")).toBeInTheDocument();
    expect(router.state.location.search.span).toBe("child");
    fireEvent.click(screen.getByRole("button", { name: "Back to traces" }));
    expect(await screen.findByText("Trace list page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/traces");
  });
});
