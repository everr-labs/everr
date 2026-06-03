import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LogsRepositoryLike } from "../data/repository";
import { LogFiltersBar } from "./log-filters";

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
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
    expect(
      screen.getByRole("complementary", { name: "Log filters" }),
    ).toBeInTheDocument();
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
});
