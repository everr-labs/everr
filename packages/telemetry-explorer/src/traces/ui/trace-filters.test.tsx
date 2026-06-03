import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { TracesRepositoryLike } from "../data/repository";
import { TraceFilters } from "./trace-filters";

function makeRepo(): TracesRepositoryLike {
  return {
    attributeKeys: vi.fn().mockResolvedValue([]),
    attributeValues: vi.fn().mockResolvedValue([]),
  } as unknown as TracesRepositoryLike;
}

const defaultTimeRange = { from: "now-1h", to: "now" } as const;

const defaultValue = {
  namespace: [],
  service: [],
  minMs: undefined,
  maxMs: undefined,
  status: "all" as const,
  attributes: [],
};

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
}

describe("TraceFilters sidebar", () => {
  it("renders Status, Service, Environment and the attribute section", () => {
    renderWithQueryClient(
      <TraceFilters
        repo={makeRepo()}
        timeRange={defaultTimeRange}
        value={defaultValue}
        identities={[]}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("complementary", { name: "Trace filters" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Service")).toBeInTheDocument();
    expect(screen.getByText("Environment")).toBeInTheDocument();
    expect(screen.getByText("Attributes")).toBeInTheDocument();
  });

  it("does not render the span-name input (it moved to the header bar)", () => {
    renderWithQueryClient(
      <TraceFilters
        repo={makeRepo()}
        timeRange={defaultTimeRange}
        value={defaultValue}
        identities={[]}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByPlaceholderText("Span name contains..."),
    ).not.toBeInTheDocument();
  });

  it("renders the environment selection once (combobox, not as a pill)", () => {
    renderWithQueryClient(
      <TraceFilters
        repo={makeRepo()}
        timeRange={defaultTimeRange}
        value={{
          ...defaultValue,
          attributes: [
            {
              source: "resource",
              key: "deployment.environment",
              op: "in",
              values: ["prod"],
            },
          ],
        }}
        identities={[]}
        onChange={vi.fn()}
      />,
    );
    // Environment is owned by the dedicated combobox; it must NOT also render as
    // a removable attribute pill in the Attributes section.
    expect(screen.getAllByText("prod")).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "Remove Environment filter" }),
    ).not.toBeInTheDocument();
  });

  it("clear-all resets namespace, service, durations, status and attributes", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <TraceFilters
        repo={makeRepo()}
        timeRange={defaultTimeRange}
        value={{ ...defaultValue, status: "error", service: ["web"] }}
        identities={[]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onChange).toHaveBeenCalledWith({
      namespace: [],
      service: [],
      minMs: undefined,
      maxMs: undefined,
      status: "all",
      attributes: [],
    });
  });
});
