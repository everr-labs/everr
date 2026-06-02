import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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
  name: "",
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

describe("TraceFilters", () => {
  it("aligns the status toggle with the other filter controls", () => {
    renderWithQueryClient(
      <TraceFilters
        repo={makeRepo()}
        timeRange={defaultTimeRange}
        value={defaultValue}
        identities={[
          {
            serviceNamespace: "frontend",
            serviceName: "web",
          },
        ]}
        onChange={() => {}}
      />,
    );

    expect(screen.getByRole("group", { name: "Status" })).toHaveAttribute(
      "data-size",
      "lg",
    );
    expect(screen.getByRole("button", { name: "Ok" })).toHaveClass(
      "bg-transparent",
    );
  });
});

describe("TraceFilters sidebar", () => {
  it("renders status, service, and the attribute section", () => {
    const repo = makeRepo();
    renderWithQueryClient(
      <TraceFilters
        repo={repo}
        timeRange={defaultTimeRange}
        value={defaultValue}
        identities={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Service")).toBeInTheDocument();
    expect(screen.getByText("Attributes")).toBeInTheDocument();
  });
});
