import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import type { LogsRepositoryLike } from "../data/repository";
import { LogFiltersBar } from "./log-filters";

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

const repo = {
  attributeKeys: vi.fn().mockResolvedValue([]),
  attributeValues: vi.fn().mockResolvedValue([]),
  filterOptions: vi.fn().mockResolvedValue({ services: [] }),
} as unknown as LogsRepositoryLike;

const baseProps = {
  repo,
  timeRange: { from: "now-1h", to: "now" } as const,
  levels: [],
  services: [],
  attributes: [],
  traceId: undefined,
};

describe("LogFiltersBar", () => {
  it("renders Service, Environment and the attribute section inside the sidebar", () => {
    renderWithQueryClient(<LogFiltersBar {...baseProps} onChange={vi.fn()} />);
    expect(screen.getByRole("complementary", { name: "Log filters" })).toBeInTheDocument();
    expect(screen.getByText("Service")).toBeInTheDocument();
    expect(screen.getByText("Environment")).toBeInTheDocument();
    expect(screen.getByText("Attributes")).toBeInTheDocument();
  });

  it("clear-all resets levels, services, attributes and trace id", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <LogFiltersBar
        {...baseProps}
        levels={["error"]}
        services={["api"]}
        attributes={[
          {
            source: "resource",
            key: "deployment.environment",
            op: "in",
            values: ["prod"],
          },
        ]}
        traceId="abc"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onChange).toHaveBeenCalledWith({
      levels: [],
      services: [],
      attributes: [],
      traceId: undefined,
    });
  });

  it("with hideSharedFilters, clear-all leaves the shared service filter untouched", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <LogFiltersBar
        {...baseProps}
        hideSharedFilters
        levels={["error"]}
        services={["api"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    const patch = onChange.mock.calls[0]?.[0];
    expect(patch).not.toHaveProperty("services");
    expect(patch).toEqual({ levels: [], attributes: [], traceId: undefined });
  });

  it("with hideSharedFilters, a shared service alone does not surface Clear all", () => {
    renderWithQueryClient(
      <LogFiltersBar {...baseProps} hideSharedFilters services={["api"]} onChange={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
  });

  it("deployment.environment renders in the Environment combobox and NOT as an attribute pill", () => {
    // Invariant: deployment.environment is a dedicated combobox filter. It must
    // be split out of the attributes passed to AttributeFilterSection so it
    // never appears as a generic attribute pill in the "Attributes" section.
    // A leaked pill would mean the env value shows up twice and a
    // "Remove Environment filter" button would exist.
    renderWithQueryClient(
      <LogFiltersBar
        {...baseProps}
        attributes={[
          {
            source: "resource",
            key: "deployment.environment",
            op: "in",
            values: ["prod"],
          },
        ]}
        onChange={vi.fn()}
      />,
    );

    // The selected value "prod" must appear exactly once — as a badge inside
    // the Environment combobox button. If the env filter leaked into
    // AttributeFilterSection it would render a second time in the pill.
    expect(screen.getAllByText("prod")).toHaveLength(1);

    // A leaked attribute pill for deployment.environment would render a remove
    // button with this aria-label. It must not exist.
    expect(
      screen.queryByRole("button", { name: "Remove Environment filter" }),
    ).not.toBeInTheDocument();
  });

  it("syncs the Trace input when the traceId prop is cleared externally", () => {
    // Regression: the Trace input held a local draft seeded once from traceId.
    // When traceId is cleared elsewhere (e.g. "Clear all" / link navigation),
    // the input must follow it — otherwise it shows a stale id and reapplies it
    // on Enter.
    const { rerender } = renderWithQueryClient(
      <LogFiltersBar {...baseProps} traceId="abc123" onChange={vi.fn()} />,
    );
    const input = screen.getByLabelText("Trace") as HTMLInputElement;
    expect(input.value).toBe("abc123");

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <LogFiltersBar {...baseProps} traceId={undefined} onChange={vi.fn()} />
      </QueryClientProvider>,
    );
    expect((screen.getByLabelText("Trace") as HTMLInputElement).value).toBe("");
  });
});
