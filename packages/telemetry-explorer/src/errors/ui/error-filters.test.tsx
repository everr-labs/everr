import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ErrorsRepositoryLike } from "../data/repository";
import { ErrorFilters } from "./error-filters";

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
}

const repo = {
  triageEvents: false,
  attributeKeys: vi.fn().mockResolvedValue([]),
  attributeValues: vi.fn().mockResolvedValue([]),
} as unknown as ErrorsRepositoryLike;

const triageRepo = { ...repo, triageEvents: true } as ErrorsRepositoryLike;

const baseValue = {
  q: "",
  service: [] as string[],
  fingerprint: "",
  sort: "lastSeen" as const,
  status: [],
  attributes: [],
};

describe("ErrorFilters", () => {
  it("renders Service, Environment and the attribute section in the sidebar", () => {
    renderWithQueryClient(
      <ErrorFilters
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        value={baseValue}
        services={[]}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("complementary", { name: "Error filters" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Service")).toBeInTheDocument();
    expect(screen.getByText("Environment")).toBeInTheDocument();
    expect(screen.getByText("Attributes")).toBeInTheDocument();
  });

  it("renders the environment selection once (combobox, not as a pill)", () => {
    renderWithQueryClient(
      <ErrorFilters
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        value={{
          ...baseValue,
          attributes: [
            {
              source: "resource",
              key: "deployment.environment",
              op: "in",
              values: ["prod"],
            },
          ],
        }}
        services={[]}
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

  it("clear-all resets service and attributes but not the sort order", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <ErrorFilters
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        value={{
          ...baseValue,
          service: ["api"],
          sort: "count",
          attributes: [
            {
              source: "resource",
              key: "deployment.environment",
              op: "in",
              values: ["prod"],
            },
          ],
        }}
        services={["api"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onChange).toHaveBeenCalledWith({ service: [], attributes: [] });
  });

  it("with hideSharedFilters, clear-all leaves the shared service filter untouched", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <ErrorFilters
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        hideSharedFilters
        value={{
          ...baseValue,
          service: ["api"],
          attributes: [
            {
              source: "resource",
              key: "http.method",
              op: "in",
              values: ["GET"],
            },
          ],
        }}
        services={["api"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    const patch = onChange.mock.calls[0]?.[0];
    expect(patch).not.toHaveProperty("service");
    expect(patch).toEqual({ attributes: [] });
  });

  it("shows the Status filter only when the repo has triage capability", () => {
    const onChange = vi.fn();
    const { rerender } = renderWithQueryClient(
      <ErrorFilters
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        value={baseValue}
        services={[]}
        onChange={onChange}
      />,
    );
    // Local/desktop surfaces have no triage Status yet.
    expect(screen.queryByText("Status")).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ErrorFilters
          repo={triageRepo}
          timeRange={{ from: "now-1h", to: "now" }}
          value={baseValue}
          services={[]}
          onChange={onChange}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Resolved" }));
    expect(onChange).toHaveBeenCalledWith({ status: ["resolved"] });
  });

  it("clear-all resets the status selection on triage surfaces", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <ErrorFilters
        repo={triageRepo}
        timeRange={{ from: "now-1h", to: "now" }}
        hideSharedFilters
        value={{ ...baseValue, status: ["open"] }}
        services={[]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onChange).toHaveBeenCalledWith({ attributes: [], status: [] });
  });

  it("with hideSharedFilters, a shared service alone does not surface Clear all", () => {
    renderWithQueryClient(
      <ErrorFilters
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        hideSharedFilters
        value={{ ...baseValue, service: ["api"] }}
        services={["api"]}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Clear all" }),
    ).not.toBeInTheDocument();
  });
});
