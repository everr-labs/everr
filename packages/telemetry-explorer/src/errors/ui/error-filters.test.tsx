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
  attributeKeys: vi.fn().mockResolvedValue([]),
  attributeValues: vi.fn().mockResolvedValue([]),
} as unknown as ErrorsRepositoryLike;

const baseValue = {
  q: "",
  service: [] as string[],
  fingerprint: "",
  sort: "lastSeen" as const,
  attributes: [],
};

describe("ErrorFilters", () => {
  it("renders Search, Order and the attribute section in the rail", () => {
    renderWithQueryClient(
      <ErrorFilters
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        value={baseValue}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("complementary", { name: "Error filters" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.getByText("Order")).toBeInTheDocument();
    expect(screen.getByText("Attributes")).toBeInTheDocument();
  });

  it("never renders Service or Environment: those belong to the persistent zone", () => {
    renderWithQueryClient(
      <ErrorFilters
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        value={baseValue}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText("Service")).not.toBeInTheDocument();
    expect(screen.queryByText("Environment")).not.toBeInTheDocument();
  });

  it("renders the message search inside the rail", () => {
    renderWithQueryClient(
      <ErrorFilters
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        value={baseValue}
        onChange={vi.fn()}
      />,
    );
    const rail = screen.getByRole("complementary", { name: "Error filters" });
    expect(rail).toContainElement(screen.getByPlaceholderText("Search errors"));
  });

  it("shows a legacy deployment.environment attribute as a removable pill", () => {
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
        onChange={vi.fn()}
      />,
    );
    // The top zone of the rail sets Environment, and it writes its own search
    // param. An older entry, for example from a saved link, must stay visible
    // and the user must be able to remove it. The query still applies that
    // entry, so a hidden entry narrows the results for no visible reason.
    expect(
      screen.getByRole("button", { name: "Remove Environment filter" }),
    ).toBeInTheDocument();
  });

  it("clear resets the search and attributes but not the sort order", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <ErrorFilters
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        value={{
          ...baseValue,
          q: "TypeError",
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
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear page filters" }));
    expect(onChange).toHaveBeenCalledWith({ q: "", attributes: [] });
  });

  it("clear never touches the persistent filters", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <ErrorFilters
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        value={{ ...baseValue, q: "TypeError" }}
        persistentFilterCount={1}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear page filters" }));
    const patch = onChange.mock.calls[0]?.[0];
    expect(patch).not.toHaveProperty("service");
    expect(patch).not.toHaveProperty("environment");
  });

  it("an active persistent filter alone does not surface the clear control", () => {
    renderWithQueryClient(
      <ErrorFilters
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        value={baseValue}
        persistentFilterCount={1}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Clear page filters" }),
    ).not.toBeInTheDocument();
  });

  it("the sort control alone does not surface the clear control", () => {
    renderWithQueryClient(
      <ErrorFilters
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        value={{ ...baseValue, sort: "count" }}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Clear page filters" }),
    ).not.toBeInTheDocument();
  });
});
